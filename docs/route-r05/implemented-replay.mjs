// R05 OFFLINE ONLY. Uses the actual createEnricher planner and shared server
// admission transitions. Never fetches a provider or invents a flight route.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { dataset, windowMetrics } from './model.mjs';
import { createEnricher } from '../../src/enrichment.ts';
import {
  enrichmentKey,
  ENRICHMENT_POLICY as P,
} from '../../src/enrichmentTypes.ts';
import {
  initialAdaptiveState,
  advanceAdaptiveState,
  adaptiveEligibility,
  reserveAdaptive,
  finishAdaptive,
} from '../../src/adaptiveBudget.ts';
import { urgentPass, urgencyFor } from '../../src/observation.ts';
globalThis.fetch = () => {
  throw Error('Provider traffic prohibited in offline replay');
};
const ds = await dataset(
  fileURLToPath(
    new URL('../route-r04/live/observation.json', import.meta.url),
  ),
);
const median = (xs) => {
  const a = [...xs].sort((a, b) => a - b),
    m = Math.floor(a.length / 2);
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null;
};
const brief = (xs) => ({
  count: xs.length,
  medianMs: median(xs),
  maximumMs: xs.length ? Math.max(...xs) : null,
});
function replay(
  adaptive,
  { unknownFailure = false, primaryOnly = false } = {},
) {
  let now = ds.start,
    pending = null,
    nextWake = Infinity,
    index = 0,
    lastPrimary = null;
  let state = initialAdaptiveState(now),
    nextGlobal = now,
    nextSecondary = now;
  const clientCache = new Map(),
    censored = new Set(),
    doneIdentity = new Set(),
    attempts = [],
    responses = [],
    acquisitions = [],
    firstAttempts = new Map();
  const budget = { nextAllowed: now, nextSecondaryAllowed: now };
  const planner = createEnricher(() => {}, {
    adaptive,
    cache: clientCache,
    budget,
    now: () => now,
    monotonicNow: () => now,
    active: () => false,
    setTimer: () => {
      throw Error('No browser timer in planning-only replay');
    },
    clearTimer: () => {},
    fetch: () => {
      throw Error('Planning-only replay cannot fetch');
    },
  });
  // Original completion publications are display evidence, not an extra
  // dispatch trigger. The model supplies its own response/completion times.
  const times = [
    ...new Set([
      ...ds.times,
      ...ds.scenes
        .filter(
          (s, i) => s.primary?.ref !== ds.scenes[i - 1]?.primary?.ref,
        )
        .map((s) => s.atMs),
    ]),
  ].sort((a, b) => a - b);
  let primaryMs = 0,
    completePrimaryMs = 0,
    marginalRequests = 0,
    cacheHits = 0,
    cacheReads = 0,
    primaryBlockedBySecondaryMs = 0,
    minimumTokens = 3;
  const firstPrimaryReady = new Map();
  function scene(t) {
    const w = ds.world(t);
    const present = new Set(w.all.map((a) => a.id));
    const toAircraft = (a) => ({
      id: a.id,
      manufacturer: a.manufacturer,
      model: a.model,
      operator: null,
      registration: null,
      typeCode: a.typeCode,
      altitudeFt: a.barometricAltitudeFt,
      distanceKm: a.distanceKm,
      origin: null,
      destination: null,
      callsign: a.callsign,
      direction: null,
      observation: a.observation,
    });
    return {
      id: 'recorded',
      label: 'Recorded R04',
      duration: 0,
      state: w.primary ? 'available' : 'standby',
      primary: w.primary ? toAircraft(w.primary) : null,
      secondary: w.secondary.map(toAircraft),
      enrichmentCandidates: w.all
        .filter((a) => a.id !== w.primary?.id)
        .map(toAircraft),
      present,
    };
  }
  function candidates() {
    const s = scene(now);
    budget.nextSecondaryAllowed = nextSecondary;
    planner.update(s);
    // Metadata content was redacted. Preserve the six observed identity jobs,
    // released at their original times, instead of manufacturing extra identity
    // successes or missing-type demand from that redaction.
    const identities = ds.identities.filter(
      (i) =>
        i.release <= now &&
        !doneIdentity.has(i.index) &&
        s.present.has(i.ref),
    );
    const forced = identities.length
      ? [
          {
            kind: 'aircraft',
            hex: identities[0].ref,
            callsign: null,
            secondary: s.primary?.id !== identities[0].ref,
            identityIndex: identities[0].index,
          },
        ]
      : [];
    const routes = planner
      .plan()
      .filter((j) => j.kind === 'route' && (!primaryOnly || !j.secondary));
    return [...forced, ...routes].filter(
      (j) =>
        !censored.has(
          j.kind === 'route'
            ? j.hex + ':' + j.callsign
            : 'identity:' + j.hex,
        ),
    );
  }
  const cacheGet = clientCache.get.bind(clientCache);
  clientCache.get = (k) => {
    cacheReads++;
    const v = cacheGet(k);
    if (v && v.expiresAtMs > now) cacheHits++;
    return v;
  };
  function routeReady(ref, t) {
    const a = ds.world(t).all.find((a) => a.id === ref);
    if (!a) return null;
    const hit = cacheGet(enrichmentKey('route', ref, a.callsign));
    return hit &&
      hit.expiresAtMs > t &&
      hit.status === 'found' &&
      hit.data.origin &&
      hit.data.destination
      ? hit
      : null;
  }
  function exposure(until) {
    const s = scene(now);
    if (!s.primary) return;
    primaryMs += until - now;
    const hit = routeReady(s.primary.id, now);
    if (hit)
      completePrimaryMs += Math.max(
        0,
        Math.min(until, hit.expiresAtMs) - now,
      );
    if (pending?.job.secondary && !hit)
      primaryBlockedBySecondaryMs += until - now;
  }
  while (now <= ds.end) {
    const t = Math.min(
      times[index] ?? Infinity,
      pending?.finish ?? Infinity,
      nextWake,
      ds.end,
    );
    if (t < now || !Number.isFinite(t))
      throw Error('Invalid replay event');
    exposure(t);
    now = t;
    let opportunity = false;
    if (pending && pending.finish <= now) {
      const { job, key, result, id } = pending;
      pending = null;
      if (adaptive) {
        state = advanceAdaptiveState(state, now);
        state = finishAdaptive(
          state,
          id,
          !result && unknownFailure
            ? {
                code: 'unobserved-hypothetical-error',
                retryAfterMs: 300000,
              }
            : undefined,
        );
      } else if (!result && unknownFailure)
        nextGlobal = Math.max(nextGlobal, now + 300000);
      if (job.kind === 'aircraft') doneIdentity.add(job.identityIndex);
      if (result) {
        const data = result.data ?? {},
          found =
            job.kind === 'aircraft'
              ? result.outcome === 'identity'
              : result.outcome === 'complete' ||
                result.outcome === 'partial';
        const valid =
          found &&
          (data.associationTimeMs == null ||
            (data.associationTimeMs <= now &&
              now - data.associationTimeMs <= P.maxRouteAgeMs));
        const value = {
          kind: job.kind,
          hex: job.hex,
          callsign: job.callsign,
          source: 'hexdb.io',
          status: valid ? 'found' : 'not-found',
          data: valid ? data : {},
          fetchedAtMs: now,
          expiresAtMs:
            now +
            (valid
              ? job.kind === 'route'
                ? P.routeTtlMs
                : P.identityTtlMs
              : P.negativeTtlMs),
        };
        clientCache.set(
          enrichmentKey(job.kind, job.hex, job.callsign),
          value,
        );
      } else censored.add(key); // no route, miss or metadata answer invented
      responses.push({
        atMs: now,
        key,
        kind: job.kind,
        known: !!result,
        outcome: result?.outcome ?? 'unobserved-censored',
        secondary: job.secondary,
      });
      opportunity = adaptive;
    }
    if (nextWake <= now) {
      nextWake = Infinity;
      opportunity = adaptive;
    }
    while ((times[index] ?? Infinity) <= now) {
      index++;
      opportunity = true;
    }
    const current = scene(now).primary?.id ?? null;
    if (current !== lastPrimary) {
      if (current) {
        const ready = !!routeReady(current, now);
        acquisitions.push({ atMs: now, ref: current, ready });
        if (!firstPrimaryReady.has(current))
          firstPrimaryReady.set(current, ready);
      }
      lastPrimary = current;
    }
    if (opportunity && !pending && now < ds.end) {
      const jobs = candidates();
      let next = Infinity,
        choice = null;
      for (const job of jobs) {
        const a = ds.world(now).all.find((a) => a.id === job.hex);
        const normal =
          job.kind !== 'aircraft' &&
          job.secondary &&
          !(
            urgentPass(a?.observation, now) ||
            urgencyFor(a?.observation, now) >= 50
          );
        const gate = adaptive
          ? adaptiveEligibility(advanceAdaptiveState(state, now), normal)
              .atMs
          : Math.max(
              now,
              nextGlobal,
              job.secondary && job.kind === 'route' ? nextSecondary : now,
            );
        if (gate <= now) {
          choice = { ...job, normal };
          break;
        }
        next = Math.min(next, gate);
      }
      if (choice) {
        const key =
            choice.kind === 'route'
              ? choice.hex + ':' + choice.callsign
              : 'identity:' + choice.hex,
          result = ds.oracle.get(key) ?? null,
          id = randomUUID();
        if (adaptive) {
          state = reserveAdaptive(
            advanceAdaptiveState(state, now),
            id,
            createHash('sha256').update(key).digest('hex'),
            choice.normal,
          );
          minimumTokens = Math.min(minimumTokens, state.tokens);
        } else {
          nextGlobal = now + 30000;
          if (choice.secondary && choice.kind === 'route')
            nextSecondary = now + 90000;
        }
        const attempt = {
          atMs: now,
          key,
          kind: choice.kind,
          hex: choice.hex,
          secondary: choice.secondary,
          knownOutcome: !!result,
          tokensAfter: adaptive ? state.tokens : null,
        };
        attempts.push(attempt);
        if (!ds.significant.has(choice.hex)) marginalRequests++;
        if (choice.kind === 'route' && !firstAttempts.has(key))
          firstAttempts.set(key, now);
        pending = {
          job: choice,
          key,
          result,
          id,
          finish: Math.ceil(now + (result?.latency ?? ds.unknownLatency)),
        };
      } else if (adaptive && Number.isFinite(next) && next > now)
        nextWake = next;
    }
    if (now === ds.end) break;
  }
  planner.stop();
  const starts = attempts.map((a) => a.atMs),
    five = windowMetrics(starts, 300000, ds.start, ds.end),
    one = windowMetrics(starts, 60000, ds.start, ds.end);
  return {
    policy: adaptive ? 'R05-implemented-10' : 'R04-implemented-30-90',
    conditional: true,
    unknownFailure,
    primaryOnly,
    requests: attempts.length,
    routeRequests: attempts.filter((a) => a.kind === 'route').length,
    identityRequests: attempts.filter((a) => a.kind === 'aircraft').length,
    unknownRequests: attempts.filter((a) => !a.knownOutcome).length,
    peakOneMinute: one.peak,
    peakFiveMinutes: five.peak,
    maximumBurst30s: windowMetrics(starts, 30000, ds.start, ds.end).peak,
    minimumStartGapMs:
      starts.length > 1
        ? Math.min(...starts.slice(1).map((t, i) => t - starts[i]))
        : null,
    minimumTokens: adaptive ? minimumTokens : null,
    firstPrimaryAircraft: firstPrimaryReady.size,
    firstPrimaryReady: [...firstPrimaryReady.values()].filter(Boolean)
      .length,
    allAcquisitions: acquisitions.length,
    readyAcquisitions: acquisitions.filter((a) => a.ready).length,
    primaryMs,
    completePrimaryMs,
    completePrimaryPercent: (100 * completePrimaryMs) / primaryMs,
    primaryWithoutRouteWhileSecondaryInFlightMs:
      primaryBlockedBySecondaryMs,
    firstDetectionToRequest: brief(
      [...firstAttempts].map(([k, t]) => t - ds.firstSeen.get(k)),
    ),
    recordedGoneWithoutAttempt: [...ds.firstSeen].filter(
      ([k]) =>
        !firstAttempts.has(k) &&
        !ds.frames[ds.frames.length - 1].snapshot.aircraft.some(
          (a) => a.id + ':' + a.callsign === k,
        ),
    ).length,
    requestsNeverSignificantlyRelevant: marginalRequests,
    cacheCandidateReads: cacheReads,
    cacheBackedReads: cacheHits,
    knownCompleteResponses: responses.filter(
      (r) => r.kind === 'route' && r.outcome === 'complete',
    ).length,
    hypotheticalBackoffs: unknownFailure
      ? responses.filter((r) => !r.known).length
      : 0,
    attempts,
    responses,
    acquisitions,
  };
}
const comparisons = [
  replay(false),
  replay(true),
  replay(true, { unknownFailure: true }),
  replay(true, { primaryOnly: true }),
];
const output = {
  basis:
    'Conditional offline replay through actual createEnricher.plan and shared R05 admission transitions; frozen captured selection; six identity demands fixed; unknown outcomes charged/censored without route credit.',
  limits: [
    'Not a bit-exact React/poller replay; original timer omissions and identity redaction persist.',
    'No claim that a recorded later HexDB response would have been identical earlier.',
    'Unknown neutral occupancy/censoring is analytical bookkeeping, not a returned provider answer or runtime cache policy.',
    'No new live provider calls; no current household coverage inference.',
  ],
  startMs: ds.start,
  endMs: ds.end,
  comparisons,
};
await writeFile(
  new URL('implemented-replay.json', import.meta.url),
  JSON.stringify(output, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    comparisons.map((row) => {
      const r = { ...row };
      delete r.attempts;
      delete r.responses;
      delete r.acquisitions;
      return r;
    }),
    null,
    2,
  ),
);

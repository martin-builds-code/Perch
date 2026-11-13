// R05 RESEARCH ONLY. Not imported by the application or server. No provider calls.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  observation,
  urgencyFor,
  urgentPass,
} from '../../src/observation.ts';
import { routeUtilityHint } from '../../src/routeUtility.ts';
const WINDOW = 300000;
export const CAPS = [10, 20, 30, 50];
export const policies = () => [
  {
    name: 'fixed-30-90',
    fixed: true,
    cap: 10,
    burst: 1,
    spacing: 30000,
    reserve: 0,
    drain: false,
    secondary: 90000,
  },
  ...CAPS.map((cap) => ({
    name: 'adaptive-' + cap,
    cap,
    burst: 3,
    spacing: 5000,
    reserve: 1,
    drain: true,
    secondary: 0,
  })),
];
const latest = (rows, time) => {
  let lo = 0,
    hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].atMs <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo ? rows[lo - 1] : null;
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};
const stats = (xs) => ({
  count: xs.length,
  medianMs: median(xs),
  maxMs: xs.length ? Math.max(...xs) : null,
});
export function windowMetrics(times, window, start, end) {
  const sorted = [...times].sort((a, b) => a - b);
  let peak = 0,
    left = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (sorted[left] <= sorted[i] - window) left++;
    peak = Math.max(peak, i - left + 1);
  }
  const endpoints = [
    ...new Set([
      start,
      end,
      ...sorted
        .flatMap((t) => [t, t + window])
        .filter((t) => t >= start && t <= end),
    ]),
  ].sort((a, b) => a - b);
  const curve = endpoints.map((atMs) => ({
    atMs,
    count: sorted.filter((t) => t > atMs - window && t <= atMs).length,
  }));
  return { peak, curve };
}
export class Budget {
  constructor(p, start) {
    if (
      !Number.isInteger(p.cap) ||
      p.cap < 1 ||
      p.cap > 50 ||
      p.burst < 1 ||
      p.burst > p.cap ||
      p.reserve < 0 ||
      p.reserve >= p.burst ||
      !Number.isFinite(start)
    )
      throw Error('Invalid research policy');
    this.p = p;
    this.tokens = p.burst;
    this.updated = start;
    this.next = start;
    this.nextSecondary = start;
    this.starts = [];
    this.cooldown = start;
  }
  refill(now) {
    if (!Number.isFinite(now) || now < this.updated)
      throw Error('Invalid/backwards coordinator clock');
    this.tokens = Math.min(
      this.p.burst,
      this.tokens + ((now - this.updated) * this.p.cap) / WINDOW,
    );
    this.updated = now;
  }
  permitAt(now, job) {
    this.refill(now);
    let eligible = Math.max(
      now,
      this.next,
      this.cooldown,
      job.secondary && job.kind === 'route' ? this.nextSecondary : now,
    );
    const live = this.starts.filter((t) => t > now - WINDOW);
    if (live.length >= this.p.cap)
      eligible = Math.max(
        eligible,
        live[live.length - this.p.cap] + WINDOW,
      );
    if (!this.p.fixed) {
      const needed = job.essential ? 1 : 1 + this.p.reserve;
      if (this.tokens + 1e-9 < needed)
        eligible = Math.max(
          eligible,
          now + ((needed - this.tokens) * WINDOW) / this.p.cap,
        );
    }
    // Admission timestamps use whole milliseconds, rounded conservatively up.
    // A floating token-refill boundary must never admit just before log expiry.
    return Math.ceil(eligible);
  }
  admit(now, job) {
    if (this.permitAt(now, job) > now) throw Error('Admission bypass');
    this.starts.push(now);
    this.next = now + this.p.spacing;
    if (job.secondary && job.kind === 'route')
      this.nextSecondary = now + this.p.secondary;
    if (!this.p.fixed) this.tokens = Math.max(0, this.tokens - 1);
    return this.tokens;
  }
  backoff(until) {
    this.cooldown = Math.max(this.cooldown, until);
  }
}
export async function dataset(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const frames = raw.sky.frames,
    scenes = raw.sky.events.filter((e) => e.type === 'scene');
  const responses = raw.sky.events.filter((e) => e.type === 'response');
  const attempts = raw.sky.events.filter((e) => e.type === 'attempt');
  const records = new Map(),
    firstSeen = new Map(),
    oracle = new Map();
  for (const f of frames)
    for (const a of f.snapshot.aircraft) {
      if (!records.has(a.id)) records.set(a.id, []);
      records.get(a.id).push({ atMs: f.atMs, aircraft: a });
      const key = a.id + ':' + a.callsign;
      if (!firstSeen.has(key)) firstSeen.set(key, f.atMs);
    }
  for (const e of responses) {
    const key =
      e.kind === 'route' ? e.ref + ':' + e.flightRef : 'identity:' + e.ref;
    const sample = raw.apiSamples.find(
      (s) =>
        s.ref === e.ref &&
        s.kind === e.kind &&
        Math.abs(s.atMs - e.atMs) < 5000,
    );
    if (!oracle.has(key))
      oracle.set(key, {
        outcome: e.diagnostic?.outcome ?? 'unknown',
        latency: e.durationMs,
        diagnostic: e.diagnostic,
        data: sample?.data ?? {},
        knownAtMs: e.atMs,
      });
  }
  const latencies = responses.map((e) => e.durationMs),
    unknownLatency = median(latencies) ?? 800;
  const identities = attempts
    .filter((e) => e.kind === 'aircraft')
    .map((e, i) => ({
      ...e,
      index: i,
      release: e.atMs,
      key: 'identity:' + e.ref,
    }));
  // Exclude the original response-induced publications as dispatch opportunities.
  // Keep them for the frozen display trace. Their replacements are model completions.
  const opportunities = scenes
    .filter(
      (s) =>
        !responses.some((r) => s.atMs >= r.atMs && s.atMs - r.atMs <= 10),
    )
    .map((s) => s.atMs);
  const times = [
    ...new Set([
      ...frames.map((f) => f.atMs),
      ...opportunities,
      ...identities.map((j) => j.release),
    ]),
  ].sort((a, b) => a - b);
  const primaryFirst = new Map(),
    significant = new Set(),
    observed = new Set();
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i],
      next = scenes[i + 1]?.atMs ?? raw.observedUntilMs;
    if (s.primary) {
      if (!primaryFirst.has(s.primary.ref))
        primaryFirst.set(s.primary.ref, s.atMs);
      if (next - s.atMs >= 15000) significant.add(s.primary.ref);
    }
  }
  for (const f of frames)
    for (const r of f.result.ranked) {
      observed.add(r.ref);
      if (
        (r.observation?.elevationDegrees ?? 0) >= 45 ||
        (r.distanceKm ?? Infinity) < 1
      )
        significant.add(r.ref);
    }
  function world(now) {
    const frame = latest(frames, now),
      scene = latest(scenes, now);
    if (!frame || !scene?.primary)
      return { primary: null, secondary: [], all: [] };
    const ids = new Set(frame.snapshot.aircraft.map((a) => a.id));
    ids.add(scene.primary.ref);
    const all = [];
    for (const id of ids) {
      const old = latest(records.get(id) ?? [], now);
      if (!old) continue;
      const a = old.aircraft;
      if (
        a.onGround === true ||
        !a.validity.position ||
        !a.validity.timestamp ||
        a.validity.anomalies.length ||
        a.positionTimeMs === null ||
        now < a.positionTimeMs ||
        now - a.positionTimeMs >= 120000 ||
        a.distanceKm === null ||
        a.distanceKm > 15
      )
        continue;
      const ranked = frame.result.ranked.find((r) => r.ref === id),
        previous = ranked?.observation;
      const o = observation(
        a,
        now,
        previous?.predictionQuality === 'supported' ? 2 : 1,
        previous?.reason !==
          'Ground track conflicts with recent displacement',
      );
      const match = a.description?.match(
        /^(Airbus|Boeing|Embraer|Cessna|ATR)\s+(.+)$/,
      );
      all.push({
        ...a,
        observation: o,
        manufacturer: match?.[1] ?? null,
        model: match?.[2] ?? a.description ?? null,
        operator: null,
        registration: null,
        rank: ranked?.score ?? 0,
      });
    }
    const primary = all.find((a) => a.id === scene.primary.ref) ?? null;
    const displayed = new Set(scene.secondary.map((a) => a.ref));
    return {
      primary,
      secondary: all.filter((a) => displayed.has(a.id)),
      all,
    };
  }
  return {
    raw,
    frames,
    scenes,
    responses,
    attempts,
    records,
    firstSeen,
    oracle,
    unknownLatency,
    identities,
    times,
    primaryFirst,
    significant,
    observed,
    world,
    start: raw.startedAtMs,
    end: raw.observedUntilMs,
  };
}
export function simulate(ds, p, { unknownFailure = false } = {}) {
  const budget = new Budget(p, ds.start),
    cache = new Map(),
    censored = new Set(),
    doneIdentities = new Set(),
    secondarySeen = new Map();
  const log = [],
    completions = [],
    tokenTrace = [],
    firstAttempts = new Map(),
    firstRoutes = new Map(),
    ready = new Map();
  let external = 0,
    now = ds.start,
    wake = Infinity,
    pending = null,
    cacheChecks = 0,
    reserveBlocks = 0,
    quotaBlocks = 0;
  let previousPrimary = null;
  const cached = (key, t) => {
    const c = cache.get(key);
    return c && c.expires > t ? c : null;
  };
  function plan(t) {
    const w = ds.world(t);
    if (!w.primary) {
      secondarySeen.clear();
      return [];
    }
    const primary = w.primary;
    const present = new Set(
      w.all
        .filter((a) => a.id !== primary.id)
        .map((a) => a.id + ':' + a.callsign),
    );
    for (const k of present)
      if (!secondarySeen.has(k)) secondarySeen.set(k, t);
    for (const k of secondarySeen.keys())
      if (!present.has(k)) secondarySeen.delete(k);
    const identities = ds.identities.filter(
      (j) =>
        j.release <= t &&
        !doneIdentities.has(j.index) &&
        w.all.some((a) => a.id === j.ref),
    );
    // Hold the six observed identity demands fixed across all policies because
    // privacy-redacted registrations/operator fields cannot reconstruct metadata demand.
    const identity = identities[0];
    if (identity)
      return [
        {
          kind: 'aircraft',
          ref: identity.ref,
          key: identity.key,
          index: identity.index,
          secondary: identity.ref !== primary.id,
          essential: true,
          utility: 1000,
          reason: 'fixed recorded identity demand',
        },
      ];
    function routeJob(a, secondary) {
      if (!/^[A-Z0-9]{2,8}$/.test(a.callsign ?? '')) return null;
      const key = a.id + ':' + a.callsign,
        c = cached(key, t);
      if (c) {
        cacheChecks++;
        if (!secondary && c.complete && c.expires - t <= 30000) {
        } else return null;
      }
      if (censored.has(key)) return null;
      const urgency = urgencyFor(a.observation, t),
        o = a.observation;
      return {
        kind: 'route',
        ref: a.id,
        key,
        secondary,
        essential: !secondary || urgentPass(o, t) || urgency >= 50,
        utility: secondary
          ? (urgency > 0
              ? urgency
              : 10 +
                (10 * (o.elevationDegrees ?? 0)) / 90 +
                10 / (1 + (a.distanceKm ?? 15))) * routeUtilityHint(a)
          : Math.max(
              urgency,
              45 +
                (25 * (o.elevationDegrees ?? 0)) / 90 +
                15 / (1 + (a.distanceKm ?? 15)),
            ),
        reason:
          urgency > 0
            ? 'R04 predicted urgency'
            : 'R04 conservative geometry',
        aircraft: a,
      };
    }
    const main = routeJob(primary, false),
      shown = new Set(w.secondary.map((a) => a.id));
    const candidates = w.all
      .filter((a) => a.id !== primary.id)
      .sort(
        (a, b) =>
          b.observation.urgency - a.observation.urgency ||
          b.rank - a.rank ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 6);
    const requests = [];
    for (const a of candidates) {
      const o = a.observation,
        key = a.id + ':' + a.callsign,
        u = urgencyFor(o, t);
      if (!shown.has(a.id) && !urgentPass(o, t)) continue;
      if (
        o.elevationDegrees != null &&
        o.elevationDegrees < 5 &&
        a.distanceKm > 5 &&
        u === 0 &&
        t - (secondarySeen.get(key) ?? t) < 90000
      )
        continue;
      if (
        o.phase === 'departing' &&
        a.distanceKm > 3 &&
        (o.elevationDegrees ?? 90) < 20
      )
        continue;
      const r = routeJob(a, true);
      if (r) requests.push(r);
    }
    requests.sort(
      (a, b) => b.utility - a.utility || a.ref.localeCompare(b.ref),
    );
    if (!main) return requests;
    const urgent = requests.find(
      (r) =>
        urgentPass(r.aircraft.observation, t) &&
        r.utility > main.utility + 15,
    );
    const protectedRoute =
      urgentPass(primary.observation, t) ||
      ((primary.observation.elevationDegrees ?? 0) >= 60 &&
        primary.distanceKm < 1) ||
      primary.observation.phase === 'passing';
    return urgent && !protectedRoute
      ? [urgent, main, ...requests.filter((r) => r !== urgent)]
      : [main, ...requests];
  }
  function complete(t) {
    const { job, result, attempt } = pending;
    pending = null;
    if (job.kind === 'aircraft') {
      doneIdentities.add(job.index);
      cache.set(job.key, { complete: false, expires: t + 1800000 });
    } else if (result) {
      const association = result.data.associationTimeMs;
      const complete =
        result.outcome === 'complete' &&
        (association == null ||
          (association <= t && t - association <= 730 * 86400000));
      cache.set(job.key, {
        complete,
        expires: t + 300000,
        historical:
          association != null && t - association > 180 * 86400000,
      });
      if (complete && !firstRoutes.has(job.key))
        firstRoutes.set(job.key, t);
    } else {
      // Unknown is NOT a HexDB negative. Censor further queries to this key in
      // the central estimate; result-dependent retries cannot be reconstructed.
      censored.add(job.key);
      if (unknownFailure) budget.backoff(t + 300000);
    }
    completions.push({
      atMs: t,
      key: job.key,
      ref: job.ref,
      kind: job.kind,
      outcome: result?.outcome ?? 'unknown-evidence',
      known: !!result,
      leadToFirstPrimaryMs: ds.primaryFirst.has(job.ref)
        ? ds.primaryFirst.get(job.ref) - t
        : null,
    });
    attempt.completedAtMs = t;
  }
  function capturePrimary(t) {
    const scene = latest(ds.scenes, t),
      ref = scene?.primary?.ref ?? null;
    if (ref && ref !== previousPrimary && !ready.has(ref)) {
      const a = ds.world(t).all.find((a) => a.id === ref),
        key = a ? ref + ':' + a.callsign : null;
      ready.set(ref, {
        atMs: t,
        knownRouteReady: !!key && cached(key, t)?.complete === true,
      });
    }
    previousPrimary = ref;
  }
  const externalTimes = [
    ...new Set([
      ...ds.times,
      ...ds.scenes
        .filter(
          (s, i) => s.primary?.ref !== ds.scenes[i - 1]?.primary?.ref,
        )
        .map((s) => s.atMs),
    ]),
  ].sort((a, b) => a - b);
  while (now <= ds.end) {
    const t = Math.min(
      externalTimes[external] ?? Infinity,
      pending?.finish ?? Infinity,
      wake,
      ds.end,
    );
    if (!Number.isFinite(t) || t < now - 1e-5)
      throw Error('Invalid event time');
    now = t;
    let opportunity = false;
    if (pending && pending.finish <= now + 1e-5) {
      complete(now);
      opportunity = p.drain;
    }
    if (wake <= now + 1e-5) {
      wake = Infinity;
      opportunity = p.drain;
    }
    while ((externalTimes[external] ?? Infinity) <= now + 1e-5) {
      external++;
      opportunity = true;
    }
    capturePrimary(now);
    if (opportunity && !pending && now < ds.end) {
      const jobs = plan(now);
      let choice = null,
        next = Infinity;
      for (const job of jobs) {
        const at = budget.permitAt(now, job);
        if (at <= now + 1e-5) {
          choice = job;
          break;
        }
        next = Math.min(next, at);
        if (budget.starts.filter((t) => t > now - WINDOW).length >= p.cap)
          quotaBlocks++;
        else if (
          !p.fixed &&
          budget.tokens < (job.essential ? 1 : 1 + p.reserve)
        )
          reserveBlocks++;
      }
      if (choice) {
        const after = budget.admit(now, choice),
          result = ds.oracle.get(choice.key) ?? null;
        const latency = result?.latency ?? ds.unknownLatency;
        const attempt = {
          atMs: now,
          ref: choice.ref,
          key: choice.key,
          kind: choice.kind,
          secondary: choice.secondary,
          utility: choice.utility,
          knownOutcome: !!result,
          outcome: result?.outcome ?? 'unknown-evidence',
          tokensAfter: after,
        };
        log.push(attempt);
        tokenTrace.push({ atMs: now, tokensAfter: after });
        if (choice.kind === 'route' && !firstAttempts.has(choice.key))
          firstAttempts.set(choice.key, now);
        pending = { job: choice, result, finish: now + latency, attempt };
      } else if (p.drain && Number.isFinite(next) && next > now + 1e-6)
        wake = next;
    }
    if (now === ds.end) break;
  }
  const one = windowMetrics(
      log.map((e) => e.atMs),
      60000,
      ds.start,
      ds.end,
    ),
    five = windowMetrics(
      log.map((e) => e.atMs),
      WINDOW,
      ds.start,
      ds.end,
    );
  if (five.peak > p.cap) throw Error('Rolling ceiling exceeded');
  let saturatedMs = 0,
    saturationEpisodes = 0,
    wasFull = false;
  for (let i = 0; i < five.curve.length - 1; i++) {
    const row = five.curve[i],
      full = row.count >= p.cap;
    if (full) {
      saturatedMs += five.curve[i + 1].atMs - row.atMs;
      if (!wasFull) saturationEpisodes++;
    }
    wasFull = full;
  }
  const exhaustion = [];
  if (!p.fixed)
    for (let i = 0; i < tokenTrace.length; i++) {
      const row = tokenTrace[i];
      if (row.tokensAfter < 1 - 1e-9)
        exhaustion.push({
          start: row.atMs,
          end: Math.min(
            ds.end,
            tokenTrace[i + 1]?.atMs ?? Infinity,
            row.atMs + ((1 - row.tokensAfter) * WINDOW) / p.cap,
          ),
        });
    }
  const unknown = log.filter((e) => !e.knownOutcome),
    successful = completions.filter(
      (e) => e.kind === 'route' && e.outcome === 'complete',
    );
  const firstPrimary = Object.fromEntries(ready),
    meaningful = ds.significant;
  const readyLeadTimes = [...ready]
    .filter(([, v]) => v.knownRouteReady)
    .map(([ref, v]) => {
      const response = successful
        .filter((c) => c.ref === ref && c.atMs <= v.atMs)
        .at(-1);
      return v.atMs - response.atMs;
    });
  return {
    policy: p,
    assumptions:
      'Frozen observed display trace; recorded outcomes reused conditionally at new times; six recorded identity demands fixed; unknown results charged once then censored, never credited as misses/successes; no new provider-failure scenario unless explicitly selected.',
    requests: log.length,
    routeRequests: log.filter((e) => e.kind === 'route').length,
    identityRequests: log.filter((e) => e.kind === 'aircraft').length,
    unknownOutcomeRequests: unknown.length,
    unknownRefs: unknown.map((e) => e.ref),
    knownCompleteResponses: successful.length,
    uniqueKnownCompleteRoutes: new Set(successful.map((e) => e.key)).size,
    firstPrimaryAircraft: ready.size,
    knownRoutesReadyAtFirstPrimary: [...ready.values()].filter(
      (e) => e.knownRouteReady,
    ).length,
    firstPrimary,
    firstDetectionToRouteRequest: stats(
      [...firstAttempts]
        .map(([k, t]) => t - ds.firstSeen.get(k))
        .filter(Number.isFinite),
    ),
    responseLeadToFirstPrimary: stats(
      successful
        .map((e) => e.leadToFirstPrimaryMs)
        .filter((v) => v !== null),
    ),
    readyAtFirstPrimaryResponseLead: stats(readyLeadTimes),
    firstRouteAttempts: Object.fromEntries(firstAttempts),
    requestsNeverObservedSignificantlyRelevant: log.filter(
      (e) => !meaningful.has(e.ref),
    ).length,
    cacheBackedCandidateChecks: cacheChecks,
    negativeOrRejectedResponses: completions.filter(
      (e) =>
        e.kind === 'route' && ['negative', 'rejected'].includes(e.outcome),
    ).length,
    peakOneMinute: one.peak,
    peakFiveMinutes: five.peak,
    averageRequestsPerFiveMinutes:
      (log.length * WINDOW) / (ds.end - ds.start),
    averageRequestsPerHour: (log.length * 3600000) / (ds.end - ds.start),
    rollingFiveCapAdmissions: five.curve.filter(
      (r) => r.count === p.cap && log.some((e) => e.atMs === r.atMs),
    ).length,
    rollingFiveSaturationEpisodes: saturationEpisodes,
    rollingFiveSaturatedMs: saturatedMs,
    rollingFiveSaturatedPercent: (100 * saturatedMs) / (ds.end - ds.start),
    tokenExhaustionSegments: exhaustion,
    tokenExhaustedMs: exhaustion.reduce(
      (sum, e) => sum + e.end - e.start,
      0,
    ),
    idleFullRefillMs: p.fixed ? null : (p.burst * WINDOW) / p.cap,
    quotaBlockedCandidateChecks: quotaBlocks,
    reserveBlockedCandidateChecks: reserveBlocks,
    rollingOneMinute: one.curve,
    rollingFiveMinutes: five.curve,
    attempts: log,
    completions,
  };
}
export async function run() {
  globalThis.fetch = () => {
    throw Error('Network prohibited in offline R05 model');
  };
  const path = fileURLToPath(
      new URL('../route-r04/live/observation.json', import.meta.url),
    ),
    ds = await dataset(path);
  const recorded = ds.responses
    .filter((e) => e.diagnostic?.upstreamRequestsStarted === 1)
    .map((e) => {
      const a = ds.attempts.find(
        (a) =>
          a.kind === e.kind &&
          a.ref === e.ref &&
          Math.abs(e.atMs - a.atMs - e.durationMs) < 20,
      );
      return a?.atMs;
    })
    .filter(Number.isFinite);
  const result = {
    basis:
      'INVESTIGATION ONLY. No application changes, deployments or provider requests. All alternative results are conditional offline models, not measured R05 performance.',
    source:
      'R04 observation26 aircraft40.01 minutes, captured976210d build; R04 Preview remains f558718.',
    bounds: {
      startMs: ds.start,
      endMs: ds.end,
      frames: ds.frames.length,
      recordedIdentities: ds.identities.length,
      recordedOutcomes: ds.oracle.size,
      unknownRouteFlights: [...ds.firstSeen.keys()].filter(
        (k) => !ds.oracle.has(k),
      ).length,
      limitations: [
        'Registrations/operator metadata redacted; six original identity demands are held fixed rather than inferred.',
        'Some original timer callbacks omitted. Frozen display trace is retained; no selection improvement is attributed to budgeting.',
        'Reusing a later response earlier is conditional on coverage/latency remaining the same. Unknown responses receive no positive/negative credit.',
        'Unknown-key repeats are censored, so traffic estimates exclude result-dependent retry effects. Provider errors/rate limits at burst rates are unmeasured.',
      ],
    },
    actual: {
      requests: recorded.length,
      peakOneMinute: windowMetrics(recorded, 60000, ds.start, ds.end).peak,
      peakFiveMinutes: windowMetrics(recorded, WINDOW, ds.start, ds.end)
        .peak,
      readyAtFirstPrimary: 3,
      primaryAircraft: 14,
    },
    comparisons: policies().map((p) => simulate(ds, p)),
    sensitivity: {
      sceneOnly: CAPS.map((cap) =>
        simulate(ds, {
          ...policies().find((p) => p.cap === cap && !p.fixed),
          drain: false,
          name: 'scene-only-' + cap,
        }),
      ),
      burst: CAPS.flatMap((cap) =>
        [2, 5].map((burst) =>
          simulate(ds, {
            ...policies().find((p) => p.cap === cap && !p.fixed),
            burst,
            name: 'burst-' + burst + '-cap-' + cap,
          }),
        ),
      ),
      spacing: CAPS.flatMap((cap) =>
        [3000, 10000].map((spacing) =>
          simulate(ds, {
            ...policies().find((p) => p.cap === cap && !p.fixed),
            spacing,
            name: 'spacing-' + spacing + '-cap-' + cap,
          }),
        ),
      ),
      retainSecondary90: CAPS.map((cap) =>
        simulate(ds, {
          ...policies().find((p) => p.cap === cap && !p.fixed),
          secondary: 90000,
          name: 'retain90-' + cap,
        }),
      ),
      unknownFailure: CAPS.map((cap) =>
        simulate(
          ds,
          {
            ...policies().find((p) => p.cap === cap && !p.fixed),
            name: 'hypothetical-unknown-failure-' + cap,
          },
          { unknownFailure: true },
        ),
      ),
    },
  };
  await writeFile(
    new URL('results.json', import.meta.url),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        actual: result.actual,
        comparisons: result.comparisons.map((r) => ({
          policy: r.policy.name,
          requests: r.requests,
          peak1: r.peakOneMinute,
          peak5: r.peakFiveMinutes,
          ready: r.knownRoutesReadyAtFirstPrimary,
          unknown: r.unknownOutcomeRequests,
          identities: r.identityRequests,
          saturated: r.rollingFiveSaturationEpisodes,
          exhaustedSeconds: r.tokenExhaustedMs / 1000,
        })),
      },
      null,
      2,
    ),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await run();

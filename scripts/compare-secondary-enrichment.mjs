// Offline paired replay of the real baseline and proposed schedulers. No HTTP.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createEnricher as proposed } from '../src/enrichment.ts';
import { ENRICHMENT_POLICY as P } from '../src/enrichmentTypes.ts';
const baselineCommit = '39eab343311ffbb46f1cdc84d8d0973de378cc58';
const temp = await mkdtemp(tmpdir() + '/perch-enrichment-replay-');
const T = Date.parse('2026-11-08T06:00:00Z');
const duration = 18 * 3600_000;
const step = 15_000;
const airport = (code) => ({ code, iata: code, icao: null, name: code });
const route = { origin: airport('MAN'), destination: airport('AMS') };
const key = (a) => a.id + ':' + a.callsign;
const median = (a) =>
  a.length ? [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)] : null;
const percentile95 = (a) =>
  a.length
    ? [...a].sort((a, b) => a - b)[
        Math.min(a.length - 1, Math.floor(a.length * 0.95))
      ]
    : null;
function observations(pattern) {
  const flights = [];
  const spacing = pattern === 'moderate' ? 120_000 : 45_000;
  if (pattern === 'quiet') {
    for (let start = 0; start < duration; start += 1200_000)
      for (const offset of [0, 90_000, 180_000])
        flights.push({ entered: start + offset, dwell: 540_000 });
  } else {
    for (let start = 0; start < duration; start += spacing)
      flights.push({
        entered: start,
        dwell: pattern === 'moderate' ? 600_000 : 420_000,
      });
  }
  return flights.map((f, i) => ({
    ...f,
    index: i,
    id: (i + 1).toString(16).padStart(6, '0'),
    callsign: i % 17 === 16 ? null : 'TST' + (i + 1),
    manufacturer: 'Airbus',
    model: i % 4 === 0 ? 'Aircraft' : 'A320neo',
    operator: i % 3 === 0 ? null : 'Synthetic operator',
    registration: 'SYNTHETIC',
    altitudeFt: 6000,
    distanceKm: 4,
    origin: null,
    destination: null,
    direction: 'East',
  }));
}
function sceneAt(flights, elapsed) {
  const active = flights
    .filter((f) => elapsed >= f.entered && elapsed < f.entered + f.dwell)
    .sort(
      (a, b) =>
        Math.abs(elapsed - a.entered - 240_000) -
          Math.abs(elapsed - b.entered - 240_000) || a.index - b.index,
    )
    .slice(0, 4);
  return {
    id: 'live',
    label: 'Synthetic paired observations',
    duration: 0,
    state: active.length ? 'available' : 'standby',
    primary: active[0] ?? null,
    secondary: active.slice(1),
  };
}
async function replay(factory, pattern) {
  let elapsed = 0,
    current,
    latest;
  const flights = observations(pattern),
    attempts = [],
    seen = new Map(),
    secondarySeen = new Set(),
    secondaryRouted = new Set();
  const firstRoute = new Map(),
    firstSecondaryRoute = new Map(),
    firstPrimary = new Map(),
    primaryRouteDelay = new Map();
  let preventedRouteOpportunities = 0,
    completeSecondarySamples = 0,
    secondarySamples = 0,
    inFlight = 0,
    maxInFlight = 0;
  const timers = new Set();
  const client = factory(
    (s) => {
      latest = s;
      for (const a of [s.primary, ...s.secondary].filter(Boolean))
        if (a.origin && a.destination && !firstRoute.has(key(a)))
          firstRoute.set(key(a), elapsed);
      for (const a of s.secondary)
        if (a.origin && a.destination) {
          secondaryRouted.add(key(a));
          if (!firstSecondaryRoute.has(key(a)))
            firstSecondaryRoute.set(key(a), elapsed);
        }
      if (
        s.primary?.origin &&
        s.primary?.destination &&
        !primaryRouteDelay.has(key(s.primary))
      )
        primaryRouteDelay.set(
          key(s.primary),
          elapsed - firstPrimary.get(key(s.primary)),
        );
    },
    {
      now: () => T + elapsed,
      monotonicNow: () => elapsed,
      active: () => true,
      fetch: async (url) => {
        const q = new URL(String(url), 'https://synthetic.invalid')
          .searchParams;
        const hex = q.get('hex'),
          callsign = q.get('callsign'),
          kind = q.get('kind');
        const a = flights.find((f) => f.id === hex);
        const secondary = current.primary?.id !== hex;
        assert.ok(
          current.primary?.id === hex ||
            current.secondary.some((f) => f.id === hex),
          'query for absent flight',
        );
        const found = kind === 'aircraft' || a.index % 5 !== 4;
        attempts.push({
          at: elapsed,
          key: hex + ':' + callsign,
          hex,
          kind,
          secondary,
          found,
        });
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await Promise.resolve();
        inFlight--;
        return new Response(
          JSON.stringify({
            kind,
            hex,
            callsign,
            source: 'hexdb.io',
            status: found ? 'found' : 'not-found',
            data: !found
              ? {}
              : kind === 'route'
                ? route
                : {
                    description: 'Airbus A320neo',
                    operator: 'Synthetic operator',
                    registration: 'SYNTHETIC',
                  },
            fetchedAtMs: T + elapsed,
            expiresAtMs:
              T +
              elapsed +
              (found && kind === 'aircraft'
                ? P.identityTtlMs
                : P.routeTtlMs),
          }),
        );
      },
      setTimer: (fn, ms) => {
        const t = setTimeout(fn, ms);
        timers.add(t);
        return t;
      },
      clearTimer: (t) => {
        clearTimeout(t);
        timers.delete(t);
      },
    },
  );
  try {
    for (elapsed = 0; elapsed < duration; elapsed += step) {
      current = sceneAt(flights, elapsed);
      for (const a of [current.primary, ...current.secondary].filter(
        Boolean,
      ))
        if (!seen.has(key(a))) seen.set(key(a), elapsed);
      for (const a of current.secondary) secondarySeen.add(key(a));
      if (current.primary && !firstPrimary.has(key(current.primary)))
        firstPrimary.set(key(current.primary), elapsed);
      client.update(current);
      await new Promise((r) => setImmediate(r));
      for (const a of latest.secondary) {
        secondarySamples++;
        if (a.origin && a.destination) {
          completeSecondarySamples++;
          if (a.callsign) preventedRouteOpportunities++;
        }
      }
      assert.ok(client.inspect().entries <= P.clientCapacity);
    }
    for (let i = 1; i < attempts.length; i++)
      assert.ok(
        attempts[i].at - attempts[i - 1].at >= P.intervalMs,
        'global interval',
      );
    const secondary = attempts.filter((a) => a.secondary);
    for (let i = 1; i < secondary.length; i++)
      assert.ok(
        secondary[i].at - secondary[i - 1].at >= P.secondaryIntervalMs,
        'secondary interval',
      );
    assert.ok(secondary.length <= duration / P.secondaryIntervalMs);
    assert.equal(maxInFlight, 1);
    const duplicateUnexpired = attempts.filter(
      (a, i) =>
        a.kind === 'route' &&
        attempts
          .slice(0, i)
          .some(
            (b) =>
              b.key === a.key &&
              b.kind === a.kind &&
              a.at - b.at < P.routeTtlMs - P.refreshLeadMs,
          ),
    );
    assert.equal(duplicateUnexpired.length, 0);
    const routeDelays = [...firstRoute].map(([k, t]) => t - seen.get(k));
    const secondaryDelays = [...firstSecondaryRoute].map(
      ([k, t]) => t - seen.get(k),
    );
    const report = {
      pattern,
      hours: duration / 3600_000,
      displayedFlights: seen.size,
      successfulRouteIdentifications: firstRoute.size,
      distinctSecondaryFlights: secondarySeen.size,
      secondaryFlightsReceivingRoutes: secondaryRouted.size,
      secondaryRouteCoveragePercent: +(
        (secondaryRouted.size / secondarySeen.size) *
        100
      ).toFixed(1),
      secondaryDisplaySamplesWithRoutePercent: +(
        (completeSecondarySamples / secondarySamples) *
        100
      ).toFixed(1),
      firstDetectionToRouteSeconds: {
        median: median(routeDelays) / 1000,
        p95: percentile95(routeDelays) / 1000,
      },
      firstDetectionToSecondaryRouteSeconds: {
        median:
          median(secondaryDelays) === null
            ? null
            : median(secondaryDelays) / 1000,
        p95:
          percentile95(secondaryDelays) === null
            ? null
            : percentile95(secondaryDelays) / 1000,
      },
      primaryFirstSelectionToRouteSeconds: {
        median: median([...primaryRouteDelay.values()]) / 1000,
        p95: percentile95([...primaryRouteDelay.values()]) / 1000,
      },
      totalRequests: attempts.length,
      routeRequests: attempts.filter((a) => a.kind === 'route').length,
      identityRequests: attempts.filter((a) => a.kind === 'aircraft')
        .length,
      secondaryRequests: secondary.length,
      unsuccessfulRouteLookups: attempts.filter((a) => !a.found).length,
      unnecessaryUnexpiredRouteLookups: duplicateUnexpired.length,
      cachedRouteDisplayOpportunities: preventedRouteOpportunities,
      clientRouteReusePerRouteRequest: +(
        preventedRouteOpportunities /
        attempts.filter((a) => a.kind === 'route').length
      ).toFixed(2),
      requestsPerHour: +(attempts.length / (duration / 3600_000)).toFixed(
        2,
      ),
      secondaryRequestsPerHour: +(
        secondary.length /
        (duration / 3600_000)
      ).toFixed(2),
      minimumGlobalGapSeconds:
        Math.min(
          ...attempts.slice(1).map((a, i) => a.at - attempts[i].at),
        ) / 1000,
      minimumSecondaryGapSeconds:
        secondary.length < 2
          ? null
          : Math.min(
              ...secondary.slice(1).map((a, i) => a.at - secondary[i].at),
            ) / 1000,
      maximumConcurrency: maxInFlight,
    };
    return { report, primaryRouteDelay, firstPrimary };
  } finally {
    client.stop();
    assert.equal(timers.size, 0);
  }
}
try {
  await writeFile(temp + '/package.json', '{"type":"module"}');
  for (const file of ['enrichment.ts', 'enrichmentTypes.ts'])
    await writeFile(
      temp + '/' + file,
      execFileSync('git', ['show', baselineCommit + ':src/' + file]),
    );
  const { createEnricher: baseline } = await import(
    pathToFileURL(temp + '/enrichment.ts').href
  );
  const results = [];
  for (const pattern of ['quiet', 'moderate', 'busy']) {
    const a = await replay(baseline, pattern),
      b = await replay(proposed, pattern);
    const deltas = [...a.primaryRouteDelay]
      .filter(([k]) => b.primaryRouteDelay.has(k))
      .map(([k, delay]) => b.primaryRouteDelay.get(k) - delay);
    const comparison = {
      pattern,
      baseline: a.report,
      proposed: b.report,
      primaryComparison: {
        pairedAircraft: deltas.length,
        medianAdditionalDelaySeconds: median(deltas) / 1000,
        p95AdditionalDelaySeconds: percentile95(deltas) / 1000,
        maximumAdditionalDelaySeconds: Math.max(...deltas) / 1000,
        aircraftDelayed: deltas.filter((d) => d > 0).length,
        aircraftImproved: deltas.filter((d) => d < 0).length,
        baselinePrimaryFlightsWithoutRoute:
          a.firstPrimary.size - a.primaryRouteDelay.size,
        proposedPrimaryFlightsWithoutRoute:
          b.firstPrimary.size - b.primaryRouteDelay.size,
      },
    };
    assert.ok(
      comparison.proposed.secondaryFlightsReceivingRoutes >=
        comparison.baseline.secondaryFlightsReceivingRoutes,
    );
    results.push(comparison);
  }
  await mkdir('docs/stage3-secondary-enrichment', { recursive: true });
  const report = {
    baselineCommit,
    durationHoursPerPattern: 18,
    synthetic: true,
    networkRequests: 0,
    assumptions: [
      'Identical 15s scenes; deterministic visible ordering by simulated pass age, no selector changes.',
      'Quiet: 3 arrivals per 20 minutes; moderate: one per 120s; busy: one per 45s. Flights enter and leave; maximum 4 displayed.',
      'Every 4th model unknown, every 3rd operator missing, every 17th callsign absent, every 5th route missing.',
      'Mock provider resolves within the same simulation tick; no transport errors, latency or cross-instance contention modelled.',
      'Route/display cache reuse counts publications with complete cached routes; not independent provider cache hits.',
      'No acoustic, route-accuracy, household performance or provider coverage success rate is inferred.',
    ],
    results,
  };
  await writeFile(
    'docs/stage3-secondary-enrichment/comparison.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}

// Offline analysis only. Identical captured snapshots, no network/provider calls.
import { readFile, writeFile } from 'node:fs/promises';
import { aircraftCategory } from '../src/routeUtility.ts';
const input = process.argv[2] ?? '/tmp/perch-r04-live/observation.json';
const destination = process.argv[3] ?? '/tmp/r04-live-analysis.json';
const evidence = JSON.parse(await readFile(input, 'utf8'));
const frames = evidence.sky?.frames ?? [],
  events = evidence.sky?.events ?? [];
const rows = new Map(),
  firstSeen = new Map(),
  lastSeen = new Map(),
  callsigns = new Map();
const categories = [
  'commercial-jet',
  'regional',
  'general-aviation',
  'helicopter',
  'unknown',
];
const groups = Object.fromEntries(
  categories.map((category) => [
    category,
    {
      detectedAircraft: 0,
      primaryAircraft: 0,
      routeAttempts: 0,
      actualRouteProviderStarts: 0,
      completeResponses: 0,
      providerCompleteResponses: 0,
      historicalResponses: 0,
      providerHistoricalResponses: 0,
      recentResponses: 0,
      unclassifiedAgeCompleteResponses: 0,
      genuineProviderMisses: 0,
      cachedNegativeResponses: 0,
      rejectedResponses: 0,
      partialResponses: 0,
      lookupErrors: 0,
      serverCacheHits: 0,
      notObservedAtEndBeforeAnyRouteAttempt: 0,
    },
  ]),
);
const attempts = events.filter((e) => e.type === 'attempt');
const responses = events.filter((e) => e.type === 'response');
const scenes = events
  .filter((e) => e.type === 'scene')
  .sort((a, b) => a.atMs - b.atMs);
const routeAttempts = attempts.filter((e) => e.kind === 'route');
const firstRouteAttempt = new Map(),
  lastRouteAttempt = new Map();
for (const e of routeAttempts) {
  if (!firstRouteAttempt.has(e.ref)) firstRouteAttempt.set(e.ref, e.atMs);
  lastRouteAttempt.set(e.ref, e.atMs);
}
for (const f of frames)
  for (const a of f.snapshot.aircraft) {
    rows.set(a.id, a);
    if (!firstSeen.has(a.id)) firstSeen.set(a.id, f.atMs);
    lastSeen.set(a.id, f.atMs);
    if (a.callsign) callsigns.set(a.id + ':' + a.callsign, true);
  }
const categoryFor = (ref) => {
  const a = rows.get(ref);
  return a
    ? aircraftCategory({
        manufacturer: null,
        model: a.description,
        typeCode: a.typeCode,
      })
    : 'unknown';
};
for (const ref of rows.keys()) groups[categoryFor(ref)].detectedAircraft++;
const primaryIds = new Set(
  scenes.flatMap((s) => (s.primary ? [s.primary.ref] : [])),
);
for (const ref of primaryIds) groups[categoryFor(ref)].primaryAircraft++;
for (const a of routeAttempts) groups[categoryFor(a.ref)].routeAttempts++;
for (const e of responses.filter((e) => e.kind === 'route')) {
  const group = groups[categoryFor(e.ref)],
    d = e.diagnostic;
  group.actualRouteProviderStarts += d?.upstreamRequestsStarted ?? 0;
  if (['hit', 'coalesced'].includes(d?.serverCache))
    group.serverCacheHits++;
  if (d?.outcome === 'complete') {
    group.completeResponses++;
    if (d.upstreamResponses === 1) group.providerCompleteResponses++;
    const sample = evidence.apiSamples?.find(
      (s) =>
        s.ref === e.ref &&
        s.kind === 'route' &&
        Math.abs(s.atMs - e.atMs) < 5000,
    );
    const association = sample?.data?.associationTimeMs;
    if (Number.isFinite(association)) {
      if (e.atMs - association > 180 * 86400000) {
        group.historicalResponses++;
        if (d.upstreamResponses === 1) group.providerHistoricalResponses++;
      } else group.recentResponses++;
    } else group.unclassifiedAgeCompleteResponses++;
  } else if (d?.outcome === 'negative' && d.origin === 'hexdb') {
    if (d.upstreamResponses === 1) group.genuineProviderMisses++;
    else group.cachedNegativeResponses++;
  } else if (d?.outcome === 'partial') group.partialResponses++;
  else if (d?.outcome === 'rejected') group.rejectedResponses++;
  if (!e.ok) group.lookupErrors++;
}
const finalIds = new Set(
  frames.at(-1)?.snapshot.aircraft.map((a) => a.id) ?? [],
);
for (const ref of rows.keys())
  if (!finalIds.has(ref) && !firstRouteAttempt.has(ref))
    groups[categoryFor(ref)].notObservedAtEndBeforeAnyRouteAttempt++;
function stats(values) {
  const a = [...values].sort((a, b) => a - b);
  return {
    count: a.length,
    medianSeconds: a.length ? a[Math.floor(a.length / 2)] / 1000 : null,
    maxSeconds: a.length ? a.at(-1) / 1000 : null,
  };
}
function selectionMetrics(field) {
  let previous = null,
    transitions = 0,
    lastAt = null;
  const intervals = [],
    acquisitions = [];
  const ids = new Set(),
    definedRelevant = new Set();
  for (const f of frames) {
    const r = f.result,
      ref = r[field];
    for (const a of r.ranked)
      if (
        (a.observation?.elevationDegrees ?? 0) >= 45 ||
        (a.distanceKm ?? Infinity) < 1
      )
        definedRelevant.add(a.ref);
    if (ref !== previous) {
      if (previous && lastAt !== null)
        intervals.push({
          ref: previous,
          startMs: lastAt,
          endMs: f.atMs,
          seconds: (f.atMs - lastAt) / 1000,
        });
      if (previous && ref) transitions++;
      if (ref && !ids.has(ref)) {
        ids.add(ref);
        const a = r.ranked.find((a) => a.ref === ref);
        acquisitions.push({
          ref,
          atMs: f.atMs,
          estimatedElevationDegrees:
            a?.observation?.elevationDegrees ?? null,
          estimatedSecondsBeforeCpa: a?.observation?.secondsToCpa ?? null,
          distanceKm: a?.distanceKm ?? null,
        });
      }
      previous = ref;
      lastAt = f.atMs;
    }
  }
  if (previous && lastAt !== null)
    intervals.push({
      ref: previous,
      startMs: lastAt,
      endMs: evidence.observedUntilMs,
      seconds: (evidence.observedUntilMs - lastAt) / 1000,
    });
  return {
    primaryAircraft: ids.size,
    transitions,
    intervals,
    firstAcquisitions: acquisitions,
    definedGeometricallyRelevantAircraft: definedRelevant.size,
    neverPrimaryDespiteDefinedGeometricRelevance: [
      ...definedRelevant,
    ].filter((id) => !ids.has(id)),
    holdSeconds: stats(intervals.map((i) => i.seconds * 1000)),
  };
}
const r04 = selectionMetrics('primary'),
  r03 = selectionMetrics('baselinePrimary');
let comparedMs = 0,
  differentMs = 0;
for (let i = 0; i < frames.length; i++) {
  const f = frames[i],
    dt = Math.max(
      0,
      (frames[i + 1]?.atMs ?? evidence.observedUntilMs) - f.atMs,
    );
  comparedMs += dt;
  if (f.result.primary !== f.result.baselinePrimary) differentMs += dt;
}
let primaryMs = 0,
  primaryCompleteMs = 0,
  primaryHistoricalMs = 0,
  secondaryMs = 0,
  secondaryCompleteMs = 0;
const primariesWithRoutes = new Set(),
  secondariesWithRoutes = new Set(),
  secondaryIds = new Set(),
  firstPrimary = new Map();
for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i],
    dt = Math.max(
      0,
      (scenes[i + 1]?.atMs ?? evidence.observedUntilMs) - s.atMs,
    );
  if (s.primary) {
    primaryMs += dt;
    if (s.primary.complete) {
      primaryCompleteMs += dt;
      primariesWithRoutes.add(s.primary.ref);
    }
    if (s.primary.complete && s.primary.historical)
      primaryHistoricalMs += dt;
    if (!firstPrimary.has(s.primary.ref))
      firstPrimary.set(s.primary.ref, {
        atMs: s.atMs,
        routeReady: s.primary.complete,
        historical: s.primary.historical,
      });
  }
  for (const a of s.secondary) {
    secondaryIds.add(a.ref);
    secondaryMs += dt;
    if (a.complete) {
      secondaryCompleteMs += dt;
      secondariesWithRoutes.add(a.ref);
    }
  }
}
const firstUsable = new Map();
for (const s of scenes)
  for (const a of [s.primary, ...s.secondary].filter(Boolean))
    if (a.complete && !firstUsable.has(a.ref))
      firstUsable.set(a.ref, s.atMs);
const clientGaps = attempts
  .slice(1)
  .map((a, i) => a.atMs - attempts[i].atMs);
const secondary = attempts.filter((a) => a.secondary),
  secondaryGaps = secondary
    .slice(1)
    .map((a, i) => a.atMs - secondary[i].atMs);
const results = {
  basis:
    'Actual bounded deployed R04 observation. R03 selections are a no-network shadow on the same snapshots; R03 route lookups/outcomes were not executed and are not inferred.',
  input,
  startedAtMs: evidence.startedAtMs,
  observedUntilMs: evidence.observedUntilMs,
  actualObservationMinutes: evidence.actualElapsedMs / 60000,
  evidenceBounds: {
    frames: frames.length,
    events: events.length,
    dropped: evidence.sky?.dropped ?? null,
    routeCollectorTruncated: evidence.report?.truncated ?? null,
    largestSnapshotAircraft: Math.max(
      0,
      ...frames.map((f) => f.snapshot.aircraft.length),
    ),
    rowLimit: 32,
  },
  detectedAircraft: rows.size,
  distinctValidFlightReferences: callsigns.size,
  detectedWithoutAnyRouteAttempt: [...rows.keys()].filter(
    (id) => !firstRouteAttempt.has(id),
  ).length,
  stillPresentAtEndWithoutRouteAttempt: [...finalIds].filter(
    (id) => !firstRouteAttempt.has(id),
  ).length,
  byCategory: groups,
  network: evidence.network,
  rateCompliance: {
    applicationEnrichmentAttempts: attempts.length,
    secondaryAttempts: secondary.length,
    actualHexdbRequests:
      evidence.report?.counters.hexdbRequestsStarted ?? null,
    actualRouteHexdbRequests:
      evidence.report?.counters.routeHexdbRequestsStarted ?? null,
    minimumApplicationGapMs: clientGaps.length
      ? Math.min(...clientGaps)
      : null,
    minimumSecondaryGapMs: secondaryGaps.length
      ? Math.min(...secondaryGaps)
      : null,
    below30sBeyond1msClockRounding: clientGaps.filter((v) => v < 29999)
      .length,
    below90sBeyond1msClockRounding: secondaryGaps.filter((v) => v < 89999)
      .length,
    requestsPerHour:
      (attempts.length * 3600000) / evidence.actualElapsedMs,
    secondaryRequestsPerHour:
      (secondary.length * 3600000) / evidence.actualElapsedMs,
  },
  selectionComparison: {
    r03,
    r04,
    comparedMinutes: comparedMs / 60000,
    differentChoiceMinutes: differentMs / 60000,
    differentChoicePercent: comparedMs
      ? (differentMs * 100) / comparedMs
      : null,
    geometricConvention:
      'Elevation>=45 degrees or distance<1km at an observed frame, never-primary count over whole session; not a human-observation accuracy label. Partial passes/session boundaries may censor comparisons.',
  },
  routeReadiness: {
    primaryAircraft: primaryIds.size,
    primaryAircraftWithCompleteRoutes: primariesWithRoutes.size,
    secondaryAircraft: secondaryIds.size,
    secondaryAircraftWithCompleteRoutes: secondariesWithRoutes.size,
    primaryMs,
    primaryCompleteMs,
    primaryHistoricalMs,
    primaryCompletePercent: primaryMs
      ? (primaryCompleteMs * 100) / primaryMs
      : null,
    primaryHistoricalPercent: primaryMs
      ? (primaryHistoricalMs * 100) / primaryMs
      : null,
    secondaryCompletePercent: secondaryMs
      ? (secondaryCompleteMs * 100) / secondaryMs
      : null,
    routeReadyAtFirstPrimary: [...firstPrimary.values()].filter(
      (v) => v.routeReady,
    ).length,
    firstPrimary: [...firstPrimary].map(([ref, v]) => ({
      ref,
      ...v,
      firstLookupAfterDetectionMs: firstRouteAttempt.has(ref)
        ? firstRouteAttempt.get(ref) - firstSeen.get(ref)
        : null,
      firstUsableAfterDetectionMs: firstUsable.has(ref)
        ? firstUsable.get(ref) - firstSeen.get(ref)
        : null,
      routeReadyBeforeFirstPrimaryMs: firstUsable.has(ref)
        ? v.atMs - firstUsable.get(ref)
        : null,
    })),
    firstDetectionToLookup: stats(
      [...firstRouteAttempt]
        .filter(([id]) => firstSeen.has(id))
        .map(([id, t]) => t - firstSeen.get(id)),
    ),
    firstDetectionToUsableRoute: stats(
      [...firstUsable]
        .filter(([id]) => firstSeen.has(id))
        .map(([id, t]) => t - firstSeen.get(id)),
    ),
  },
  counters: evidence.report?.counters,
  deferrals: evidence.report?.deferrals ?? [],
  pageErrorCount: evidence.pageErrorCount,
  limitations: [
    'No independently verified visibility, audibility or flight plan ground truth.',
    'Calls/aircraft references are trial-local pseudonyms; category is a bounded type heuristic.',
    'Provider-not-found counts include cached API responses unless the upstream start count is separately used.',
    'Last scene is integrated to the saved observation endpoint; no post-close exposure.',
    'Counterfactual R03 scheduler route readiness is unknowable for unqueried flights; only modelled comparisons have both sets of outcomes.',
  ],
};
await writeFile(destination, JSON.stringify(results, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      minutes: results.actualObservationMinutes,
      detected: results.detectedAircraft,
      primary: r04.primaryAircraft,
      transitionsR03: r03.transitions,
      transitionsR04: r04.transitions,
      primaryRoutePercent: results.routeReadiness.primaryCompletePercent,
      rateCompliance: results.rateCompliance,
      byCategory: groups,
    },
    null,
    2,
  ),
);

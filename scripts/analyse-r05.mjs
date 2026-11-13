// Offline R05 evidence analysis. No browser/provider calls.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const input = process.argv[2],
  output = process.argv[3];
if (!input || !output)
  throw Error('Supply captured observation and output paths');
const x = JSON.parse(await readFile(input, 'utf8'));
const intermediate = output + '.inherited.tmp';
execFileSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/analyse-r04.mjs', input, intermediate],
  { cwd: resolve(import.meta.dirname, '..'), stdio: 'pipe' },
);
const y = JSON.parse(await readFile(intermediate, 'utf8'));
const { rm } = await import('node:fs/promises');
await rm(intermediate);
const attempts = x.apiSamples.filter(
  (s) => s.diagnostic?.upstreamRequestsStarted === 1,
);
const starts = attempts
  .map((s) => s.diagnostic.upstreamStartedAtMs)
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const peak = (w) => {
  let l = 0,
    max = 0;
  for (let r = 0; r < starts.length; r++) {
    while (starts[l] <= starts[r] - w) l++;
    max = Math.max(max, r - l + 1);
  }
  return max;
};
const gaps = starts.slice(1).map((t, i) => t - starts[i]);
const budgetRows = x.apiSamples
  .map((s) => s.adaptiveBudget)
  .filter(Boolean);
const local = x.apiSamples.filter((s) => s.adaptiveFailure);
const states = Object.fromEntries(
  [...new Set(local.map((s) => s.adaptiveFailure.reason))].map((k) => [
    k,
    local.filter((s) => s.adaptiveFailure.reason === k).length,
  ]),
);
const categories = y.byCategory;
const paired = JSON.parse(
  await readFile('docs/route-r04/live/analysis.json', 'utf8'),
);
const report = {
  basis:
    'Measured bounded R05 live Preview trial; source provider outcomes, not simulated flights. R04 historical observation differs in date, traffic and aircraft mix.',
  input,
  startedAtMs: x.startedAtMs,
  observedUntilMs: x.observedUntilMs,
  actualObservationMinutes: x.actualElapsedMs / 60000,
  requestedMinutes: x.requestedMinutes,
  stopReason: x.stopReason,
  detectedAircraft: y.detectedAircraft,
  distinctValidFlightReferences: y.distinctValidFlightReferences,
  detectedWithoutAnyRouteAttempt: y.detectedWithoutAnyRouteAttempt,
  evidenceBounds: y.evidenceBounds,
  network: x.network,
  pageErrorCount: x.pageErrorCount,
  routeReadiness: y.routeReadiness,
  rateCompliance: {
    applicationEnrichmentAttempts: x.network.enrichmentRequests,
    observedUpstreamStarts: attempts.length,
    startsWithTiming: starts.length,
    diagnosticCounterStarts:
      x.report?.counters.hexdbRequestsStarted ?? null,
    requestsPerHour: (attempts.length * 3600000) / x.actualElapsedMs,
    minimumProviderStartGapMs: gaps.length ? Math.min(...gaps) : null,
    peakRolling30s: peak(30000),
    peakRollingOneMinute: peak(60000),
    peakRollingFiveMinutes: peak(300000),
    below10sBeyond1msRounding: gaps.filter((g) => g < 9999).length,
    fiveMinuteCeilingViolated: peak(300000) > 10,
    minimumObservedTokens: budgetRows.length
      ? Math.min(...budgetRows.map((b) => b.tokens))
      : null,
    maximumObservedRollingFive: budgetRows.length
      ? Math.max(...budgetRows.map((b) => b.rollingFive))
      : null,
    maximumObservedRollingDay: budgetRows.length
      ? Math.max(...budgetRows.map((b) => b.rollingDay))
      : null,
    localDeferralIncidents: states,
    serverCacheHits: x.apiSamples.filter(
      (s) => s.diagnostic?.serverCache === 'hit',
    ).length,
    localDeferralsAmplifiedToFiveMinutes: local.filter(
      (s) =>
        s.adaptiveFailure.retryAfterMs < 300000 &&
        s.adaptiveBudget?.protectedWaitMs >= 300000,
    ).length,
    provider429: attempts.filter((s) => s.diagnostic.httpStatus === 429)
      .length,
    provider403: attempts.filter((s) => s.diagnostic.httpStatus === 403)
      .length,
    providerErrors: attempts.filter(
      (s) => s.diagnostic.outcome === 'error',
    ).length,
    sharedCounters: budgetRows.at(-1)?.counters ?? null,
  },
  byCategory: categories,
  counters: x.report?.counters ?? {},
  historicalR04Context: {
    minutes: paired.actualObservationMinutes,
    detected: paired.detectedAircraft,
    requests: paired.rateCompliance.actualHexdbRequests,
    routeReadyAtFirstPrimary:
      paired.routeReadiness.routeReadyAtFirstPrimary,
    firstPrimaryCount: paired.routeReadiness.firstPrimary.length,
    primaryCompletePercent: paired.routeReadiness.primaryCompletePercent,
    routeLookupDelay: paired.routeReadiness.firstDetectionToLookup,
  },
  primaryWithoutRouteCoincidingWithSecondaryMs: null,
  limitations: [
    'Actual upstream starts are those reported at fetch dispatch by the deployed server; a killed worker/response loss can leave an uncertain charged reservation. Compare shared before/after counters separately.',
    'Rolling start times use function-instance clocks; DB admission uses the authoritative writer clock and conservative completion bounds. Timing measurements do not establish cloud-wide clock accuracy.',
    'Only R05 participates in its shared ceiling. Existing R04 and household Production do not.',
    'Historical R04 and this R05 observation are different traffic populations, not a randomized controlled trial.',
    'No FR24 or independent current flight-plan verification; complete routes may be qualified historical associations.',
    'Primary readiness at observation boundaries may be censored. Category is a bounded aircraft-type heuristic, not a measured coverage probability.',
  ],
};
const events = x.sky?.events ?? [];
let pendingSecondary = 0,
  pendingKey = null,
  primaryRef = null,
  primaryMissing = false,
  last = x.startedAtMs,
  blocked = 0;
for (const e of events) {
  const at = Math.max(last, e.atMs);
  if (pendingSecondary && primaryMissing) blocked += at - last;
  if (e.type === 'scene') {
    primaryRef = e.primary?.ref ?? null;
    primaryMissing = !!e.primary && !e.primary.complete;
  }
  if (e.type === 'attempt') {
    pendingKey = e.ref + ':' + e.kind;
    pendingSecondary = e.ref !== primaryRef ? 1 : 0;
  }
  if (e.type === 'response' && pendingKey === e.ref + ':' + e.kind) {
    pendingSecondary = 0;
    pendingKey = null;
  }
  last = at;
}
if (pendingSecondary && primaryMissing)
  blocked += Math.max(0, x.observedUntilMs - last);
report.primaryWithoutRouteCoincidingWithSecondaryMs = blocked;
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      minutes: report.actualObservationMinutes,
      detected: report.detectedAircraft,
      primary: report.routeReadiness.primaryAircraft,
      readiness: report.routeReadiness.routeReadyAtFirstPrimary,
      primaryRoutePercent: report.routeReadiness.primaryCompletePercent,
      rate: report.rateCompliance,
    },
    null,
    2,
  ),
);

"""Offline analysis of the bounded observer; never performs network requests."""
import collections
import datetime
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent
repo = root.parent.parent
source = pathlib.Path(sys.argv[1])
final = '--final' in sys.argv[2:]
current = json.loads(source.read_text())
deployment = json.loads((root / 'DEPLOYMENT.json').read_text())
baseline = json.loads((repo / 'docs/stage3-route-investigation/live-observation.json').read_text())

def utc(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat(timespec='seconds')

def counter_outcomes(events):
    counts = collections.Counter((e.get('diagnostic') or {}).get('outcome', 'unknown') for e in events)
    return {key: counts.get(key, 0) for key in ['complete', 'partial', 'negative', 'rejected', 'error', 'unknown']}

def summarise(observation):
    r = observation['lastReport']
    c = r['counters']
    events = [e for e in r['events'] if e['type'] == 'lookup-response']
    routes = [e for e in events if e['kind'] == 'route']
    new_routes = [e for e in routes if (e.get('diagnostic') or {}).get('upstreamResponses') == 1]
    starts = sorted(e.get('startedElapsedMs', e['atMs'] - e['durationMs']) for e in events)
    secondary_starts = sorted(e.get('startedElapsedMs', e['atMs'] - e['durationMs']) for e in events if e['role'] == 'secondary')
    spacing = lambda xs: min((b - a for a, b in zip(xs, xs[1:])), default=None)
    legacy_amplified = [e for e in events if (e.get('diagnostic') or {}).get('origin') == 'application'
        and e['diagnostic'].get('reason') == 'cooldown' and e['diagnostic'].get('retryAfterMs') == 30000
        and e.get('clientCooldownMs', 0) >= 299999 and e.get('clientCooldownMs', 0) >
        max(e['diagnostic'].get('retryAfterMs', 0), (e.get('scheduling') or {}).get('priorGlobalWaitMs', 0)) + 1]
    spans = []
    for event in events:
        end = event.get('elapsedMs', event['atMs'])
        start = event.get('startedElapsedMs', end - event['durationMs'])
        spans.extend([(start, 1), (end, -1)])
    active = peak = 0
    for _, change in sorted(spans):
        active += change
        peak = max(peak, active)
    no_attempt = [f for f in r['flights'] if f['firstLookupMs'] is None]
    return {
        'startedAt': utc(observation['startedAtMs']), 'observedUntil': utc(observation['observedUntilMs']),
        'wallMinutes': observation['actualElapsedMs'] / 60000,
        'pageEvidenceMinutes': (r['endedAtMs'] - r['startedAtMs']) / 60000,
        'aircraftDetected': r['distinctAircraft'], 'primaryAircraft': r['aircraftBecomingPrimary'],
        'detectedFlightKeys': r['distinctDetectedFlights'], 'displayedFlightKeys': r['distinctDisplayedFlights'],
        'validCallsignAircraft': r['aircraftWithValidCallsigns'],
        'withoutApplicationRouteAttempt': len(no_attempt),
        'withoutAttemptAndAbsentAtEnd': sum(not f['present'] for f in no_attempt),
        'primaryAircraftEverComplete': r['primaryAircraftWithCompleteRoutes'],
        'primaryAircraftEverCompletePercent': r['primaryAircraftCompleteRoutePercent'],
        'primaryDisplayedTimeCompletePercent': r['primaryCompleteRoutePercent'],
        'secondaryAircraftEverComplete': r['secondaryAircraftWithCompleteRoutes'],
        'secondaryAircraftObserved': r['secondaryAircraftObserved'],
        'secondaryAircraftEverCompletePercent': r['secondaryAircraftCompleteRoutePercent'],
        'secondaryDisplayedTimeCompletePercent': r['secondaryCompleteRoutePercent'],
        'applicationAttempts': c.get('applicationAttempts', 0), 'applicationResponses': c.get('applicationResponses', 0),
        'routeApplicationAttempts': c.get('routeLookupAttempts', 0), 'identityApplicationAttempts': c.get('identityLookupAttempts', 0),
        'confirmedProviderHttpStarts': c.get('hexdbRequestsStarted', 0), 'confirmedProviderHttpResponses': c.get('hexdbResponsesReceived', 0),
        'newRouteHttpStarts': c.get('routeHexdbRequestsStarted', 0), 'newIdentityHttpStarts': c.get('aircraftHexdbRequestsStarted', 0),
        'serverCacheHitsOrCoalesced': c.get('serverCacheHits', 0),
        'newUpstreamRouteOutcomes': counter_outcomes(new_routes), 'routeApiOutcomesIncludingCache': counter_outcomes(routes),
        'verifiedLocalDeferrals': c.get('verifiedLocalDeferrals', 0),
        'localDeferralsAmplifiedToFailurePause': len(legacy_amplified),
        'typedLocalDeadlineAmplifications': c.get('localDeferralsAmplified', 0),
        'protectedFailureBackoffs': c.get('clientCooldownIncidents', 0),
        'genuineProviderFailureBackoffs': c.get('providerFailureBackoffs', 0),
        'unverifiedOrUnexpectedFailureBackoffs': c.get('unverifiedFailureBackoffs', 0),
        'maximumOverlappingCompletedClientRequests': peak,
        'minimumGlobalAttemptSpacingMs': spacing(starts), 'minimumSecondaryAttemptSpacingMs': spacing(secondary_starts),
        'medianFirstDetectionToRouteAttemptSeconds': (r['firstDetectionToLookup']['medianMs'] / 1000 if r['firstDetectionToLookup']['medianMs'] is not None else None),
        'medianFirstDetectionToUsableRouteSeconds': (r['firstDetectionToUsableRoute']['medianMs'] / 1000 if r['firstDetectionToUsableRoute']['medianMs'] is not None else None),
        'firstDetectionToApplicationRouteAttempt': r['firstDetectionToLookup'],
        'firstDetectionToUsableRoute': r['firstDetectionToUsableRoute'],
        'responseToScenePublication': r['responseToScenePublication'],
        'internalRoutesNotDisplayedAtLastSnapshot': r['routesAvailableInternallyNotDisplayed'],
        'deferrals': r.get('deferrals', []), 'network': observation['network'], 'counters': c,
        'stoppedReason': observation['stoppedReason'], 'truncated': r['truncated'],
    }

base, now = summarise(baseline), summarise(current)
if final:
    cleanup = json.loads((root / 'CLEANUP.json').read_text())
    assert cleanup['authenticationRestored'] and cleanup['observerStopped']
    assert now['wallMinutes'] >= 40 and not now['truncated']

# Check the saved evidence, not only the shorter metrics object.
def privacy(value):
    if isinstance(value, dict):
        for key, v in value.items():
            assert key.lower() not in {'hex', 'callsign', 'registration', 'latitude', 'longitude', 'credentials', 'token', 'secret', 'cookie'}, key
            privacy(v)
    elif isinstance(value, list):
        for v in value:
            privacy(v)
privacy(current)
(root / 'live-observation.json').write_text(json.dumps(current, indent=2) + '\n')
result = {'status': 'final' if final else 'preliminary', 'baseline': base, 'r01': now,
    'notes': ['Traffic populations/cache/concurrent client activity differ; this is not an identical-population experiment.',
              'Provider starts/responses are confirmed through this browser only; other clients and unreturned boundary requests are unknown.',
              'Latency excludes aircraft without any application route attempt. A cache hit is not another provider request.']}
(root / 'comparison.json').write_text(json.dumps(result, indent=2) + '\n')

fmt = lambda n: 'not measurable' if n is None else f'{n:.2f}'.rstrip('0').rstrip('.')
seconds = lambda n: 'pending / not observed' if n is None else f'{n / 1000:.3f} s'
metrics = [
    ('Observation minutes', 'wallMinutes'), ('Aircraft detected', 'aircraftDetected'),
    ('Aircraft becoming primary', 'primaryAircraft'), ('Displayed aircraft without any route API attempt', 'withoutApplicationRouteAttempt'),
    ('Primary aircraft ever showing complete routes (%)', 'primaryAircraftEverCompletePercent'),
    ('Primary display time with complete routes (%)', 'primaryDisplayedTimeCompletePercent'),
    ('Secondary aircraft ever showing complete routes (%)', 'secondaryAircraftEverCompletePercent'),
    ('Secondary displayed aircraft-time with complete routes (%)', 'secondaryDisplayedTimeCompletePercent'),
    ('Short local deferrals amplified to five minutes', 'localDeferralsAmplifiedToFailurePause'),
    ('Browser enrichment attempts', 'applicationAttempts'), ('Confirmed new provider HTTP starts', 'confirmedProviderHttpStarts'),
    ('Server cache hits/coalesced responses', 'serverCacheHitsOrCoalesced'),
    ('Median first detection to route API attempt (seconds, attempted only)', 'medianFirstDetectionToRouteAttemptSeconds'),
    ('Median first detection to usable route (seconds, successful only)', 'medianFirstDetectionToUsableRouteSeconds'),
]
rows = '\n'.join(f'| {name} | {fmt(base[key])} | {fmt(now[key])} |' for name, key in metrics)
deferral_rows = '\n'.join('| ' + ' | '.join([
    utc(d['atMs']), d['role'] + ' ' + d['kind'], d['scheduling']['reason'],
    seconds(d['scheduling']['serverRetryAfterMs']), seconds(d['scheduling']['globalWaitMs']),
    seconds(d['actualDelayMs']), ', '.join(d['observedRestrictions']) or 'none recorded']) + ' |' for d in now['deferrals'])
if not deferral_rows:
    deferral_rows = '| No local deferral observed | — | — | — | — | — | — |'

complete_delta = (now['primaryAircraftEverCompletePercent'] or 0) - (base['primaryAircraftEverCompletePercent'] or 0)
time_delta = (now['primaryDisplayedTimeCompletePercent'] or 0) - (base['primaryDisplayedTimeCompletePercent'] or 0)
if not final:
    conclusion = 'The trial is still running. No final route-availability conclusion is drawn.'
elif complete_delta > 0 and time_delta > 0:
    conclusion = f'Both primary-route measures increased in this sample: {complete_delta:+.2f} percentage points ever complete and {time_delta:+.2f} points of display time. This is a measured improvement in the new observation, but different traffic/cache/client conditions prevent attributing its full size to R01 or establishing a material long-term household benefit. Overall route reliability remains limited.'
elif complete_delta <= 0 and time_delta <= 0:
    conclusion = f'This trial did not establish improved primary-route availability: ever-complete changed by {complete_delta:+.2f} points and complete display-time by {time_delta:+.2f} points. Removing cooldown amplification does not supply routes that HexDB lacks or that existing validation rejects.'
else:
    conclusion = f'Primary-route results were mixed: ever-complete changed by {complete_delta:+.2f} points and complete display-time by {time_delta:+.2f} points. A consistent operational route-availability improvement is inconclusive.'

mechanism = ('No verified local deferral occurred in this live window. The shorter retry path was therefore not exercised live; its resolution is established by the deployed-source proof and automated/compiled/browser tests, not by an observed live deferral.' if not now['verifiedLocalDeferrals'] else 'Verified application-local deferrals occurred live. Their requested/applied deadlines and actual recovery are recorded below; the trace distinguishes longer scheduling constraints from failure-backoff amplification.')

case_rows = []
seen_cases = set()
for e in current['lastReport']['events']:
    if e['type'] != 'lookup-response' or e['kind'] != 'route':
        continue
    d = e.get('diagnostic') or {}
    signature = (e['role'], d.get('outcome'), d.get('reason'))
    if signature in seen_cases or len(case_rows) >= 10:
        continue
    seen_cases.add(signature)
    explanation = d.get('reason', 'unclassified')
    age = (d.get('summary') or {}).get('associationAgeDays')
    if age is not None:
        explanation += f'; association age {age:.1f} days (field presence does not prove current route validity)'
    wait = (e.get('scheduling') or {}).get('globalWaitMs')
    if wait is not None:
        explanation += f'; resulting global wait {wait / 1000:.3f} s'
    case_rows.append(f"| {e['ref']} | {e['role']} | {d.get('serverCache', 'unknown')} | {d.get('outcome', 'unknown')} | {explanation} |")
case_table = '\n'.join(case_rows) or '| No route response observed | — | — | — | Coverage undetermined |'

report = f'''# Route reliability correction R01 — live comparison

{'Completed trial and verified cleanup.' if final else 'PRELIMINARY — observation is still running.'}

{conclusion}

**Root cause and correction.** The old browser treated any unsuccessful enrichment
response as a provider failure. A 30-second application-local gate deferral therefore
imposed a 300-second shared pause. R01 requires a versioned, coherent same-origin
contract, distinguishes the global gate from an in-flight request, and honors the
server wait while preserving the existing client deadline. Ambiguous responses
retain the conservative failure backoff. No retry timer or faster request ceiling
was introduced. The correction works in normal PIN-protected live mode too.

Code commit: `{deployment["codeCommit"]}`, branch
`stage-3a-display-redesign`, [Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5).
Baseline source was verified as `b8076615e4989fe85edebc33ee7058b38f5529f7`.
Deployment `{deployment["deploymentId"]}` reached READY in Preview,
project `prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW`, team mml3. All 69 runtime source
hashes matched. Runtime access required the exact Preview identity, independently
confirming that target=null was Preview, not Production.

[Stable corrected Preview](https://perch-aero-pane-stage3a.vercel.app/?mode=live) ·
[Immutable R01 URL]({deployment["uniqueUrl"]}) ·
[Previous Preview preserved for comparison/rollback](https://perch-aero-pane-stage3a-eixaj6pkv-mml3.vercel.app/?mode=live).
Existing tabs need a normal page refresh to load the corrected client bundle.

**Actual observation:** {now['startedAt']} to {now['observedUntil']},
{now['wallMinutes']:.2f} minutes of process time / {now['pageEvidenceMinutes']:.2f}
minutes of page evidence. The deployed browser used live adsb.fi and HexDB through
the ordinary scheduler, with no route mocks, direct extra provider probes or FR24
scraping. A valid returned association is not an independently verified flight plan.
No physical iPad/Safari-engine execution or 18-hour unattended test is claimed.

| Measurement | Prior 40-minute session | R01 session |
| --- | --- | --- |
{rows}

The populations differ. Aircraft may occur in both primary/secondary denominators.
Displayed aircraft-time differs from the fraction ever receiving a route. First
detection means first receipt in this session, not known entry to the area.
Callsign changes can split displayed flight identities, so the no-attempt count
is per displayed flight key, using the same instrument as the baseline.
Leaving the display does not prove leaving the 15 km area. Unqueried aircraft
cannot establish HexDB coverage. A concurrently active Safari/other invocation
could share a server instance with this added observer; whole-household and
single-client contention frequencies are not established.

**End-to-end evidence.** Browser → same-origin API → HexDB → normalised cache
→ scene publication is checked independently at each boundary.

| Boundary | Evidence |
| --- | --- |
| Correct deployed source/environment | READY Preview; all 69 source hashes matched {deployment["codeCommit"]} |
| Browser → API | {now['applicationAttempts']} application attempts; bounded response records and screenshots |
| API → provider | {now['confirmedProviderHttpStarts']} confirmed new upstream starts, separate from {now['serverCacheHitsOrCoalesced']} cache/coalesced responses |
| Provider → validation/cache | Explicit complete/partial/negative/rejected/error outcomes below; original source safeguards unchanged |
| Cache → scene | Publication timing below; final internal-but-unshown routes {now['internalRoutesNotDisplayedAtLastSnapshot']} |
| Local-deferral recovery | {'Observed live, with per-deferral deadlines below' if now['verifiedLocalDeferrals'] else 'Automated/compiled/browser proof; no live local-deferral sample in this window'} |
| Authentication cleanup | {'Verified post-expiry HTTP 401 and real PIN browser screens' if final else 'Pending absolute expiry'} |

There were {now['responseToScenePublication']['count']} complete-route publications in this live window.
Mocked success/role/publication regressions are kept separate from live evidence.
No raw production runtime log or secret was required.

**Local deferral evidence.** {mechanism}

Verified deferrals: {now['verifiedLocalDeferrals']}.
Applied-deadline amplifications: {now['typedLocalDeadlineAmplifications']}.
Any short local response still held with a five-minute failure pause:
{now['localDeferralsAmplifiedToFailurePause']}.

| Response UTC | Lookup | Server reason | Requested wait | Browser global wait | Actual next attempt | Observed restrictions |
| --- | --- | --- | --- | --- | --- | --- |
{deferral_rows}

[Real complete route](live-complete-route.png) · [Live local deferral](live-local-deferral-pending.png) · [Recovery trace](live-local-deferral-resumed.png).

Each verified local deferral declares zero upstream HTTP work. Full global and
secondary eligibility timestamps and the next attempt role/type are retained in
comparison.json. Actual elapsed waits use monotonic time. Longer observations may
reflect the 15-second scene cadence, secondary allowance, primary priority,
inactivity, disappearance or no eligible lookup; restriction samples are evidence
of conditions, not exclusive causal attribution. Unresolved records at shutdown
must not be treated as five-minute amplification.

**Provider work and protection.** There were {now['routeApplicationAttempts']} route
and {now['identityApplicationAttempts']} identity API attempts. Confirmed new
provider starts/responses were {now['confirmedProviderHttpStarts']} /
{now['confirmedProviderHttpResponses']}: {now['newRouteHttpStarts']} route and
{now['newIdentityHttpStarts']} identity starts. Server cache hits/coalescing account
for {now['serverCacheHitsOrCoalesced']} responses without another provider request.
These are confirmed counts attributable to this observer, not a project-wide total.
Aborted/unreturned boundary requests and work from other clients are not claimed.

New upstream route outcomes: `{json.dumps(now['newUpstreamRouteOutcomes'])}`.
All route API outcomes including cached reuse and local deferrals:
`{json.dumps(now['routeApiOutcomesIncludingCache'])}`.
Genuine provider-failure backoffs observed: {now['genuineProviderFailureBackoffs']};
unverified/unexpected/network failure backoffs: {now['unverifiedOrUnexpectedFailureBackoffs']}.
A live absence of provider errors does not test a real 429; numeric/date 429,
access denial, timeouts and malformed upstream responses are covered by mocks
and compiled HTTP tests. Genuine failures retain the five-minute floor and longer
valid Retry-After. Coalesced failures do not double-count an upstream request.

Minimum measured client attempt spacing: global {seconds(now['minimumGlobalAttemptSpacingMs'])},
secondary {seconds(now['minimumSecondaryAttemptSpacingMs'])}. Maximum simultaneous
client requests among completed measured intervals: {now['maximumOverlappingCompletedClientRequests']}. Existing ceilings
remain at most 120 attempts/hour per active client, at most 40 collective secondary
attempts/hour, one client request at a time. The server's 30-second gate and single
upstream operation remain process-local, not a globally coordinated rate limiter.
There is no new timer/provider/database/paid infrastructure. Positions remain
15-second polling within 15 km; all cache TTLs, primary priority, selection,
authentication credentials, quiet hours and the 180-day route-age guard are unchanged.

**Representative route results.** These session-local references cannot identify
an aircraft across sessions. Provider misses, existing validation rejections and
application deferrals are different outcomes. Aircraft with no route attempt
have unknown source coverage.

| Session reference | Role at request | Server cache | Outcome | Evidence |
| --- | --- | --- | --- | --- |
{case_table}

**Lookup/publication timing.** First detection to first application route attempt:
{now['firstDetectionToApplicationRouteAttempt']}. First detection to first usable
route: {now['firstDetectionToUsableRoute']}. Response to enriched scene publication:
{now['responseToScenePublication']}. These latency samples exclude unattempted
flights and measure application publication, not physical iPad paint. Internally
available but unshown route count at the final snapshot:
{now['internalRoutesNotDisplayedAtLastSnapshot']}.

**Verification and files.** 256 automated tests, 19 compiled plain-Node ESM HTTP
cases, ESLint, TypeScript/server checks, default and all-feature Safari 15 builds
passed. Browser checks at both iPad sizes verify local recovery, secondary/primary
constraints and a full ten-minute upstream backoff. The 51 inherited layouts,
secondary lifecycle, sleep/wake, PIN/sleep pixels and diagnostic regressions pass.
Core files: src/enrichmentFailure.ts, src/enrichment.ts,
server/enrichmentService.ts, api/enrichment.ts. Server error context/trace types,
routeDiagnostics/RouteTrialDisplay, observer and test scripts support the contract
and safe evidence. No normal artwork, stylesheet, selection or quiet-hours file
was changed. No test/runtime dependency was added.

**Access and cleanup.** The server-only explicit lease was restricted to the exact
isolated Preview and absolutely {'expired' if final else 'expires'} at {deployment["lease"]["expiresAt"]}, below 48 hours.
The project flag was disabled for future builds immediately after activation.
Observation intentionally ends with that absolute expiry; no permanent bypass
cookie exists. {'CLEANUP.json records real post-expiry 401/PIN checks, no locked-screen tracking, a stopped observer and the stable alias remaining on R01.' if final else 'Final post-expiry HTTP/browser checks and observer shutdown are still pending.'}
No secret or private observation-coordinate values were viewed, changed or rotated;
the existing server configuration was reused.
Household Production remains outside this deployment; no main update/merge/Git
connection/other alias change occurred.

**Remaining limitations and next correction.** This fix removes an application
amplification mechanism; it does not invent unavailable routes, relax old-route
validation or eliminate budget/priority waiting. Review the observed rejected-age
and provider-miss counts before choosing another correction. The next proposed
work is to establish what HexDB updated_at means and review the historical-route
policy separately, without automatically removing the 180-day guard or adding a
provider. A longer representative or single-active-client follow-up may clarify
coverage; no such unattended collection continues after this bounded session.

Raw bounded anonymised evidence: live-observation.json. Derived comparison and
per-deferral records: comparison.json. Initial deployment and source proof:
DEPLOYMENT.json. Unit/browser/legacy verification: README.md, browser-tests.json
and inherited-regressions.json. The original investigation archive is unchanged.
'''
(root / 'REPORT.md').write_text(report)
print(json.dumps({'status':result['status'],'minutes':round(now['wallMinutes'],2),
    'aircraft':now['aircraftDetected'],'primary':now['primaryAircraft'],
    'deferrals':now['verifiedLocalDeferrals'],'amplified':now['localDeferralsAmplifiedToFailurePause'],
    'primaryEverPercent':now['primaryAircraftEverCompletePercent'],
    'primaryTimePercent':now['primaryDisplayedTimeCompletePercent'],
    'providerStarts':now['confirmedProviderHttpStarts']}))

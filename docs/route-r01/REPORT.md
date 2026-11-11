# Route reliability correction R01 — live comparison

Completed trial and verified cleanup.

Both primary-route measures increased in this sample: +6.25 percentage points ever complete and +3.48 points of display time. This is a measured improvement in the new observation, but different traffic/cache/client conditions prevent attributing its full size to R01 or establishing a material long-term household benefit. Overall route reliability remains limited.

**Root cause and correction.** The old browser treated any unsuccessful enrichment
response as a provider failure. A 30-second application-local gate deferral therefore
imposed a 300-second shared pause. R01 requires a versioned, coherent same-origin
contract, distinguishes the global gate from an in-flight request, and honors the
server wait while preserving the existing client deadline. Ambiguous responses
retain the conservative failure backoff. No retry timer or faster request ceiling
was introduced. The correction works in normal PIN-protected live mode too.

Code commit: `903a1cf191ba648dbde001014b5c13eafb2ed9e0`, branch
`stage-3a-display-redesign`, [Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5).
Baseline source was verified as `b8076615e4989fe85edebc33ee7058b38f5529f7`.
Deployment `dpl_V6WySMt7yY2eJ4pHXWQtp7pW2DUo` reached READY in Preview,
project `prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW`, team mml3. All 69 runtime source
hashes matched. Runtime access required the exact Preview identity, independently
confirming that target=null was Preview, not Production.

[Stable corrected Preview](https://perch-aero-pane-stage3a.vercel.app/?mode=live) ·
[Immutable R01 URL](https://perch-aero-pane-stage3a-d8qti1wku-mml3.vercel.app/?mode=live) ·
[Previous Preview preserved for comparison/rollback](https://perch-aero-pane-stage3a-eixaj6pkv-mml3.vercel.app/?mode=live).
Existing tabs need a normal page refresh to load the corrected client bundle.

**Actual observation:** 2026-11-11T17:16:42+00:00 to 2026-11-11T18:03:33+00:00,
46.85 minutes of process time / 46.56
minutes of page evidence. The deployed browser used live adsb.fi and HexDB through
the ordinary scheduler, with no route mocks, direct extra provider probes or FR24
scraping. A valid returned association is not an independently verified flight plan.
No physical iPad/Safari-engine execution or 18-hour unattended test is claimed.

| Measurement | Prior 40-minute session | R01 session |
| --- | --- | --- |
| Observation minutes | 40 | 46.85 |
| Aircraft detected | 29 | 18 |
| Aircraft becoming primary | 16 | 16 |
| Displayed aircraft without any route API attempt | 16 | 1 |
| Primary aircraft ever showing complete routes (%) | 25 | 31.25 |
| Primary display time with complete routes (%) | 13.18 | 16.66 |
| Secondary aircraft ever showing complete routes (%) | 10.71 | 33.33 |
| Secondary displayed aircraft-time with complete routes (%) | 6.4 | 23.62 |
| Short local deferrals amplified to five minutes | 3 | 0 |
| Browser enrichment attempts | 28 | 32 |
| Confirmed new provider HTTP starts | 14 | 20 |
| Server cache hits/coalesced responses | 11 | 10 |
| Median first detection to route API attempt (seconds, attempted only) | 15.64 | 0 |
| Median first detection to usable route (seconds, successful only) | 16.28 | 0.7 |

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
| Correct deployed source/environment | READY Preview; all 69 source hashes matched 903a1cf191ba648dbde001014b5c13eafb2ed9e0 |
| Browser → API | 32 application attempts; bounded response records and screenshots |
| API → provider | 20 confirmed new upstream starts, separate from 10 cache/coalesced responses |
| Provider → validation/cache | Explicit complete/partial/negative/rejected/error outcomes below; original source safeguards unchanged |
| Cache → scene | Publication timing below; final internal-but-unshown routes 0 |
| Local-deferral recovery | Observed live, with per-deferral deadlines below |
| Authentication cleanup | Verified post-expiry HTTP 401 and real PIN browser screens |

There were 5 complete-route publications in this live window.
Mocked success/role/publication regressions are kept separate from live evidence.
No raw production runtime log or secret was required.

**Local deferral evidence.** Verified application-local deferrals occurred live. Their requested/applied deadlines and actual recovery are recorded below; the trace distinguishes longer scheduling constraints from failure-backoff amplification.

Verified deferrals: 2.
Applied-deadline amplifications: 0.
Any short local response still held with a five-minute failure pause:
0.

| Response UTC | Lookup | Server reason | Requested wait | Browser global wait | Actual next attempt | Observed restrictions |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-11T17:42:00+00:00 | primary aircraft | global-gate | 30.000 s | 30.000 s | 59.186 s | no-current-primary, scene-opportunity |
| 2026-11-11T17:46:45+00:00 | primary aircraft | global-gate | 30.000 s | 30.000 s | 44.336 s | scene-opportunity |

[Real complete route](live-complete-route.png) · [Live local deferral](live-local-deferral-pending.png) · [Recovery trace](live-local-deferral-resumed.png).

Each verified local deferral declares zero upstream HTTP work. Full global and
secondary eligibility timestamps and the next attempt role/type are retained in
comparison.json. Actual elapsed waits use monotonic time. Longer observations may
reflect the 15-second scene cadence, secondary allowance, primary priority,
inactivity, disappearance or no eligible lookup; restriction samples are evidence
of conditions, not exclusive causal attribution. Unresolved records at shutdown
must not be treated as five-minute amplification.

**Provider work and protection.** There were 16 route
and 16 identity API attempts. Confirmed new
provider starts/responses were 20 /
20: 11 route and
9 identity starts. Server cache hits/coalescing account
for 10 responses without another provider request.
These are confirmed counts attributable to this observer, not a project-wide total.
Aborted/unreturned boundary requests and work from other clients are not claimed.

New upstream route outcomes: `{"complete": 3, "partial": 0, "negative": 3, "rejected": 5, "error": 0, "unknown": 0}`.
All route API outcomes including cached reuse and local deferrals:
`{"complete": 5, "partial": 0, "negative": 4, "rejected": 7, "error": 0, "unknown": 0}`.
Genuine provider-failure backoffs observed: 0;
unverified/unexpected/network failure backoffs: 0.
A live absence of provider errors does not test a real 429; numeric/date 429,
access denial, timeouts and malformed upstream responses are covered by mocks
and compiled HTTP tests. Genuine failures retain the five-minute floor and longer
valid Retry-After. Coalesced failures do not double-count an upstream request.

Minimum measured client attempt spacing: global 30.006 s,
secondary 119.829 s. Maximum simultaneous
client requests among completed measured intervals: 1. Existing ceilings
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
| F0001 | primary | miss | negative | http-404 |
| F0002 | primary | miss | rejected | route-too-old; association age 542.0 days (field presence does not prove current route validity) |
| F0005 | secondary | hit | negative | http-404 |
| F0006 | primary | miss | complete | validated; association age 14.5 days (field presence does not prove current route validity) |
| F0008 | secondary | hit | rejected | route-too-old; association age 377.7 days (field presence does not prove current route validity) |
| F0013 | secondary | miss | complete | validated; association age 14.5 days (field presence does not prove current route validity) |

**Lookup/publication timing.** First detection to first application route attempt:
{'count': 16, 'medianMs': 0, 'maxMs': 2598}. First detection to first usable
route: {'count': 5, 'medianMs': 702, 'maxMs': 3387}. Response to enriched scene publication:
{'count': 5, 'medianMs': 0, 'maxMs': 0}. These latency samples exclude unattempted
flights and measure application publication, not physical iPad paint. Internally
available but unshown route count at the final snapshot:
0.

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
isolated Preview and absolutely expired at 2026-11-11T18:03:30.191Z, below 48 hours.
The project flag was disabled for future builds immediately after activation.
Observation intentionally ends with that absolute expiry; no permanent bypass
cookie exists. CLEANUP.json records real post-expiry 401/PIN checks, no locked-screen tracking, a stopped observer and the stable alias remaining on R01.
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

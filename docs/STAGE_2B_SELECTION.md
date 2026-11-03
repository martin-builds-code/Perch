# Stage 2B — relevance and stability

Stage 2B implements Option A, “most likely to be noticed”, as a provisional
relevance estimate. It does not establish audibility or visibility and adds no
noise model, enrichment, provider, location disclosure or persistent history.

## Baseline and review dependency

Source baseline: `78c9b644a82737a9270a61f1a2ce6b358fa092fc` on
`stage-2a-live-data`. Remote branch and PR #1 were checked: this was still the
latest commit, PR #1 was open/draft/unmerged and the working tree was clean.
The corrected ESM imports and plain-Node runtime checks are retained.
The attached Product and Technical Specification v2.0 was reread before design.

Development branch: `stage-2b-aircraft-selection`. Its separate PR targets
`stage-2a-live-data`, so the review diff contains only Stage 2B. PR #1 and its
branch are unchanged. Do not merge either PR or deploy without separate authority.
After Stage 2A is accepted, reviewers can retarget Stage 2B appropriately.
Branch-specific Git deployment is disabled in source for Stage 2B as well.
No existing protected Preview, production setting, environment variable, sharing
link or deployment protection was changed.

## Inputs and eligibility

`src/selection.ts` consumes the existing normalised aircraft contract. The server's
validated haversine distance is reused; no second geodesic calculation exists.
Only explicit ground aircraft are excluded. Ground status is now tri-state:
`true` for the provider's `alt_baro="ground"`, `false` for numeric barometric
altitude, `null` when neither is reported. False is not an independently verified
airborne observation. Missing status/altitude remains eligible with neutral altitude.
This small normalisation change is the only server behaviour change.

Eligible records need valid position/timestamp indicators, no timestamp anomalies,
a finite horizontal distance in 0–15 km and a non-future position age below
Stage 2A's 120-second expiry. No altitude cutoff applies. Invalid, expired,
explicit ground and out-of-region replacements release the primary immediately.
Unknown altitude, track and speed are never interpreted as zero.

## Initial score

All values live in `DEFAULT_SELECTION_POLICY` and can be adjusted in code; there
are no user-facing settings. The score is an inspectable heuristic, not a
probability or statistically fitted result.

| Contribution | Initial rule |
| --- | --- |
| Proximity, up to 50 | `50 / (1 + distanceKm / 3)` |
| Altitude, up to 20 | `20 / (1 + max(0, barometricAltitudeFt) / 8000)` |
| Missing altitude | Neutral 10 points |
| Approaching / passing / departing / unknown | 20 / 12 / 0 / 10 points |
| Valid positional quality baseline | 10 points after eligibility checks |
| Freshness multiplier | `1 - 0.8 * positionAgeMs / 120000` |

The sum of the first four contributions is multiplied by freshness. At 30 seconds,
positions remain eligible but are delayed and movement becomes neutral. At 120
seconds they expire. A missing/invalid position gets no score. Quality here means
valid positional evidence and source age; identity completeness does not affect
relevance. Negative barometric altitude retains its displayed value but receives
the maximum low-altitude contribution. It is not ground clearance.

Proximity is smooth, with no artificial discontinuity around 2 km or similar
internal boundaries. Altitude supports preference without excluding higher flights.
The movement difference is deliberately large enough for a slightly farther
approaching aircraft to outrank a nearer departing aircraft. These initial weights
need practical calibration; none have been optimised against listening ground truth.

## Motion evidence and bounds

The browser maintains timestamped **distance** samples, not geographic coordinates.
Distance decreasing/increasing directly measures radial movement relative to the
observer. A compass track alone cannot do that without observer bearing, so track
remains a display field rather than a guessed radial direction. Ground speed is
used only to reject implausibly large distance jumps.

Motion uses the three most recent distinct position timestamps, spanning at least
20 seconds, with no gap above 45 seconds. At the normal cadence it first becomes
available after about 30 seconds; acquisition does not wait for it. A least-squares
slope uses actual elapsed seconds, so irregular polling is supported.

A net change below 150 metres or radial speed below 3 m/s is neutral/unknown.
An approach followed by flattening or a reversal within 250 metres of the preceding
minimum is classified passing; this requires a preceding decrease of at least
150 metres and allows 50 metres of jitter. These tolerances are starting values.
Steady jitter alone never establishes passing. Missing speed/track does not block
motion assessment. A speed sanity limit uses 1.5 times the larger reported speed
plus 30 m/s tolerance and 50 metres of displacement tolerance; if speed is absent,
the radial ceiling is 600 m/s. A jump or gap resets that aircraft's motion samples.

History keeps at most six samples per aircraft, in a 90-second window, for at most
1,000 identifiers (the existing API response cap). Newer observations refresh map
insertion order; capacity eviction discards the least recently updated history.
Cached, repeated and older timestamps add no samples or challenger confirmations.
A short omission can retain history; a gap above 45 seconds starts motion afresh.
A backwards local clock clears selection/history. Reload starts empty and acquires
from available data immediately. Unmount/live-mode stop clears all selector state.
There is no localStorage, database, background worker or additional provider request.

## Holding and handover

The selector owns one primary, its acquisition time and at most one pending challenger.
Records are scored and sorted once per publish; the display and expiry scheduling
reuse that result. Ties use identifier order. Secondary cards use relevance order,
exclude the primary, deduplicate identifiers and are capped at the existing three.
Duplicate records prefer the newer position, then the smaller distance if times tie.

Normal takeover requires all of:
- At least 36 seconds since primary acquisition.
- A score lead of at least 8 points.
- Two distinct newer position observations supporting that lead.

The hold is not renewed on every poll. Small leads reset confirmation and cannot
oscillate the primary. It is legitimate to retain a useful current aircraft when
a rival's advantage remains below the hysteresis threshold.

Earlier handover is allowed for a lead of at least 22 points, or an approaching
challenger with an 8-point lead over a departing incumbent. A delayed incumbent
also yields to a fresh candidate with at least an equal score. A brief failed
request freezes discretionary switches while the incumbent remains eligible;
invalid/expired records still release. There is no freshness bonus for retention.

If an aircraft is omitted from a nonempty response containing other eligible
candidates, its unchanged last record can remain primary for **less than 30 seconds
since last seen**, subject to all freshness checks. Its timestamp is never renewed.
The existing expiry timer enforces this grace even if the next request hangs.
An empty successful response, or a ground-only response, clears the primary
immediately. A useful challenger may take over during the grace under the same
rules. Retained records naturally become delayed at the existing 30-second age.
Failed requests are not treated as empty; the last successful snapshot still
expires after 120 seconds as in Stage 2A.

`SelectionResult` exposes ranked scores/components, motion, ages, primary ID,
challenger ID, score margin, holding duration, confirmation count, retention status
and decision reason. `createPoller().diagnostics()` exposes that result and bounded
history counts to tests/developers. Nothing is added to the product interface or
sent to a remote diagnostic service.

## Evidence and checks

Stage 1B's reported 310 aircraft / 394 passes, near and high-altitude observations
(including above 10,000 ft), and 15-second cadence informed synthetic cases. The
original archive was not present in the repository, workspace project files or
attachments; the sole supplied attachment was v2.0. No Mac mini/collector was
accessed and no original evidence was changed. **Archive-based replay remains
outstanding.** Reported listening observations are not complete acoustic ground truth.

`npm run replay:selection` compares the original nearest-first rule with the new
selector on six explicit synthetic scenarios in `tests/fixtures/selection-replay.json`.
It writes `stage-2b-synthetic-replay.json` with factor-level explanations and verifies
expected primaries. Representative results:

| Synthetic scenario | Nearest-first | Stage 2B |
| --- | --- | --- |
| Slightly farther approach vs nearer departure | Nearer departing aircraft | Approaching aircraft at 30 s |
| Eight small alternating distance observations | Seven switches | No switches |
| 2,000 ft at 5 km vs 12,000 ft at 3 km | Closer high aircraft | Farther lower aircraft |
| Close ground aircraft plus airborne candidate | Ground aircraft | Airborne candidate |
| Only aircraft at 18,000 ft | Eligible | Eligible |
| Meaningful normal challenger at 15 s | Immediate takeover | Holds until 45 s |

These demonstrate rules and regressions, not real-world accuracy or detection coverage.

`npm test` passes 54 named tests (20 inherited, 34 new) plus all five plain-Node
compiled-server HTTP scenarios. Coverage includes scoring, jitter, approach/passing/
departure, irregular intervals, omission/reappearance, duplicates, stale/future data,
hysteresis, holding/early release, recovery, cleanup/bounds and unchanged polling.
Both default and live-enabled builds, NodeNext server checks and ESLint pass.
The inherited ESM correction remains intact.

Optional local Chromium check: with a loopback-only dev server running using
`VITE_AERO_LIVE_ENABLED=true`, set `PERCH_PLAYWRIGHT_MODULE` to the separately
installed Playwright Core module and run `node scripts/selection-browser-check.mjs`.
The script intercepts every aircraft request with synthetic responses and uses
an accelerated browser clock. At 1024×624, 1024×768 and 1112×834 it verifies primary
A at 0/15 seconds, approaching primary B at 30 seconds, secondary exclusion,
existing card/footer bounds, no added controls, zero page errors and zero API calls
after navigating to simulation. Results and a synthetic screenshot accompany this
note. No browser test used the protected Preview or a live provider.

## Compatibility, performance and remaining review

The approved display components, CSS, typography, colours, dimensions, spacing,
compact footer and landscape behaviour are unchanged. Safari 15 transpilation and
CSS targets are retained. New client operations are ordinary arrays, Map and
numeric calculations supported in Safari 15; no newer browser-only API or new
runtime dependency was introduced. No physical Safari/iPad Air 2 or Air 3 testing
was performed. Chromium dimensions are not hardware certification. There is no
identified material Air 2 compromise; physical fit, readability, interruptions and
endurance remain acceptance activities after separate deployment authorisation.

The 15-second polling cadence, request timeout, server caching, geographical query
and provider request budget are unchanged. There is still one polling chain, one
expiry timer and the existing per-request timeout; no additional timers. The added
processing is one bounded history/score pass plus one ranking sort per publish.
At most 6,000 small motion samples and one snapshot/ranking are retained. Expiry
publishes reuse the same timers and never request data. Desktop tests check counts
and cleanup, not physical Air 2 memory or performance guarantees.

Review the initial weights, 3 m/s/150 m movement tolerance, 36-second hold, 8/22-point
margins and missing grace against real passes before tuning. Unusual slow movement,
circling traffic, missing ground flags and equal candidates remain heuristic cases.
Ground flags can be absent or wrong; missing ones cannot establish flight status.
Routes, operator enrichment, authentication, acoustic modelling and Stage 2C are
out of scope. No deployment, merge or production/Preview change was performed.
Stage 2B is returned for code review and a separate deployment decision.

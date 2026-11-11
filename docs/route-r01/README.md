# Route reliability correction R01

Baseline: b8076615e4989fe85edebc33ee7058b38f5529f7, verified local and GitHub
branch head, with open Draft PR #5. Main remains accepted Stage 2D 8031a76.
The previous investigation and its original evidence are preserved unchanged in
`docs/stage3-route-investigation/`.

R01 corrects the verified 30-second local-server deferral becoming a five-minute
browser-wide enrichment pause. It does not change route coverage, the 180-day
association-age guard, caches, relevance selection or provider request ceilings.
The [completed report](REPORT.md) compares 46.85 minutes of real observation
against the original session. Two live local deferrals applied 30-second deadlines
and recovered at 59.186/44.336 seconds with documented scene restrictions, without
five-minute pauses. Five of 16 primary aircraft had complete routes (31.25% versus
25%); complete primary-display time was 16.66% versus 13.18%. Different populations
and cache/client conditions prevent a firm long-term causal claim.

**Response contract and correction.** Only the service's typed
LocalEnrichmentDeferral can generate schemaVersion=1, origin=application,
category=local-deferral, reason=global-gate or in-flight. It declares zero
upstream requests/responses and the server's retry duration/issue time. The API
emits this contract in ordinary PIN-protected use too; the correction does not
require diagnostic mode. Upstream, invalid-request and unexpected failures have
different categories. Internal exception text and provider bodies are not exposed.

The browser requires HTTP 503, JSON media type, exact parent/error/envelope
fields, supported version/category/reason, zero upstream work, coherent
Retry-After and (when present) non-contradictory diagnostic metadata. A generic
503, an old diagnostic label alone, malformed/oversized JSON or an ambiguous
contract never receives the short treatment. Error bodies are bounded to 8 KiB.
Numeric and HTTP-date retry headers are supported; a date must agree with the
server's own relative duration/issue time rather than trusting browser clock
agreement. Millisecond durations are rounded up in the published contract.

A verified local deferral sets the next global opportunity to the maximum of
the existing client deadline and the server-requested wait from receipt, using
monotonic browser time. It creates no retry timer. The next existing scene or
resume opportunity decides the eligible aircraft. Thus an ordinary 30-second
deferral normally retries in 30–45 seconds, depending on the 15-second positional
phase. A secondary still cannot retry until the collective 90-second deadline;
a new eligible primary can use the earlier global opportunity. Old/absent aircraft
are not queued for automatic retries. Identity/route priority and fairness stay
unchanged. Stop-aborted late responses cannot extend shared budgets or publish.

Genuine upstream errors retain the five-minute floor, access-denial protections
and any longer valid Retry-After. No provider retry is weakened. A long server
protective deadline and an existing client deadline remain authoritative even
when longer than the ordinary local wait. Server cache, 30-second gate and single
in-flight protection are unchanged; gates/cache remain process-local on Vercel,
not globally coordinated across instances. Coalesced failing callers get separate
error context so they do not double-count the same upstream HTTP request.

**Diagnostics.** The bounded collector retains the original states and gains
verified-deferral records: identity/route, role, application origin/reason,
server duration, browser global/secondary deadlines, monotonic actual time to
next attempt, next role/type, and observed restrictions. These restrictions are
correlations from scene/lifecycle samples, not claims of exclusive causation.
The next attempt can concern another eligible aircraft; a local deferral never
forces a disappeared aircraft to be queried. Existing intervals, secondary
eligibility, primary priority, inactivity and absent aircraft can extend the
observed delay. Four recent deferrals appear in the temporary dashboard; exports
retain at most 1,024 records. Coordinates, complete positions, credentials, full
hex/callsigns, registrations and browser identifiers are not exported.

**Automated verification.** 256 tests, 19 compiled plain-Node HTTP cases,
ESLint, TypeScript/server checks and default/all-feature Safari 15 builds pass.
New cases cover the original 50 ms timing variation, malformed/contradictory
contracts, numeric/date Retry-After, upstream rate/access/timeout/network/invalid
responses, shared-server clients, single concurrency, cache/role correctness,
secondary deadlines, clock adjustments and lifecycle cancellation.

Mocked R01 browser checks at 1024×768 and 1024×624 prove 30-second global
recovery, a justified 90-second secondary wait, primary refresh priority, no
five-minute local backoff, shutdown and a full ten-minute upstream rate-limit
wait. All 51 inherited Stage 3 layouts plus secondary-enrichment and diagnostic
browser regressions pass, including no sleep requests and exact PIN/sleep pixels
against the approved baseline. No normal artwork/layout/CSS file was changed.
The test fixtures use compatible indexing; the Safari build target was not raised.
No physical iPad or Safari-engine execution is claimed.

**Completed live trial and access cleanup.** Corrected code commit
`903a1cf191ba648dbde001014b5c13eafb2ed9e0` is READY in Preview
`dpl_V6WySMt7yY2eJ4pHXWQtp7pW2DUo`, mml3 / perch-aero-pane-stage3a /
prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW. All 69 runtime source hashes matched.
Only the stable Stage 3A alias was reassigned; earlier immutable URLs remain.
The direct source deployment left Git integration disconnected.

A server-only lease ran from 17:13:30.191 to 18:03:30.191 UTC on 11 November
2026, including build and validation. The actual controlled browser ran from
17:16:42 to 18:03:33 UTC (46.85 minutes); it stopped when the absolute lease
expired. The project flag was disabled for future builds immediately after
activation. No bypass cookie was issued. [Cleanup evidence](CLEANUP.json)
records nine real post-expiry API 401s and four real PIN browser checks at
1024×768/624, with zero tracking requests and no diagnostic handle. Both the
corrected immutable URL and the stable URL now require the existing PIN.
The superseded partial-run deployment is also closed. No observation process or
task development server remains running.

The [stable Preview](https://perch-aero-pane-stage3a.vercel.app/?mode=live)
remains on R01. Refresh existing tabs to load its corrected client bundle.
Normal PIN-protected operation receives the same safe error contract;
diagnostic access is not needed for the correction. Configuration metadata
confirms all other Preview values unchanged; secret values were not viewed.
Household Production remains 8031a76 / dpl_2WX2Y9nNudmiJCtYMcAaMofp7Yzw.

The baseline comparison is 40 minutes, 29 aircraft, 16 primary, 16 without any
route API attempt, 25% of primary aircraft ever complete and 13.2% of primary
screen time complete, with three amplified local deferrals. Different traffic,
provider coverage, cache state and other clients prevent a causal accuracy claim.
Only provider HTTP starts/responses confirmed through this observer's requests
are counted; other clients' provider work is unknown. There is no paid service,
new provider, wider radius, faster positional polling, permanent monitoring,
credential change, merge or household Production deployment.

An initial exploratory run on 8a5baf0 was stopped after 27.84 minutes when two
additional red regression tests exposed a longer-provider-wait edge case. The
final client retains Retry-After before reading the body, even on body timeout; a
validated contract can only lengthen fallback protection if a header is missing.
Both tests then passed. Partial evidence is retained separately and excluded from
the final comparison; the final controlled observation uses the revised commit.

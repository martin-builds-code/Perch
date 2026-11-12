# Aero Pane route reliability investigation — 11 November 2026

Complete bounded live session. The household Production installation was not a test target.

The evidence establishes an application-side amplification problem: a local
server cooldown with a 30-second Retry-After becomes a five-minute pause for
**all** browser enrichment, including routes. This occurred live, while ADS-B
positions continued updating. A separate cause is the existing 180-day route-age
rule: complete matching provider associations can be discarded as too old.
HexDB also returned genuine route-not-found responses. These are different
conditions; aircraft that were never queried cannot be counted as provider misses.

**Source and execution.** Approved baseline `3b87077eab07a1d861c910fdaf385e3d32f49c6f`;
observed diagnostic build `beb028f09b604f0c2de5ed86938cf3408b95a433`;
local startup correction `efc5c52814391af84429ea9e15cf7c01a6096caa`. Branch `stage-3a-display-redesign`,
[open Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5).
Diagnostic deployment `dpl_2HsAJZcjzbLSr7uop8motbDq6WLV`, project
`perch-aero-pane-stage3a` / `prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW`, team mml3.
It reached READY; all 67 uploaded runtime files matched local source hashes.
API target null was verified as Preview by the successful server grant, which
requires VERCEL_ENV=preview and this exact platform-supplied project identity.
No Git integration was connected.

[Diagnostic build](https://perch-aero-pane-stage3a-o006y9x8r-mml3.vercel.app/?mode=live)
and [stable isolated Preview](https://perch-aero-pane-stage3a.vercel.app/?mode=live).
The final cleanup/alias verification is recorded in `CLEANUP.json` and PR #5.

**Actual observation.** One controlled foreground Chromium browser used the
normal deployed application, not a replay or direct provider probe. It ran from
2026-11-11T11:15:17+00:00 to 2026-11-11T11:55:17+00:00 (40.00
minutes of process time; 39.95 minutes of page
collection). No independent FR24/API comparison was performed. A returned route
is a best-effort provider association, not a verified current flight plan.

| Measurement | Observed result |
| --- | --- |
| Distinct aircraft detected in received nearby snapshots | 29 |
| Distinct detected / displayed flight keys | 29 / 29 |
| Aircraft becoming primary | 16 |
| Aircraft with valid-format callsigns | 29 |
| Positional snapshots successfully consumed | 160 |
| Browser enrichment attempts / completed responses | 28 / 28 |
| Route / identity attempts | 17 / 11 |
| HexDB HTTP attempts started / responses confirmed through this browser's requests | 14 / 14 |
| New upstream route / identity HTTP attempts | 9 / 5 |
| Application-server cache hits/coalesced responses | 11 |
| Route response outcomes from newly confirmed upstream responses | {"complete": 2, "partial": 0, "negative": 6, "rejected": 1, "error": 0, "unknown": 0} |
| Route API outcomes including server-cache reuse | {"complete": 4, "partial": 0, "negative": 8, "rejected": 3, "error": 2, "unknown": 0} |
| Primary aircraft ever displaying a complete IATA route | 4 / 16 (25.0%) |
| Secondary aircraft ever displaying a complete IATA route | 3 / 28 (10.7%) |
| Observed displayed aircraft-time with complete primary / secondary route | 13.2% / 6.4% |
| Time spent as primary without a complete route, across observed rows | 32.49 minutes |
| Displayed flights without any application route attempt / already absent at the end | 16 / 15 |
| Departures from displayed scene before lookup, including reappearances | 17 incidents |
| Client / server cooldown incidents | 3 / 3 |
| Combined configured client-wide pauses (not provider-outage time) | 15.00 minutes |
| Application HTTP / enrichment-network errors | 3 / 0 |
| Upstream transport/provider errors | 0 |
| Client response-validation errors | 0 |
| Minimum measured global / secondary attempt spacing | 30.172 s / 104.296 s |

| Role at lookup | Browser route attempts | New upstream route attempts | New upstream outcomes | API outcomes including cache |
| --- | --- | --- | --- | --- |
| Primary | 12 | 7 | {"complete": 1, "partial": 0, "negative": 5, "rejected": 1, "error": 0, "unknown": 0} | {"complete": 2, "partial": 0, "negative": 7, "rejected": 3, "error": 0, "unknown": 0} |
| Secondary | 5 | 2 | {"complete": 1, "partial": 0, "negative": 1, "rejected": 0, "error": 0, "unknown": 0} | {"complete": 2, "partial": 0, "negative": 1, "rejected": 0, "error": 2, "unknown": 0} |

All success percentages concern this limited session, not route accuracy or
real-world detection coverage. The final collector export may still say active because the observer closes
the page after the requested 40 minutes, before the 45-minute server lease.
metrics.json separately confirms the requested observation window completed.
An aircraft can occur in both role denominators.
Aircraft-time differs from the fraction ever receiving a route: a long-lived
light aircraft without a route can occupy the primary panel for many minutes.
Unqueried aircraft are excluded from lookup latency statistics, so latency alone
would overstate service quality. First detection means the first received record
in this session; startup aircraft are already in the area. Leaving the displayed
scene does not prove leaving the 15 km area. Cache hits do not count another
HexDB request; cache origins and other clients' provider work are not measured by
this browser. An existing Safari tab or another invocation may share a function
instance with this additional diagnostic browser. Therefore observed contention
frequency is not a measurement of single-iPad household frequency. Exact competing
requests are not recorded. Process-local Vercel gates/cache are not globally shared guarantees.
Vercel's runtime-log query provided no additional request-count evidence.

**Timing and publication.** Overall first detection to first application route attempt:
n=13, median 15.640 s, maximum 74.925 s. First usable route:
n=4, median 16.284 s, maximum 29.780 s. Primary-first lookups:
n=9, median 30.308 s, maximum 74.925 s; secondary-first lookups:
n=4, median 0.001 s, maximum 15.640 s.
Provider/API response to first enriched scene publication:
n=4, median 0.000 s, maximum 0.001 s. This measures application publication,
not physical iPad paint latency. Live screenshots show the validated routes in
the diagnostic cards. Role changes preserved cached routes; a secondary success
also appeared as primary without a second route lookup.

**Verified application problem: cooldown amplification.** The client obeyed its
30-second minimum. The server can nevertheless defer a request because its own
arrival-time gate is still closed or another request is in progress. It returns
503 with error=cooldown, Retry-After=30, origin=application and zero upstream
requests. The browser applies its shared 300-second provider-error pause anyway.
All routes then wait, even though aircraft tracking remains healthy. The live
incidents include a primary identity request and a secondary route request,
demonstrating that the pause suppresses unrelated route work in either case.

| Incident UTC | Failed kind | Server Retry-After | Browser pause | Gap to next completed enrichment response |
| --- | --- | --- | --- | --- |
| 2026-11-11T11:33:21+00:00 | aircraft | 30.000 s | 300.000 s | 315.306 s |
| 2026-11-11T11:43:06+00:00 | route | 30.000 s | 300.000 s | 313.517 s |
| 2026-11-11T11:49:36+00:00 | route | 30.000 s | 300.000 s | 314.615 s |

A deterministic regression additionally reproduces the mechanism with only
50 ms of server-arrival jitter. Live client timing is consistent with arrival
jitter, but concurrent client activity cannot be excluded; this session does not
identify the exact gate-conflict trigger. The amplification itself is directly
verified. No change to the shared failure pause was deployed or applied: shortening
it would restore suppressed provider opportunities and requires review against
the instruction not to expand provider traffic. Upstream 429/Retry-After and
provider-error protection must remain distinct from an application-local deferral.

**Verified validation policy: older route associations.** A matching callsign and
both IATA-code fields were present in an actual HTTP 200 response with an association
age of 541.7 days. The 180-day rule discards that route before caching/presentation.
The active diagnostics correctly label it rejected, whereas the ordinary payload
retains the existing not-found shape for compatibility. Additional cached
rejections are counted as cache outcomes, not new HexDB responses. This is a
known application policy interacting with source age, not proof that the rejected
route is either correct or incorrect for today's flight. The public documentation
does not establish that updated_at equals the last time that route was flown.
The early age rejection means later airport/contradiction checks were not
completed for that payload; field presence alone does not prove it was usable.
No age threshold, IATA guard or validation requirement was weakened.

**Verified source limitations.** Newly confirmed HexDB HTTP 404 responses are
separate from errors, deferrals and unqueried aircraft. Several were light-aircraft
or helicopter cases. Valid callsign syntax does not guarantee a scheduled route.
There was no route created from a callsign prefix, registration or airline.
The full per-flight evidence below shows which claims rest on real lookups.

| Reference | Displayed model | First detection → first application route attempt | First detection → usable route | Last observed cause |
| --- | --- | --- | --- | --- |
| F0001 | IKARUS C-42 Bison | 0.001 s | none | http-404 |
| F0002 | PARTENAVIA P-68 Observer | not queried | none | global-interval-or-cooldown |
| F0003 | PIPER PA-28-140/150/160/180 | not queried | none | global-interval-or-cooldown |
| F0004 | ATR-72-600 | not queried | none | global-interval-or-cooldown |
| F0005 | Airbus A-321 | 0.001 s | 0.332 s | validated; association 17.8 days old |
| F0006 | PIPER PA-38 Tomahawk | 0.000 s | none | http-404 |
| F0007 | Airbus A-321neo | not queried | none | global-interval-or-cooldown |
| F0008 | Boeing 787-10 Dreamliner | not queried | none | global-interval-or-cooldown |
| F0009 | LUSCOMBE 8 | 30.308 s | none | http-404 |
| F0010 | Boeing 767-300 | 0.000 s | 0.416 s | validated; association 6.7 days old |
| F0011 | Unidentified Aircraft | 0.000 s | none | http-404 |
| F0012 | Airbus A-320neo | 59.855 s | none | route-too-old; association 541.7 days old |
| F0013 | EXTRA EA-300/330/350 | not queried | none | global-interval-or-cooldown |
| F0014 | Airbus HELICOPTERS EC-135/635 | 44.691 s | none | http-404 |
| F0015 | ATR-72-600 | not queried | none | global-interval-or-cooldown |
| F0016 | PIPER PA-28-140/150/160/180 | not queried | none | global-interval-or-cooldown |
| F0017 | Boeing 737 MAX 8 | not queried | none | global-interval-or-cooldown |
| F0018 | BELLANCA 7 Citabria | not queried | none | global-interval-or-cooldown |
| F0019 | Boeing 787-10 Dreamliner | 74.925 s | none | route-too-old; association 541.7 days old |
| F0020 | Airbus A-320neo | not queried | none | global-interval-or-cooldown |
| F0021 | ATR-72-600 | 59.686 s | none | route-too-old; association 541.7 days old |
| F0022 | Airbus A-320 | 15.640 s | 16.284 s | validated; association 14.2 days old |
| F0023 | Boeing 737-800 | not queried | none | global-interval-or-cooldown |
| F0024 | Cessna 152 | not queried | none | global-interval-or-cooldown |
| F0025 | Embraer EMB-505 Phenom 300 | not queried | none | global-interval-or-cooldown |
| F0026 | EVEKTRO EV-97 EuroStar | 0.001 s | none | cooldown |
| F0027 | Airbus A-320neo | not queried | none | global-interval-or-cooldown |
| F0028 | AEROPRO Eurofox | not queried | none | global-interval-or-cooldown |
| F0029 | Boeing 737 MAX 8 | 29.570 s | 29.780 s | validated; association 17.8 days old |

**Pipeline review.** ADS-B stays authoritative for aircraft presence, freshness,
position, selection and movement. Callsigns are trimmed/uppercased, valid 2–8
alphanumeric characters; full values/hex are never exported. Primary priority
remains missing-model identity, eligible route, other eligible identity, then a
secondary route only at an existing scene opportunity. The client keeps its
30-second global/90-second collective-secondary minima and single in-flight
request. The application API authenticates/validates and uses the existing
process-local cache/gate. HexDB endpoints remain documented v2/routes/:callsign
and v2/aircraft/:hex, with TLS verification, 2.5-second upstream timeout and 64 KiB
cap. Route responses require matching identifiers, valid airports and acceptable
timestamps. Caches remain 5-minute positive routes, 5-minute negatives, 30-minute
identity, 30-second refresh lead, 64 client/128 server entries, keyed by hex plus
callsign for routes. Cached results are applied to all matching displayed
records and published as soon as the async request resolves. The prominent route
still requires a complete reliable IATA pair; partial or ICAO-only data remains
classified separately. No live invalid-callsign, mismatched-callsign or ICAO-only
rejection is established merely by its synthetic test.

**Corrections and tests.** Development-only state summaries now distinguish
awaiting, waiting, checking, complete, partial, negative, rejected, unavailable
and negative-cache states. Server metadata separates local API deferral from
upstream work. A startup race introduced by the diagnostic grant was reproduced
with a deliberately delayed session JSON body and corrected in efc5c52: policy
and authentication publish together before tracking mounts. The observed initial
build has one aborted startup positional request; it is retained in the network
counts rather than concealed. This is not a cause of the earlier household route
problem. No existing selection weights, radius, cache TTLs, polling, enrichment
ceilings or provider-error policy changed.

212 automated tests and 13 compiled plain-Node HTTP runtime checks pass, including
Production/other-project/expired-bypass denial, no minted bypass cookie, trace
privacy, outcome classification, gate reproduction, bounded collection, export
isolation and observer-failure independence. ESLint, TypeScript/server checks,
default build and all-feature Safari 15-targeted build pass. Mocked browser
checks pass at 1024×768 and 1024×624, including expiry to PIN, stopped requests,
30/90-second spacing and immediate publication. Inherited browser checks pass:
51 layout cases, secondary scheduler/role changes, stationary artwork,
reduced motion, legacy export, sleep/wake and disabled enrichment. PIN/sleep pixels
match accepted Stage 3 baseline 3b87077. Initial local harness failures (missing
disabled-feature server, a restart during a check, and a baseline font filesystem
permission) were resolved; no application CSS change was made to pass comparison.
No physical iPad or Safari-engine execution is claimed. Existing visual design
returns when diagnostics are inactive.

**Access, privacy and cleanup.** The server lease began at
2026-11-11T11:12:22.537Z and absolutely expires at 2026-11-11T11:57:22.537Z
(45 minutes, well below 48 hours). It requires an explicit server-only JSON flag,
VERCEL=1, exact isolated project identity and Preview environment. Production,
other projects, browser-supplied flags and clock changes cannot enable it. No
bypass cookie is minted. The flag was disabled in project configuration after the
one deployment was activated, so later builds cannot accidentally reactivate it;
the existing immutable diagnostic deployment remains bounded by its original
absolute expiry. The stable alias is restored to the prior accepted Preview at
the end; final real HTTP expiry/PIN and alias checks are in CLEANUP.json. No
existing credential or coordinate was read, replaced or rotated.

Collection/export remains browser-local with explicit local file saves, no
remote telemetry, no raw provider bodies or complete aircraft positions. The
bounded evidence uses F0001-style references, not ICAO identifiers, callsigns or
registrations. Up to 4,096 flight/detection records, 1,024 events, saturating
counters and an 18-hour collector cap prevent unbounded growth; the shorter
server lease limits this run. Closing the page stops requests. Evidence files
are a finite investigation record, not a persistent aviation-history service.

**Recommendations requiring review, ranked.**

1. Separate typed application-local cooldown deferrals from upstream failures.
   For a validated local cooldown, honor Retry-After and the existing global
   deadline instead of imposing an unrelated five-minute provider-error pause.
   Keep 30/90-second limits, single concurrency and genuine provider backoff.
   Test overlapping clients and response-timing variation before another bounded
   Preview trial. This proposal restores opportunities within existing ceilings;
   it is not silently applied because actual provider work may increase.
2. Confirm the meaning of HexDB updated_at, then explicitly review the 180-day
   policy against entertainment-only route use. Matching old associations are
   being discarded, but their current accuracy is not established. Do not simply
   remove the safeguard or treat a historical association as a current flight plan.
3. Replay the captured scene/slot timings and review optional identity requests
   versus secondary route opportunities under the same budgets. Aircraft leaving
   the display before lookup need a scheduling/priority discussion, not an
   automatic coverage label, wider radius or more frequent polling.
4. After those decisions, run a genuinely supervised longer trial with the same
   bounded browser observer. No reliable 18-hour environment lifetime was verified
   here, so this 40.00-minute observation is not reported as
   18 hours or as representative of the entire household day. The checked-in
   observer can run up to 18 hours in a verified durable execution window; Codex
   must initiate it, not require the owner to collect logs or operate a terminal.
5. Consider another permitted route source only if a longer sample still shows
   inadequate coverage after application issues are addressed. No alternative
   provider, paid service or persistent database is introduced by this work.

The strongest application finding is the five-minute amplification, followed by
an evidenced age-policy rejection and budget/priority waiting. Source misses are
also real. Their household-wide relative frequency remains unresolved without a
longer, representative observation and independent route accuracy evidence.

No main update, merge, household Production deployment/configuration/alias change,
new project, paid infrastructure, Mac mini or M24 change occurred. No 18-hour
monitor or background collection remains running after this session. Detailed
numeric evidence is in live-observation.json and metrics.json; synthetic browser
and normal-display regression evidence is clearly separate in browser-tests.json
and regressions.json.

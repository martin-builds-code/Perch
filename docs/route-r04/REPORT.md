# R04 — observation-cone selection and predictive route readiness

R04 is available on the [PIN-protected Stage3A Preview](https://perch-aero-pane-stage3a.vercel.app/?mode=live). Refresh an existing Safari tab to load the new client. Household Production is unchanged. No merge or Production promotion was performed.

Application commit: **f558718c659b7e928617abc5266345b88919f9ab**, branch `stage-3a-display-redesign`, [Draft PR5](https://github.com/martin-builds-code/Perch/pull/5). The verified starting HEAD was **c230231d262b345418680c900a397acf76c826a0**, including accepted R03 application **f2c1b3b3f0d4ede916f57994fccae3551717fc01** and later evidence. R01–R03 reports were read before implementation; later work was preserved.

## What changed

Display selection now follows estimated sky geometry and movement. Route scheduling uses a separate urgency calculation, with a small, explicitly uncalibrated information-value hint. Route availability and aircraft category never enter primary-display scoring.

The mandatory comparison passes: an airliner near overhead at6,500ft outranks a helicopter11km away at300ft. The reverse also passes: a helicopter close overhead at1,000ft can outrank a distant jet and retain its primary-route opportunity. Missing routes never make an otherwise relevant aircraft ineligible.

Core application changes are in `src/observation.ts`, `src/selection.ts`, `src/live.ts`, `src/liveTypes.ts`, `src/simulation.ts`, `src/enrichment.ts`, `src/routeUtility.ts`, `server/aircraft.ts`, `server/service.ts` and `api/aircraft.ts`. Trial-only comparison plumbing is in `src/LiveApp.tsx`, `src/SkyTrialDisplay.tsx`, `src/skyDiagnostics.ts` and the frozen `src/selectionR03.ts`; CSS additions are scoped to that diagnostic screen. `.env.example` documents the optional server-only elevation setting. Aircraft artwork, normal display components, authentication, quiet-hours code and provider adapters remain unchanged.

## Geometry and assumptions

The owner supplied observation elevation **31m**. It is configured only in the isolated project's Preview environment. Existing private latitude/longitude are unchanged. The server derives relative bearing and height from the same adsb.fi response already being fetched; it returns neither observer nor aircraft coordinates. The browser contract adds optional bearing, relative-height and height-reference fields.

For horizontal distance `d` and estimated height `h`, elevation is `atan2(max(0,h), d)` and spatial distance is `sqrt(d*d+h*h)`. Neither is interchangeable with horizontal distance. Geometric altitude is preferred, with barometric fallback. Subtracting31m is still approximate: geometric/barometric vertical datums, atmospheric pressure and the supplied ground elevation are not perfectly interchangeable. The measurement panel continues to show reported barometric altitude, not ground clearance. Unknown or implausible height uses neutral scoring rather than zero height or exclusion.

With bearing and ground track, position and velocity are expressed in a local east/north plane. Horizontal CPA time is `-(r·v)/|v|²`. Predictions assume constant ground track, speed and altitude, and stop at180s. A horizon endpoint is not labelled true CPA. A named35-degree cone estimates entry/exit to useful sky; it is not an eligibility boundary. Cone entry, CPA distance and time to CPA remain separate quantities.

Confident prediction requires two consistent positions, valid bearing/track, plausible15–650kt speed and position age below20s. Initial vectors are provisional. Turns, implausible jumps, missing fields and stale observations reduce confidence or disable prediction. Distance history can support simple approach/departure fallback but cannot manufacture two-dimensional CPA. No calibrated visibility, audibility or aircraft-noise claim is made.

## Display score and handover

Named starting contributions are horizontal proximity32, elevation sine24, spatial proximity8, motion20, quality10 and imminence6. Smooth distance scales are3km horizontally and5km spatially. Missing height receives half of the elevation/spatial terms. The existing continuous age penalty remains. These values are transparent trial heuristics, not statistically fitted probabilities.

Ordinary36s holding,8-point hysteresis, two fresh challenger confirmations, bounded history, missing-aircraft grace and expiry safeguards remain. Confirmed substantially better candidates and supported fast passes can interrupt the hold. A clearly overhead fresh arrival can immediately replace a much weaker horizon incumbent under documented geometric margins. An implausible jump's warning stays attached to its history sample across cached reevaluations.

The live trial exposed a separate inherited freshness-boundary weakness: records120ms apart straddled the30s delayed threshold, briefly changing primary for287ms before the next response restored it. The final special freshness handover requires a15s age advantage. Delayed remains30s, expiry120s, and genuinely fresh/confirmed/urgent challengers and expired-primary release remain available. This change addresses flicker without concealing stale data.

## Enrichment urgency

The planner considers the displayed aircraft plus at most six current future candidates. Named urgency contributions are proximity35, predicted elevation30, immediacy20 and speed15. A supported approaching fast secondary with a useful CPA/cone entry can receive its route before becoming primary, including ahead of a less time-sensitive primary request. Required primary identification and an urgent/overhead/passing primary route remain protected. Optional operator metadata can wait behind useful routes.

Small bounded type/callsign hints range from0.85 to1.10. They suggest potential information value, never an airline or airport pair. All aircraft categories remain eligible. Distant low-horizon secondary flights without a useful approach wait briefly before using a slot; low departing flights can remain low priority. A close relevant helicopter remains eligible for both primary display and a route lookup.

Every non-primary lookup, including one outside the three displayed secondary cards, consumes the collective **90s** secondary allowance. Global **30s**, concurrency **one**, R01 verified local deferrals/upstream backoff, cache TTLs, exact flight keys and R03's730-day qualified historical policy are unchanged. There is no new request timer or provider. Process-local Vercel gates are not a globally coordinated limiter.

## Controlled comparisons

[Eight synthetic comparisons](COMPARISON.md) replay identical trajectories and known fixture outcomes through R03 and R04. All remain within the configured budgets and R04 uses no more requests in these fixtures. The slow-primary/fast-jet case has the jet's route ready29s before primary selection. Busy traffic uses35 requests versus38, with route-bearing primary time69.1% versus19.1%. Those are model results, not household route coverage or human-observation accuracy.

The stress case is deliberately retained: with two jets30s apart and a genuinely close circling turboprop, both selectors retain the turboprop. The second jet's route arrives1s after CPA because of the90s secondary restriction. R04 does not promise universal readiness or silently increase the allowance. See the full [timing and request results](synthetic-comparison.json).

Old archives lack the bearing/trajectory detail needed for honest two-dimensional replay. R01/R02/R03 evidence therefore informed scenarios but was not represented as a complete trajectory archive.

## Actual live observation

**12 November 2026,11:54:07–12:34:07UTC;40.01 minutes of process time.** One real deployed browser used ordinary adsb.fi/HexDB APIs, without mocks, direct extra provider probes or FR24 scraping. The collector stopped automatically and its browser closed. No 18-hour test is claimed.

The live trial used **976210d284fae705b5245fec5a01e75eb2afcfd8**. The final application adds the cached-jump warning, meaningful freshness handover and fuller diagnostic timing capture after the trial exposed those needs. Those final changes have regression/browser and recorded-geometry replay evidence; the full40-minute route percentages below are measurements of the trial build, not a second live run of the final build.

|Measurement|Observed result|
|---|---:|
|Distinct aircraft detected|26|
|Distinct aircraft becoming primary|14|
|Primaries ever showing complete routes|9/14 —64.3%|
|Primary displayed aircraft-time with a complete route|33.77%|
|Primary aircraft-time showing a historical route|24.82%|
|Secondary aircraft ever showing complete routes|12/25 —48.0%|
|Secondary displayed aircraft-time with complete routes|14.83%|
|Route ready at first primary acquisition|3/14|
|Aircraft without any route attempt during the session|5|
|Browser enrichment attempts / confirmed HexDB HTTP starts|34/34|
|Route requests / identity requests|28/6|
|Complete route responses|15:6 recent,9 historical|
|Genuine provider misses / rejected associations|12/1|
|Upstream errors / amplified local cooldowns|0/0|
|Minimum enrichment attempt gap|30.016s|
|Minimum secondary attempt gap|90.567s|
|Maximum observed enrichment concurrency|1|
|Positional API requests / provider loads / cache responses|160/110/50|

This sample's request rates were51.0 enrichment attempts/hour and21.0 secondary attempts/hour, below their120/40 theoretical ceilings. They are observation rates, not future traffic guarantees. A different selected-aircraft population can change total requests despite unchanged scheduling ceilings. There were no observed local deferrals in this trial, so live recovery from one is not claimed; the R01 regression/compiled-server/browser tests provide that evidence.

Route000006 was ready29.26s before first becoming primary; historical routes00000d and000013 were ready14.70s and75.56s beforehand. These are genuine examples of advance availability. Median first detection to route attempt was30.12s; successful routes appeared after a median40.11s from detection. Successful response-to-scene publication had a median0ms and maximum1ms. The longest detection-to-attempt interval was20.5min for a low/receding C172, with intermittent scene presence; it was eventually queried as primary and returned404. That is not evidence of20.5min of continuous eligible queue waiting, and shows that low-priority aircraft can wait substantially longer.

The893.1-day association for000019 was correctly rejected even though both airport codes were present. Genuine not-found results stayed missing. Historical qualifications survived cache-backed publication and role changes. Client caches backed173 positive and311 negative scene uses; these are publication counts, not that many avoided HTTP requests. All34 HexDB calls were confirmed new upstream starts, rather than inferred from browser invocation counts.

The R01 context was31.25% of primary aircraft ever complete and16.66% of primary display time with routes, in a different46.85-minute traffic sample. R03's historical policy and traffic composition also changed. This trial cannot isolate a causal R04 coverage improvement over R03. The demonstrated improvements are useful advance route examples and the model/replay results, not a controlled household success-rate claim.

### Observed lookup outcomes by coarse category

Counts below are requests, not independent flight samples. Classification is a bounded type heuristic; unknown includes types outside its mapping. No live helicopter was observed, so helicopter behavior is established by regression scenarios rather than claimed field coverage.

|Category|Detected|Route attempts|Complete|Of which historical|Provider miss|Rejected|Gone at end without any attempt|
|---|---:|---:|---:|---:|---:|---:|---:|
|Commercial-type jets|12|10|9|4|0|1|2|
|Regional/turboprop mapping|1|2|2|2|0|0|0|
|General aviation mapping|4|4|0|0|4|0|2|
|Helicopters|0|0|0|0|0|0|0|
|Unknown/unclassified|9|12|4|3|8|0|1|

These small, selected groups do not establish category-wide HexDB coverage. Omission at the end is not proof of leaving the geographical area. Aircraft mix, repeated sightings and five-minute cache expiration affect counts.

## Selection evidence and limitations

[Three visual sky comparisons](live/sky-comparisons.png) make the different choices reviewable without developer tools. One shows R04 selecting an A320 at1.9km and66.7-degree estimated elevation while the R03 shadow selected a C172 at9.8km and2.3degrees. Another shows a higher departing aircraft remaining preferable to a very low horizon aircraft; departure alone is not an exclusion.

The trial captured19 R04 primary transitions, with a median selection interval about105s, versus15 captured R03-shadow transitions. More high-sky passes can justify more transitions, but that judgment needs physical review. The final selector's [recorded-geometry replay](live/replay.json) has17 transitions and removes the287ms flicker; its shortest completed selection is15.55s. This is replay, not a measured final-build display session.

The initial collector omitted some unchanged timer evaluations that can reset challenger confirmation. Replay of the original selector agrees with116/118 captured primary choices; R03 agrees with112/118. These are reproduction-agreement checks, not human accuracy percentages. Exact counterfactual timing/route coverage cannot be reconstructed for every scene. The final collector retains lightweight bounded evaluation times and R03-only choice changes for future trials. Unqueried provider outcomes are never invented.

## Tests, compatibility and performance

**349 application tests and29 compiled plain-Node HTTP scenarios pass.** ESLint, TypeScript, default build and live/enrichment/diagnostics/appliance-enabled Safari15 build pass. The existing51 Stage3 layout checks, secondary-enrichment lifecycle, R01 local/upstream cooldown browser tests and R03 historical-layout checks passed. New R04 tests cover geometry, stale/invalid vectors, adaptive handover, category separation, request priority, cache/role/callsign changes, stopped/hidden states, evidence bounds and both identified flicker safeguards.

Hosted fixture checks passed at1024×768 and1024×624: normal PIN, historical/secondary route publication, no diagnostic access from a query alone, stationary artwork through single/multiple transitions, full header and no scrolling. These used browser-intercepted synthetic APIs and made zero provider requests; they are separate from the real live trial. [Screenshots and checks](hosted/) show the normal display without the temporary trial banner.

Two old standalone Stage2 browser scripts timed out on pre-PIN `.model`/`.primary .details` selectors; they are not counted as passing current Stage3 checks. Their relevant behaviors are covered by the passing application suite and current browser checks. See [verification details](VERIFICATION.md).

No runtime dependency or artwork was added. Histories, caches and future candidates are bounded; extra R03 shadow work exists only during an explicit diagnostic lease. No request timer, background worker, database or analytics transmission was introduced. The all-feature client bundle is about288KB,91.8KB gzip. Safari15 syntax/CSS targets remain; actual Safari-engine performance and physical iPad Air2/sofa readability were not tested by Codex.

## Deployment, access restoration and next action

Final READY Preview: **dpl_7M3TTFYhqCpQAoxvzXesEDEga93G**, exact project **prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW**, team **mml3**. All94 uploaded source hashes matched the committed files. API target=null was independently established as Preview by the existing exact-project/Preview-only frozen-review guard. [Immutable final URL](https://perch-aero-pane-stage3a-9722tqll8-mml3.vercel.app/?mode=live) and the stable alias serve identical HTML/assets. Only `perch-aero-pane-stage3a.vercel.app` was reassigned.

The50-minute trial lease was active11:51:35.726–12:41:35.726UTC and was disabled for subsequent builds immediately after the trial deployment was captured. It required the exact isolated project, Preview environment and explicit server-only configuration. The final deployment requires the normal PIN. After absolute expiry, the old trial's session, aircraft and enrichment APIs independently returned401. No credentials were revealed, rotated or replaced and no Vercel platform security was disabled. Evidence: [deployment](deployment.json), [normal HTTP](normal-http.json), [stable URL](stable-http.json), [expired trial authentication](auth-expiry.json).

The previous [R03 immutable Preview](https://perch-aero-pane-stage3a-ea6xgvpnm-mml3.vercel.app/?mode=live) remains available for rollback/comparison. Household Production remains **dpl_2WX2Y9nNudmiJCtYMcAaMofp7Yzw**, main **8031a76d0a24e1bb4ba88febd87d9a9c15ff2166**. Production configuration, credentials, aliases, observation coordinates, Git integration and PR merge state were not changed.

Recommended next action: review the visual sky comparisons and the new stable Preview on the physical iPad. Assess whether the additional fast-aircraft handovers feel useful and readable. Keep the current budgets and historical policy during that acceptance review. Larger live samples, difficult turns/low-altitude datum uncertainty, the90s prefetch constraint and category mapping remain calibration topics. Route associations remain best-effort information, not verified current flight plans. Production promotion requires separate authorization.

Task cleanup: the40-minute observer exited normally, both the final and expired trial URLs passed independent PIN/browser checks, the three task-local development servers were stopped and the disposable baseline worktree was removed. No background collection continues. Normal screenshots use synthetic aircraft data; retained live records use trial-local references and contain no observation/aircraft coordinates, raw ICAO/callsign/registration or credentials.

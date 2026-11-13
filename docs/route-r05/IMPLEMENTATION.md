# R05 — adaptive enrichment implementation and controlled trial

R05 is developed on `r05-adaptive-enrichment`, based on accepted R04 evidence commit `ad010cd3b9da31e2ee06fba75854c995107cd493` and application `f558718c659b7e928617abc5266345b88919f9ab`. Draft PR5 remains unmerged. The stable R04 alias remains on `dpl_7M3TTFYhqCpQAoxvzXesEDEga93G`. Household Production, main, the observation point and its 31m elevation are unchanged.

## Implemented policy

Every new R05 HexDB attempt, including identity, route, errors and retries, requires a shared atomic reservation. One request consumes one token. Capacity is three, replenishment is continuous at one token per30s, the minimum start gap is10s, concurrency is one, and an independent rolling five-minute log caps starts at ten. Successful cache reads consume no provider allowance. Uncertain/abandoned reservations remain charged conservatively; capacity is never refunded based on an uncertain outcome.

For additional safety the implementation waits10s after completion, so actual starts are at least10s apart even when response times vary. The rolling log retains completion-time upper bounds on starts, preventing a slow/in-flight request from falling out of the limit early. This can postpone capacity slightly beyond the mathematical minimum. It cannot admit extra calls. Marginal work preserves one token for essential/urgent work; urgent predictive secondary routes can use the protected capacity. No fixed90s secondary gate or30s global client/server gate remains in the R05 path. Those policies remain unchanged in R04. The separate R04 peripheral-residency relevance filter is retained; it is not the superseded collective secondary rate gate.

The rolling24h runaway guard is **2,000**, shared across all R05 viewers and types. Observed R04 traffic51/h implies1,224/day; the conditional R05 replay55.5/h implies about1,332/day. A1,000/day guard would predictably interrupt continuous ordinary operation.2,000 provides headroom over those samples while capping an unexpectedly persistent120/h ceiling. It is an initial policy rather than a measured household maximum. Changing it requires matching expected server configuration and the shared state; a viewer cannot raise it. State validation bounds it at2,880, the ten-per-five-minute theoretical daily maximum.

## Scheduling, queue and lifecycle

The existing R04 planner remains responsible for urgency. Essential primary identification and immediate primary routes are protected; approaching secondary routes can outrank optional metadata or less urgent primary work according to the accepted geometric urgency and bounded category utility. Route availability never enters display selection. There is no change to the observation cone, holding/handover rules,15km radius,15s position polling, aircraft graphics or layout.

The queue is the bounded current scene, recalculated before each admission, with the established exact aircraft/callsign cache keys. A single bounded timeout wakes at the next shared opportunity only when eligible work exists. Completion can drain the queue without waiting for another positional poll. Hidden/offline pages cancel wakeups and abort their HTTP request; sleeping/stopped application lifecycles stop the enricher. Aborting a browser request does not refund an already-started provider call. Server ownership remains charged until safe completion/recovery. Stale/missing aircraft are rechecked before dispatch.

Existing TTLs remain: successful route5min, genuine miss5min, aircraft identity30min; capacities and refresh-lead rules are retained. No six-hour route or one-hour miss cache was adopted. Longer TTLs would reduce traffic but retain outdated callsign associations/misses longer and confound this scheduling comparison. R03's180–730day historical qualification, exact callsign matching, contradictions and timestamp checks remain intact.

## Shared coordination and safety scope

A new **free, separate Perch project in MML**, `Perch-R05-Coordinator` (`jjtkwqscfukioutgnxgc`, eu-west-2), holds one small PostgreSQL budget row, an encrypted bounded cache and a hashed server credential. No M24 database is used. No background worker or Supabase end-user authentication is introduced.

`server/r05Coordinator.sql` defines a serialized compare-and-swap RPC. Every reservation/completion uses the same writable database and locks the one scope row. Database time, not an instance/browser wall clock, controls replenishment, spacing and expiry. Revision checks prevent two instances using the same capacity. A crash, lost acknowledgement, unavailable coordinator, malformed state, clock regression or lost completion fails closed; it never falls back to a per-instance limiter. Concurrent callers may receive a typed short local deferral and retry at the returned deadline.

The ownership lease is120s, deliberately longer than the verified15s Vercel function maximum. A worker cannot begin a provider request more than3s after its reservation RPC begins. A lease recovery records an uncertain attempt and starts protective error backoff. The platform runtime bound is essential: an arbitrary lock TTL alone cannot guarantee concurrency safety. Database restore/failover that loses acknowledged state requires suspending admission, waiting a complete five-minute window plus worker quiescence, and assessing the daily guard before resuming; this trial does not prove disaster-recovery durability. Ordinary simultaneous-instance enforcement is verified against the real store.

Raw tables/schema are inaccessible to browser roles and have RLS enabled with no allowing policies. The only exposed RPC requires both a project API key and an independent256bit server-only secret, checked before table access. EXECUTE is explicitly revoked from PUBLIC and authenticated; anon can call the RPC only with that separate server secret. This deliberate server-principal design avoids changing Aero Pane PIN authentication. The [Supabase SECURITY DEFINER advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) remains expected for that intentionally authenticated RPC; the private-table/no-policy informational advisory represents deny-by-default. The real API test rejects a publishable key without the secret and rejects private-table reads.

Cache keys are HMACs of exact enrichment keys. Cached identity/route payloads are AES256-GCM encrypted, at most128 entries per scope, with logical expiry matching existing TTLs and physical cleanup on the next RPC. No position history or observation coordinates enter the store. Request accounting retains only bounded timing/aggregate data for24h. There is no permanent route-history database. Free-plan inactivity pausing or quota exhaustion makes enrichment unavailable safely; positional tracking remains independent. No paid upgrade is enabled. RPC payload/stream sizes and timeouts are bounded.

The guarantee covers **participating R05 calls only**, across its viewers and overlapping instances/deployments sharing this coordinator. Unchanged R04 and household Production make their own provider calls and do not participate. This is not a provider-wide or source-IP-wide quota guarantee.

## Provider failures and local deferrals

Typed v2 application deferrals distinguish in-flight, spacing, tokens/reserve, rolling caps, provider backoff and coordination unavailability. They include zero upstream starts, consistent Retry-After and validated safe budget metadata. Ambiguous/generic503 responses retain failure protection. R01's v1 contract continues to work for R04. Short local waits do not become five-minute provider pauses. A focused regression also reproduces a50ms gate with HTTP `Retry-After: 1`: the client now honours the full second, while an explicitly marginal reserve deferral still permits a different eligible protected primary request. Contradictory gate reasons/budget snapshots fail safely. These client guards were verified offline during the live session; the session has not encountered a local deferral, so it does not provide live evidence for that edge case.

Actual upstream failures remain charged. Shared repeated429/server failures escalate5/15/60min; a longer valid numeric/date Retry-After wins, as do existing access-denied protections. Cache hits remain useful during backoff. No provider stress test or quota discovery is performed.

## Offline and browser verification

All388 unit tests pass, including39 new R05 cases for burst/refill/rolling boundaries, daily guard,20 simultaneous modeled clients, leases/crashes, cache encryption, exact callsigns, negative results, R01 errors, lifecycle and machine-access isolation. Plain Node ESM HTTP checks cover inherited handlers, the frozen route review and the new actual R05 server graph. ESLint, TypeScript, standard production build and the full live/enrichment/diagnostics/appliance/R05-enabled Safari15 build are run before deployment.

The real shared-store test used12 concurrent clients: exactly one reservation won; no RPC failed. Median RPC time564ms, maximum748ms in this execution environment. It verified stale-revision rejection, shared encrypted cache and missing-secret/private-table denial without making an aviation-provider call or changing the live budget.

Inherited browser assertions cover51 layouts, artwork fallback, identity transitions, reduced motion, late enrichment, private export, unchanged PIN/sleep pixels, R03 historical labels and R04 geometry/diagnostic expiry at1024×768 and1024×624 (plus1112×834 layout coverage). The baseline worktree needed a local Vite filesystem allow-list for the shared dependency font directory; no application font or assertion changed. Adaptive-enabled browser checks use the actual service with a mocked shared store/provider, verifying a10s request opportunity, independent secondary lookups, historical publication, hidden-page stopping, unchanged positional cadence and no scrolling at both target sizes. They are not physical Safari or real-provider tests.

## Conditional replay of retained real R04 observations

The40.01minute archive contains26 aircraft,14 distinct first-primary aircraft and34 recorded provider calls. The actual R05 planner/admission transitions replay the same retained geometry and frozen primary decisions. Six redacted identity demands are held fixed. Captured provider outcomes are conditionally reused earlier; never-queried flights receive no invented answer or route credit. This cannot establish household live coverage.

| Metric | R04 reference | Implemented R05 |
|---|---:|---:|
| Requests / route / identity |34 /28 /6|37 /31 /6|
| Peak rolling1min /5min |2 /7|3 /8|
| Minimum start gap |30.015s|10.579s|
| Routes ready on first primary |3/14|6/14|
| Primary display time with complete route |33.78%|35.38%|
| Aircraft gone without a route attempt |5|3|
| Known complete responses |15|15|
| Requests with unobserved provider outcomes |0|2|
| Requests on never significantly relevant aircraft |3|5|

The significance proxy now uses complete contiguous primary stints, rather than individual scene-publication intervals. This corrects the investigation's marginal-request counter only; requests, readiness and exposure are unchanged. The frozen investigation retains its original6/8 counts for provenance.

The gain is earlier delivery of already-known routes, with three additional requests (+8.8%), not demonstrated new source coverage. Both models remain below ten; R05 peaks at80% five-minute utilization and never exhausts its token reserve in this sample. Median detection-to-request falls39.29s→0s, but cohorts differ; the real recorded R04 median was30.12s. The frozen replay does not reproduce every browser callback timing.

Unresolved primary-without-route time coinciding with a secondary request is6.57s→9.06s, an occupancy indicator rather than proven causal primary delay. A pessimistic sensitivity assigning unseen outcomes hypothetical five-minute errors yields4/14 routes ready and32.09% complete primary time. Those errors were not observed. The earlier20/30/50-cap experiments recovered no additional known first-primary routes; they do not justify increasing this trial's ten cap.

## Preview isolation, access and rollback

Vercel rejects branch-scoped variables when Git is disconnected. Git integration stays disconnected. Only new `AERO_R05_*`/`VITE_AERO_R05_ENABLED` Preview keys are added; no existing live/PIN/session/coordinates/diagnostic setting is replaced. R04 source does not reference these keys and its immutable deployment retains its original build/runtime values. R05 additionally checks exact Vercel project ID, Preview environment and R05 source branch server-side before opting in. A requested but invalid R05 setup fails closed rather than using the old limiter. No stable alias is reassigned.

Normal owner access retains the existing PIN. For the single automated trial, a separate server-only machine credential authorizes only GET requests on `/api/r05-observe`, within an absolute window no longer than90min and only the exact R05 Preview identity. It can read session/aircraft or use the same enrichment handler/budget; it cannot create a household session, submit PINs, access other paths or authenticate normal APIs. It is never sent to the owner or stored in browser assets/results. Normal PIN endpoints reject it. This is not a public PIN bypass. Its expiration is verified after testing.

Rollback is simply to close the separate R05 URL and continue using the unchanged stable R04 URL. No deployment/alias/config rollback is needed for R04. Do not reset a live budget or extend test credentials to recover a failed trial. Stop the test browser; temporary machine access expires independently. A fail-closed coordinator can reduce optional enrichment but cannot stop positional tracking.

## Live trial and final deployment

**[Open the separate R05 Preview](https://perch-aero-pane-stage3a-4wgfc8612-mml3.vercel.app/?mode=live)** using the existing PIN. [Draft PR6](https://github.com/martin-builds-code/Perch/pull/6) is stacked on PR5. Application source is **`dd0e18fdcd2cad1fe71370f9d30ff945cab861bd`**, deployment **`dpl_ERjUikdfKg74VEELCN4HApVCW7Aj`**, project `perch-aero-pane-stage3a` / `prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW`, team `mml3`, **READY / Preview**. The documented API uses omitted target / returned `target:null` for Preview. Exact project, Preview and R05 branch identity additionally passed the server-enforced machine-access guard; this was not inferred from the project's name. The final source manifest contains74 committed runtime/build files; no local credentials were uploaded.

The one ordinary live trial ran **13 November2026,20:45:52–21:45:52 UTC**,60.003minutes including initial page startup. It stopped automatically, and the browser/process exited. An environment restart occurred during the trial; the same process and fresh file timestamps were independently verified, with no duplicate session started and no dropped records. The timeout, browser watchdog and independent server access expiry supplied bounded stops. Normal authentication was never publicly disabled.

The immutable trial deployment is `dpl_Ccf23483riXrTYqAKajz1Qniqj7v`, [URL](https://perch-aero-pane-stage3a-a3ecine9j-mml3.vercel.app/?mode=live), source `432d7d040f9befd618597f1ff0c849f76015dc02`. The final source additionally fixes diagnostic captions and the sub-second Retry-After rounding/contradictory-contract edge. The limiter, provider adapter, selection and positive-response scheduling are identical. **No local deferral occurred in the live trial:** those final client edge corrections have regression/browser evidence, not a claimed live deferral incident. No second trial was run.

### Measured results

[Observation](live/observation.json), [analysis](live/analysis.json), [aggregate budget snapshots](live/budget-after.json), [automatic-stop log](live/progress.log) and [budget/readiness plot](live/budget-and-readiness.svg) are retained. Identifiers are trial-local pseudonyms; no coordinates, credentials, registrations or real callsigns are in the structured evidence.

| Measurement | Observed R05 result |
|---|---:|
| Distinct aircraft / valid flight references |25 /25|
| Aircraft becoming primary |20|
| Application attempts / confirmed actual upstream starts |45 /45|
| Route / identity starts |26 /19|
| Complete route responses |23:17 recent,6 qualified historical|
| Genuine route misses / identity miss |3 /1|
| Partial / rejected / transport errors /429 / access denial |0 /0 /0 /0 /0|
| Primary aircraft ever with a complete route |19/20|
| Routes ready at first primary selection |7/20 (35%)|
| All primary acquisitions with route already ready |7/21|
| Primary-scene time with a complete route |90.81% of39.74minutes with a primary|
| Primary-scene time with qualified historical routes |19.95%|
| Secondary-scene time with a complete route |75.55%|
| Aircraft gone without any route attempt |0|
| Detection→first route request, median / longest |0.001s /29.943s|
| Detection→first usable route, median / longest |2.339s /32.317s|
| Response→scene publication, median / longest |0ms /1ms|
| Peak rolling30s /1min /5min starts |2 /4 /9|
| Minimum measured provider-start gap |11.990s|
| Minimum observed post-response tokens |0.840|
| Local deferrals / amplified waits / failed leases |0 /0 /0|
| Shared cache HTTP hits |0 (single viewer)|
| Local positive / negative cached scene uses |466 /61|

All45 server reservations reconcile with45 confirmed starts and45 responses; the final shared ledger has no pending owner, uncertain attempt or recovery. Capacity recovered to three tokens and the trailing five-minute count to zero at the final snapshot. No token exhaustion or hard five-minute ceiling event was observed; synthetic boundary tests supply that coverage. There were no rate violations. The observed rate was45 requests/hour, not a target rate. Cached scene uses are not a claim of466 avoided requests. Shared encrypted cache reuse/deduplication was tested independently against the real coordinator, without extra aviation traffic. One route was refreshed after313.852s under the existing five-minute TTL; it was not an uncontrolled duplicate.

Underlying primary scenes feed the ordinary panel; the diagnostic view was predominantly visible during observation, with normal display checks/screenshots during the same session. Empty airspace accounted for about20minutes. Percentages use primary/secondary presence time, not the entire hour. Counts near observation boundaries may be censored.

Examples show actual predictive readiness: reference`000007` had its route available27.45s before first becoming primary;`00000c` had71.32s. Reference`000009` received a544-day LHR→LDY association27.73s before primary selection, retaining the historical qualification. Other historical pairs included BER→DUB (544days), GLA→LHR (268days) and LPA→OSL (292days). These are provider associations, not independently verified current flight plans.

Missing routes were genuine HexDB404s: reference`000002` (Dassault Falcon6X),`000005` (PilatusPC-24) and`00000a` (AirbusA321neo). The A321neo example matters: a commercial-looking flight can lack a route despite a valid completed query. No route was guessed to fill these gaps.

The type heuristic classified19 commercial jets, one regional aircraft and five unknown/unclassified aircraft; it classified no general aviation or helicopters in this sample. Classified commercial route responses were20/20 complete, regional1/1, unknown2/5. These are small, selected counts, **not provider coverage probabilities**. The unknown bucket includes the A321neo miss; category heuristics must not be mistaken for definitive aviation classification. R05 did not change R04 category rules or exclude unknown aircraft. Four actual requests concerned aircraft not meeting the stated geometric/stint significance proxy; this does not prove those calls were useless.

### What the comparison establishes

The earlier real R04 observation was40minutes,26 aircraft,34 requests,3/14 first-primary routes ready and33.78% primary route time. This R05 evening sample contains a different aircraft mix and long quiet periods. **The raw90.81% versus33.78% difference cannot be attributed to scheduling alone.**

A [conditional replay of this same R05 traffic](live/conditional-replay.json) through both implemented planners provides a better timing comparison. Every requested flight has an observed provider outcome in this recording; no unknown answer is invented. Captured responses are nevertheless assumed reproducible at different times, identity demands remain fixed because identifying metadata was redacted, and callbacks are not reconstructed bit-for-bit.

| Same retained R05 observations; conditional only | R04 policy | R05 policy |
|---|---:|---:|
| Total / route / identity requests |43 /24 /19|45 /26 /19|
| First-primary routes ready |4/20|7/20|
| All acquisition routes ready |5/21|7/21|
| Complete primary-scene time |87.32%|90.83%|
| Known complete responses |22|23|
| Median / maximum detection→request |29.58s /134.04s|0s /29.94s|
| Never-significant proxy requests |2|4|
| Missing-primary-route time coinciding with secondary in flight |3.740s|2.124s|

This supports a **modest, conditional timeliness gain**: three additional first-primary opportunities and about84s more usable-route time for two extra requests (+4.7%). It also recovers one additional known complete response and one additional miss. The actual R05 run agrees closely with that replay, but an R04 browser was not run on the same traffic as a separate live control. The2.124s overlap is not a proven causal primary-delay measure. No primary regression was demonstrated in that matched replay; it is not proof that no future secondary prefetch can delay a primary job. Essential-primary priority, reserve handling and one-request concurrency have direct regression coverage.

### Authentication, compatibility and preservation

[Final HTTP smoke checks](live/final-smoke.json) confirm root200 and normal session/aircraft/enrichment401 without PIN; no Vercel account sign-in is imposed. The final compiled server graph and exact Preview guard loaded successfully using only a machine session check, with zero additional provider calls. A real owner-PIN login was not attempted or claimed. Inherited PIN/persistent-session tests pass, and the final deployed PIN screen was checked at both target viewports.

The private machine-access window was68minutes, ending **21:50:55UTC on13November2026**. It created no household session. Future test configuration was closed immediately after the trial. [Expiry verification](live/auth-cleanup.json) confirmed that **both immutable deployments reject the former test credential with401**, and normal session/aircraft endpoints remain PIN-protected. The normal PIN was never removed, rotated or disclosed. No collection process remains.

There are388 passing unit tests (39 R05 additions),20 inherited compiled-server scenarios, nine frozen-review HTTP scenarios and11 R05 compiled HTTP scenarios; lint/TypeScript/default and full Safari15 builds pass. The388 total includes the focused50ms/whole-second Retry-After and urgent-primary reserve regressions. [Before/after regression output](regression/) is retained. Inherited51-layout, historical-label and R04 browser checks pass; the final adaptive browser/diagnostic checks pass at1024×768 and1024×624. Normal screenshot evidence is in [browser/](browser/) and [live/](live/). No normal CSS, aircraft rendering, typography, route-age rule, observation geometry or illustration placement changed. Default build assets remain byte-identical; the enabled client is about94KB gzip. Physical iPad/Safari operation and subjective household relevance are outstanding acceptance tests.

Vercel's installer reported existing development-dependency advisories; the separately run production-dependency audit reports **zero vulnerabilities**. No package was upgraded as part of R05. No Safari15-unsupported feature was introduced.

R04's stable alias still resolves to `dpl_7M3TTFYhqCpQAoxvzXesEDEga93G`; PR5 remains open/draft at`ad010cd3b9da31e2ee06fba75854c995107cd493`. Household Production remains the READY Production deployment `dpl_2WX2Y9nNudmiJCtYMcAaMofp7Yzw`, source`8031a76d0a24e1bb4ba88febd87d9a9c15ff2166`. A project's “latest deployment” can be a separate Preview; the actual Production deployment was checked independently. No Production alias, environment value, credential, Git integration or merge was changed.

### Recommendation and remaining risks

**Accept R05 for controlled physical iPad comparison at the approved3-token /30s refill /10s gap /10-per-five-minute settings. Do not increase the cap or promote to household Production on this sample alone.** The measured run demonstrates conservative real request timing, prompt publication, useful prefetch examples and genuine source misses. The matched replay supports earlier readiness with modest extra requests; it is conditional evidence rather than a guaranteed household improvement.

Keep the2,000/day guard and five-minute route/miss caches during comparison. The observed45/h would imply1,080/day if sustained24h; the guard is comfortably above that, while1,000/day would interrupt it. Quiet hours reduce demand further. No extra paid service is required or enabled. The free coordinator's few bounded rows fit storage capacity, but monthly egress/availability are not certified by one hour. At the observed rate, four RPCs per miss and rolling state of roughly15KB imply order2GB/month before extra viewers/denials; continuous saturated2,000/day usage could exceed the free egress allowance. That is a sensitivity estimate, not measured billing. Quota/coordination failure stops optional enrichment safely; never enable a paid upgrade automatically.

The trial did not exhaust tokens/caps, exercise an actual provider429, prove database failover/restore durability, test many viewers under real provider load, or cover daytime helicopters/general aviation. Those remain bounded-test/operational limitations. Historical associations still can be wrong; route sources remain incomplete. No new provider or validation change is proposed for immediate implementation.

Rollback remains the unchanged [R04 stable Preview](https://perch-aero-pane-stage3a.vercel.app/?mode=live). The R05 deployment has not replaced that alias. The owner need only compare the two displays; no terminal, database configuration or deployment work is assigned to them. Production consideration requires separate approval after that review and an explicit review of the Preview-only enablement guard and free-tier operation.

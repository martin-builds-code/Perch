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

Typed v2 application deferrals distinguish in-flight, spacing, tokens/reserve, rolling caps, provider backoff and coordination unavailability. They include zero upstream starts, consistent Retry-After and validated safe budget metadata. Ambiguous/generic503 responses retain failure protection. R01's v1 contract continues to work for R04. Short local waits do not become five-minute provider pauses.

Actual upstream failures remain charged. Shared repeated429/server failures escalate5/15/60min; a longer valid numeric/date Retry-After wins, as do existing access-denied protections. Cache hits remain useful during backoff. No provider stress test or quota discovery is performed.

## Offline and browser verification

All386 unit tests pass, including37 new R05 cases for burst/refill/rolling boundaries, daily guard,20 simultaneous modeled clients, leases/crashes, cache encryption, exact callsigns, negative results, R01 errors, lifecycle and machine-access isolation. Plain Node ESM HTTP checks cover inherited handlers, the frozen route review and the new actual R05 server graph. ESLint, TypeScript, standard production build and the full live/enrichment/diagnostics/appliance/R05-enabled Safari15 build are run before deployment.

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
| Requests on never significantly relevant aircraft |6|8|

The gain is earlier delivery of already-known routes, with three additional requests (+8.8%), not demonstrated new source coverage. Both models remain below ten; R05 peaks at80% five-minute utilization and never exhausts its token reserve in this sample. Median detection-to-request falls39.29s→0s, but cohorts differ; the real recorded R04 median was30.12s. The frozen replay does not reproduce every browser callback timing.

Unresolved primary-without-route time coinciding with a secondary request is6.57s→9.06s, an occupancy indicator rather than proven causal primary delay. A pessimistic sensitivity assigning unseen outcomes hypothetical five-minute errors yields4/14 routes ready and32.09% complete primary time. Those errors were not observed. The earlier20/30/50-cap experiments recovered no additional known first-primary routes; they do not justify increasing this trial's ten cap.

## Preview isolation, access and rollback

Vercel rejects branch-scoped variables when Git is disconnected. Git integration stays disconnected. Only new `AERO_R05_*`/`VITE_AERO_R05_ENABLED` Preview keys are added; no existing live/PIN/session/coordinates/diagnostic setting is replaced. R04 source does not reference these keys and its immutable deployment retains its original build/runtime values. R05 additionally checks exact Vercel project ID, Preview environment and R05 source branch server-side before opting in. A requested but invalid R05 setup fails closed rather than using the old limiter. No stable alias is reassigned.

Normal owner access retains the existing PIN. For the single automated trial, a separate server-only machine credential authorizes only GET requests on `/api/r05-observe`, within an absolute window no longer than90min and only the exact R05 Preview identity. It can read session/aircraft or use the same enrichment handler/budget; it cannot create a household session, submit PINs, access other paths or authenticate normal APIs. It is never sent to the owner or stored in browser assets/results. Normal PIN endpoints reject it. This is not a public PIN bypass. Its expiration is verified after testing.

Rollback is simply to close the separate R05 URL and continue using the unchanged stable R04 URL. No deployment/alias/config rollback is needed for R04. Do not reset a live budget or extend test credentials to recover a failed trial. Stop the test browser; temporary machine access expires independently. A fail-closed coordinator can reduce optional enrichment but cannot stop positional tracking.

## Live trial and final deployment

The live trial uses immutable application commit `432d7d040f9befd618597f1ff0c849f76015dc02`, deployment `dpl_Ccf23483riXrTYqAKajz1Qniqj7v`. Subsequent diagnostic-caption corrections remove obsolete30/90s and unsecured-access labels without changing the scheduler, selector, provider adapter or shared coordinator. The final protected Preview will include those captions and share the same budget. The authorised single bounded trial is in progress. No live R05 route-readiness improvement is claimed by the offline evidence above. Exact commit, Preview URL/deployment, observed aircraft/request counts, stop evidence, machine-access expiry and preservation checks will be recorded here after execution.

# R05 — adaptive enrichment budgeting investigation

**12 November 2026. Investigation only; no R05 application implementation or deployment.**

The evidence supports testing a small burst reserve before increasing the five-minute ceiling. Recommend a **hard limit of 10 upstream requests in every rolling five minutes**, three stored tokens, replenishment of one token per 30 seconds, a **10-second minimum start gap**, and one request in flight. Protect one token from marginal work. This is a proposed future trial policy, not a change to R04.

The 20, 30 and 50 ceilings produce no additional known route-readiness benefit in the retained R04 sample. They admit additional lookups whose provider outcomes are unknown. A larger ceiling can help a contrived busy workload, but that is not evidence that household traffic needs it.

There are two prerequisites to any live change: clarify HexDB's current burst policy, and authorize a genuinely shared, durable server-side coordinator. Neither has been established as available for use in Perch. Do not deploy a browser-only token bucket and describe it as an absolute shared limit.

## Scope, baseline and evidence

Repository `martin-builds-code/Perch`, branch `stage-3a-display-redesign`, [Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5). Investigation starting HEAD **ad010cd3b9da31e2ee06fba75854c995107cd493**. The deployed R04 application is **f558718c659b7e928617abc5266345b88919f9ab**, READY deployment **dpl_7M3TTFYhqCpQAoxvzXesEDEga93G**, isolated project **prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW**. A read-only alias check confirmed that destination before the investigation.

The [R04 report](../route-r04/REPORT.md), [recording](../route-r04/live/observation.json), [analysis](../route-r04/live/analysis.json), current client scheduler and process-local server gate were inspected. R01 local-deferral behavior and R03 historical-route validation remain unchanged.

The real recording covers **11:54:07–12:34:07 UTC on 12 November 2026: 40.01 minutes**, 26 aircraft and 14 first primary acquisitions. It was collected using R04 trial build **976210d284fae705b5245fec5a01e75eb2afcfd8**, before the final R04 handover refinements. It contains 118 frames, 327 scene events and all 34 lookup attempts/responses, with at most five aircraft per frame. Some unchanged timer evaluations were omitted by that collector. It is useful evidence, not an exact recording of every callback in the final deployed application.

Observed R04 results:

| Measurement | Real observation |
|---|---:|
| Actual upstream requests | 34: 28 route, 6 aircraft identity |
| Complete route responses | 15: 6 recent, 9 historical; 14 distinct route keys |
| Genuine route misses / rejected routes | 12 / 1 |
| Upstream transport errors / local deferrals | 0 / 0 |
| Routes ready at first primary acquisition | 3/14 — 21.4% |
| Primary aircraft-time displaying complete routes | 33.77% |
| Peak upstream starts in rolling one / five minutes | 2 / 7 |
| Average upstream starts per hour | 51.0 |
| Median first detection to first route request | 30.12 seconds |

The actual trace never reaches even the 10-request ceiling. Increasing a ceiling alone cannot unblock requests that are waiting on a separate 90-second secondary gate or on the next scheduler invocation.

## HexDB policy: permission for bursts is unresolved

The current [HexDB API documentation](https://hexdb.io/) was inspected on 12 November 2026, including its v2/v1/legacy reference, errors and linked documentation. It describes free access without a key. No numeric request allowance, burst allowance or applicable rate-limit terms were found on the reviewed official page; searches did not establish a current authoritative replacement. Its published daily service traffic is not a per-user allowance.

**The previously cited 1,000 requests per five minutes is not verified current permission and is not used to justify any candidate here.** Absence of a numeric rule does not imply unlimited access. Before live bursting, obtain authoritative clarification covering calls per rolling window, short bursts, whether limits apply per IP/client/site, caching and Retry-After. A shared Vercel egress address may have a different scope from a single display.

No test lookups, load tests, account creation or provider correspondence were made for R05. Reading public documentation generated no aircraft/route API requests. No live traffic increase is recommended until the policy question is resolved.

## Policies compared

All adaptive comparisons use the same R04 geometric urgency and information-value hints, positive/negative caches, one concurrent request and conservative handling of unseen outcomes. Both identity and route requests consume the same budget. Cached results consume no upstream token.

For comparable capacity experiments, the main table uses **three tokens, five-second minimum spacing and a one-token reserve** for every candidate. Refill is continuous, capped at three; the hard rolling log is an additional constraint. Primary/urgent work can use the reserve; marginal work must leave one token. Stored capacity never accumulates beyond three during a long quiet period.

| Five-minute ceiling | Refill | Full refill from empty during idle | Comparison spacing | Role in recommendation |
|---|---:|---:|---:|---|
| 10 | 1 token / 30s | 90s | 5s | Best supported ceiling; use the tested 10s spacing initially |
| 20 | 1 / 15s | 45s | 5s | Contingency if longer recordings show useful work blocked at 10 |
| 30 | 1 / 10s | 30s | 5s | No demonstrated household benefit over 10 |
| 50 | 1 / 6s | 18s | 5s | Exploratory upper bound; not justified for a live trial |

A token bucket alone does **not** enforce the requested rolling ceiling: stored credit plus refill can admit more than the nominal ceiling in a five-minute window. The model separately counts starts in **(now−300 seconds, now]** and rejects admission at the limit. Whole-millisecond deadlines round upwards. Reserve, spacing, rolling limit, concurrency and provider backoff must all allow a request before it starts.

Recommended initial short burst: up to three stored requests, **at least ten seconds between starts**. That spacing also bounds starts to three in any rolling 30 seconds. Testing three-, five- and ten-second spacing in the R04 replay produced the same known readiness; there is no evidence requiring the more aggressive gap. This recommendation concerns timing only and requires future authorization.

### Conditional replay results

These are **offline counterfactuals**, not observed R05 provider performance. The display/primary sequence is frozen to the real recording. Known provider results are reused conditionally at different times; no response is invented for an unqueried flight. The six recorded identity demands are held fixed because identifying metadata was privacy-redacted. See [method and limitations](METHOD.md).

| Policy | Total / route / identity requests | Peak 1min / 5min | Mean requests / 5min | Known routes ready at first primary | Unseen-outcome requests | Times at its five-minute ceiling |
|---|---:|---:|---:|---:|---:|---:|
| Fixed R04 30s / 90s reference | 34 / 28 / 6 | 2 / 7 | 4.25 | 3/14 | 0 | 0 |
| Adaptive 10 | 37 / 31 / 6 | 3 / 8 | 4.62 | 6/14 | 2 | 0 |
| Adaptive 20 | 38 / 32 / 6 | 4 / 9 | 4.75 | 6/14 | 3 | 0 |
| Adaptive 30 | 38 / 32 / 6 | 4 / 9 | 4.75 | 6/14 | 3 | 0 |
| Adaptive 50 | 38 / 32 / 6 | 4 / 9 | 4.75 | 6/14 | 3 | 0 |

The ten-second-spacing version of adaptive 10 also uses 37 requests, prepares 6/14 known routes and peaks at 3/8. No reserve exhaustion or hard-cap blocked time occurs in any main adaptive replay. Adaptive 10 postpones marginal candidates on three scheduling checks to preserve reserve; these are checks, not three distinct aircraft.

For adaptive 10, average cap utilization is **46.2%**, peak five-minute utilization **80%**. The 20/30/50 alternatives average **23.7% / 15.8% / 9.5%**, peak **45% / 30% / 18%**. Frequency of ceiling saturation is zero throughout this recording, not a prediction for busier household periods.

All main policies produce the same **15 complete recorded responses for 14 distinct known route keys**. Adaptive 10 adds three requests, **8.8%**; the larger budgets add four, **11.8%**. The additional requests consist of an additional known negative lookup and two or three unobserved outcomes. There are **zero additional demonstrated successful route discoveries**. The useful gain is earlier delivery of three already-known successful results, not evidence of greater HexDB coverage.

Three additional flights would conditionally have their routes ready before first becoming primary:

| Trial-local reference | Aircraft description | Response lead before first primary, adaptive 10 |
|---|---|---:|
| 000005 | Boeing 737-800 | 73.33s |
| 000009 | Boeing 737 MAX 8 | 14.25s |
| 000011 | Airbus A-320 | 23.57s |

These are pseudonymous references, not real ICAO addresses. The outcome assumes the same validated response could have been obtained earlier. All three larger ceilings recover the same three first-primary opportunities. No selection change or human visibility accuracy is attributed to budgeting.

Across queried route keys, median detection-to-request is **39.29s** in the fixed reference and **0–0.001s** in adaptive models; the maximum falls from **1,229.76s to 118.94s**. The queried cohorts differ, some aircraft arrive already eligible, and the long reference wait includes intermittent low-priority presence. These values are not matched measurements of continuous queue waiting. The reference reproduces request totals and readiness, **not every real request time**: the real median was 30.12s.

The signed response-to-first-primary lead across known successful responses changes from a median around **−0.55s** to **+14.48s**. That series includes repeated responses and responses after first acquisition; the three-flight table above provides the clearer distinct-flight interpretation. The complete timing series is retained in [results.json](results.json).

### Opportunity cost, caching and uncertainty

Using an explicit research definition of significant relevance — observed elevation at least 45 degrees, distance under 1km, or an observed primary stint of at least 15s — requests on aircraft never meeting that definition rise **6 → 8 → 9** for fixed / adaptive 10 / adaptive 20+. This is a geometric cost proxy, not proof those requests were useless. All extra unknown-outcome aircraft remain non-primary in the frozen recording.

The fixed / adaptive 10 / adaptive 20+ planners encounter cached candidate information 339 / 544 / 542 times. Those are internal candidate checks, **not that many avoided HTTP calls**, and are not a cache-hit-rate estimate. The five-minute positive/negative and thirty-minute identity lifetimes are retained; an expired negative can legitimately be retried. Exact aircraft-plus-flight keys prevent reuse after a callsign change. The model cannot estimate shared server cache hits from other sessions.

Five observed route-flight keys have no original provider result. A newly scheduled request to one is charged and receives no success or negative credit; subsequent repeats to that key are censored. Its scheduling duration is the median recorded latency, an assumption. Consequently total traffic and provider backoff under unknown results remain uncertain.

A deliberately pessimistic sensitivity assigns every previously unseen outcome a hypothetical five-minute provider failure. Then known readiness is **4/14 at 10** and **2/14 at 20/30/50**, versus the reference 3/14. These failures were **not observed**. This demonstrates that the apparently favorable central result is conditional, and larger speculative request budgets can make things worse if unseen requests encounter errors.

## Do primary and secondary limits still need to be separate?

A unified budget is technically plausible, but removing separate limits is a material policy change for future approval. R04's operational **30-second global and 90-second secondary rules remain in place**.

Sensitivity with adaptive spacing but the 90-second secondary restriction retained yields **4/14** ready routes at every ceiling, with 33 requests. Removing that restriction in the model yields **6/14**. Raising only the five-minute ceiling offers no benefit in either comparison. The secondary timing gate is more consequential here than total five-minute capacity.

The preferred future design would use a single shared hard ceiling with:

* R04's urgency ranking and its existing primary protections, without making a flight primary to get a lookup.
* A protected token for urgent/primary work; low-value candidates cannot spend the last token.
* Negative-cache and exact-flight-key checks before admission, bounded candidates, deduplication and no provider calls solely to fill a quota.
* Ordinary primary identity/route priority preserved; an urgent future candidate can outrank optional metadata under the existing R04 rules.
* Stop/hidden/offline/sleep checks at admission and immediately before dispatch, no background work after lifecycle termination.

The current scheduler runs on scene updates. Its own enrichment completion publishes data but does not immediately drain another request. An eventual burst implementation would need a single bounded completion/next-eligibility wake, not an independent polling loop or faster positional refresh. Scene-only sensitivity still prepares 6/14 routes in this archive, so a faster drain is not proven necessary here. It matters in the abstract busy-wave experiment. Stale queued jobs must be revalidated against the current scene at dispatch.

## Busy-load stress and recovery

To test limits rather than invent flight outcomes, a separate workload offers abstract request jobs with an **assumed one-second serial completion**. It assigns no routes, aircraft categories or successful lookups.

After five minutes of quiet, 12 urgent jobs arrive with a 90-second usefulness deadline. A separate 20-minute run supplies unlimited urgent work. Results use the common five-second-spacing policies, not the more conservative proposed first trial.

| Ceiling | Jobs completed within the 90s wave | Requests in saturated 20min | Peak 1min / 5min | Saturated-run time at five-minute ceiling | Idle empty-to-full refill |
|---|---:|---:|---:|---:|---:|
| 10 | 5/12 | 40 | 4 / 10 | 82.50% | 90s |
| 20 | 8/12 | 80 | 6 / 20 | 78.75% | 45s |
| 30 | 11/12 | 120 | 8 / 30 | 77.50% | 30s |
| 50 | 12/12 | 200 | 12 / 50 | 76.50% | 18s |

This quantifies when larger allowances could matter. The real archive peaks at five simultaneous aircraft, contains only 34 provider calls and never saturates 10. It does not establish the frequency of a 12-job commercial arrival wave. The saturation percentages describe deliberately unlimited offered demand and must not be presented as expected household utilization.

Quiet recovery adds capacity only up to three tokens; it never banks an hour's unused quota. An exhausted protected reserve recovers one token in at most 30/15/10/6 seconds of idle time, but a still-full rolling log or provider cooldown can require longer. Full token refill is not permission to ignore either. Burst-size sensitivity: at ceiling 10, two stored tokens prepare 5/14 known routes; three and five prepare 6/14, while five admits an extra unknown lookup. Three is the smallest tested reserve giving the full known benefit.

## Reliable shared enforcement

### What the existing infrastructure can and cannot do

Perch currently has browser budgets, process-local Vercel gates and temporary caches. They do not coordinate separate instances, sessions, regions or cold starts. A simple test with four independent 10-request buckets permits **40 requests per five minutes**, demonstrating why per-browser limits cannot promise a shared ceiling.

| Candidate state store | Assessment |
|---|---|
| Browser memory/localStorage or Vercel Function memory | Useful advisory limits only; reloads, multiple sessions and instances defeat a shared ceiling |
| Vercel Runtime Cache | Regional and evictable; reviewed API lacks a suitable transactional admission operation. Insufficient for an authoritative rolling log |
| Upstash Redis free tier | Convenient atomic scripts under normal operation, but its documented eventual consistency and failover semantics do not establish the required absolute distributed guarantee |
| Transactional PostgreSQL on one authoritative writer | Preferred architecture candidate: serialize admission on one row and durably commit reservation before contacting HexDB; requires authorized shared storage and failure testing |

[Vercel documents Runtime Cache as regional and ephemeral](https://vercel.com/docs/runtime-cache). On Hobby, projects share cache capacity; environments remain separate. Eviction or an ordinary get-then-set race cannot safely reset a global budget. No cache resources were accessed or modified in this investigation.

[Upstash documents asynchronous replication, eventual consistency and retirement of its former strong-consistency mode](https://upstash.com/docs/redis/features/consistency). An atomic Lua script is useful but does not by itself prove safe admission through partition/failover or forgotten reservations. Do not claim a generic rate-limit SDK meets an absolute limit without resolving those guarantees.

### Proposed transaction protocol — not implemented

Use a tiny server-only budget row on an authoritative writable PostgreSQL instance. PostgreSQL [row locks](https://www.postgresql.org/docs/current/explicit-locking.html) can serialize competing admissions. State consists of at most 50 recent reservation timestamps, token/refill state, next-start/cooldown deadlines, and an opaque in-flight attempt owner. It contains no observation coordinates or permanent aircraft history.

1. Authenticate and validate the request. Check/coalesce an existing exact-flight cache result first. A cache hit or local deferral does not consume upstream allowance.
2. Within one transaction, lock the budget row, use database time, prune safely expired completed reservations and enforce the rolling cap, refill, minimum gap, reserve, cooldown and in-flight restriction. Commit an attempt reservation **before** issuing the upstream request. A pending reservation must not expire while its worker may still issue a request. Do not hold a database lock open across an HTTP fetch.
3. Make one HexDB request. A completion transaction, tied to the same attempt owner, records the bounded temporary result, applies any genuine provider backoff and releases ownership. Conservatively retain that reservation until **five minutes after completion**, and set the next-start spacing deadline from completion. This prevents a worker paused between reservation and fetch from starting after its reservation has expired, or from permitting a following request too soon. It is slightly stricter than counting actual starts. A timed-out request still consumes a reservation. Never refund an uncertain request. Record actual HTTP starts separately for evidence; reservation count is a conservative admission bound, not an exact provider-receipt metric.
4. Return typed local deferral metadata and the latest applicable deadline to the client. Preserve R01's distinction between verified local scheduling and genuine upstream errors. A generic or malformed 503 must not acquire special retry privileges.
5. If shared state is missing, corrupt, unavailable or its commit outcome is uncertain, **fail closed for enrichment**. Positional tracking continues. No fallback full bucket in function memory. Recovery from lost budget history must quarantine admission for a full five minutes and verify old workers are no longer issuing calls before reopening.

Atomic admission alone is not sufficient to promise global single-flight execution. An expired lease is not proof that a paused worker has stopped its external request; a fencing token cannot cancel a request already issued to HexDB. Normal completion can safely release ownership. Ambiguous worker failure should leave enrichment closed until verified safe recovery rather than automatically reuse a short lease. This availability trade-off must be tested and accepted before deployment.

Use durable commits and the same writer for every participating session/instance; never use a read replica for admission. The chosen hosted database must establish whether acknowledged commits survive failover; a provider that can silently lose accepted reservations cannot simply be certified as enforcing an absolute ceiling. Restore/maintenance must suspend admission and verify a full-window quarantine plus worker quiescence. Clock regressions deny admission, deadlines round up and randomized client retry jitter only lengthens waits. Database restore/failover and stale-worker recovery require explicit adversarial testing; the local mathematical model is **not** a deployed distributed-system verification.

### Scope of the absolute guarantee

A shared key must cover every participating enrichment type and browser, including concurrent old/new deployments that can call HexDB. A new coordinator cannot control the unchanged household Production or existing R04 code paths. A future isolated trial can guarantee a ceiling for its participating R05 paths only. It cannot honestly promise an account-/IP-wide provider ceiling while other paths bypass it. Provider policy scope and coordination scope must be settled before a trial; R05 does not authorize changing Production to achieve that scope.

## Cost and free-tier assessment

No shared transactional store is currently integrated into Perch. Available account slots and unrelated projects were not inventoried or reused. No infrastructure was provisioned. A future free store may be viable, but that is a separate integration requiring approval and a free-capacity check, not an existing capability that can simply be assumed.

[Supabase Free](https://supabase.com/pricing) currently lists a 500MB database, 5GB egress and two active projects, with inactivity pausing. A small private PostgreSQL coordinator appears capacity-compatible in principle. There is no availability guarantee here, and no claim that the owner's free slots are unused. Keep access server-only, expose no public table, and retain Aero Pane's existing PIN/session system; no authentication migration is needed.

[Upstash Free](https://upstash.com/pricing/redis) lists 500,000 commands/month and one free database. Its [rate-limiter cost documentation](https://upstash.com/docs/redis/sdks/ratelimit-ts/costs) shows costs varying with algorithm, cache and replication. Commands inside a workflow, denied admissions and coalescing/cache checks matter; one enrichment request is not necessarily one billable command. Consistency remains an independent obstacle.

Traffic arithmetic below assumes continuous eligibility for 18 hours/day and 30 days/month. These are **ceilings**, not forecasts or permitted usage:

| Rolling five-minute ceiling | Maximum / hour | Maximum / 18h | Maximum / 30 such days |
|---|---:|---:|---:|
| 10 | 120 | 2,160 | 64,800 |
| 20 | 240 | 4,320 | 129,600 |
| 30 | 360 | 6,480 | 194,400 |
| 50 | 600 | 10,800 | 324,000 |

Extrapolating this single sample instead gives approximately **27,536 observed R04 starts/month**, **29,965 adaptive-10 model starts/month**, or **30,775 adaptive-20+ starts/month** at 18h/day. Such extrapolation does not represent seasonal household demand.

For illustration, 8–12 storage commands per admission/completion workflow would cost roughly 240,000–360,000 commands/month at the adaptive-10 sample rate, before denied requests or multiple clients. At the full 10-request ceiling it would be 518,400–777,600, already above the cited 500,000 free quota. This is a sensitivity calculation, **not measured command usage**. Measure the actual design and fail closed on quota exhaustion; do not enable a paid upgrade. A two-transaction PostgreSQL protocol at the sample rate is around 60,000 transactions/month, but CPU, connection and egress costs still need measurement. The state itself is only a few KB plus existing bounded caches.

Vercel would receive bursts of short API invocations, not extra positional polls or a new background collector. Incremental function load should track extra misses/coordinator calls; free-tier fit cannot be certified from request count alone. No additional cost or Vercel resource use was incurred beyond public/read-only investigation access.

## Decision and next trial

1. **Measurable benefit:** conditional evidence of earlier known routes, 3/14 → 6/14 ready at first primary, with no extra known successful route discoveries. This is sufficient to justify further investigation, not a household performance claim.
2. **Best practical candidate:** hard 10 per rolling five minutes first. Consider 20 only after real busy recordings demonstrate useful misses caused by reaching 10. The retained sample provides no reason to adopt 30 or 50.
3. **Short burst:** three stored requests, ten-second minimum start gap; protect one token from marginal jobs. Do not bank more credit during prolonged quiet.
4. **Recovery:** continuous refill, one per 30s; hard rolling log and provider deadlines override credit. No target utilization or request-for-the-sake-of-consuming-tokens behavior.
5. **Expected readiness:** three additional known first-primary opportunities in this sample, conditional on unchanged responses and timing. The true live gain is unknown; extra unknown requests and their failures can reverse it.
6. **Expected extra traffic:** +3 modeled starts/40min at 10 (+8.8%); +4 at 20+ (+11.8%). Result-dependent retries and other sessions are unmeasured. No additional upstream requests were actually made for R05.
7. **Ceiling frequency:** zero at all candidate ceilings in the real archive and central replay. No representative frequency estimate for busy household periods can be inferred from one short sample.
8. **Enforcement:** an authenticated, fail-closed, transactionally serialized shared coordinator; an in-memory bucket or ordinary cache cannot satisfy an absolute shared ceiling. Resolve scope, durability and failure recovery before claiming a guarantee.
9. **Controlled trial:** justified in principle after current HexDB burst permission, separate implementation authorization and a verified no-cost coordinator are established. Do not alter R04 while its physical acceptance test continues.

For a future authorized trial, Codex should prepare the coordinator and automatic stop/rollback, capture actual upstream starts and unknown outcomes, and compare eligible request waits/readiness while holding selection and caches fixed. Include busy and quiet intervals and concurrent-client failure tests. Stop on unexpected 429/access denial, coordination uncertainty or budget violation. The owner need only assess the aircraft display; no terminal, deployment or infrastructure work is assigned to them.

## Verification and preservation

**22 offline research checks pass**, covering rolling-window boundaries, token-only overshoot, quiet accumulation, protected reserve, minimum spacing, provider backoff, invalid/backwards clocks, single-flight admission, multiple independent clients, legacy secondary scope, cache timing and unknown-outcome handling. These are mathematical/replay checks, not a deployment/backend load test. [Model](model.mjs), [checks](checks.mjs), [test output](checks.log), [compact results](summary.json), [full results](results.json) and [stress results](stress.json) are separate research artifacts not imported by the application.

No application files, dependencies, environment variables, secrets, caches, authentication rules, aliases or deployments were changed. The operational 15km radius, 15s positional polling, 30s/90s enrichment gates, one client request, R01 backoff and R03 historical rules remain as deployed. No new collector or server was started. No operational builds or physical-device tests were needed or claimed for an unchanged application.

R05 artifacts remain under `docs/route-r05/` in the local workspace. No commit, push, PR mutation or merge was performed. Current R04 Preview, its PIN protection, household Production and repository main remain untouched. [Preservation record](preservation.json) records the final read-only checks.

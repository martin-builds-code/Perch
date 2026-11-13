# R05 research method and reproducibility

This directory is an offline investigation, not an alternative runtime scheduler. It is not imported by the frontend, API or server. Do not deploy its assumptions as policy.

## Inputs and model boundaries

* Frozen input: [`../route-r04/live/observation.json`](../route-r04/live/observation.json), real 40-minute trial described in the [R04 report](../route-r04/REPORT.md). Trial-local aircraft/flight references contain no observation or aircraft coordinates, raw identifiers or credentials. Relative bearing/height and movement evidence are sufficient for the limited scheduling comparison.
* Reuse the captured primary/secondary choices. Recompute age-dependent R04 observation/urgency from the last available frame and reuse the recorded prediction-support/consistency indication. This is not an independent selector comparison or complete reconstruction of challenger history.
* Registration/operator details were redacted. Reconstructing missing-model/optional-metadata demand would invent information, so hold the six recorded identity requests and their original release times fixed across policies. Their precedence is identical in every model. This can delay a route differently from a fully reconstructed live planner and limits external validity.
* Do not read future outcomes to rank candidates. Only R04 geometry/urgency, current display membership and a bounded type hint inform ordering. Reuse a recorded response only after selecting a job. Responses are keyed by pseudonymous aircraft and callsign; identity has a separate key. The first captured response per key supplies its outcome and latency. Any later change in provider content is not modeled.
* Provider responses are conditional, not time travel: retrieving the same answer earlier is an assumption, especially for historical association age near a boundary or provider content updates. Recorded association times and the 730-day acceptance guard remain in the model.
* A response for a never-queried flight is unknown. Charge one upstream request, use the median measured latency only for serial occupancy, give no positive/negative credit, then censor repeat requests to that key. This is not a new negative-cache policy. It prevents fabricated repeated outcomes while exposing uncertainty in traffic totals. A separate sensitivity applies hypothetical five-minute failure backoff to unknown results; it does not assert that HexDB failed.
* Preserve five-minute route positive/negative and thirty-minute identity TTLs. Cache lookups by exact flight, not just airframe. Candidate cache-check counts are neither HTTP cache-hit ratios nor counts of definitely avoided requests.
* Original response-induced publications remain in the frozen display trace but are excluded as dispatch opportunities; modeled completions supply their replacements. Scene/frame/primary-change events remain opportunities. Adaptive variants may also wake on completion or the next eligibility deadline. The scene-only sensitivity omits these additional wakes.
* Keep one pending request. Polling, aircraft presence, display changes and quiet/hidden events are not generated anew. The captured session was active; lifecycle/failure behavior outside it needs future runtime tests, not assumptions from this replay.

## Admission mathematics

For capacity `C`, token capacity `B` and elapsed time `dt`:

```
tokens = min(B, tokens + dt * C / 300000)
recent = reservations with timestamp > now - 300000
```

Admission requires all of:

* fewer than `C` recent reservations;
* at least one token for protected work, or `1 + reserve` for marginal work;
* minimum start gap elapsed;
* provider/server cooldown elapsed;
* no pending request;
* an eligible, uncached current candidate.

Use the maximum applicable deadline and round upwards to whole milliseconds. A hard rolling log is necessary in addition to tokens. The research object keeps its full small session log for analysis; a production coordinator would prune/retain at most the configured window/cap. Browser clock, server clock and distributed transaction failure are not solved by the offline object.

The fixed reference uses 30-second spacing and the 90-second collective secondary-route gate. Adaptive comparisons remove those separate waits **only inside this model**, keep one shared cap and use R04 priority plus a protected token. The old waits remain unchanged in the real application.

## Metrics

Rolling windows are left-open/right-closed: `(t−window, t]`. Peaks are evaluated at starts; saturated durations also include reservation-expiry boundaries. Means use the full 2,400,372ms observation period. No traffic is extrapolated from route success rates.

Ready at first primary means a known, unexpired complete route is already cached at the aircraft's first captured primary acquisition. It does not imply the aircraft had a route for its entire primary tenure. Response lead is positive before that first acquisition and negative afterward. `responseLeadToFirstPrimary` includes repeated responses and is not a distinct-flight median. `readyAtFirstPrimaryResponseLead` limits the calculation to acquisitions with a cached known route. `firstRouteAttempts` permits paired inspection without conflating different cohorts.

“Never significantly relevant” means the recording never shows estimated elevation ≥45°, horizontal distance <1km, or an uninterrupted captured primary interval of at least 15s. This is an explicit cost proxy, not human-interest ground truth. Changing it can change the marginal-request count without changing scheduler behavior.

Token exhaustion means fewer than one token remains for any new request. Reserve-block checks mean marginal work cannot spend protected credit. Full idle refill times are theoretical bucket recovery, not a promise the rolling window, provider gate or scene will permit dispatch then.

The fixed reference reproduces 34 requests, six identity demands, three ready first acquisitions and rolling peaks 2/7. It does not reproduce exact callback/request timing: its detection-to-request median is 39.29s versus 30.12s measured live. There is no claim of bit-exact R04 replay or statistically established causal improvement.

## Reproduction

For Codex/developer use in the existing repository with installed dependencies:

```
node --import tsx docs/route-r05/model.mjs
node --import tsx --test docs/route-r05/checks.mjs
```

The model writes `results.json`; checks write `stress.json`. Network fetch is replaced with a throwing function. No package installation, provider endpoint, authentication session or deployment is required. Modern Node features in these research scripts are not shipped to Safari.

The synthetic stress workload contains request jobs only: 12 jobs after quiet with a 90-second deadline, or unlimited jobs over 20 minutes. One-second serial completion is assumed. It does not supply invented flights, successful routes, category coverage or provider permission.

## Public-source review, checked 12 November 2026

| Official source | What it supports / remaining uncertainty |
|---|---|
| [HexDB reference](https://hexdb.io/) | Current public interfaces and free/keyless description; reviewed page provides no current numeric burst allowance. The older 1,000 figure is unverified |
| [Vercel Runtime Cache](https://vercel.com/docs/runtime-cache) | Regional, ephemeral, environment-separated state and Hobby shared capacity; insufficient authority for durable atomic global admission |
| [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) | Row-level serialization for a proposed transactional budget; does not prove a particular hosted failover configuration |
| [Supabase pricing](https://supabase.com/pricing) | Free-plan resource/active-project bounds; no evidence that an unused owner slot or approved Perch database exists |
| [Upstash consistency](https://upstash.com/docs/redis/features/consistency) | Eventual consistency, asynchronous replication and retirement of former strong-consistency mode; distributed hard-limit safety is unresolved |
| [Upstash pricing](https://upstash.com/pricing/redis) | Free command/bandwidth allowance; not a guarantee for this workflow |
| [Upstash limiter costs](https://upstash.com/docs/redis/sdks/ratelimit-ts/costs) | Algorithm/cache/replication-dependent command usage; a workflow must measure actual command counts |

Public documentation was read; no provider lookups, correspondence, infrastructure provisioning or account-wide database inventory was performed. These source findings and the engineering recommendation must be rechecked before any future live implementation.

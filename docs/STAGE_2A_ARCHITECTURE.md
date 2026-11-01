# Stage 2A architecture decision — 1 November 2026

Baseline: approved Product and Technical Specification v2.0 (user supplied RTF),
with the narrower Stage 2A implementation instruction. Production/main baseline:
`ce708901750975c89400314a091db0b59a3a9919`. Working tree was clean after cloning.

Selected path: visible, online browser → same-origin `/api/aircraft` → Node.js
Vercel Function → adsb.fi v3 geographical endpoint. No collector, cron, database,
worker, Mac mini, or enrichment service. One bounded fetch per cache refresh;
the function exits after responding. No persistent backend process is assumed.

Observation latitude/longitude are server-only environment variables. Only the
provider receives them. Normalised positions remain server-side; the response
contains distance and presentation fields, never location configuration or raw
provider URLs/errors. Distances plus observed aircraft can still reveal an
approximate location by inference: eventual access control remains necessary.

Client requests start at least 15 seconds apart (configurable, minimum 15s),
never overlap, time out after 8s and pause while hidden/offline. Resume clears
expired information immediately, then fetches once, without catch-up requests.
Provider timeout is 5s including body reading; no automatic provider retries.
429 honours Retry-After; 401/403 uses a five-minute cooldown. Errors are distinct
from valid empty results. Position ages derive from `now` and `seen_pos`, never
`ptime`. Negative ages and future clocks are diagnostic anomalies.

Ten-second success caching and in-flight coalescing in each warm function reduce
duplicate traffic; a ten-second Vercel CDN TTL additionally shares responses.
Browser/downstream caching is disabled. No stale-while-revalidate. Error cooldown
is per process. Neither process memory nor CDN cache is a global lock: cold
instances, different cache regions, query strings and bypasses can duplicate
provider traffic. Queries are rejected by the handler, but CDN protection must
be validated before hosted access. Do not claim globally enforced 1 request/s.

This is suitable for bounded single-iPad review and the intended personal scale;
an unrestricted multi-client live service is not approved. Before any hosted
live test: separately approve deployment, protect the entire deployment/API,
verify actual cache/coalescing and provider traffic from that deployment, and
keep review to one active client until that check passes. If a strict global
limiter becomes necessary, report it as a blocker rather than add a database.

Live access is disabled by default and hard-disabled for Vercel production.
Simulation works without configuration. The Stage 2A branch disables automatic
Vercel Git deployments. No hosted test is authorised by committing this code.

## Published limits and estimated budget

Sources checked 1 November 2026:
- [adsb.fi API/terms](https://github.com/adsbfi/opendata/blob/main/README.md):
  personal/non-commercial; attribution with homepage link; public limit 1/s;
  invalid requests count; geographical v2 deprecated, use v3; distance in NM.
- [Vercel Hobby](https://vercel.com/docs/plans/hobby): 1M function invocations,
  1M CDN requests, 4 CPU hours, 360 GB hours memory, 100 GB fast transfer and
  10 GB origin transfer. Allowances shared with other account usage.
- [Function limits](https://vercel.com/docs/functions/limitations): Fluid Hobby
  maximum 300s, 2 GB memory, 4.5 MB request/response. Our function cap is 10s.
- [CDN cache headers](https://vercel.com/docs/caching/cache-control-headers).

At 15s, one continuously active client makes at most 240 requests/hour, 5,760/day,
172,800/30 days; provider requests and function invocations at most the same
under normal single-client operation. Caching helps clustered visitors but may
save little for one 15s client with a 10s TTL. N visitors cost up to N times
these values without sharing. Six continuous clients exceed 1M CDN requests.

Estimated 10 KB normalised response: 57.6 MB/day, 1.73 GB/30 days/client.
Estimated 50 KB provider response: 288 MB/day, 8.64 GB/30 days ingested; this
is an estimate, not a measurement of local traffic. 2 GB memory at 0.5s per
invocation: 48 GB hours/month; 5s timeouts throughout: 480 GB hours/month,
exceeding Hobby's allowance. 10ms CPU/request: 0.48 CPU hours/month; actual
CPU, memory billing, cache hit rates, cold starts and other account usage need
measurement. Responses are capped at 256 KiB and 1,000 provider records.

No paid product or billing change. Hobby can pause service when usage is
exhausted. The estimate supports a free-tier trial, not a capacity guarantee.
Closing the iPad ends collection; disconnected clients expire their displayed
positions after 120s and resume normally when visible and online again.

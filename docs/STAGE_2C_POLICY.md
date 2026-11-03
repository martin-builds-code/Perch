# Stage 2C implementation policy

Baseline: Stage 2B e102eb2e1f1480c40a2fe50f9254642397aacd2f. Stacked on
PR #2; PRs #1/#2, production and the protected Preview remain untouched.

Before implementation, the public HexDB homepage/API documentation was checked:
https://hexdb.io/ documents free/no-key v2 aircraft-by-hex and route-by-ICAO-callsign
lookups. No numeric public limit or explicit incompatible restriction was found
in that page. This does not establish unrestricted storage/redistribution rights.
Use selective personal lookups only, link attribution and temporary caches.
Do not scrape the website or fetch airport/image/bulk resources.

Selected budget (before implementing calls): primary only, one optional browser
request per 30 seconds maximum, concurrency one; no enrichment polling timer.
Existing positional publications trigger lookup opportunities. A prior primary's
cached fields may appear in the secondary list; no secondary prefetch. Identity
TTL 30 minutes; route TTL 5 minutes; missing results TTL 5 minutes. Client cache
64 entries; process-local server cache 128. No database. One provider call per
endpoint invocation; in-flight deduplication, one call per process at a time and
at least 30 seconds between new provider calls. Fetch/body timeout 2.5 seconds,
64 KiB cap, no internal retries. Errors cool down 5 minutes, access denial 10
minutes, rate limiting honours longer Retry-After. Cache hits make no provider call.
Different warm processes/clients do not share a global limiter; hosted trial must
remain protected and bounded. Never claim Vercel memory is globally shared.

Ceiling per continuous client/process: 2 lookups/minute, 120/hour, 2,880/day,
86,400/30 days. Most actual traffic should be much lower: a stable primary with
both fields cached needs roughly 14–16 combined lookups/hour; negative
caching is the same five-minute cadence. Positive entries can refresh up to 30
seconds early on an existing positional publication, retaining valid fields while
the refresh is pending; this still uses the same concurrency and request gate. Rapid switches remain bounded at 120/hour,
not two calls per positional poll. Function invocations can reach that ceiling
per client even when provider results are shared across clients in one warm process.
At an estimated 2 KB/response, ceiling transfer is 5.76 MB/day/client. At 2 GB and
0.5 seconds/request, 30-day memory estimate is 24 GB-hours; all 2.5-second timeouts
would be 120 GB-hours, additional to positional usage. Actual account headroom,
CPU, cold starts and multiple clients still need measurement; no paid upgrade.

Route keys include hex AND exact normalised callsign. Match returned callsign
exactly. Preserve IATA and ICAO codes; use names only when supplied. Reject
contradictory endpoints, invalid/future dates and known updates older than 180 days.
Unknown update age is an unverified best-effort association, never a current flight
plan. Native adsb.fi description/registration/callsign win over optional fields.
Registered owner alone is not an operator: only explicitly documented/endorsed
brand evidence pairs (owner plus provider operator flag) receive a brand label.

Delay investigation: leave 30-second delay, 120-second expiry and Stage 2B weights/
holding unchanged. Prepare opt-in 30–60-minute local diagnostics, inactive normally,
with no remote telemetry or persistent storage. Do not start a hosted observation.

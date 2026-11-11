# Route investigation scope and controls

Baseline: 3b87077eab07a1d861c910fdaf385e3d32f49c6f, open Draft PR #5,
verified READY Preview dpl_9tmsCijuHXUiXrvu1egEbCv7ctht. Household Production
remains independent at accepted Stage 2D 8031a76d0a24e1bb4ba88febd87d9a9c15ff2166.

The temporary access lease is server-only AERO_ROUTE_DIAGNOSTICS JSON containing
explicit enabled=true, startedAtMs and expiresAtMs integer UTC timestamps. It
requires VERCEL=1, VERCEL_ENV=preview, the exact isolated VERCEL_PROJECT_ID and,
when present, VERCEL_TARGET_ENV=preview. It never trusts browser flags, headers,
hostnames or client clocks. Expiration is absolute and enforced on each API
request, with a maximum duration of 48 hours. No bypass cookie/session is minted.
Production and other projects fail closed even with the flag. Existing PIN
credentials and Vercel protection are untouched. /api/session exposes only the
safe trial deadline; the experimental UI/banner appears only on server consent.
The concrete trial window will be configured shortly before deployment and
recorded in the evidence report; no lease timestamp is committed to activate it.

The normal display and API schemas remain unchanged when the trial is inactive.
Provider metadata is an explicit allowlist: outcome/reason, HTTP status, endpoint
template without identifiers, bounded timing, boolean airport/code/match fields,
and association age in days. No coordinates, raw payload, environment-variable
values, cookies, credentials or full provider URLs are exported. Browser exports
replace flight identifiers/callsigns with session-local F0001-style references.
The diagnostic dashboard intentionally replaces artwork during active diagnosis.

The pipeline is instrumented at the successful positional snapshot, scheduler,
application request, server cache/gate, upstream HTTP/validation, scene enrichment
and displayed-IATA guard. Server requests started and responses received are
separate: a network failure does not prove the request reached HexDB. Cache hits
and coalesced requests do not count another provider request. Primary/secondary
request roles are captured at scheduling time; displayed-aircraft time is tracked
separately. A successful old/stale response rejected by the existing age rule is
reported as rejection rather than provider absence, without changing that rule.

No radius, 15-second positional cadence, 30-second global enrichment minimum,
90-second collective secondary minimum, concurrency, priority, TTL, expiry or
provider-error backoff is changed. Diagnostic UI refreshes do not schedule network
work. The collector is bounded to 4,096 flight/detection entries, 1,024 events,
saturating counters, and the earlier of server lease expiry or 18 hours. Aircraft
positions/history are not stored. Closing the page stops collection; exports are
local, explicit and do not generate provider requests. Stop/unmount aborts lookups.

The baseline server/client conflict is reproduced by a deterministic test: 50 ms
of server-arrival jitter can reject a browser's correctly spaced 30-second request
with local Retry-After=30, while the browser imposes a 300-second shared pause.
This is a verified application mechanism, not a measured household frequency or
proof that it dominates real missing routes. It is deliberately not corrected
before live observation. The 180-day route-age guard and complete-IATA display
requirement are also retained and individually labelled in diagnostics.

Current public HexDB documentation was retrieved on 11 November 2026:
https://hexdb.io/ documents /api/v2/routes/{ICAO-callsign} and
/api/v2/aircraft/{hex}, free/no key, with no numeric rate limit stated. The current
endpoint used by Aero Pane is correct. The documentation's route example has a
2014 updated_at; that is an example, not live-coverage evidence. No airport,
image, bulk or alternative-provider requests are required for this trial.

A controlled initial live session will run through the actual deployed browser,
using existing request budgets only, with no unrelated lookups or FR24 scraping.
The managed execution environment does not advertise a durable scheduler or
18-hour session guarantee; a short session cannot be reported as 18 hours.
The bounded observation script can support a separately supervised longer run,
but no unattended background worker, paid infrastructure or Mac mini is created.
Real duration, counts, provider outcomes, limitations and cleanup are recorded in
the final report rather than estimated from simulated traffic.

Local pre-deployment verification: 212 automated tests, 13 compiled plain-Node
HTTP runtime cases, ESLint, TypeScript/server checks, default production build
and all-feature Safari 15-targeted build passed. The mocked browser investigation
at 1024×768 and 1024×624 verifies immediate route publication, separate rejected
and negative states, unchanged request spacing, privacy, and automatic expiry to
PIN with no remaining positional polling. Browser screenshots in this directory
are explicitly synthetic; they are not live-provider evidence or physical-iPad
verification. React effects/timers/listeners were reviewed using the Vercel
React best-practices checklist; no provider timer was introduced.

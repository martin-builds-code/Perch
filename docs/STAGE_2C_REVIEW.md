# Stage 2C — review, compatibility and operation

Baseline: `e102eb2e1f1480c40a2fe50f9254642397aacd2f`. PRs #1 and #2 were
verified open/unmerged and source heads unchanged. The Stage 2A ESM correction
and Stage 2B selection are inherited. This branch `stage-2c-aircraft-enrichment`
prepares a separate draft PR targeting `stage-2b-aircraft-selection`; it does not
modify either earlier PR/branch. Review the stacked diff, not a diff against main.
Specification v2.0 and its Stage 1C findings were reviewed. The underlying Stage 1C
archive is not available here; four current bounded HexDB checks were made instead.

## Optional enrichment

Endpoints verified from [HexDB's current API documentation](https://hexdb.io/):
- `GET https://hexdb.io/api/v2/aircraft/{hex}`
- `GET https://hexdb.io/api/v2/routes/{ICAO-callsign}`

Only these two resources are used. No image/airport/bulk lookup or website scraping.
A separate `/api/enrichment` function runs one lookup, with its own cache, concurrency
and timeout. The positional endpoint never awaits/imports this service. Neither
route data nor operator/model enrichment is fed back into selection or freshness.
The frontend decorates the latest presentation scene after selection. A late reply
can decorate only matching aircraft/flight keys, including a cached former primary
in a secondary slot; it cannot select or resurrect an aircraft.

Native adsb.fi descriptions, registrations and callsigns take precedence. HexDB
fills unavailable description/registration, route endpoints and a conservative
operator brand. Registered owner alone is not treated as operator. Supported brand
pairs are HexDB's easyJet owner/`EZY` evidence and user-endorsed Ryanair/Malta Air
owner plus `RYR`/`MAY` evidence. Other owners/flags remain unknown; no callsign-prefix
operator matching or exhaustive airline directory is added.

Routes match the exact normalised callsign and are cached by hex AND callsign.
Different flights on the same airframe do not inherit a previous callsign's route.
IATA and ICAO codes are retained; supplied names occupy existing route slots. Codes
without names use the existing unavailable-name treatment, never invented names.
Partial routes are usable. Invalid/mismatched routes, contradictory airport endpoints,
invalid/future dates and known updates older than 180 days are suppressed. A route
without update age is an unverified best-effort association. No flight-plan claim
or intrusive warning is added. Later manual spot checks can guide review; no
Flightradar24 scraping was performed.

[Request/cache policy and cost estimates](STAGE_2C_POLICY.md) explains ceilings,
TTLs and cross-instance limitations. Positive current-primary entries may refresh
30 seconds before TTL using an existing positional publication, preserving valid
fields while a bounded refresh runs. Missing results are not prefetched. Expiry
is pruned on access/publication; no cache-cleaning background timer is introduced.
Expired fields are not reapplied, and at worst a currently rendered value remains
until the next ordinary publication (normally at most 15 seconds). Cache memory is
bounded even while idle and is reclaimed on process termination/client stop.

## Bounded live-provider evidence

Exactly four ordinary documented example lookups were performed, without the private
observation location. Recorded results are in `stage-2c-provider-smoke.json`:

| Lookup | HTTP | Latency | Result |
| --- | --- | --- | --- |
| Aircraft 4010ee | 200 | 226 ms | Identity parsed; easyJet UK/EZY brand evidence |
| Route EIN17A | 200 | 546 ms | Association dated 2023-03-30; deliberately suppressed as old |
| Missing aircraft 000000 | 404 | 314 ms | Negative result |
| Missing route ABC123 | 404 | 838 ms | Negative result |

No access denial/rate restriction was encountered. Public documentation advertises
free/no-key hobby access, but gives no numeric rate limit in the reviewed page.
This is not permission for unlimited requests, a permanent database or redistribution.
The native-description-first strategy follows v2.0's reported Stage 1C coverage;
it does not rely on those old findings as proof of today's API schema or route accuracy.
Fresh route mechanics and partial results are tested with fixtures. The smoke sample
contains no verified current real route and is not an accuracy benchmark.

## Local review

Node 24 and locked dependencies; no package/runtime dependency was added.
Run `npm ci`, `npm run lint`, `npm test`, `npm run build` and a live-enabled build:
`VITE_AERO_LIVE_ENABLED=true VITE_AERO_ENRICHMENT_ENABLED=true VITE_AERO_DIAGNOSTICS_ENABLED=true npm run build`.
Automated tests use fixtures, never live providers. The compiled runtime check binds
an ephemeral loopback port; the cloud execution sandbox needs network permission
for that local bind. Plain Node, not Vite/tsx, executes emitted server JavaScript.
For a materialised single-function artifact, `node scripts/test-server-runtime.mjs /path`
automatically exercises the handler graph present there (position or enrichment).

For an authorised local live test, use ignored `.env.local` from `.env.example`:
set both live flags and both enrichment flags true, and configure the original
observation point privately as documented for Stage 2A. Restart the loopback-only
server and open `/?mode=live`. Do not put private coordinates in `VITE_` variables,
shell arguments, source, screenshots or PRs. Simulation remains usable without any
configuration/API and uses the normal root URL. Enrichment/diagnostics flags default
false. Both server endpoints retain production live guards; the enrichment endpoint
also requires `AERO_LIVE_ENABLED=true` and `AERO_ENRICHMENT_ENABLED=true`.

Diagnostic trials additionally require the diagnostic build flag and explicit
30–60-minute query. See [delay findings and trial procedure](STAGE_2C_DELAYS.md).
No hosted trial or unattended observation was initiated here.

## Validation and compatibility

- All 80 named tests pass: 54 inherited, 15 enrichment/cache/client tests and 11
  diagnostic/investigation tests. Coverage includes malformed data, size/time bounds,
  HTTP/access/rate failures, cache expiry/negative/coalescing/bounds/cooldowns, late
  replies, native precedence, finite delay episodes, clocks, lifecycle and cleanup.
- All 11 compiled-server HTTP scenarios pass (five positional, six enrichment).
- Local `@vercel/node@29.0.1` packaging generated two separate `nodejs24.x` artifacts.
  Position and enrichment graphs each passed their corresponding plain-Node HTTP
  checks. The enrichment artifact includes `server/hexdb.js`,
  `server/enrichmentService.js` and `src/enrichmentTypes.js`. This builder was used
  only under `/tmp`; no hosted deployment or project dependency was introduced.
- Lint, default TypeScript/Vite build, NodeNext server checks and live/enrichment/
  diagnostic-enabled Safari 15 builds pass. Private configuration canaries are
  checked against emitted browser assets.
- Existing local browser regressions pass: 18 pixel-identical simulation comparisons,
  12 Stage 2A state/layout checks and Stage 2B acquisition/handover at three sizes.
- New Chromium fixtures verify immediate native rendering before enrichment, later
  operator/routes, preservation of the native MAX variant, callsign-specific clearing,
  timeout isolation from positional requests/diagnostics, long route-name fit and
  simulation cleanup at 1024×624, 1024×768 and 1112×834. See
  `stage-2c-browser-checks.json`, `stage-2c-enrichment-fixture.png` and
  `scripts/enrichment-browser-check.mjs` (optional Playwright Core via
  `PERCH_PLAYWRIGHT_MODULE`, local :5173 server with public flags enabled, server
  provider flags disabled, all API responses intercepted as synthetic fixtures).

No essential typography, card size, spacing, colours, model hierarchy, orientation
or controls changed. The compact footer adds a HexDB attribution link only when
its fields are actually used. Optional airport names ellipsize in the existing
live route slot to avoid wrapping into adjacent content; the bounded supplied name
remains in its title. This preserves essential font sizes instead of shrinking them.
No loading spinner, map, settings panel or enrichment-error banner is added.

New browser APIs (fetch/AbortController, URLSearchParams, Map, JSON and ordinary
array/numeric operations) are supported by Safari 15. Explicit Safari 15 JS/CSS
targets remain. Physical Air 2/Safari, Web Inspector export workflow, readability
and endurance were not tested. Desktop checks are not device certification; no
material Air 2 compromise was identified. Actual cache hit rates, provider behaviour,
Hobby headroom and authentication on a replacement Preview remain unverified.

## Deployment boundary and remaining work

No merge, deployment, live variable, protection setting, sharing link, production
alias or protected Stage 2B Preview was changed. Git deployment is disabled for this
branch in source. No Supabase, background collector, enrichment provider substitution,
paid service or Stage 2D authentication work was introduced.

Before a live trial: review the stacked PR, the 180-day route age policy, conservative
brand pairs and request budget; separately authorise a protected Stage 2C Preview;
validate authenticated API guards and live rendering before any sharing step;
then run/export a bounded diagnostic trial. The user's real delayed-episode rate
and cause are still unknown. Any server cache/gate change or freshness/selection
policy change needs evidence and review; no automatic threshold changes are made.

Reversion before merge is simply closing this PR and retaining Stage 2B. Locally
stop the dev server/close the live tab and disable the opt-in flags; private local
config remains ignored. Do not roll back or alter the existing protected Preview
or production as part of reviewing this branch.

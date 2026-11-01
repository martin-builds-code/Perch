# Stage 2A review and operation

Repository: https://github.com/martin-builds-code/Perch
Branch: `stage-2a-live-data`; base `ce708901750975c89400314a091db0b59a3a9919`.
The attached Product and Technical Specification v2.0 was read before implementation.
Its document header says proposed baseline; the user's implementation instruction
establishes it as approved. The narrower Stage 2A exclusions govern this work.

## Local review

Use Node 24, `npm ci`, `npm run lint`, `npm test`, `npm run build`.
No live requests are made by these checks. For named test output in this Node
runner, run each file directly: `node --expose-gc --import tsx tests/live.test.tsx`
(and `display.test.tsx`, `lifecycle.test.tsx`). There are 20 named tests in total.

`npm run dev` binds to loopback. Open `http://127.0.0.1:5173/` for simulation;
`?scene=multiple` selects the existing comparison scenario. Simulation needs no
configuration and makes no aircraft API requests. No new runtime dependencies.

For an authorised local live check, copy `.env.example` to `.env.local` and
edit it privately. Set `AERO_LIVE_ENABLED=true`, the established private latitude
and longitude in decimal degrees, and `VITE_AERO_LIVE_ENABLED=true`.
Keep `AERO_POLL_INTERVAL_MS=15000` initially (supported 15000–300000 ms).
Restart the dev server, then open `/?mode=live`. The ordinary root still runs
simulation. Delete the query or close the tab to stop polling. Never put
coordinates in a `VITE_` variable, shell arguments, screenshots, commits or PRs.

Vite's development middleware loads only `AERO_` values into the server process;
normal Vite handling exposes only the deliberate `VITE_` build flag. API errors
contain codes, never raw provider URLs, coordinates or exception messages.
Private configuration files are ignored. No actual observation point is included
in this branch or was available during implementation. No Mac mini was accessed.

The local live smoke used the provider's documented public Helsinki example
point, not a replacement for the established household observation point. When
running behind an environment proxy, Node 24 may require `NODE_USE_ENV_PROXY=1`;
keep TLS verification enabled and use the configured trust chain.

## Review focus

- `server/aircraft.ts`: provider-independent normalisation, geodesic distance,
  native description preservation and explicit public projection.
- `server/provider.ts`: v3 endpoint, 15 km → NM conversion, streaming byte cap,
  timeout covering headers/body, schema checks, HTTP/access/rate-limit handling.
- `server/service.ts` and `api/aircraft.ts`: private configuration, process cache,
  coalescing, cooldown, safe API and CDN headers. No persistent process required.
- `src/live.ts`: isolated provisional nearest-aircraft selection, 30s delayed /
  120s expiry policy, one polling chain and expiry timer, lifecycle recovery.
- `src/LiveApp.tsx`, `src/mode.ts`, existing display: opt-in rendering, unchanged
  simulation, provider attribution in the compact footer. Up to three secondaries.

The native readable description is preserved with limited manufacturer casing;
no subtype, operator, airline-prefix or route enrichment. Unknown values stay
unknown. Ground aircraft have `onGround=true`; nonnumeric barometric altitude is
unavailable, never manufactured as zero or geometric/ground-relative height.
Raw description and position stay in the normaliser for server diagnostics and
are not retained in a permanent store or exposed in the API.

Freshness uses provider epoch milliseconds minus `seen_pos` seconds. Any negative
age/future clock becomes an anomaly, not a zero-age reading. Expiry is evaluated
on a separate deadline timer even if an API request hangs. Displayed rows older
than 120s are removed. Brief request failures retain valid rows explicitly delayed.
A successful empty observation is distinct from failed or invalid-position data.

## Browser regression reproduction

`scripts/browser-check.mjs` uses optional Playwright Core, installed separately
(e.g. in `/tmp/perch-browser`), and `/usr/bin/chromium`. Set
`PERCH_PLAYWRIGHT_MODULE=/tmp/perch-browser/node_modules/playwright-core/index.mjs`.
Run the script from the repository root. It expects the approved baseline server
on 127.0.0.1:5174 and this branch on :5173 with `VITE_AERO_LIVE_ENABLED=true`.
Both servers must bind to loopback. All live browser responses in this regression
script are synthetic; it makes no provider requests.

Create a detached baseline worktree at the base SHA, install its dependencies
(or share the node_modules directory and allow that directory in its temporary
Vite `server.fs.allow` so the self-hosted font loads). This temporary harness
adjustment must not change baseline display code. Screenshots wait for fonts.
The script compares 18 simulation screenshots byte-for-byte and checks 12 live
state layouts, footer bounds, identity/route separation and secondary card
content separation. Results and an explicitly synthetic screenshot are in docs.

## Hosted deployment and rollback

No hosted live test or production release is authorised. Branch-specific
`git.deploymentEnabled=false` prevents Git preview builds; server configuration
hard-disables live for `VERCEL_ENV=production`, even if flags are set. The public
simulation has no changes until a separately approved merge/deployment.

Before any hosted live review, obtain separate deployment authorisation, protect
both assets and API using Vercel deployment protection, scope private config to
that review environment only, and validate cache headers, cold starts, provider
traffic and rate limits. Do not assume a hidden query string or public build
flag is access control. Begin with one active reviewer/iPad; CDN/process caches
are not a globally enforced limiter. Actual Vercel billing plan and remaining
account allowances were not returned by the inspection tools and need checking.

Reversion before merge: close the PR and keep main unchanged. Locally switch to
main; remove ignored private config if no longer needed. For an approved test,
close the browser, unset live flags, and remove that test deployment when approved.
Do not roll back or modify the existing production project for this branch.

Stage 2B relevance/switching stability, Stage 2C enrichment/routes and Stage 2D
private authentication/endurance are deferred. Stage 2A nearest ordering is a
rendering demonstration, with no audibility or detection-coverage claim.

# Stage 2A validation and compatibility — 1 November 2026

Current status: the original protected Preview failed before provider execution.
The ESM correction is locally verified, but has not been redeployed. Hosted live
validation must pass before iPad testing; see the follow-up below.

## Original local results (d27505f)

- TypeScript/Vite build and ESLint passed. No new runtime dependencies.
- 20 named automated tests passed: seven existing display tests, one existing
  mounted simulation soak and twelve Stage 2A tests. The soak covers 30 complete
  simulation cycles, bounded heap growth, one simulation timer and cleanup.
- Adapter fixtures cover populated/empty, HTTP error, 401/403, 429/Retry-After,
  timeout on fetch/body, malformed JSON/structure, missing fields, excessive
  Content-Length and streamed bytes. Native descriptions/variants, missing
  identifiers, ground status, altitude units, invalid coordinates, negative
  ages, clock anomalies, zero/known/antipodal distances are covered.
- Selection/render tests cover primary/secondary prominence, deterministic
  order, missing routes, current/delayed/unavailable/empty, expiry, future times,
  mode gating. Poller tests cover cadence, overlapping starts, timeout, transient
  failure recovery, hidden/offline suspension, resume expiry and cleanup.
- Service/API tests cover concurrent in-process clients, TTL, cadence, cooldown,
  disabled/production guards, safe projection and response cache headers.
- Chromium: 18 pixel-identical baseline simulation comparisons and 12 live
  fixture layout checks passed at 1024×624, 1024×768 and 1112×834. No page errors.
  See `stage-2a-browser-checks.json` and `stage-2a-live-fixture.png` (synthetic).
- Build with synthetic private configuration canaries: neither coordinate nor
  server configuration names/provider URL appeared in built client files.
- Two deliberate live provider checks: one documented public example via curl,
  one full local Chromium → Vite API → adapter → provider flow. The latter made
  one browser request, returned HTTP 200 / five aircraft, rendered current data,
  reported zero page errors and exposed no position/configuration fields.
  These were bounded checks, not a provider benchmark or local coverage test.

Browser testing found a timer method binding error missed by Node fixtures;
wrapping browser timer functions corrected it, and the full flow then passed.
The first visual comparison had a harness font-access issue; enabling access
only in the detached baseline harness produced the correct Nunito comparison.
No display redesign or font change was needed.

## iPad Air 2 assessment

Existing JS/CSS Safari 15 targets and module-preload polyfill remain explicit.
New client features (fetch, AbortController, visibility/online/pageshow events,
Map, flatMap, optional chaining after transpilation) are supported in Safari 15.
No `AbortSignal.timeout`, `Array.at`, `toSorted`, dynamic viewport units or new
CSS features were introduced. The same self-hosted font, layout, spacing,
measurements and compact footer are retained. No header/map added.

Chromium viewport checks and compiler targeting do not certify Safari/WebKit or
physical hardware. No physical Air 2 / Air 3 or Safari device testing occurred in
this stage. No demonstrated Air 2 limitation or material compromise was found;
there is no current evidence justifying an Air 3 change. Actual hardware must
still confirm fit with Safari chrome/Home Screen, room-distance readability,
resume after lock, network loss, permanent power and extended unattended use.

## Not performed / review gates

- Previously established private observation point: not available in this
  environment; must be configured privately for an authorised local/review test.
- Stage 1B archive: absent from this repository and attachments. Synthetic fixtures
  and the provider's public example were used. The original archive was untouched;
  representative archive replay remains outstanding when supplied.
- The original hosted Preview was subsequently attempted and failed at module
  loading, as detailed below. The corrected revision still needs a separately
  authorised hosted test; live cache/rate behaviour remains unverified. The user
  confirmed Hobby and deployment protection for the original Preview. CDN sharing
  across regions/instances is not guaranteed.
- No physical iPad test, long live endurance run, final relevance algorithm,
  route/operator enrichment or authentication implementation.

Ready for code review and a decision about a separately authorised protected
single-client test deployment after the above configuration/budget checks.
Automated passes do not establish production readiness or detection coverage.

## Follow-up: protected Preview ESM failure and correction

The subsequent protected Preview `dpl_GCXha8dTYsPyGZix7GELJz9fsxBa` at
`d27505f74081062257e669af5d2baf161b07ca7f` built successfully but, according
to the user's validation report, returned HTTP 500 before provider execution:
`ERR_MODULE_NOT_FOUND` for `/var/task/server/service`. That deployed revision
is not ready for iPad testing. The earlier local Vite/tsx passes did not verify
Node's emitted-code module loading and did not establish hosted live operation.

Root cause: extensionless server imports were preserved in emitted ESM. Vite
and tsx resolved them during development; plain Node requires the emitted `.js`
extensions. The failure was reproduced locally with ordinary Node 24 loading
transpiled copies of the original server code, without a TypeScript loader.

Correction: explicit `.js` specifiers throughout `api/` and `server/`, including
type-only references for consistent NodeNext checks. TypeScript maps these to
`.ts` during development and preserves valid `.js` references when emitting.
No frontend, provider logic, configuration values or deployment settings changed.

New verification:
- `tsconfig.server.json` checks the server graph with NodeNext resolution;
  `npm run build` now includes this check, catching extensionless imports early.
- `npm test` still passes all 20 original tests and additionally runs five
  compiled-code HTTP checks in fresh plain-Node child processes: disabled,
  production guard, populated, empty and provider failure.
- The compiled populated fixture checks normalisation, 15 km filtering,
  deterministic distance, cache headers and absence of private position fields.
- Local packaging with `@vercel/node@29.0.1`, TypeScript 5.9.3 and Node 24
  produced a `nodejs24.x` artifact containing the API and all three required
  server modules. The same five HTTP checks passed against that packaged output.
  This builder was installed only under `/tmp`, not added to project dependencies.
- ESLint and the application build pass. The client asset hashes stayed unchanged.

The runtime smoke binds an ephemeral loopback port, uses synthetic configuration
and mocks every provider request. No live provider requests or browser tests were
performed for this correction. The cloud shell requires network permission for
loopback binding; a denied bind is a sandbox restriction, not a provider failure.

A corrected deployment has not been created. Hosted live operation, real private
location filtering/distances, cache behaviour and iPad acceptance remain unverified.
The user reports that the protected Preview's temporary variables remain configured;
this correction does not read, change or remove them. Production remains outside
this correction's deployment authority. Separately authorise a replacement protected
Preview using the corrected commit, then validate the authenticated API and
`/?mode=live` before considering iPad testing or any sharing step.

# Stage 2A validation and compatibility — 1 November 2026

## Results

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
- Hosted Vercel execution/cache/rate behaviour, actual account usage headroom,
  deployment protection and production runtime packaging: not tested because no
  deployment is authorised. CDN sharing across regions/instances is not guaranteed.
- No physical iPad test, long live endurance run, final relevance algorithm,
  route/operator enrichment or authentication implementation.

Ready for code review and a decision about a separately authorised protected
single-client test deployment after the above configuration/budget checks.
Automated passes do not establish production readiness or detection coverage.

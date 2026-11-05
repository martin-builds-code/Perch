# Stage 3A — display redesign review

**Composition B is implemented, with the authorised fallback, spacing and radar corrections.**
See the [current report and screenshots](stage3a/visual-corrections/README.md).
The [A/B/C review archive](stage3a/composition-review/README.md) remains as evidence;
its temporary runtime switch and stylesheet have been removed.

Baseline: accepted main `8031a76d0a24e1bb4ba88febd87d9a9c15ff2166`, verified unchanged
before development and review preparation. Branch: `stage-3a-display-redesign`,
targeting main. No main reset/rewrite, Production change, deployment, Vercel Git
reconnection or M24 modification. The branch is excluded from Git deployments in
source; other deployment settings are unchanged.

## Implemented experience

- Full manufacturer/model moves to a wide top header with compact provisional A·P /
  Aero Pane branding. Names wrap and stay readable, including Challenger 350, PA-28
  variants, Dreamliner and longer technical descriptions; tested header minimum 34px.
- The navy primary card has a protected upper-left route area and prominent artwork
  towards the lower-right. Approved per-asset placements integrate the visible
  silhouette around the route while preserving text clearance. Useful operator,
  callsign, registration and direction information remains subordinate.
- Complete reliable IATA routes use large condensed codes and smaller full airport
  names underneath. Partial or ICAO-only routes have no prominent missing-data block.
  No airport mapping, invented code or route-validation/enrichment change is added.
- Yellow/aqua measurement panels take 28.5% of the primary width, approximately 25%
  narrower than the previous ~38.5%. Self-hosted Barlow Condensed SemiBold supplies
  naturally condensed numbers/codes; Nunito remains for friendly headings/labels.
  Primary numbers are 88–106px in tested viewports, without horizontal distortion.
  The bundled font is a Latin WOFF subset under SIL OFL (`public/fonts/`).
- Three compact secondary cards prioritise aircraft type and measurements. Missing
  operators are omitted and identifiers appear where space permits. A lone aircraft
  expands the presentation and removes the secondary section entirely.
- Healthy empty airspace is a dark screen with a centred 220px slow radar sweep. Outages
  remain visibly distinct; existing freshness/footer rules still apply.
- Actual primary ID triggers a restrained one-second card glow/header/image fade,
  including consecutive aircraft with the same model. Routine same-ID updates keep
  their DOM and do not restart animation. Reduced motion disables all new motion.

## Artwork, provenance and remaining inputs

The directly supplied starter ZIP provided accepted A380 (1774×887), generic
narrow-body (1600×800) and independent clouds (1800×330), each as transparent PNG and
WebP. All six images were decoded, alpha-checked and hash-verified. Their bytes are
unchanged. See [asset mapping and installation](artwork/README.md),
[original manifest](artwork/source-manifest.json), [verification](artwork/verification.json)
and [house style](artwork/house-style.md). Actual files are in `public/aircraft/`;
runtime configuration is `src/artwork/manifest.json`. No replacement art was generated.

The pack contains artwork rather than a full dashboard mockup. The user subsequently
reviewed the three alternatives and approved B. The subsequent visual corrections
preserve its aircraft-led composition and A380 tail/route relationship while
improving clearance and keeping aircraft/clouds together as the card resizes.
Branding is provisional as authorised. As explicitly requested, every non-A380
aircraft now uses the generic jet as a visual placeholder, including light aircraft,
helicopters, wide-bodies and unidentified records. The actual manufacturer/model
text is preserved; the picture makes no claim about the aircraft's real shape or
livery. No new artwork is needed or requested.

## Preserved technical behaviour

No server/API, selector, enrichment, authentication, Appliance, quiet-hours,
diagnostic collector/export or dependency file was edited. The only live-data
presentation addition forwards the already-available ICAO type code to the renderer;
optional IATA/ICAO declarations preserve existing airport metadata. No API contract,
tracking/identification algorithm, polling cadence, radius, holding/switching rule,
route validation, freshness threshold, gate/cache or request budget changes.

No new runtime package, recurring timer, paid service or routine control. Fonts and
images are static same-origin resources. A380+cloud WebP transfer is about 204KiB;
generic+cloud about 137KiB, before normal caching. Decoded images are larger: all
three subjects total roughly 13MiB RGBA if the browser retains them. No application
image history or prefetch grows over time. Actual extended Air 2 memory/performance
needs acceptance testing.

## Validation

- **159 automated tests** pass: 137 inherited plus 22 Stage 3A checks. Old presentation
  assertions were updated for intentional omission of empty secondary sections,
  missing operators and partial routes. Provider, selector, session/PIN, quiet-hours,
  lifecycle/soak, diagnostics and cooldown regression coverage remains.
- **13 compiled-server HTTP checks** pass under plain Node ESM. Server `.js` imports
  and guards are unchanged. Lint, TypeScript/NodeNext, default and all-feature Safari
  15 production builds pass.
- **51 Chromium layout cases** cover 17 scenarios at 1024×624, 1024×768 and 1112×834:
  A380, Challenger, PA-28, Dreamliner, ATR, helicopter, A320, single, missing/ICAO route,
  missing values, healthy empty, outage, delay, long technical names, long airports and wide-letter IATA codes.
  Assertions cover overlap, scrolling, protected artwork, numeric width/height,
  minimum font sizes, capacity and truthful missing information.
- Additional browser checks cover WebP→PNG fallback, same-model identity changes,
  routine DOM stability, reduced motion, immediate primary before late route
  enrichment, unchanged 15-second cadence and private diagnostic downloads.
- Sleeping and PIN-entry screenshots are **pixel-identical** to Stage 2D at all three sizes, with
  no sleeping positional requests. Wake acquires fresh data; existing corner-hold
  quiet-hours settings still open/close normally.
- Current final-composition checks cover 69 alpha-aware layouts, including routes
  missing and both single/multiple states, plus three radar/outage checks. They
  verify shared scaling, at least 12px clearance from information-row text, fixed
  header/measurement/secondary/footer pixels and bounded listener lifecycle.

Evidence: [browser results](stage3a/browser-checks.json), [A380](stage3a/a380.png),
[compact A380](stage3a/a380-compact.png), [generic A320 class](stage3a/a320.png),
[expanded single](stage3a/single.png), [missing route](stage3a/missing-route.png),
[Piper name](stage3a/piper.png), [healthy empty](stage3a/empty.png),
[outage](stage3a/unavailable.png), [quiet hours](stage3a/quiet-hours.png).

Stage 2's old dashboard pixel/geometry comparisons are intentionally superseded by
Stage 3A browser checks. Inherited functional tests remain; unchanged sleeping pixels
are compared directly against accepted Stage 2D.

## Local review and compatibility

Run `npm run lint`, `npm test`, `npm run build`, followed by:

```sh
VITE_AERO_LIVE_ENABLED=true VITE_AERO_ENRICHMENT_ENABLED=true VITE_AERO_DIAGNOSTICS_ENABLED=true VITE_AERO_APPLIANCE_ENABLED=true npm run build
```

For local visual fixtures, open `/qa-stage3a.html?scenario=a380` on the loopback Vite
server. Other fixture names are in `tests/fixtures/stage3a-harness.tsx`. This synthetic
entry is not imported by the application or emitted by the standard production
build. Simulation at `/` remains usable without API/private/auth configuration;
normal live/appliance configuration and guards remain unchanged.

`scripts/stage3a-browser-check.mjs` uses optional Playwright Core/Chromium with this
branch on :5173 and an unchanged 8031a76 checkout on :5175. Both enable all public
flags; server provider flags stay false. Every API is mocked, including sessions;
no real provider requests. Set `PERCH_PLAYWRIGHT_MODULE` for an external tool install.
The browser tooling and Pillow verification are not application dependencies.

Safari 15 JS/CSS targets remain explicit. Grid/flex, WOFF, SVG raster viewports,
uniform scaling, image-error fallback and reduced-motion queries fit Safari 15.8.5;
no newer animation/File System API or canvas loop. This is build/source assessment
and desktop evidence, not physical Safari certification.

**Ready for physical iPad review, not release approval.** Air 2 / iPadOS 15.8.5 still
needs room-distance reading, image/font decoding, transition, prolonged memory,
real-route and sleep/wake checks against the current corrected screenshots.
No material hardware compromise has been demonstrated or accepted.
ChatGPT Work retains separately authorised deployment/release coordination.

# Stage 3 — living-room readability revision

Baseline: **`b22a5c2ecefcf9c903aa91ee4dfe52b15eecdcdf`**, confirmed as the current
head of `stage-3a-display-redesign` and [Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5).
It includes the authorised corrections after the instruction's older `8669b10`
reference. The initial working tree was clean. Both approved concept images were
visible in the conversation and used directly, with the multiple-aircraft concept
guiding secondary type/route hierarchy. These are real React/HTML fields, not a
flattened concept image. No merge or deployment was performed.

## Screenshots

| State                              | 1024 × 768                                | 1024 × 624                                |
| ---------------------------------- | ----------------------------------------- | ----------------------------------------- |
| Complete multiple aircraft         | [View](readability-multiple-1024x768.png) | [View](readability-multiple-1024x624.png) |
| Complete single aircraft           | [View](readability-single-1024x768.png)   | [View](readability-single-1024x624.png)   |
| Partially missing secondary routes | [View](readability-partial-1024x768.png)  | [View](readability-partial-1024x624.png)  |
| Two secondary aircraft             | [View](readability-two-1024x768.png)      | [View](readability-two-1024x624.png)      |
| Long aircraft names                | [View](long-names-1024x768.png)           | [View](long-names-1024x624.png)           |
| Wide route letters                 | [View](readability-wide-1024x768.png)     | [View](readability-wide-1024x624.png)     |
| Long airport names                 | [View](long-airports-1024x768.png)        | [View](long-airports-1024x624.png)        |
| Higher-contrast radar              | [View](empty-1024x768.png)                | [View](empty-1024x624.png)                |
| PIN                                | [View](pin-1024x768.png)                  | [View](pin-1024x624.png)                  |
| Sleeping                           | [View](sleep-1024x768.png)                | [View](sleep-1024x624.png)                |
| Provider unavailable               | [View](unavailable-1024x768.png)          | [View](unavailable-1024x624.png)          |

[Before/after gallery](gallery.html), with exported comparison sheets for
[multiple, regular](comparison-multiple-1024x768.png),
[multiple, compact](comparison-multiple-1024x624.png),
[single, regular](comparison-single-1024x768.png) and
[single, compact](comparison-single-1024x624.png).
All data is synthetic; baseline and revised screenshots use the same fixtures.
The photographs/concepts guide hierarchy rather than supplying data or pixels.

## Implemented hierarchy

- Primary aircraft name/header, compact branding, navy/white identity and prominent
  yellow/aqua measurement styling remain. Header/footer pixels match the baseline;
  primary metric typography and widths are retained. Secondary cards get a modestly
  taller section, reducing multiple-mode primary-panel height without shrinking its
  illustration or metric numbers.
- The existing illustrations retain the previous **multiple-aircraft** placement
  and scale (within 1 CSS pixel at both target viewports). Single mode now uses that
  same placement, rather than centring/enlarging the picture. All cloud rendering
  and cloud image requests are removed. The original cloud files remain untouched.
- Single mode spends its extra room on callsign and human-readable direction:
  **44px regular / 40px compact**, with visible labels and a subordinate operator
  line at 26px / 24px. Missing fields are omitted. Multiple mode retains a compact
  value row; registration is no longer displayed there but remains in the data.
- Secondary aircraft type is **32px regular / 28px compact**, or **28px / 26px**
  for longer names. Genuine complete route codes use **66px / 64px** Barlow
  Condensed, with an arrow; altitude/distance follow in yellow/aqua at 24px / 22px.
  Callsigns and optional operator clutter are omitted from secondary cards.
- Missing/partial/ICAO-only routes produce no large route placeholder or callsign
  substitute. Available type and measurements use the space. One or two secondary
  cards use the available width rather than reserving empty third-card columns.
- Two strict display-name mappings remove redundant technical/category wording:
  Bombardier BD-100 Challenger 350 → Bombardier Challenger 350; the matching
  BD-700-2A12 Global 7500 description → Bombardier Global 7500. Full original names
  remain in titles and the primary header. Piper variants and other names retain
  their actual wording; no general subtype/enrichment system was introduced.
- The same 220px radar has brighter rings/sweep, a thicker line and higher opacity.
  It retains its 16-second CSS-only rotation and reduced-motion suppression.

## Stationary illustration evidence

The manifest now supplies one `placement` per artwork/viewport (width, left, top).
No secondary count, parent-card height or route availability enters its placement.
The original frame controls aspect ratio; the same image DOM node survives mode
changes, so routine count changes do not restart the primary-change animation.

| Artwork / viewport  | Multiple **and** single frame coordinates, CSS px      |
| ------------------- | ------------------------------------------------------ |
| Generic, 1024 × 768 | x 42, y 292, width 640, height 156                     |
| Generic, 1024 × 624 | x 106, y 204, width 590, height 143.8125               |
| A380, 1024 × 768    | x ≈38.0095, y 194, width ≈599.9905, height 296.421875  |
| A380, 1024 × 624    | x ≈221.0012, y 121, width ≈479.9988, height 237.140625 |

**Measured delta is exactly 0** for all coordinates in both transition directions,
also at 1112 × 834. Full precision is in [checks.json](checks.json). Corresponding
screenshots are `generic-multiple-to-single-*`, `generic-single-to-multiple-*`,
`a380-multiple-to-single-*` and `a380-single-to-multiple-*` in this directory.

## Route timing

See the [separate route investigation](../STAGE_3_ROUTE_TIMING.md). The existing
enricher already attaches cached routes to secondary records, but the old cards
never displayed them. The new cards render those validated fields immediately.
No requests, caching rules, priorities, identifiers, validation or TTLs were changed.

Uncached secondary aircraft still do not initiate lookups. Missing primary models
use an identity-first lookup, then the shared 30-second gate; negative results and
errors can delay later attempts. Routes arriving asynchronously are published
immediately, retained across matching aircraft-role/position changes, and excluded
after callsign changes/expiry. Controlled tests cover these cases. No household
latency frequency or provider reliability measurement is claimed.

## Verification

- **163 automated tests pass**, including all inherited tracking/selection,
  provider, sessions/PIN, sleep/wake, diagnostics, cooldown and mounted-soak cases.
  Four new tests cover secondary route hierarchy/shortening and route-cache timing,
  role handover, expiry, flight mismatch and unchanged lookup counts.
- **13 compiled plain-Node ESM HTTP checks pass**, with no server source changes.
- **72 browser layout cases pass** at 1024×768, 1024×624 and 1112×834, including
  complete/partial/missing data, one/two/three secondary cards, unknown records,
  long models/airport labels and wide codes. They check text/route/metric separation,
  readable minimum sizes, no scroll/clipping, and decoded artwork alpha clearance.
- **Six bidirectional transition scenarios** (12 mode changes) prove zero image
  movement and no remount. Late secondary route appearance also leaves art fixed.
- **51 inherited browser layouts and functional checks pass**, including actual-ID
  handover, PNG fallback, live rendering after enrichment, diagnostics export and
  unchanged 15-second polling. The cloud fallback expectation was intentionally
  removed; one aircraft image remains. PIN/sleep pixels match accepted Stage 2D at
  all three sizes; screenshot evidence is included above.
- Radar centring/visibility, real production animation duration, reduced motion
  and separate outage state are checked at all three sizes. Current app fixtures
  request **zero cloud assets and zero APIs**; functional API tests use mocks.
- ESLint, TypeScript/NodeNext, default build and all-feature Safari 15 build pass.
  Source image bytes/checksums, selection, positional/enrichment services, request
  budgets, authentication, observation configuration, quiet hours and deployment
  configuration are unchanged. No new package or infrastructure was introduced.

The historical `stage3a-final-composition-check.mjs` entry forwards to the current
readability check. Older Stage 3A visual reports/images are historical baselines,
not assertions that the intentionally replaced secondary cards must remain alike.

## Review and remaining acceptance

No material Air 2 hardware compromise was identified. Compact layouts use the
documented smaller fonts, and multiple-mode primary metadata omits visual labels
to protect space for type/routes. Airport names retain existing two-line truncation;
the actual three-letter route codes remain intact. The generic illustration remains
the approved placeholder for all non-A380 aircraft; it does not claim their true shape.

All evidence is desktop Chromium plus explicit Safari 15 build/source checks,
**not new physical iPad verification**. The user must review sofa-distance text,
compact browser-chrome height, contrast, real-world long names and prolonged
sleep/wake/thermal/memory behaviour on the Air 2. No hosted Preview was created or
modified to obtain this evidence. Household Production, credentials, observation
point, aliases and Vercel Git integration were untouched. PR #5 remains draft/unmerged.

## Local reproduction

Run the current branch on loopback :5173 with public live/enrichment/diagnostics/
appliance flags enabled and **server providers disabled**. Use an isolated `b22a5c2`
checkout on :5176, with the same current fixture harness but its original app/styles,
and accepted Stage 2D `8031a76` on :5175. Permit a symlinked dependency target only in
temporary baseline Vite filesystem settings so fonts load. No private coordinates
or real provider access are required.

```sh
AERO_LIVE_ENABLED=false AERO_ENRICHMENT_ENABLED=false \
VITE_AERO_LIVE_ENABLED=true VITE_AERO_ENRICHMENT_ENABLED=true \
VITE_AERO_DIAGNOSTICS_ENABLED=true VITE_AERO_APPLIANCE_ENABLED=true \
npm run dev -- --port 5173 --strictPort
```

Open `/qa-stage3a.html?scenario=readability-multiple`, `readability-single`,
`readability-partial`, `readability-two`, `readability-wide` or `long-names`.
The fixture entry is excluded from normal production builds.

```sh
PERCH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/stage3-readability-check.mjs
PERCH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/stage3a-browser-check.mjs
PERCH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/stage3-readability-gallery.mjs
```

Playwright/Chromium are external test tools, not application dependencies. Standard
checks remain `npm test`, `npm run lint`, `npm run build`, then the build with the
four public flags above enabled. These commands do not authorise a deployment.

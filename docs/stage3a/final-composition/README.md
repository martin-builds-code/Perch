# Approved Composition B — final application implementation

Historical record of `8669b10`. The subsequently authorised fallback, artwork
spacing and radar changes are documented in the
[current visual-corrections report](../visual-corrections/README.md). The screenshots
below are retained as the previous baseline; current verification uses that report.

Baseline: `19c2518f42f5151aee30b0b06de6337759f97a00` on
`stage-3a-display-redesign`, [Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5).
The user approved the Aircraft-led composition. It is now the actual application
layout for the two supplied artwork assets when secondary aircraft and a complete
reliable route are present. The A/B/C query switch, temporary review stylesheet
and old generation script have been removed. Archived comparison images remain.

## Final screenshots

| Subject                                    | 1024 × 768                             | 1024 × 624                             |
| ------------------------------------------ | -------------------------------------- | -------------------------------------- |
| A380, multiple aircraft                    | [Screenshot](a380-1024x768.png)        | [Screenshot](a380-1024x624.png)        |
| Generic narrow-body, multiple aircraft     | [Screenshot](a320-1024x768.png)        | [Screenshot](a320-1024x624.png)        |
| A380, no secondary aircraft                | [Screenshot](single-1024x768.png)      | [Screenshot](single-1024x624.png)      |
| Generic narrow-body, no secondary aircraft | [Screenshot](a320-single-1024x768.png) | [Screenshot](a320-single-1024x624.png) |

The multi-aircraft A380 screenshots are **pixel-identical** to the approved
`composition-review/B-1024x768.png` and `B-1024x624.png`. The tail still rises into
the natural gap between the airport codes. No additional separation was inserted.
Its framed widths are 640px and 480px, with the approved 76px / 72px code sizes
for AMS → MAN. Wide-letter routes fit within the same protected columns.

The generic narrow-body has its own 640px / 590px framed widths and a lower,
panoramic placement, with independent clouds underneath. It does not borrow the
A380 tail position. Its proportions, endpoints and text clearance are verified at
both heights and at 1112 × 834. All screenshots use synthetic data; the generic
picture represents the aircraft family rather than an exact aircraft/livery.

## Maintainable presentation contract

`src/artwork/manifest.json` adds optional `multiAircraft.regular` and `.compact`
placements to each approved asset. Each supplies width, left and top in CSS pixels
relative to the card. Compact applies at heights up to 650px. Framed height derives
from the existing asset frame aspect ratio. CSS constrains the SVG viewport to
card bounds, and its unchanged `preserveAspectRatio="xMaxYMax meet"` keeps scaling
uniform. The two current source frames and all image bytes are unchanged.

These profiles are presentation metadata on already-selected artwork. They never
identify aircraft, affect routes or change selection. Adding a future illustration
requires no aircraft-ID branches in dashboard code. Unconfigured illustrations
retain the safe original layout until a profile is visually reviewed. See the
[artwork installation contract](../../artwork/README.md).

The route is real HTML, using the same Barlow Condensed font. Existing airport-code
validation is unchanged. A small effect measures two codes after font readiness
and on route changes/resize; it uses primitive dependencies and no React state,
timer, observer loop or network request. Very wide codes fit uniformly. Original
17px / 15px airport-name fonts are retained, with the approved two-line ellipsis
and full names in their existing titles/DOM. The listener and pending callback
clean up on layout changes/unmount. Environments without the Font Loading API keep
the CSS default rather than throwing; Safari 15 supports that API.

## Verification results

- **155 automated tests pass**, including two new tests for profile opt-in,
  complete-route/multiple-aircraft conditions and preserved single/default layouts.
  All approved artwork checksum/dimension checks pass. The inherited 30-cycle
  mounted simulation soak, selector, provider, freshness, enrichment, diagnostics,
  cooldown, authentication and quiet-hours tests remain intact.
- **13 compiled plain-Node server HTTP checks pass.** No server module was edited.
- **18 final-composition browser cases pass:** both silhouettes × normal,
  wide-letter and long-airport routes × 1024×768, 1024×624 and 1112×834. Assertions
  cover full image-frame containment, uniform proportions, no page scrolling,
  code/number overflow, unchanged name fonts and fixed surrounding geometry/pixels.
  Aircraft and cloud alpha greater than 8/255 stay outside a 6px guard around
  every rendered text line. Nearly transparent source noise is excluded from that
  clearance mask; no source pixels are modified or cropped by it.
- **39 baseline pixel comparisons pass:** both expanded single-aircraft layouts,
  missing/ICAO-only route, empty, unavailable and unillustrated model/name states at
  all three sizes. Baseline application/style source is `19c2518`; the same synthetic
  harness is used on both sides to exercise the added narrow-body scenarios.
- Browser lifecycle checks exercise resize, 60 same-ID refreshes per viewport,
  stable route DOM, one fitting listener without accumulation, single/multiple
  changes and unmount cleanup. Old A/B/C query parameters have no visual effect.
- **51 inherited browser layouts pass**, plus PNG fallback, actual-ID transitions,
  reduced motion, live multi-aircraft rendering after late route enrichment,
  diagnostics export and unchanged 15-second polling. PIN and sleeping pixels remain
  identical to accepted Stage 2D at all three sizes, with normal wake/settings and
  no sleeping positional requests. All APIs are mocked; no provider calls occur.
- ESLint, TypeScript/NodeNext, default production build and live/enrichment/
  diagnostics/appliance-enabled production build pass, still targeting Safari 15.

Evidence: [final browser checks](checks.json), [inherited browser checks](../browser-checks.json).
The original strict rectangular artwork-region check remains for unconfigured
layouts; the final composed layouts use the stronger visible-silhouette check so
transparent canvas can share space naturally with the route.

## Boundaries and compatibility

No changes to tracking, selection, enrichment, airport validation, request budgets,
authentication, quiet hours, operational states, primary-change animation or
secondary hierarchy. The header, brand, measurement panels, secondary cards and
footer retain their pixels in direct comparisons. All source artwork/cloud PNGs
and WebPs remain byte-identical. No packages or paid infrastructure were added.
The route fitter does two text measurements per relevant event, not per polling
tick; its canvas is temporary. No image prefetch/history or extra provider traffic.

CSS uses ordinary absolute positioning, existing grid/flex, custom properties,
`min`/`calc` and Safari-supported prefixed two-line clamping. SVG image fallback and
font APIs are supported by Safari 15. This is source/build assessment and desktop
Chromium evidence, **not physical iPadOS/Safari testing**.

**Ready for a separately authorised, isolated physical iPad Preview.** Outstanding
checks on the Air 2 / iPadOS 15.8.5 are room-distance readability, actual WebP/font
decoding, browser-chrome compact height, transitions, sleep/resume and prolonged
memory/performance. Long names remain deliberately truncated to two lines in the
multi-aircraft route block. New artwork silhouettes require their own visual
clearance review. No material visual/hardware compromise was introduced.

No deployment, merge, Vercel Git reconnection, live configuration change, Production
change or M24 modification occurred. Main remains at accepted Stage 2D
`8031a76d0a24e1bb4ba88febd87d9a9c15ff2166`. ChatGPT Work retains Preview/release
coordination after source review.

## Local reproduction

Run `npm test`, `npm run lint` and `npm run build`. For the feature-enabled build:

```sh
VITE_AERO_LIVE_ENABLED=true VITE_AERO_ENRICHMENT_ENABLED=true \
VITE_AERO_DIAGNOSTICS_ENABLED=true VITE_AERO_APPLIANCE_ENABLED=true npm run build
```

Start a loopback Vite server with those public flags and server providers disabled:

```sh
AERO_LIVE_ENABLED=false AERO_ENRICHMENT_ENABLED=false \
VITE_AERO_LIVE_ENABLED=true VITE_AERO_ENRICHMENT_ENABLED=true \
VITE_AERO_DIAGNOSTICS_ENABLED=true VITE_AERO_APPLIANCE_ENABLED=true \
npm run dev -- --port 5173 --strictPort
```

Open `/qa-stage3a.html?scenario=a380`, `a320`, `single` or `a320-single`. Wide-code
and long-name scenarios exist for each asset in `tests/fixtures/stage3a-harness.tsx`.
The QA entry is not emitted by a normal build; `/` uses the same actual components,
stylesheet and manifest without a composition flag.

`scripts/stage3a-final-composition-check.mjs` uses optional Playwright Core/Chromium,
this branch on :5173 and accepted `19c2518` application source on :5176. Copy the
current synthetic harness to the baseline checkout so the additional narrow-body
scenarios are identical; leave baseline application/style files unchanged.
`scripts/stage3a-browser-check.mjs` also uses accepted Stage 2D `8031a76` on :5175.
All three servers use the same flags, with providers disabled. If dependencies are
symlinked, permit the dependency target in the temporary baseline's Vite
`server.fs.allow` so the original font loads; no app security change is required.

```sh
PERCH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
node scripts/stage3a-final-composition-check.mjs
PERCH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
node scripts/stage3a-browser-check.mjs
```

`PERCH_CHROMIUM` selects an alternative Chromium executable for the final check.
Browser tooling remains outside application dependencies. An isolated Preview is
not created or authorised by these local instructions.

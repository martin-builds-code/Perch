# Multi-aircraft composition review

**Historical review archive:** the user subsequently approved B. It is now
[implemented in the application](../final-composition/README.md). The original
comparison images and measurements below are preserved; the temporary composition
query switch, review CSS and old generation script have been removed.

Review baseline: `451fec765bb1dd92bf9ae0d8ae254de5badedef1`, on
`stage-3a-display-redesign`, Draft [PR #5](https://github.com/martin-builds-code/Perch/pull/5).
This archive records the three alternatives before selection. At that review
commit application source/build behavior remained unchanged. Nothing was deployed.

## Compare the alternatives

Open the [side-by-side HTML gallery](index.html) locally, or use the contact sheets:
[1024 × 768](comparison-1024x768.png) and [1024 × 624](comparison-1024x624.png).
Each column contains the same synthetic A380, AMS → MAN, measurements, secondary
aircraft, assets and status. Individual screenshots retain their original CSS
pixel dimensions; browser/device scale factor is 1. The old composition is included
for comparison at [768px](baseline-1024x768.png) and [624px](baseline-1024x624.png).

| Alternative          | 1024 × 768                                               | 1024 × 624                                               | Assessment                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Balanced**     | [Screenshot](A-1024x768.png); 600px aircraft, 80px codes | [Screenshot](A-1024x624.png); 448px aircraft, 76px codes | A broad aircraft and strong route share attention. More breathing room than B, while filling much more of the original central/lower void.                                                    |
| **B — Aircraft-led** | [Screenshot](B-1024x768.png); 640px aircraft, 76px codes | [Screenshot](B-1024x624.png); 480px aircraft, 72px codes | Largest aircraft, extending left through the lower card. Route remains prominent. Least unused central space; closest visible approach to the lower identity labels, with clearance verified. |
| **C — Route-led**    | [Screenshot](C-1024x768.png); 536px aircraft, 94px codes | [Screenshot](C-1024x624.png); 420px aircraft, 88px codes | Boldest route and a more generous upper-left text area. Aircraft remains much larger than before at full height, but leaves more navy space and loses some impact at compact height.          |

**Recommendation: B**, because the aircraft is the dominant focal point and the
route is still legible at household viewing distance. This is a recommendation
for artistic review, not an application default or a final choice.

The old A380 frame is approximately 375px wide at 768px height and 378px at 624px.
The new full-height aircraft widths increase by approximately **60% / 71% / 43%**
for A/B/C; uniform scale increases visible area correspondingly. Original IATA
codes are 54px at both viewports. New AMS/MAN fonts increase by **48% / 41% / 74%**
at full height and **41% / 33% / 63%** at compact height.

At 624px, the primary card is only 326px tall. The illustrations therefore move
rightwards and slightly upwards and use smaller sizes than their 430px-tall card
counterparts. B still increases the aircraft width by about 27%; C prioritises
route readability and increases it by about 11%. This is the principal compact
height compromise. None of the variants changes the card, metrics, secondary
panels, header or footer dimensions.

## Composition and remaining visual concerns

The card is one layered composition rather than a 44% text / 56% art grid. Route
columns reserve only the space needed for three letters. Transparent aircraft
space can share the surrounding region, while **visible** artwork keeps clear of
text. The existing renderer, manifest framing, aircraft mapping, image bytes and
independent cloud layer are unchanged. The full framed aircraft remains inside
the card, at its original aspect ratio; no tail, wing, engine or nose is cropped.

Codes share a baseline and the arrow is centred on their line. The self-hosted
Barlow Condensed font is unchanged. Very wide combinations such as MMW → WWK fit
the reserved columns through a measured, uniform code-font adjustment; the three
experiments retain distinct sizes. This adjustment never shrinks airport names or
changes aircraft scale. Airport names retain the existing **17px / 15px** fonts
and are limited to two lines; unusually long names are ellipsised, with the full
name retained in the existing title/DOM. Destination names align right. These are
explicit review tradeoffs to avoid allowing long names to displace the artwork.
Normal AMS/MAN names are fully visible.

For stress evidence, each variant also has `*-wide-codes-1024x*.png` and
`*-long-airports-1024x*.png` screenshots in this directory. Long names and wide-code
fixtures are synthetic layout tests, not assertions of verified flight routes.
The tail rises into the transparent gap between the route endpoints at full
height; small changes to future artwork would require a fresh silhouette review.
These placements are deliberately limited to the supplied **A380 review fixture**,
not a proposed universal arrangement for every artwork shape.

Direct comparison against the actual approved dashboard mockup remains outstanding
because it was not supplied with the artwork pack. The three alternatives follow
the written composition refinement. Physical iPad / room-distance review and final
artistic selection remain outstanding.

## Verification

- **18 new browser layout checks:** A/B/C × both heights × normal, wide-code and
  long-airport routes. All pass silhouette/text separation, complete image-frame
  containment, aspect ratio, code/number overflow, no scrolling and unchanged name
  fonts. Header, measurement, secondary and footer pixels match the unmodified
  default for every case; their geometry and the bottom identity row also match.
- Collision checks decode the actual displayed WebP alpha channel. Every rendered
  text-line rectangle has a **6 CSS pixel guard** against aircraft/cloud pixels
  with source alpha greater than 8/255 (including faint edges, excluding nearly
  invisible source noise). This checks useful silhouette clearance instead of
  forbidding transparent rectangles from intersecting. Screenshots are also
  visually reviewed; a passing mask check alone is not artistic acceptance.
- **42 pixel-identical checks:** A/B/C at both sizes leave the single-aircraft,
  empty, unavailable, missing-route, ICAO-only, A320 and Challenger fixtures
  unchanged. Resize refits wide codes. Fixture tests make **zero API/provider
  requests** and assert no browser errors.
- Inherited **153 automated tests and 13 compiled plain-Node HTTP checks** pass.
  Existing **51 browser layouts** and additional artwork fallback, ID transition,
  reduced-motion, live/enrichment/export, polling and quiet-hours checks pass.
  PIN/sleeping pixels match accepted Stage 2D at all three inherited sizes.
- ESLint, TypeScript/NodeNext, default and all-feature production builds pass.
  Both builds still target **Safari 15**. The review stylesheet/switch and QA HTML
  are excluded from the production output. Source assets are unchanged.

Machine-readable evidence: [checks.json](checks.json). Inherited evidence remains
in [browser-checks.json](../browser-checks.json). This is desktop Chromium and
build/source compatibility evidence, **not physical iPad or Safari verification**.
The review uses ordinary absolute positioning, custom properties, SVG uniform
scaling, canvas text measurement, `document.fonts.ready`, resize listeners and
Safari-supported prefixed two-line clamping. No new runtime dependency, polling
timer, animation, network service or provider request is introduced.

## Historical reproduction

```sh
AERO_LIVE_ENABLED=false AERO_ENRICHMENT_ENABLED=false \
VITE_AERO_LIVE_ENABLED=true VITE_AERO_ENRICHMENT_ENABLED=true \
VITE_AERO_DIAGNOSTICS_ENABLED=true VITE_AERO_APPLIANCE_ENABLED=true \
npm run dev -- --port 5173 --strictPort
```

Open `/qa-stage3a.html?scenario=a380&composition=A`, replacing A with B or C.
For comparison, omit `composition`. Use `scenario=wide-codes` or
`scenario=long-airports` for stress fixtures. There is no layout selector in the
application; the main entry ignores this parameter. CSS overrides are imported
only by the existing development harness. `tests/fixtures/composition-review.css`
contains all composition sizes/positions; the harness cleans up its measurement
listener and temporary document attributes when the fixture changes/unmounts.

With optional Playwright Core and Chromium installed outside the app dependencies:

```sh
PERCH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
node scripts/stage3a-composition-check.mjs
```

`PERCH_CHROMIUM` can select a Chromium executable. This command regenerates the
screenshots, side-by-side contact sheets and evidence JSON. The inherited browser
suite also needs an accepted `8031a76` checkout on :5175 with identical public
flags and server providers disabled. If its `node_modules` is a symlink, permit
that target in the **temporary baseline's** Vite `server.fs.allow` so its font
loads; do not change application security settings. The baseline source remains
unchanged.

The commands above describe the archived `19c2518` review commit, where the old
switch/script still exist. For the current application and verification commands,
use the [final composition report](../final-composition/README.md).

# Stage 3A — fallback, composition and radar corrections

Historical record of `b22a5c2`. The [approved readability revision](../../stage3-readability/README.md)
supersedes the count-dependent composition and cloud-rendering expectations below.
Images and results here remain evidence for that earlier commit.

Source baseline: `8669b10be0dc3679d589bb1e5d7946a9c294c949`.
Branch: `stage-3a-display-redesign`, [Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5).
These are targeted corrections to the existing Composition B interface. No
deployment, merge, Vercel configuration/credential change or Production change.
The existing isolated Preview has not been modified.

## Fresh screenshots

| State                                              | 1024 × 768                                | 1024 × 624                                |
| -------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| A380, multiple aircraft                            | [View](a380-1024x768.png)                 | [View](a380-1024x624.png)                 |
| Generic jet, multiple aircraft                     | [View](a320-1024x768.png)                 | [View](a320-1024x624.png)                 |
| Generic jet, single aircraft                       | [View](a320-single-1024x768.png)          | [View](a320-single-1024x624.png)          |
| No nearby aircraft                                 | [View](empty-1024x768.png)                | [View](empty-1024x624.png)                |
| Generic jet, multiple, route missing               | [View](a320-no-route-1024x768.png)        | [View](a320-no-route-1024x624.png)        |
| Generic jet, single, route missing                 | [View](a320-single-no-route-1024x768.png) | [View](a320-single-no-route-1024x624.png) |
| Boeing 777 identity with generic placeholder       | [View](b777-1024x768.png)                 | [View](b777-1024x624.png)                 |
| ALPI Pioneer 330 identity with generic placeholder | [View](pioneer-1024x768.png)              | [View](pioneer-1024x624.png)              |
| Incomplete identification / simulation scene       | [View](demo-incomplete-1024x768.png)      | [View](demo-incomplete-1024x624.png)      |

All aircraft data is synthetic. Images retain the supplied aircraft and cloud
bytes; no artwork was created, cropped anew, repainted or recompressed.

## What changed and why

**Fallback:** previously only the A380 and recognised narrow-body families selected
artwork. The current policy explicitly selects the A380 for an identified Airbus
A380, and the existing generic jet for every other record, including unknown or
incomplete identification. Boeing 777, Airbus A320neo and ALPI Pioneer 330 are
covered directly. The manufacturer/model text always remains the actual data;
the generic picture is a visual placeholder, not a type, livery or operator claim.
Asset approval/path/frame safety checks and WebP → PNG error fallback remain.

**Composition:** source inspection established that the improved multi-aircraft
placement was conditional on a complete route. Missing routes therefore reverted
to the older layout. Aircraft and clouds also fitted separate SVG viewBoxes into
independently positioned rectangles, allowing their scale and separation to diverge
as available height changed. Single-aircraft artwork was aligned at the bottom of
its large available region, explaining the empty centre and crowded lower row.
These findings are from baseline source and local fixtures, not a hosted/iPad trace.

The multi-aircraft placement now applies regardless of route availability. The two
independent SVG image layers use a shared outer composition canvas and alignment;
their original source frames remain nested, intact viewports. Uniform scaling now
moves/scales the plane and clouds together. Manifest placement profiles bound the
available rectangle with width/left/top/bottom, rather than fixing a plane at the
top and a cloud at the bottom separately. The operator line is constrained to the
protected information width, so a long name cannot claim extra illustration space.

Composition B's A380 tail still rises into the route-code gap. Its regular framed
width is 600px (about 6% below the previous 640px), retaining roughly 87% of the main
card's width while making room for text clearance. Its compact width remains 480px.
The generic remains 640px regular / 590px compact in the multiple-aircraft layout.
The single generic remains about 654–660px wide and the complete aircraft/cloud
composition is centred vertically between flight information and the lower row,
with additional bottom margin. The correction does not rely on making it small.

**Radar:** diameter increases from 66px to 220px (3.3×). Its existing colours,
opacity and quiet 16-second sweep are retained. It is centred within the available
content area and honours reduced motion. A true outage retains its separate state;
PIN and quiet-hours sleeping screens are unchanged.

## Verification

- **159 automated tests pass**, including all inherited provider, selector,
  polling, enrichment, diagnostics, authentication, quiet-hours and 30-cycle mounted
  simulation soak coverage. New/updated cases cover the universal placeholder,
  incomplete identity, unchanged real model text, route-independent composition,
  shared image canvas and byte-identical supplied assets.
- **13 compiled plain-Node ESM HTTP checks pass.** No server source/import change.
- **69 alpha-aware browser layouts:** 23 scenarios at 1024×768, 1024×624 and
  1112×834. Both silhouettes, requested fallback models, unknown records, missing
  routes, single/multiple layouts, long headers, wide codes and long airport names.
  Checks cover no scroll/overflow/clipping, uniform shared transforms, dominant
  image widths, close aircraft/cloud composition, a 6px guard around rendered text
  and at least 12px from visible art/clouds to the information-row text. Single
  generic fixtures retain at least 40px clearance and at least 650px framed width.
- Header, measurement, secondary and footer pixels match the baseline in every
  aircraft scenario. Actual identity text is not replaced by the placeholder's name.
- **Three radar/outage checks** verify 220px dimensions, centring and bounds,
  the actual 16-second production animation, reduced-motion suppression and the
  distinct unavailable state. Radar screenshots freeze a representative angle.
- Listener/DOM lifecycle checks exercise 60 routine updates per viewport, resize,
  single/multiple transitions and cleanup. Fixture tests make no API/provider calls.
- **51 inherited browser layouts and functional browser checks pass**, including
  PNG fallback, primary-ID transitions, reduced motion, live rendering after late
  enrichment, private diagnostic export and unchanged 15-second polling. Sleeping
  and PIN pixels match accepted Stage 2D at all three landscape sizes.
- ESLint, TypeScript/NodeNext, default production build and all-feature Safari 15
  build pass. No new runtime dependency or paid infrastructure.

Evidence: [current geometry/alpha/radar results](checks.json) and
[inherited browser results](../browser-checks.json). Text guards use decoded source
alpha >8/255, including faint edges but excluding nearly transparent source noise;
the assets themselves are unchanged. Layout screenshots are visually reviewed as
well as measured. These checks establish local rendering, not physical iPad approval.

## Boundaries and limitations

No changes to aircraft selection, live positional/enrichment requests, cadence,
data freshness/expiry, authentication, quiet hours, transition policy, provider
budgets, public configuration or secrets. The original six artwork assets and
their checksums are unchanged. Two images remain independently replaceable; see
the [updated artwork contract](../../artwork/README.md).

The universal generic jet intentionally does not represent the true shape of every
aircraft. Long airport names still use the previously accepted two-line truncation.
Safari 15 compatibility is assessed from the explicit build target and supported
SVG/CSS techniques (nested SVG viewports, uniform `meet` scaling, positioning,
grid/flex and reduced motion). No new browser API is introduced by these fixes.
Physical Air 2 / iPadOS 15.8.5 readability, decoding, animation and extended memory
behaviour remain user acceptance checks. Neither desktop Chromium nor local builds
establish hosted Vercel or physical WebKit verification.

## Reproduce locally

Start the current branch on loopback :5173 with public live/enrichment/diagnostics/
appliance flags enabled and server providers disabled, as described in the
[Stage 3A report](../../STAGE_3A_REVIEW.md). Use `/qa-stage3a.html?scenario=a380`,
`a320`, `a320-single`, `empty`, `b777`, `pioneer`, `a320-no-route` or `demo-incomplete`.
There is no composition selector or new routine user control.

The current `scripts/stage3a-final-composition-check.mjs` compares against an
isolated `8669b10` application checkout on :5176 with the **same current synthetic
harness**, leaving baseline application/style files unchanged. The inherited
`scripts/stage3a-browser-check.mjs` also uses accepted Stage 2D `8031a76` on :5175.
All servers use identical public flags; server providers are disabled and every
API in the functional browser checks is mocked. A symlinked dependency directory
must be allowed in the temporary baseline's Vite filesystem settings so fonts load.

```sh
PERCH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
node scripts/stage3a-final-composition-check.mjs
PERCH_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
node scripts/stage3a-browser-check.mjs
```

`PERCH_CHROMIUM` optionally selects a Chromium executable for the final-composition
check. Browser tooling is external to application dependencies. Run `npm test`,
`npm run lint`, `npm run build` and the all-feature build documented in Stage 3A.
No deployment is included in these instructions. The user separately reviews the
design on the physical iPad before any further deployment approval.

# Primary airline/operator readability

Development baseline: `7b446435a8eff825c11e21ab109429db33a52658` on
`stage-3a-display-redesign`, verified clean locally and on open Draft PR #5.
This refinement changes only the primary information row and its presentation.

Operator now precedes direction and callsign. The existing airline/operator value
is trimmed for display; missing/blank values are omitted. No airline inference,
source normalization, provider, route or enrichment policy has changed.

| Primary value | Regular landscape | Compact landscape |
| --- | --- | --- |
| Airline, single aircraft | **44px Nunito, 900, white** (previously 26px muted) | **40px** (previously 24px muted) |
| Direction, single aircraft | 44px | 40px |
| Callsign with airline, single aircraft | 28px, subordinate muted text | 26px |
| Airline, multiple aircraft | **32px Nunito, 900, white** (previously 20px) | **30px** (previously 18px) |
| Direction, multiple aircraft with airline | 24px | 22px |
| Callsign with airline, multiple aircraft | 16px, subordinate muted text | 15px |
| Airline longer than 22 characters, multiple | 34px Barlow Condensed | 32px Barlow Condensed |
| Airline longer than 45 characters, multiple | 30px Barlow Condensed, full row width | 30px Barlow Condensed, full row width |
| Airline longer than 45 characters, single | 42px Barlow Condensed, can wrap | 38px Barlow Condensed, can wrap |

Names up to 22 characters retain Nunito; longer names use the existing condensed
font where needed. Long names sacrifice the multiple-mode callsign first; names
over 45 characters use the whole compact row, omitting direction and callsign
visually in multiple mode. Both remain visible in single mode. Their original
values stay in the data/DOM; no identity or movement information is invented.
Missing operators restore the previous large 44/40px single-mode callsign and
direction, with both fields sharing the available width.

The 59-character test name, “Northern Isles Regional Air Services Demonstration
Operator”, fits completely in both sizes. Descriptions beyond the row's available
width retain the established ellipsis/title fallback in multiple mode rather than
shrinking into unreadable text; the full supplied value remains in the title.
Arbitrarily long corporate descriptions cannot all be sofa-readable inside one
fixed row. Single mode wraps names instead. Physical viewing remains the final
readability acceptance test.

The operator row uses a slightly lower multi-aircraft baseline to retain at least
six CSS pixels between decoded visible artwork and text. Aircraft artwork position,
scale and identity-based transitions are unchanged. Primary name, route codes,
metrics, secondary cards, palette, footer, cloud-free presentation and radar are
untouched. No new font, animation, dependency, resize loop or request is added.

## Before/after review

Both sides use identical synthetic data, exact viewports and the supplied A380.
Before uses the accepted baseline components; after uses this revision. These are
real component screenshots, not a flattened product interface or generated art.

| Layout | 1024 × 768 | 1024 × 624 |
| --- | --- | --- |
| Single aircraft, before/after | [Compare](comparison-single-1024x768.png) | [Compare](comparison-single-1024x624.png) |
| Multiple aircraft, before/after | [Compare](comparison-multiple-1024x768.png) | [Compare](comparison-multiple-1024x624.png) |
| Long airline, single | [View](long-single-1024x768.png) | [View](long-single-1024x624.png) |
| Long airline, multiple | [View](long-multiple-1024x768.png) | [View](long-multiple-1024x624.png) |
| Missing airline, single | [View](missing-single-1024x768.png) | [View](missing-single-1024x624.png) |
| Missing airline, multiple | [View](missing-multiple-1024x768.png) | [View](missing-multiple-1024x624.png) |
| Long aircraft name, complete route | [View](long-model-multiple-1024x768.png) | [View](long-model-multiple-1024x624.png) |

[HTML comparison sheets](review.html) · [Measured checks](checks.json).
The development-only `qa-operator.html` and fixture render the real `Display`.
Run `scripts/operator-browser-check.mjs` against local ports 5173 (current) and
5178 (baseline), with the same fixture entry in the baseline. Browser tooling is
external to runtime dependencies. The temporary baseline's Vite filesystem allow
list includes its shared local dependency directory so it loads the same Nunito
font; this test-only setting is not a repository or deployment-config change.

## Verification

- **195 automated tests pass**, including ten new single/multiple, short/long,
  absent/blank operator tests and all inherited scheduler/auth/selection checks.
- **13 compiled plain-Node ESM HTTP checks pass.**
- **52 operator layouts** pass at 1024×768 and 1024×624, using A380 and generic
  aircraft, no operator, easyJet, Ryanair, British Airways, KLM Royal Dutch Airlines,
  the long name above, and a long Challenger description with a complete route.
- Surrounding header/route/metric/secondary pixels and geometry match the baseline.
  No scrolling, unintended truncation of tested airline/direction/callsign values,
  or decoded artwork/text collision with a six-pixel guard.
- **Four bidirectional artwork transitions** (eight count changes) retain the same
  image node and exactly the same coordinates/scale. Existing 72-layout/six-transition
  readability, 51-layout Stage 3 and secondary-enrichment browser suites pass.
- ESLint, TypeScript/NodeNext, default and all-feature Safari 15-targeted builds pass.
  Nunito/Barlow, static CSS/grid and existing browser features are retained.
- The first trial's close text/artwork spacing was corrected without moving art.
  An initial comparison used a baseline with a blocked Nunito file; that baseline
  setup was repaired before the successful pixel comparisons and review screenshots.

No scheduler, server, authentication, private coordinates, quiet-hours, provider
budget or secondary-card source changed. The existing 90-second collective
secondary interval, 30-second global interval, single-flight behavior and primary
priority remain in the passing suite. No real aviation-provider calls were used
for local verification. Physical Safari 15/iPad sofa-distance acceptance remains
outstanding; desktop Chromium does not establish physical readability.

The user authorised deployment of the tested commit to the existing isolated
Stage 3A **Preview** and reassignment of only `perch-aero-pane-stage3a.vercel.app`.
No merge, household Production change, Git integration or new infrastructure is
permitted. Deployment/alias results are reported separately after live checks.

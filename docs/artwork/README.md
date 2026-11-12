# Aero Pane artwork interface

The supplied `Aero_Pane_Artwork_Starter_v1.zip` remains the source of the accepted
images. No artwork was generated, repainted or recompressed. The original
[manifest](source-manifest.json), [house style](house-style.md) and
[verification](verification.json) retain dimensions, transparency evidence and
SHA-256 checksums; all six source hashes still match.

| Subject                          | Browser WebP / PNG fallback                 | Dimensions |
| -------------------------------- | ------------------------------------------- | ---------- |
| A380-800                         | `aeropane_a380_baseline.webp` / `.png`      | 1774×887   |
| Generic jet                      | `aeropane_generic_narrowbody.webp` / `.png` | 1600×800   |
| Legacy cloud strip, not rendered | `aeropane_cloud_strip_01.webp` / `.png`     | 1800×330   |

Files are in `public/aircraft/`, with same-origin `/aircraft/<filename>` URLs.
The readability revision renders **only the aircraft**, never the cloud layer.
Cloud metadata/files are retained to avoid unrelated archive changes; no cloud
resource is fetched by the current interface.

## Selection is presentation only

An identified Airbus A380 uses its approved illustration; every other aircraft,
including incomplete identity, uses the existing generic jet as an explicitly
approved placeholder. It does not claim their actual configuration, model, livery
or operator. Real manufacturer/model text is preserved. No callsign/registration
inference or runtime enrichment call is used to select a picture.

Asset approval, safe local paths, positive intrinsic dimensions and valid source
frames are checked. Exact current policy lives in `src/artwork.ts`; installing
additional illustrations or expanding this two-image policy requires separate
authorisation. This revision creates or requests none.

## One placement for all count modes

Each aircraft manifest entry in `src/artwork/manifest.json` supplies its source,
intrinsic dimensions, optional WebP and verified frame, plus one placement per
viewport. For the A380:

```json
"placement": {
  "regular": { "width": 600, "left": 18, "top": 94 },
  "compact": { "width": 480, "left": 205, "top": 33 }
}
```

Values are CSS pixels relative to the aircraft card. Compact applies at heights
up to 650px. The generic uses 640/590px widths and its own matching positions.
Height derives from the frame ratio; SVG `xMaxYMax meet` preserves proportions.
Neither secondary count, route availability nor expanded-card height affects the
placement. Single mode spends its extra space on supporting text rather than
moving/enlarging the illustration. The old `multiAircraft`/bottom/cloud-overlap
settings are superseded. Exact coordinates and zero-delta transition evidence are
in the [current review report](../stage3-readability/README.md).

Frames continue to describe verified source content bounds. Omit no important
features or guess a crop; current frames only remove transparent source padding.
All delivered image bytes stay unchanged. Future approved artwork can supply its
own viewport placements without adding a new dashboard or changing tracking logic;
it still requires silhouette/text-clearance and long-name review.

`AircraftArtwork.tsx` renders a single decorative SVG image viewport. WebP errors
fall back once to PNG; a failed PNG hides the optional illustration without
clearing aircraft data or retrying indefinitely. Images do not intercept touches.
Only the primary illustration is mounted, with no prefetch, image history, database,
asset polling or generation service. Browser caching reuses the source image.

## Verify changes

Run `npm test`, `npm run lint`, `npm run build`, the all-feature Safari 15 build,
`scripts/stage3-readability-check.mjs` and inherited
`scripts/stage3a-browser-check.mjs`, using the baseline setup documented in the
review report. The old `stage3a-final-composition-check.mjs` entry forwards to the
current readability check. Source checksum tests still cover all six files,
including the retained, unused cloud pair.

Review both silhouettes at 1024×768 and 1024×624, wider landscape, missing routes,
long names, secondary-count transitions, PNG fallback and reduced motion. Physical
Air 2 review remains separate. File/source installation never authorises deployment.

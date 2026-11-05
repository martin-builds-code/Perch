# Aero Pane artwork interface

The supplied `Aero_Pane_Artwork_Starter_v1.zip` is integrated as independently
replaceable static raster images. No artwork was generated, repainted or recompressed
by Codex. The original [manifest](source-manifest.json) and [house style](house-style.md)
are preserved; [verification.json](verification.json) records decoded dimensions,
alpha range, transparent-pixel counts, size and SHA-256. All six source hashes match.

| Subject             | Browser WebP / PNG fallback filename        | Dimensions |
| ------------------- | ------------------------------------------- | ---------- |
| Accepted A380-800   | `aeropane_a380_baseline.webp` / `.png`      | 1774×887   |
| Generic narrow-body | `aeropane_generic_narrowbody.webp` / `.png` | 1600×800   |
| Independent clouds  | `aeropane_cloud_strip_01.webp` / `.png`     | 1800×330   |

Actual files: `public/aircraft/`; browser URLs: `/aircraft/<filename>`.
Artwork never selects an airline/operator or changes aircraft identification. The
generic jet is now an explicitly authorised visual placeholder for **all aircraft
other than an identified Airbus A380**, including wide-bodies, helicopters, light
aircraft and incomplete/unknown records. It never changes their real identity text
or claims to depict their actual configuration or livery. A388 or a supported
readable A380 description selects the A380; otherwise the approved
`generic-narrow-body` manifest entry is used. No callsign/registration inference.

## Adding a type without changing the dashboard

The current correction task adds or requests **no artwork**. Any future expansion
of the two-image policy requires separate authorisation; the following is the
installation contract for that future work.

1. Obtain approved PNG/WebP artwork and provenance from the artwork project. Verify
   actual alpha transparency, dimensions and appearance on `#162E3E`, not merely
   the presence of an alpha channel. The current files were decoded using Pillow;
   every PNG/WebP has alpha extrema 0–255. Keep the delivered bytes unchanged.
2. Add files with lowercase, versioned names to `public/aircraft/`.
3. Add an entry to `src/artwork/manifest.json`, using actual dimensions:

   ```json
   {
     "id": "airbus-a350-900",
     "label": "Airbus A350-900",
     "approval": "approved",
     "typeCodes": ["A359"],
     "src": "/aircraft/airbus-a350-v1.png",
     "webp": "/aircraft/airbus-a350-v1.webp",
     "width": 2048,
     "height": 1024
   }
   ```

   Omit `webp` when unavailable. Pending entries use `approval: "pending"`, null
   source and zero dimensions; they are never requested. The current policy has
   one type-specific exception, A388, followed by the universal generic entry.
   The legacy `families` metadata does not restrict that generic fallback.
   No registration/callsign association or runtime enrichment lookup is introduced.

4. Optional `frame: {"x":0,"y":0,"width":2048,"height":1024}` describes the
   verified visible-content bounds in source pixels. Omit it to display the whole
   raster. Current frames use the alpha bounding box: only transparent padding is
   removed. Do not guess a crop cutting wings, tail or engines. Invalid bounds fail
   validation. No source pixels are modified by this display framing.
5. Optional `multiAircraft` supplies silhouette-specific placement in the approved
   aircraft-led composition whenever secondary aircraft exist, with or without a route:

   ```json
   "multiAircraft": {
     "regular": { "width": 600, "left": 18, "top": 80, "bottom": 40 },
     "compact": { "width": 480, "left": 205, "top": 32, "bottom": 56 }
   }
   ```

   Values are CSS pixels relative to the primary card; compact applies at heights
   up to 650px. These are the corrected A380 settings, **not defaults for another
   silhouette**. `top` and `bottom` bound the available viewport, rather than
   independently positioning an aircraft and a cloud. Width caps the composition;
   the shared canvas is uniformly fitted inside the available rectangle. Both
   source frames stay intact. Aircraft and cloud layers remain independent.
   Optional `cloudOverlap` (A380 0.143, generic 0.09) specifies how far the cloud
   overlaps the aircraft frame, as a fraction of framed width. Its independent
   height derives from its own frame ratio. Omit `multiAircraft`
   to retain the safe original layout for a new/unreviewed asset. Single-aircraft
   layouts never consume this optional profile. No aircraft-type branches need to
   be added to the dashboard. Verify both supported landscape sizes and wider
   layouts, wide route codes and long names before approving a new placement.

6. Run tests/build, `scripts/stage3a-browser-check.mjs` and
   `scripts/stage3a-final-composition-check.mjs`. Inspect single/multiple
   layouts, image proportions, protected route area and actual Air 2 rendering.
   Future artwork work must preserve tracking/identification and the separately
   authorised fallback policy.

`AircraftArtwork.tsx` gives the two independent layers the **same outer SVG canvas**
and alignment. Nested source viewports retain their existing frames. Uniform
`meet` scaling keeps the aircraft and clouds together even when height is limiting;
single-aircraft layouts centre the whole composition vertically, while multiple
layouts align towards the lower-right. These remain supplied raster assets,
not newly drawn vectors. The cloud is an independent lower layer. The approved
A380 and generic narrow-body profiles share the multi-aircraft card with a compact
route region; actual visible silhouette clearance is verified with an alpha-mask
browser check and visual inspection. The A380 tail rises between the route codes;
the panoramic generic jet has its own lower, wider placement. No source transparency
is altered. Profiles are selected through the existing manifest asset mapping.
Unconfigured panoramic silhouettes (aspect ratio above 2.8) retain the full-width
lower region; taller unconfigured subjects use the original right-hand region.
WebP errors fall back once to PNG; failed PNG hides the optional layer without
clearing aircraft data or retrying indefinitely. Source dimensions exceed tested
display sizes. Artwork cannot intercept pointer input.

Only the current primary image/cloud are mounted, with no bulk prefetch, database,
asset polling, new timer or generation service. Browser caching reuses static
images. Version filenames when replacing content. File installation does not
authorise deployment; release authority remains separate.

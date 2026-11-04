# Aero Pane artwork interface

The supplied `Aero_Pane_Artwork_Starter_v1.zip` is integrated as independently
replaceable static raster images. No artwork was generated, repainted or recompressed
by Codex. The original [manifest](source-manifest.json) and [house style](house-style.md)
are preserved; [verification.json](verification.json) records decoded dimensions,
alpha range, transparent-pixel counts, size and SHA-256. All six source hashes match.

| Subject | Browser WebP / PNG fallback filename | Dimensions |
| --- | --- | --- |
| Accepted A380-800 | `aeropane_a380_baseline.webp` / `.png` | 1774×887 |
| Generic narrow-body | `aeropane_generic_narrowbody.webp` / `.png` | 1600×800 |
| Independent clouds | `aeropane_cloud_strip_01.webp` / `.png` | 1800×330 |

Actual files: `public/aircraft/`; browser URLs: `/aircraft/<filename>`.
Artwork never selects an airline/operator or changes aircraft identification. The
generic illustration is for narrow-body families, not an exact model or real livery.
It is not substituted for a helicopter, light aircraft, turboprop, business jet or
wide-body. Those layouts work with an unobtrusive illustration-unavailable state
until the artwork project supplies their assets.

## Adding a type without changing the dashboard

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
   source and zero dimensions; they are never requested. Exact ICAO type mappings
   win. The supplied generic entry uses `families: ["narrow-body"]`; known A380
   readable descriptions provide a bounded fallback when no type code is available.
   No registration/callsign association or runtime enrichment lookup is introduced.
4. Optional `frame: {"x":0,"y":0,"width":2048,"height":1024}` describes the
   verified visible-content bounds in source pixels. Omit it to display the whole
   raster. Current frames use the alpha bounding box: only transparent padding is
   removed. Do not guess a crop cutting wings, tail or engines. Invalid bounds fail
   validation. No source pixels are modified by this display framing.
5. Run tests/build and `scripts/stage3a-browser-check.mjs`. Inspect single/multiple
   layouts, image proportions, protected route area and actual Air 2 rendering.
   Adding an exact type needs no tracking, selection or dashboard changes.

`AircraftArtwork.tsx` places the raster in an SVG viewport with uniform
`preserveAspectRatio="xMaxYMax meet"` scaling. These remain supplied raster assets,
not newly drawn vectors. The cloud is an independent lower layer; flight text has
its own protected layout region and never relies on transparent pixels for safety.
Panoramic visible silhouettes (aspect ratio above 2.8) share the full-width lower
region used by single-aircraft layouts; taller subjects use the right-hand region.
This is a geometry rule, not a separate dashboard or a registration/type-specific layout.
WebP errors fall back once to PNG; failed PNG hides the optional layer without
clearing aircraft data or retrying indefinitely. Source dimensions exceed tested
display sizes. Artwork cannot intercept pointer input.

Only the current primary image/cloud are mounted, with no bulk prefetch, database,
asset polling, new timer or generation service. Browser caching reuses static
images. Version filenames when replacing content. File installation does not
authorise deployment; release authority remains separate.

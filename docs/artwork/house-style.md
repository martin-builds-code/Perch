# Aero Pane — Aircraft artwork house style (v1.0)

## Source of truth
- `artwork/aircraft/aeropane_a380_baseline.png` is the **untouched approved A380**, not a redraw. It defines the current paint scheme and dimensional rendering.
- `artwork/aircraft/aeropane_generic_narrowbody.png` is a **generic** twin-engine narrow-body class illustration, not a type-accurate Boeing 737 or Airbus A320 or a real operator.
- `artwork/clouds/aeropane_cloud_strip_01.png` is a separate transparent, bottom-weighted ambient layer, not a sky or dashboard background.
- PNGs are full-quality raster masters; WebP copies are compressed static display derivatives. **These are raster illustrations, not editable vector SVGs.**

## Rules for future images
- Modern clean, slightly dimensional aviation rendering; not a photograph or vintage poster.
- Bright white and silver fuselage, dominant red striping, restrained navy **only within light-coloured silhouette**. Match tail red panel, white/silver diagonal, navy inner area and engine red rings.
- Natural sunlight from upper left with gentle metallic highlights, consistent shading and panel-line density.
- Flying aircraft in a right-facing three-quarter perspective, with recognizable wing/engine arrangement; retain transparent padding.
- No names, logos, registrations, writing, real-world airline liveries, rendered sky, clouds or drop shadows in aircraft PNG.
- Clouds belong in separate low-horizon transparent assets and should be layered independently on actual card colour #162E3E; outer dashboard colour #081925.
- Do not stretch aircraft nonuniformly; set CSS `object-fit: contain`; reserve aircraft image region away from long model names and data labels.
- Preview scale and performance on Safari / iPad Air 2 before integration; no app modifications or deployment authorized by this pack.

## Caveat
The accepted A380 is a hobby-use stylistic baseline, not a certified technical drawing; the generic narrow-body is intentionally non-type-specific. Transparency and file encoding were verified programmatically, but actual visual fit in the application has not yet been tested.

# Perch / Aero Pane

Passive, landscape aircraft display prototype. **DEMO — SIMULATED DATA.** All
flights, operators, identifiers and movements are fictional. Airport names are
real places used only as illustrative route labels. No real tracking API,
observation coordinates, authentication, database or backend is included.

## Run and check

Node 24; `npm ci`, `npm run dev`, `npm run build`, `npm run lint`, `npm test`.
Production is a static Vite build in `dist/`. React 19.2.0, Vite 7.2.2,
TypeScript 5.9.3; exact dependencies are locked. Only React/ReactDOM are runtime
dependencies. No external fonts, images, analytics or component libraries.

The deterministic nine-stage cycle lasts 166 seconds: single (20), multiple
(24), changed primary (18), regional primary (18), incomplete identification
(22), standby (18), delayed (14), unavailable (14), recovered business jet (18).
It repeats automatically with one one-shot timeout, resynchronizes after page
visibility changes, and removes its timer/listeners on unmount. No audio or UI
controls. Optional `?scene=multiple` (also `single`, `changing`, `regional`,
`incomplete`, `standby`, `delayed`, `unavailable`, `recovery`) starts the normal
cycle at that scenario for reproducible review; it does not freeze the display.

## Compatibility

JS and CSS explicitly target Safari 15 rather than Vite's newer default.
Vite's bundled module-preload polyfill is enabled. All other used APIs are
available on iPadOS 15; no general legacy/polyfill package is needed. CSS uses
Grid/Flexbox, ordinary colors, responsive type and layout, 100vh plus the Visual
Viewport height to account for Safari browser chrome. No dynamic viewport units,
container queries, color-mix, View Transitions or newer array-copy APIs.
Long model names wrap in a shared length-based type size on every device; none
of the information is removed specifically for older hardware. Low-height
landscape layouts adapt consistently on all devices. Physical iPadOS Safari,
room-distance readability, browser chrome, Home Screen safe areas and endurance
still require testing. Emulated dimensions are not device certification.

`qa.html` is a development-only iframe size harness, not a production entry.
No map, relevance algorithm, live integration or research collector is included.
M24 and the separate Stage 1B collector are not used or modified by this project.

# Aero Pane — Stage 3 review

The current approved revision is the [living-room readability implementation](stage3-readability/README.md),
with [before/after comparisons](stage3-readability/gallery.html) and a separate
[route-availability investigation](STAGE_3_ROUTE_TIMING.md).

Branch: `stage-3a-display-redesign`, [Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5),
unmerged. Readability development uses verified `b22a5c2ecefcf9c903aa91ee4dfe52b15eecdcdf`,
which includes the authorised corrections after `8669b10`. Accepted Stage 2D main
remains `8031a76d0a24e1bb4ba88febd87d9a9c15ff2166`. Household Production,
observation configuration, credentials, aliases and Vercel Git integration are untouched.
No deployment, merge, paid service or M24 change.

## Current display

- Existing aircraft-name header, compact branding, navy/white identity and prominent
  yellow/aqua primary measurements retain their styling and priority.
- One per-artwork placement per viewport keeps the illustration stationary as the
  number of nearby aircraft changes. A380 remains specific; all other aircraft use
  the authorised generic placeholder. Aircraft files are unchanged. Clouds are no
  longer rendered or requested; the old cloud files remain in the repository.
- Single mode uses extra room for 44px / 40px callsign and direction, plus a
  subordinate operator line. Multiple mode keeps a compact supporting-value row.
- Secondary cards prioritise large type and genuine IATA routes, then altitude and
  distance. No secondary callsign substitutes, guessed routes or oversized missing
  labels. Fewer cards use the available width. Known redundant technical wording
  has narrowly validated shortening, with full originals retained in titles/header.
- The 220px radar is more visible, retaining its slow 16-second sweep and reduced
  motion support. Healthy empty airspace, true outages and overnight sleep remain
  distinct. Actual primary IDs still trigger the existing restrained transitions.

## Routes and preserved operation

The previous secondary component ignored already-enriched route fields. Those
fields are now visible without additional traffic. Primary-only lookup scheduling,
30-second common gate, cache/cooldown/source validation, 15-second positional
polling, selector/holding policy, authentication, sleep/wake, diagnostics and recovery
remain unchanged. Uncached secondary routes still require a separate request-budget
policy decision; see the investigation rather than assuming they are immediately available.

## Validation and acceptance

163 automated tests and 13 compiled plain-Node HTTP checks pass. Browser evidence
includes 72 readability layouts, six bidirectional stationary-illustration scenarios,
late routes, radar/reduced-motion/outage checks and 51 inherited layouts plus live,
export, PNG fallback and unchanged Stage 2D PIN/sleep checks. Lint, TypeScript,
default and all-feature Safari 15 builds pass. The current report contains exact
coordinates and screenshots at 1024×768 and 1024×624, plus 1112×834 checks.

No physical iPad certification is claimed. The user must assess the new text at
sofa distance, compact browser height, radar contrast, real-world long names and
extended sleep/wake/memory behaviour. Any Preview deployment is separately authorised.

Local commands and baseline setup are in the readability report. Browser tooling
is external to app dependencies. Fixtures are synthetic and excluded from standard
production output; no private location or provider access is needed for the tests.

## Historical evidence

- [A/B/C composition comparison](stage3a/composition-review/README.md).
- [Approved B implementation at 8669b10](stage3a/final-composition/README.md).
- [Fallback/spacing/radar corrections at b22a5c2](stage3a/visual-corrections/README.md).
- [Artwork provenance, hashes and installation contract](artwork/README.md).

These prior reports document their respective commits. Their older card layouts
and cloud-rendering expectations are intentionally superseded by the readability revision.

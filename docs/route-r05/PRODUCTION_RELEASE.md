# Aero Pane R05 Production release — 15 November 2026

Owner authorised R05 Production deployment to https://aeropane.app after physical R05 acceptance. This record accompanies, but does not change, the running application.

## Deployment
- Source branch: `release-r05-production` (forked from R05 evidence commit `4847ef494c01a23b6f2eec9b08ac7804cc0817ab`)
- Deployed runtime commit: `b53f32517c68690f9bf533ef60fc95512ba2453f`
- Vercel deployment: `dpl_2TzKATmfMHcuxWfAg8aRm8vggs9F` (READY; explicit Production target)
- Vercel project hosting release: `prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW`, formerly named `perch-aero-pane-stage3a`.
- Domain aliases: `www.aeropane.app` serves R05; `aeropane.app` retains 308 redirect to `www.aeropane.app`.
- Root domain and www HTTP smoke: 308 and 200 respectively; published JS bundle includes R05 budget and defaults the Production homepage to Live. Browser/PIN-authenticated live aircraft and actual HexDB enrichment need physical owner acceptance post-release.

## Release-only changes
- Production-specific R05 identity checks in `server/adaptiveCoordinator.ts`, while preserving the accepted isolated R05 Preview guard.
- R05 automated trial credential additionally requires isolated Stage 3 Preview identity; not eligible in Production.
- Production defaults to live display without a query parameter; explicit `?mode=simulation` remains available.
- The existing bounded adaptive rate policy, shared coordinator URL, credentials, PIN, location, elevation, 15-second position polling, and caching behaviours were reused through Vercel's encrypted environment configuration; no sensitive values placed in GitHub.

## Preservation and rollback
- Stable R04 Preview `perch-aero-pane-stage3a.vercel.app/?mode=live` remains aliased to `dpl_7M3TTFYhqCpQAoxvzXesEDEga93G` (READY).
- Immutable R05 Preview `perch-aero-pane-stage3a-4wgfc8612-mml3.vercel.app/?mode=live` remains available.
- Previous household Production deployment `dpl_2WX2Y9nNudmiJCtYMcAaMofp7Yzw` remains READY in project `prj_Esh3e64v7aYtnf0vP7i5gzcipDnO`.
- GitHub main and Draft PR5/PR6 were not merged.
- To roll back the public domain rapidly, reassign both apex and www aliases to prior Production deployment while retaining the apex redirect.

## Important follow-up
The legacy Production Vercel project still lists `aeropane.app` and `www.aeropane.app` in its **project domain configuration**, despite their live aliases now resolving to the new R05 Production deployment in the Stage 3A project. Future deployments to the legacy project may reclaim these aliases. Regularise project-domain association to the actual hosting project (Vercel Dashboard domain move or supported API) before setting up automatic Production deployments. Do not claim that alias reassignment alone migrated the project-domain configuration.

This release retains best-effort provider enrichment; it does not claim commercial reliability or confirmed improvements from a same-traffic controlled live A/B trial.

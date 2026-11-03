# Perch / Aero Pane - Stage 2C Acceptance and Closure Report

Date: 3 November 2026 (GMT)
Specification: Approved Product and Technical Specification v2.0

## 1. Decision, baseline and positional reliability

**Classification B - Accepted with limitations. Stage 2C is recommended for closure.**
The corrected hosted trial satisfies Stage 2C's positional reliability requirement. Optional enrichment works without obstructing tracking. Noncritical coverage, device and hosting limitations below do not prevent the intended protected, single-display personal use. No further extended observation is required for closure.

Application baseline: `b56d4b28a681c8e707f7d463550348d38ae61909`, branch `stage-2c-aircraft-enrichment`, draft PR #3, repository `martin-builds-code/Perch`.
Corrected Preview: `dpl_EmzBpYB58vxhKgTdoLubQNsDGmcv`, READY, Preview target, project `mml3/perch-aero-pane` (`prj_Esh3e64v7aYtnf0vP7i5gzcipDnO`).
Deployment: https://perch-aero-pane-1wo4exvix-mml3.vercel.app
The raw URL requires authorised access. Share tokens are deliberately omitted from this document.

Both original JSON exports were inspected and their counters checked against retained poll records. Both exports report a completed session with no pending attempt and no truncated episode window.

| Measurement | Original | Corrected |
| --- | --- | --- |
| Planned observation | 45 minutes | 30 minutes |
| Polling attempts | 180 | 120 |
| Successful requests | 117/180 (65.00%) | 119/120 (99.17%) |
| Failed requests | 63/180 | 1/120 |
| HTTP 503 cooldown failures | 63/180 | 0/120 |
| Delayed episodes | 33 | 39 |
| Median delayed duration | 15.234 s | 2.244 s |
| Delayed observed time | 18.54% | 5.15% |

The corrected failure was a browser timeout after 8.033 seconds, with no HTTP status, not a cooldown rejection. Observed time was 1,799.998 seconds; delayed time was 92.765 seconds. The minimum interval between poll starts was 15,000 ms in both trials. Delay proportion fell by about 72% relative to baseline, despite more, much shorter episodes. Episode counts alone are therefore a poor reliability measure.

The defect was a 10-second success cache expiring before a 15-second provider gate reopened. The correction reuses the exact successful snapshot while the gate is closed, only with nonnegative receipt age below 15 seconds and no failed refresh. Original snapshot/provider/position timestamps are preserved. The 10-second ordinary cache, 15-second provider gate, 30-second delayed threshold, 120-second expiry and Stage 2B policy remain unchanged.

The prior hosted smoke recorded 10/10 successes, zero cooldowns and four timestamp-preserving cached replies. The completed user trial now provides stronger follow-up evidence. Legitimately aged primary/secondary snapshots, one timeout and five clock-anomaly flags remain visible; these do not justify suppressing warnings or retuning selection. Associations are correlations, not proof of each episode's cause. This is bounded acceptance evidence, not a guarantee of future provider uptime.

## 2. Identification, enrichment and functional acceptance

**Verdict: accepted for the intended optional enrichment role.** Manufacturer/model remains the essential identification priority. Native adsb.fi description, registration and callsign take precedence; HexDB fills missing identification fields rather than overwriting useful native information. Missing provider coverage remains honestly unknown. This review does not establish an accuracy percentage across all future airframes.

A separate guarded Node endpoint uses only HexDB v2 aircraft-by-hex and route-by-exact-ICAO-callsign lookups. Aircraft identity includes manufacturer/model and registration where returned. Owner alone is not labelled as operator. The implemented brand associations require specific owner plus provider-flag evidence for easyJet and Ryanair/Malta Air; these are conservative brand associations, not proof of the operating legal entity on every flight. Other unsupported associations stay unknown.

Origin and destination are independently optional. Route cache keys include airframe hex and exact normalised callsign. Mismatched callsigns, contradictory endpoints, invalid/future update dates and known updates older than 180 days are rejected/suppressed. Unknown-age or accepted-age records remain best-effort associations, not independently verified current flight plans. No flight number or airport name is invented.

The positional service never waits for enrichment. Selection runs on positional records before the scene is decorated. Late enrichment cannot select, resurrect or transfer a flight's route to another callsign. Primary rendering occurs before optional lookups finish; secondaries may reuse former-primary cache entries. Selection weights and holding rules are untouched.

Evidence distinctions:
- Hosted operation previously received genuine nearby aircraft; Stage 2B primary/secondary presentation operated normally. HexDB naturally populated Ryanair and Wroclaw (WRO) to Manchester (MAN). That is a real returned route association, not independent route verification.
- Four earlier bounded HexDB example requests demonstrated aircraft parsing, two valid 404 negatives and deliberate suppression of a 2023 route. No extra live lookups were made for this closure review.
- Automated evidence covers native precedence, partial/unknown fields, owner distinctions, exact-callsign clearing, route contradictions/age, timeouts, denied/rate-limited responses, invalid/oversized bodies, caches, failure isolation and selection independence.
- Existing final-baseline results: 111 named tests passed, zero failures; 13 emitted plain-Node HTTP checks passed; lint, server NodeNext checks and default/all-feature Safari-15-targeted builds passed. Packaged Node 24 handlers also passed their corresponding checks. These results were reviewed, not rerun unnecessarily.
- GitHub currently lists no commit workflow runs or status entries. Acceptance relies on the recorded local/packaged checks, deployed READY state and hosted/user evidence; there is no claimed green GitHub CI run.

## 3. iPad Air 2 and diagnostic acceptance

**Verdict: suitable with limited remaining physical checks.** The user previously confirmed the approved prototype on iPad Air 2, iPadOS 15.8.5. The completed device diagnostic export demonstrates successful acquisition, bounded recording and export/upload of the trial. It does not by itself prove room-distance readability, every Safari UI state or long-term responsiveness.

Established automated browser evidence covers landscape CSS viewports 1024x624, 1024x768 and 1112x834, native-first rendering, later enrichment, long airport names, missing fields and live transitions. Nine ordinary-live comparisons and diagnostic aircraft-card comparisons were pixel-identical to the approved Stage 2C design. The export control has a visible 44-pixel touch target; no space is reserved for it during ordinary live viewing or simulation. The corrected commit changed server positional handling only; its frontend assets were unchanged.

Safari 15 JavaScript and CSS targets are explicit. The export uses Blob/object-URL download and selectable text fallback, avoiding dependence on Web Share, asynchronous clipboard permission or File System Access APIs. No material appearance, information-density or responsiveness compromise was introduced specifically for Air 2. Long optional airport names ellipsize within existing slots; this is a general layout choice, not smaller essential typography.

Precisely outstanding: subjective readability of primary/secondary panels and long enrichment labels from the normal viewing position; smoothness during real updates on this device; fit with the user's chosen Safari/Home Screen chrome; and the exact Downloads/Files/share or fallback workflow if not already exercised. Guided Access and multi-hour physical endurance are not certified. None currently has evidence of a blocking defect. No redesign or repeat diagnostic trial is required to settle closure.

Diagnostics remain opt-in: with the diagnostic build flag, open the authorised protected link with `?mode=live&diagnostics=30` (preserve sharing parameters). Keep Safari visible and online, tap **Export diagnostics**, save in Downloads/Files and export before closing/reloading. Repeated exports preserve observations; closing the panel is safe. A selectable-JSON fallback is available. Ordinary live viewing has no diagnostic collection/control; simulation never enables it. Recording adds no provider calls or telemetry and stops at the requested bound; the display can continue afterwards.

## 4. Privacy, request limits, costs and remaining limitations

Private observation coordinates remain sensitive, server-only Vercel variables; no coordinate uses a VITE_ name. The existing verified observation point and 15 km region were used for hosted validation. Closure inspection confirmed all eight established variables remain Preview-only, both coordinate variables sensitive, with no Production variables shown. No values were decrypted or changed for this review.

Current Vercel Authentication remains enabled (`all_except_custom_domains`). Earlier unauthorised page/aircraft/enrichment requests redirected to Vercel authentication; authorised sharing and same-origin APIs worked. Current protection configuration was rechecked. Expiring Shareable Links are access credentials, not permanent public access. This review created no new link and changed no access settings.

Positional browser polling is 15 seconds: at most about 240 starts/hour or 5,760/day per continuous client. The warm-process provider gate is 15 seconds, one in flight with coalescing, no automatic retries, 10-second ordinary cache/CDN TTL and bounded transport/error cooldowns. Timestamp-preserving gate-gap reuse adds no early provider start.

HexDB is primary-driven, at most one new browser lookup per 30 seconds and one in flight; server concurrency/gate are separate and process-local. Ceiling is 120 lookups/hour or 2,880/day per continuous client/process, usually lower. Identity TTL is 30 minutes; route and negative TTL are five minutes; positive current-primary entries may refresh 30 seconds early under the same budget. Caches are bounded at 64 client/128 server entries. Provider fetch/body timeout is 2.5 seconds, cap 64 KiB, no internal retries; errors cool down five minutes, access denial ten minutes, with longer Retry-After respected.

Separate Vercel instances do not share a global gate/cache. This is acceptable for the present protected single-display personal project, with bounded selective lookups; it is not an aggregate request guarantee or a basis for public/multi-display scaling. No distributed cache is required for this stage.

Diagnostics contain timing/state/error categories, not observation coordinates, aircraft identifiers, positions, registrations, callsigns, routes or credentials. Source inspection and both actual exports support this boundary. Data stays in browser memory until deliberate export; there is no persistent tracking database or automatic upload. Reviewed application handlers do not log raw exceptions, coordinates or aircraft identifiers.

Logging qualification: HexDB GET query URLs necessarily carry hex/callsign identifiers and may be present in platform/provider-managed access logs. Their retention/redaction was not independently established. The server's upstream adsb.fi geographical URL necessarily reaches that provider. Accordingly, an absolute claim that no infrastructure ever logs identifiers or location is not made. No evidence of an unintended application logging defect was found.

Hobby plan was rechecked. No paid provider, new service, database or billing change was introduced. Detailed usage headroom and global provider request totals are not certified; the previous runtime-log query returned no entries, not proof of universal absence of errors. HexDB's reviewed free/no-key documentation is not unrestricted caching/redistribution permission. Temporary personal selective use and attribution remain the approved scope; public redistribution or broader use needs separate rights review.

## 5. PR readiness, preservation and closure

PR #3 is draft, open, unmerged and mergeable at review, based on `stage-2b-aircraft-selection` at `e102eb2e1f1480c40a2fe50f9254642397aacd2f`. Its application head matches the authorised baseline, includes diagnostic export and the narrow cooldown correction, and retains the Stage 2A .js ESM correction. The 37-file Stage 2C diff covers enrichment, diagnostics, regression tests, scoped build/Git-deployment configuration and documentation; no unrelated application change was identified. There are no inline review threads. No unresolved material acceptance defect was found. This closure update changes this documentation file only; the deployed application SHA remains b56d4b28.

Stacked dependency order is PR #1 (2A) -> PR #2 (2B) -> PR #3 (2C). When separately authorised, prefer ancestry-preserving merges in that order. After #1, retarget #2 to main and inspect that only Stage 2B remains; after #2, retarget #3 to main and inspect only Stage 2C plus closure documentation remains. Recheck required validations after each base change. Squash/rebase merges can rewrite the ancestor SHAs and make later stacked diffs duplicate earlier work; avoid them unless deliberately reconciled. No merges, retargets or rebases were performed here.

Production remains READY at `dpl_2qDBRGtTANq4JFWUJZwhTYVSyRYn`, commit `ce708901750975c89400314a091db0b59a3a9919`, with the same three aliases: perch-aero-pane.vercel.app, perch-aero-pane-mml3.vercel.app and perch-aero-pane-git-main-mml3.vercel.app. Previous Stage 2C `dpl_ALQmLyxii6em8A6D2wg5NufZDua1` and Stage 2B `dpl_JBt7bKJ9KnjRkbkPqSKHVCPi571A` remain READY. PRs #1/#2 remain draft/open/unmerged. Perch remains absent from Vercel's linked Git projects. No source, deployment, environment, sharing, Production or M24 changes were made by this review.

**Final recommendation:** close Stage 2C as accepted with the documented limitations. The cooldown defect is resolved for acceptance; optional provider coverage is not an unfinished core feature. Outstanding device impressions can be recorded during normal use. Proposed next step is planning review of this closure and separate authorisation for stacked integration and/or the Stage 2D access/operating plan. No Stage 2D implementation or production release is authorised by this report.

Evidence register:
- Original export: aero-pane-diagnostics-2026-11-02-211027.json; SHA-256 302993382dc7b84ca4e0a93126258828fc65d0c2f14473445f8d4251a0552bbc.
- Corrected export: aero-pane-diagnostics-2026-11-02-230839.json; SHA-256 f3047a382ad7e99b6c519f4293ede7590c076daac71e46292e2216c09cb83495.
- Existing repository details: docs/STAGE_2C_POLICY.md, docs/STAGE_2C_COOLDOWN_REMEDIATION.md, docs/STAGE_2C_DELAYS.md, docs/DIAGNOSTIC_EXPORT.md and the browser/provider fixture evidence beside them. Development-stage statements in those historical records predate this final acceptance.
- Final local test/build logs and preceding hosted deployment report were reviewed. No raw user diagnostic JSON, private configuration or Shareable Link token is committed.
- GitHub review: https://github.com/martin-builds-code/Perch/pull/3 ; provider documentation previously reviewed: https://hexdb.io/ .

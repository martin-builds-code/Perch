# R04 verification before live trial

Baseline: c230231d262b345418680c900a397acf76c826a0. All tests use mocked APIs or frozen/synthetic observations unless explicitly listed in the eventual live report.

- Application suite:348 passed,0 failed. Includes R01 local-vs-upstream backoff, R03 historical qualification, authentication/expiry, selectors, caches and lifecycle.
- Plain Node compiled-server HTTP checks:20 passed; R02 review/auth boundary HTTP checks:9 passed. Derived bearing/relative height are tested in the emitted server graph.
- ESLint, TypeScript project builds, default production build, and live/enrichment/diagnostics/appliance-enabled Safari15-targeted build passed. No Production deployment.
- Current Stage3 layout suite:51 checks passed. Historical labels and stationary artwork passed at1024x768 and1024x624.
- Secondary enrichment browser suite passed: prompt route publication,30s global/90s collective secondary gate, no concurrency, sleep/wake, disabled enrichment,15s polling and stationary artwork at both iPad sizes.
- R01 browser suite passed at both sizes: three verified local deferrals recover at30s,30s and90s (the final wait is a legitimate secondary restriction); no amplified provider cooldown; genuine429 retains600s wait. R04 changes which request uses a slot, so expected request timestamps/targets were updated without removing protection assertions.
- Route-trial browser suite passed: rejected/negative/complete states, privacy, counters, delayed session mount, automatic lease expiry toPIN and shutdown. R04 omits one optional identity lookup after a known route miss; expected counts reflect three upstream requests rather than four.
- New R04 browser suite passed at both sizes: same-snapshot R03 shadow comparison, supported geometry, high-jet preference over distant low helicopter, historical publication, privacy, no extra lookup from UI refresh, request budgets and automatic lease shutdown. Screenshots under browser/.
- Two standalone Stage2 browser scripts (enrichment-browser-check and selection-browser-check) timed out on their old pre-PIN `.model`/`.primary .details` selectors. They are not adapted to the established Stage3 authentication/DOM contract. Their underlying behavior remains covered by the full unit suite and current Stage3/R04 browser checks; they are not counted as passing.

Physical iPad Air2/iPadOS15.8.5 testing has not been performed by Codex. Chromium screenshots and Safari15 compilation establish synthetic layout and syntax checks, not actual Safari rendering or household relevance.

A focused cached-position-jump regression failed against the initial R04 implementation: a repeated rejected sample could lose its discontinuity flag and activate the clear-sky exception. The final patch stores the flag with its bounded history sample until a new valid observation arrives. All348 application tests and29 HTTP scenarios pass after the correction. The existing seven model outputs are unchanged byte-for-byte; an eighth close-turboprop/two-jet budget scenario adds a documented limitation. The diagnostic frame signature also retains R03-only primary changes; the initial live trial uses the earlier capture signature and is reported with that timing limitation.

# R03 — qualified historical route recovery

Baseline: `8eefe8709a676bcf4b9096e75b232d42f85ea051`; accepted deployed R02 source `9fd9f3276fdba8b49c3b211e8630136bc907e26e`. Read the R02 report, owner verification, timestamp investigation and R01 report before implementation. Branch `stage-3a-display-redesign`, Draft PR #5.

## Policy and pipeline

Associations through 180 days retain ordinary presentation. Valid associations older than 180 through **730 days inclusive** are eligible and display **Historical route**. Older than 730 days returns no usable association. Invalid/future timestamps throw validation errors. Missing timestamps retain existing acceptance behavior and remain unknown (no historical/recent classification). Genuine 404s remain not found. Partial and ICAO-only routes retain existing behavior; only complete IATA pairs receive the prominent route block and qualification.

The age rejection now follows all existing airport and sequence consistency checks. Exact callsign matching, identifier checks, same-airport rejection, endpoint consistency, payload/size protections and error handling are preserved. Historical routes are not independently verified current flight plans. The precise meaning of HexDB updated_at remains unresolved; two years is an approved provisional trial limit, not demonstrated universal accuracy.

The existing associationTimeMs survives the API and route cache. Publication derives optional routeHistorical on the scene aircraft using the same wall clock; the cache does not duplicate the classification or store owner overrides. Routes remain keyed by hex AND normalized callsign. New snapshots, cached republication and primary/secondary role changes reuse that flight-specific metadata. Missing timestamps produce undefined classification, not a false recent designation. Cache TTLs remain unchanged. Entries crossing the hard 730-day limit are discarded even within their cache TTL; no new timer or retry mechanism was added.

## Presentation

Primary qualification: 18px high-contrast text beneath the existing route block. Secondary qualification: 17px. Historical secondary cards reduce vertical gaps/padding and use 60px route codes, or 56px at compact height (previously 66/64px). Recent cards are unchanged. Aircraft identity and metric type sizes are unchanged. The qualification is subordinate to route codes and adds no artwork-position dependency. Screenshots cover A380, generic jet and single-aircraft layouts at 1024×768 and 1024×624. Rectangles before/after qualification are identical for the aircraft illustration; labels and metrics fit their cards without scrolling. No artwork files or readability features outside this qualification were changed.

## Evidence and tests

[Replay](replay.json): **7 recent + 7 historical + 2 missing**, giving **14/16 eligible pairs versus 7/16** in the selected R02 records. Fixtures reconstruct retained airport/callsign/timestamp fields, not unarchived full provider responses. The owner-identified EXS041A LBA→MAN positioning flight remains missing from HexDB; its human result is not imported into the application. Examples recovered: SHT9Q EDI→LHR (~266 days), LOG31AW ABZ→MAN (~542 days), EAI19MS MAN→DUB (~542 days).

This is a counterfactual record-acceptance replay, not household coverage or live primary display time. Synthetic rejection examples include 730 days plus 1ms, future/invalid times, wrong callsign, identical endpoints and contradictory airport sequences at recent, historical and beyond-limit ages.

**315 unit tests and 29 plain-Node ESM HTTP scenarios pass**, including a historical enrichment response through the compiled HTTP handler. Lint, TypeScript/server checks, default and all-feature Safari 15 builds pass. Browser results: all 51 existing Stage 3 layouts, unchanged PIN/sleep pixels, primary-priority/secondary lifecycle, R01 short deferrals and full upstream backoff, diagnostic trial expiry, and six R03 historical/recent layout scenarios pass. Unknown timestamp classification is explicitly tested; the legacy R02 research test was updated to assert the newly authorized acceptance while its frozen evidence stays unchanged.

Initial verification found a duplicate-ID test fixture, an ES2020-incompatible test-only Array.at call, and an unknown-timestamp assertion expecting false; these were corrected rather than weakening safeguards. A diagnostic browser timeout was traced to candidate and disabled-enrichment Vite servers sharing an optimization cache. Isolated caches fixed it and all browser regressions passed. Earlier evidence archives were restored after saving new results here.

## Operations and acceptance

15 km radius, 15-second position polling, 30-second global and 90-second collective secondary enrichment intervals, concurrency one, genuine upstream backoff, R01 local deferrals, positive/negative TTLs, PIN and quiet hours remain unchanged. No new provider request path, polling loop, paid service, database or collector. Classification/rendering reuse data already fetched. Actual aggregate provider traffic has not been measured in an authenticated hosted trial; no claim of a controlled live comparison is made.

Normal PIN is retained. No authorized authenticated session is available to Codex, so no new live-provider observation is performed and no bypass is activated. Hosted verification checks PIN/API protection, source/deployment identity and the existing frozen review interface. Replay and local browsers prove historical rendering; they are not hosted live aircraft evidence. Deployment details and final smoke results are recorded separately after READY verification.

Safari 15 syntax/CSS build targets remain unchanged; no new browser API or runtime dependency. Physical iPad Air 2 readability and actual household route behavior remain acceptance activities. Recommendation: review the isolated Preview on the iPad before any separately authorized household promotion. No merge, main change, household Production/configuration/alias change or livery/readability development is authorized or performed.

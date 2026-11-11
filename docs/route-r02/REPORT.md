# R02 — historical route accuracy and verification

R02 has prepared 16 genuine flight cases and a mobile review/export page. Seven complete associations are excluded solely by the 180-day rule, but **none is yet confirmed as the route of the observed flight**. Public schedule evidence is useful context, not a substitute for that check. No operational age-policy change is justified by the evidence collected so far.

## Baseline and operating safeguards

Development branch: `stage-3a-display-redesign`, [Draft PR #5](https://github.com/martin-builds-code/Perch/pull/5). Reviewed baseline `465eb5cb483d681d2bbfb9c2d1cf6c40f4df6527`, R01 application `903a1cf191ba648dbde001014b5c13eafb2ed9e0`; both [R01](../route-r01/REPORT.md) and the [preceding investigation](../stage3-route-investigation/REPORT.md) were read. Main remained `8031a76d0a24e1bb4ba88febd87d9a9c15ff2166`.

The positional adapter, selector, enrichment service/adapter, R01 verified-local-deferral contract, authentication, quiet hours and main styling are unchanged from R01 in the final application. The 15 km radius, 15-second positional cadence, 30-second global and 90-second secondary enrichment intervals, single in-flight request and 180-day age guard remain in effect. The final research endpoint is permanently closed; the reviewer serves only frozen cases. No provider requests originate from the review page.

The isolated destination is `mml3 / perch-aero-pane-stage3a`, `prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW`, Preview. Final deployed source is `9fd9f3276fdba8b49c3b211e8630136bc907e26e`. READY Preview `dpl_D2ULPmHj4PxTnVKxztLQERsXtdhk` is verified in [deployment.json](deployment.json), including all 83 source hashes and the stable alias. Later evidence-only commits do not change this deployed application. Household `perch-aero-pane` and its configuration/aliases are outside this change. No Git integration, paid service, provider or database was introduced.

## Why a new sample was necessary

Earlier investigations intentionally pseudonymised flight identities; their archives cannot be reliably turned into aircraft/date-specific FR24 cases. No additional usable Stage 1C archive was present. We did not invent identities or alter those archives.

A private, one-hour-maximum sampler was committed as `cb7a1abf3c001eba8fe684390c4d6ec20e211af9` and deployed to immutable Preview `dpl_BCMMhRmXQ9kGGnWY7WdTiEtGKoKp`. It required an independent random bearer capability, an explicit server-only flag and verified isolated Preview project identity. It did not issue a PIN session or authorize live application APIs. The stable alias stayed on R01 throughout acquisition. Its 50-minute lease expired at **19:51:04.586 UTC**; the flag was disabled for future deployments immediately after building. Actual post-expiry HTTP requests confirmed sampler 404 and session/aircraft/enrichment 401 even with the former capability ([evidence](capture-access-closed.json)). Final code replaces acquisition with a 404 tombstone and removes its adapter hooks.

## Actual observation and request accounting

Acquisition ran **41 minutes 25 seconds**, from **19:04:09.018 to 19:45:34.414 UTC, 11 November 2026**. It was deliberately stopped between requests after 16 distinct cases covered all categories. [Actual stop status](collection-status.json) supersedes the collector's default `time-limit` text retained verbatim in [raw evidence](raw-collection.json); exit 130 was the intentional stop, not a completed 45-minute claim.

There were 25 private sampler API calls, 17 route-attempt opportunities, **16 confirmed new HexDB case responses** (14 HTTP 200, two HTTP 404), no case-cache hits and one additional API 503 `contradictory-route`. That failed response did not return case identity or an upstream HTTP counter. It is consistent with provider validation failure in the known code path, but cannot be counted as another fully evidenced case or silently treated as zero upstream activity. Thus the recorded lower bound is 16 confirmed upstream case responses, with one additional validation attempt whose response metadata is incomplete. The raw event's default `newHexdbRequest:false` for this missing metadata does not prove that no request reached HexDB.

Calls were sequential and at least 91 seconds apart, within the existing 30-second global and stricter research 90-second gate. The validation failure returned `Retry-After: 300`; the collector honored the normal five-minute protection. It was not a local 30-second gate amplified into a five-minute pause. This sample is not another route-availability trial and does not replace R01's measurements.

Selection favored currently observed fresh, airborne commercial types and then nearby records, skipping already sampled identities. This is purposive evening sampling, not random traffic coverage. It uses no wider radius, no aircraft history database and no extra source. Samples include Airbus A319/A320/A321neo, Boeing 737-800/MAX 8, ATR 42/72, ERJ 145 and an EMB-135 Legacy. Exact airborne positions, private observation coordinates and credentials were not retained in the study.

## Cases and initial results

| HexDB association category | Cases | Exact-flight corroborated matches | Confirmed mismatches | Unverified |
| --- | ---: | ---: | ---: | ---: |
| Up to 180 days | 7 | 0 | 0 | 7 |
| 180–365 days | 3 | 0 | 0 | 3 |
| Over one year | 4 | 0 | 0 | 4 |
| Missing/unusable (two provider 404s) | 2 | 0 | 0 | 2 |

Accuracy is **undetermined**, not zero percent or 100 percent. All seven historical cases have complete IATA pairs, matching response callsigns, valid timestamps and other structural checks passing. If correct, these are seven additional route candidates in this selected sample; they are not seven demonstrated recovered routes or a measured household coverage gain. No confirmed mismatch is not proof of correctness.

Cases are interleaved by category for review, never duplicated to meet a target. The [dataset](cases.json) retains observed UTC instants, airframe identifiers, manufacturer/model, endpoint/HTTP outcome, airport codes/names, original timestamp, calculated age, validation reason and independent-evidence confidence. The file and final server copy have a canonical SHA-256 fingerprint. Cases are frozen; their association age is calculated at lookup, not repeatedly aged while the owner reviews them.

## Independent verification: what is and is not established

Permitted public searches covered all 16 callsigns and the observation date, excluding automated FR24 flight-page scraping. [Source URLs and limited facts](independent-checks.json) are preserved. Thirteen cases have date-specific public schedule support, mostly airport boards. They pair the same callsign/date with planned airports; they do not establish an actual completed route or source independence from HexDB. They remain **limited**, excluded from accuracy counts.

Examples:

- `LOG31AW / G-SAJF`: HexDB ABZ → MAN, about 542 days old. The dated Aberdeen departure board lists LM27/LOG31AW on the matching date. This is encouraging schedule context, not confirmation that this particular airframe flew that route.
- `SHT19B / G-EUYH`: HexDB ABZ → LHR, about 266 days old. A Plane Finder **upcoming row for 11 November 2026** identifies G-EUYH and ABZ → LHR. Its page header concerns a different January 2025 flight and is explicitly not used. A scheduled matching airframe is stronger context, still not a verified flown route.
- `SHT9Q / G-TTSJ`: EDI → LHR, about 266 days old. Search results for G-EUYU on 28 October are a different date and airframe; they remain a general association only.
- `YUSRB / YU-SRB` and `EXS041A / G-GDFW`: HexDB 404. No reliable independently matched route was found. A missing provider result is distinct from age rejection.

Public FlightAware history URLs for two cases could not be accessed through the available web tool. No account restriction was circumvented, no provider was substituted and no private FR24 service was scraped. [Timestamp semantics remain unresolved](TIMESTAMP.md).

## Human review and evidence analysis

The [single review URL](https://perch-aero-pane-stage3a.vercel.app/route-review) opens curated historical cases without exposing live configuration or observations. Server checks require the exact isolated Vercel project and Preview environment. Household/other/Production environments return 404. The main application PIN remains enforced. The page's separately loaded bundle does not mount the live display or call session, positional or enrichment APIs.

Each case has an aircraft-history link, observation UTC time, copyable callsign, proposed airports and association age. The owner selects one of four verdicts, confirms the strength of the flight/date match, and optionally adds corrected airports/notes. Same-route is disabled for missing route pairs. Registration history links are legitimate starting points, not guessed exact-flight permalinks. Another-date matches are retained as unverified. FR24 history depends on the owner's existing plan; inaccessible history is a valid Unable-to-verify answer, not a reason to purchase access.

Drafts remain on the device in versioned, fingerprint-specific local storage. There is no server submission, account, permanent diagnostics store or automatic upload. JSON export uses feature-detected native file sharing or a conventional browser download, with an explicit download fallback. Cancels/failures do not clear answers. Duplicate exports are idempotent, conflicting verdicts are excluded for deliberate consolidation, and altered dataset/flight identities are rejected. The offline analysis tool reports raw counts by age category, exact-date verification denominators, missing-source recoveries and unresolved conflicts. No-route-available is not counted as a mismatch or accuracy success.

## Policy options awaiting results

| Option | Expected benefit | Incorrect-route risk | Complexity and provider usage |
| --- | --- | --- | --- |
| A — retain 180 days | Keeps present conservative behavior; no historical recovery | Existing recent associations can still be wrong; old useful pairs excluded | None; unchanged calls |
| B — extend age threshold | Could admit some of the seven rejected pairs | Unknown until dated review; no defensible new maximum yet | Small code change later; no extra calls |
| C — graduated historical confidence | Makes older plausible associations available with visible qualification | Qualification reduces overstatement, not factual errors; readability tradeoff | Moderate display/cache/type work; same calls |
| D — independent corroboration | Stronger basis for selected historical pairs | Depends on exact-flight/date evidence and source quality | Manual review now; automated source/terms/budget need separate approval |
| E — supplementary/alternative provider | May address 404s and stale coverage | New source can also be incomplete/incorrect | New terms, cost and integration assessment; extra traffic; not implemented |

**Provisional recommendation:** retain A while the owner checks this sample. If old cases are convincingly corroborated, evaluate C or D before choosing an unqualified larger age threshold. A few matching schedules cannot justify B. Compare recent controls with old cases, report raw counts alongside percentages, separate unavailable evidence, and account for commercial/evening/availability selection bias. Repeated callsigns and a small, non-random sample do not establish general reliability. No policy was approved or deployed by R02.

## Validation and remaining limits

All **282 unit tests and 28 compiled Node ESM HTTP scenarios passed**, as did lint, TypeScript, both builds and the inherited browser regressions. The actual immutable deployment and stable alias passed the 16-case review at all four phone/iPad sizes; normal PIN screens and protected API responses also passed. Results are in [verification.json](verification.json), [hosted-checks.json](hosted-checks.json) and [deployment.json](deployment.json). Checks include the inherited R01 cooldown and lifecycle suite, provider guards, current layout regressions, mobile navigation/revision/local resume, JSON export/import/conflicts, missing storage and export cancellation/failure, stale observations, privacy validation and compiled plain-Node ESM HTTP loading. Builds retain the Safari 15 target; [compatibility evidence](COMPATIBILITY.md) records the checked APIs and remaining device tests. No browser library or new runtime dependency was added.

Safari 15 supports the baseline File/Blob/object-URL/download/localStorage techniques used here; file sharing is feature-detected rather than required. The reviewer alone permits mobile portrait scrolling; normal aircraft-display iPad/landscape restrictions are unchanged. Desktop Chromium layout testing is not physical Safari testing. Files/share-sheet behavior on the actual iPhone/iPad, possible Guided Access restrictions and sofa-distance display acceptance remain physical acceptance tasks.

The normal PIN screen and authenticated API rejection can be checked without the owner's PIN. This does not claim a new authenticated live-flight acceptance test. The operational server graph is byte-identical to R01 after removing the acquisition hooks; the new evidence sampler, while active, verified actual nearby records and HexDB responses separately. Existing visual and operational regressions provide additional checks.

Next action: owner reviews the prepared cases and exports one results file. Codex then consolidates exact-flight evidence, reports historical/recent raw results and recommends a policy for explicit approval. Stop here; no merge, Production release or automatic age-rule adjustment.

The first hosted page check found a Vercel `NOT_FOUND` response despite a working frozen-case API. A single-path SPA rewrite corrected this before the stable alias was reassigned. All final hosted checks passed. The prior R01 immutable Preview is retained for comparison/rollback; only the explicit Stage 3A stable alias was moved. [Cleanup](cleanup.json) confirms task servers/observer stopped, temporary capability files removed, expired sampler access and unchanged original Preview configuration metadata.

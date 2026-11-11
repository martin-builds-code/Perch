# R02 — owner route-verification results

The owner's completed review corroborates **all 14 HexDB route pairs**, including **all seven rejected by the 180-day rule**. No incorrect supplied route was reported. In this sample, rejecting an association solely for being older than 180 days discarded useful, correctly identified routes.

This is evidence for changing the policy, not authorization to change it. The operational rule, application code, Preview, Production and request budgets remain unchanged.

## Evidence and validation

The [original export](owner-review-2026-11-11-211716.json), exported **11 November 2026 at 21:17:16.152 UTC**, is preserved byte-for-byte. Its SHA-256 is `1fd4d2bcbfaae8079429203bf17197160b1acb46dc19ed16f500618a5a500111`. It matches the frozen R02 dataset `r02-2026-11-11`, revision 1, fingerprint `25036c5700a1dd09062767e442e36fd23d352b74698e6e7198fa2eb20867a55e`.

All 16 cases were reviewed. The owner selected **same aircraft, flight and date** for 15 cases; one could not be matched. Codex checked the exact case content, identities, answer schema, timestamps and recomputed summary. An independent count agrees with the existing offline analysis script. Importing the same file twice leaves the counts unchanged; no conflicts were found. [Machine-readable analysis](owner-analysis.json) and [validation/provenance](owner-review-validation.json) retain the details.

The verification basis is the owner's declared FR24 checks. No flight links or screenshots were included, which were optional. Codex has not independently reproduced those checks or converted earlier schedule clues into automatic verification. The frozen case dataset, initial analysis and pre-review evidence remain unchanged.

## Results by association age

| HexDB association category | Cases | Owner-corroborated supplied routes | Confirmed mismatches | Other outcomes |
| --- | ---: | ---: | ---: | --- |
| Up to 180 days (observed ages 14.5–18.1 days) | 7 | 7/7 (100% of compared pairs) | 0 | None |
| 180–365 days (about 266 days) | 3 | 3/3 (100% of compared pairs) | 0 | None |
| Over one year (about 542 days) | 4 | 4/4 (100% of compared pairs) | 0 | None |
| Provider supplied no route | 2 | Not applicable | Not applicable | One route identified by owner; one unable to verify |

Recent and historical pairs both matched in every comparison: **7/7 recent versus 7/7 historical**. These are observed sample results, not a claim of 100% accuracy across household traffic or all HexDB data. The missing/unverified cases are excluded from route-association accuracy.

## Individual cases

All observations were on **11 November 2026, 19:04–19:45 UTC**. Exact individual observation/lookup/answer times, model, registration, hex and case IDs remain in the original export.

| Callsign | Registration | HexDB route | Age at lookup | Owner result |
| --- | --- | --- | ---: | --- |
| SHT9Q | G-TTSJ | EDI → LHR | 266 days | Same route; same aircraft/flight/date |
| LOG31AW | G-SAJF | ABZ → MAN | 542 days | Same route; same aircraft/flight/date |
| EZY64RF | G-EZFV | BFS → STN | 18 days | Same route; same aircraft/flight/date |
| YUSRB | YU-SRB | None (404) | Unknown | Unable to verify; remains unresolved |
| SHT19B | G-EUYH | ABZ → LHR | 266 days | Same route; same aircraft/flight/date |
| LOG17ZA | G-LMRD | INV → MAN | 542 days | Same route; same aircraft/flight/date |
| EZY387T | G-EZUW | LGW → BFS | 15 days | Same route; same aircraft/flight/date |
| EXS041A | G-GDFW | None (404) | Unknown | Owner identified **LBA → MAN**, noted “Positioning flight”; same aircraft/flight/date |
| SHT7P | G-EUYM | GLA → LHR | 266 days | Same route; same aircraft/flight/date |
| EAI19MS | EI-GPN | MAN → DUB | 542 days | Same route; same aircraft/flight/date |
| RYR1AC | EI-IKA | FCO → DUB | 18 days | Same route; same aircraft/flight/date |
| EAG18C | G-CMMK | BHD → MAN | 542 days | Same route; same aircraft/flight/date |
| EZY86NE | G-EZTT | MAD → EDI | 15 days | Same route; same aircraft/flight/date |
| EZY208N | G-ZXIA | BRS → GLA | 18 days | Same route; same aircraft/flight/date |
| EZY465Y | G-EZTK | MAN → BFS | 18 days | Same route; same aircraft/flight/date |
| RYR82JD | EI-HMT | MAN → ORK | 18 days | Same route; same aircraft/flight/date |

EXS041A's **Different route** button does not establish a wrong HexDB association: there was no proposed pair to contradict. It records a real source-coverage gap that human checking filled. That route is evidence only and has not been inserted into the live cache or turned into a persistent flight override. YUSRB's Unable-to-verify result says nothing about whether an independent route exists.

## What the results establish

The seven historical associations were complete, matched callsigns and passed the other structural checks. The current age rule was their sole rejection reason. Owner verification therefore identifies **seven useful route pairs lost to that rule in this sample**, with no observed incorrect pair introduced by accepting those particular records.

For the **prepared records only**, the current rule admits seven of 16 cases (43.75%). Admitting these seven corroborated historical pairs would make 14 of 16 available (87.5%), an additional seven pairs. This is a counterfactual acceptance count, not measured primary display time, primary/secondary route availability, an improvement deployed to the iPad, or a prediction of future traffic. Scheduler timing was not replayed in this comparison.

Association age did not distinguish correct from incorrect routes in these comparisons, because no incorrect pair was observed in either age group. The 180-day cutoff is demonstrably over-conservative for these seven flights. It is not established that age has no predictive value in other traffic.

The sample is small, non-random, commercial-heavy and drawn from one evening and one observation area. Age coverage is concentrated near 15–18, 266 and 542 days; it does not test the intervening ages or anything older than about 542 days. The four oldest records share a provider timestamp, so they should not be treated as four independently sampled update histories. Zero observed mismatches is not a general error-rate guarantee.

The acquisition also recorded one separate `contradictory-route` API failure without an exported identity or comparable pair. That event is documented in the original report but was not one of the 16 prepared cases, so this review cannot adjudicate it. Correctness checks that reject contradictory responses must remain in place.

The owner's checks do **not** resolve the meaning of `updated_at`. Correct routes can remain correct after an old database timestamp under several possible timestamp interpretations. The [timestamp investigation](TIMESTAMP.md) therefore remains unresolved.

## Policy assessment after human review

| Option | Updated assessment | Expected benefit and risk | Complexity / added provider usage |
| --- | --- | --- | --- |
| A — retain 180 days | Preserves current behavior but knowingly excludes seven corroborated pairs here | No recovery; avoids accepting untested older associations | None / none |
| B — extend age threshold | Evidence supports admitting the tested ages, including about 542 days; it does not identify an optimum cutoff | Recovers tested old pairs without changing the display; older errors may be shown without qualification | Low / none |
| C — graduated historical confidence | **Preferred:** make structurally valid older pairs useful while identifying their historical status | Same recovery opportunity as B, with a restrained qualification; still cannot guarantee route correctness | Moderate presentation/type/cache work / no additional calls required |
| D — independent corroboration | Strong basis for these specific cases; per-flight manual checking is unsuitable for passive daily operation | Stronger evidence where a lawful source is available; coverage and matching remain constraints | High to automate reliably; source/usage requires separate approval |
| E — another route provider | Not the first remedy for this demonstrated age-policy loss | Could address gaps such as the positioning flight; no coverage/cost benefit has been established | New terms/cost/integration assessment and likely extra calls; not implemented |

**Recommendation for a separately approved personal-use trial:** use Option C as a bounded historical fallback, with a provisional **730-day maximum (two years)**. Keep the existing recent-route behavior through 180 days, give older accepted routes an unobtrusive historical qualification, and retain callsign matching, complete airport-pair checks, timestamp/contradiction safeguards, TTLs and all request limits. Do not describe any association as a verified current flight plan.

The proposed two-year ceiling is a **practical trial bound, not an accuracy threshold established by the evidence**. It includes the tested 542-day records with some operating headroom and still rejects much older associations. A cap just above the oldest case, such as 550 days, would exclude those same correct records about eight days after this observation without new evidence of a route change. However, the two-year proposal includes ages beyond this sample: their accuracy remains untested and that additional uncertainty must be explicitly accepted in the policy decision. There is no basis here for unlimited-age acceptance or a general claim about older records. The precise label and presentation also require approval; no visual alteration was made during consolidation.

The next decision is a route-policy decision, not another software task for the owner. The submitted review is complete and usable; no additional manual checking is required to interpret it. An explicit implementation instruction is still needed before changing the operational age rule. No merge or deployment was performed.

## Work performed for this return

Only evidence and documentation were added/updated. The original export was validated using the existing offline code, its summary was independently recomputed, and duplicate ingestion was checked. There were **zero provider requests**, source-code changes, Vercel operations or new costs. The prior application-suite/build results remain as recorded in [verification.json](verification.json); they were not unnecessarily rerun for this documentation-only consolidation. R01, Preview/household authentication, selection, polling, enrichment budgets and Production remain unaffected.

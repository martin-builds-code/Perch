# R03–R04 controlled model comparison

Identical synthetic trajectories were replayed through the frozen R03 selector/scheduler and the R04 code. Constant track/speed or explicit orbital fixtures, known recent/historical/missing responses,1s latency, no server cache. These results do not measure household route coverage or human observing accuracy. No live providers were called. Full timing, decisions, requests, primary intervals and per-flight delays: synthetic-comparison.json.

|Scenario|Requests R03→R04|Primary time with route R03→R04|Primary transitions R03→R04|Route ready at first primary R03→R04|
|---|---:|---:|---:|---:|
|high-jet-versus-horizon-helicopter|5→4|10.7%→32.1%|2→2|1/2→1/2|
|close-helicopter-versus-distant-jet|3→3|99.6%→99.6%|0→1|0/1→1/2|
|slow-primary-fast-approach|7→5|41.1%→58.1%|2→2|0/3→1/3|
|quiet|5→5|99.7%→99.7%|0→0|0/2→0/2|
|moderate|19→18|24.9%→52.4%|12→10|4/7→4/7|
|busy|38→35|19.1%→69.1%|26→18|8/14→11/18|
|unknown-trajectory|5→5|99.7%→99.7%|2→2|1/2→1/2|
|two-jets-30-seconds-apart|5→5|99.7%→99.7%|0→0|0/1→0/1|

R04 uses no more requests in any of the eight scenarios. This is a property of these fixtures, not a proof of identical future traffic volume. All attempts retain the30s global/90s collective secondary gates and single concurrency; negative outcomes remain negatively cached.

In the slow-primary/fast-approach example, R04 requests the jet while still secondary at60s, returns its route at61s and selects it at90s:29s ready in advance. R03 first queries it at105s, selecting it simultaneously; the route arrives1s afterwards. R04 does not make it primary merely to obtain a lookup.

In the high-jet/horizon-helicopter example, R04 selects the jet45s before CPA rather than at CPA. In the reverse example, the close helicopter initially remains primary; R04 later attends to the jet only after the helicopter departs. No commercial preference enters display selection. Busy traffic sees four fewer misses of the deliberately defined geometric criterion (elevation>=45 degrees or horizontal distance<1km), but that criterion is an evaluation convention, not verified human-interest ground truth. More primary acquisitions in busy traffic mean raw readiness counts and denominators both change.

The90s secondary budget still prevents universal readiness when several jets enter together, and two consistent samples may consume15s of a short pass. Provisional vectors never receive confident prefetch priority. Required primary identification and immediate primary routes can legitimately postpone another flight. Optional operator metadata may be postponed to keep route opportunities available. Those are explicit tradeoffs for physical review.

**Deliberate budget/subjectivity stress case:** two jets have CPAs30s apart while a turboprop circles0.8km away at2,500ft. Both policies retain the genuinely close turboprop; neither jet wins two sustained8-point challenger margins before passing. This is an acknowledged ranking tradeoff, not a claim those jets were unnoticeable. Their routes are attempted at60s and150s; with1s model latency, the second result follows its150s CPA by1s. The90s collective secondary gate is the binding constraint. No frequency increase or special renaming of secondary requests is used. A future policy discussion could examine that budget with more live evidence; this implementation retains it.

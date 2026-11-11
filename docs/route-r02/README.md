# R02 route verification

Open **[the prepared route review](https://perch-aero-pane-stage3a.vercel.app/route-review)** on an iPhone or iPad. The page contains 16 frozen observations from **11 November 2026, 19:04–19:45 UTC**. It does not track the aircraft now or make aviation-provider requests.

1. Open **aircraft history in FR24**. This opens the recorded registration, not a guessed flight number. Select the flight airborne around the displayed observation time on **11 November**. The HexDB association timestamp is a different date and is not the flight date.
2. Compare the departure and arrival airports. Tap **Same route**, **Different route**, **No route available**, or **Unable to verify**. For a different route, enter the airports FR24 shows when available.
3. For a usable comparison, select whether you matched the same aircraft/flight/date or the same flight/date. Another date or a general callsign association remains unverified. Notes and a public flight link are optional.
4. Tap **Next**. **Previous** lets you revise answers. You can stop and resume on the same device and browser; progress saves locally. Do not clear Safari website data before exporting. Private browsing or disabled storage may prevent saving; the page explains this and still permits an export.
5. Tap **Export results**, either at the top or bottom. On supported Safari versions, choose **Save to Files** from the share sheet. Otherwise use Safari Downloads, normally in **Files → Downloads**. **Download file instead** provides an explicit fallback. Attach the single JSON file in the development conversation. No copying JSON or developer tools is required.

An incomplete export is fine and is labelled accordingly. Exporting does not erase answers. Nothing is submitted automatically. Cancelling the share sheet preserves the draft. **Load a saved results file** can restore an export on another device; conflicting answers require confirmation.

FR24 access depends on your existing plan. Its published free history is seven days; do not purchase a plan just for this exercise. If the relevant flight cannot be matched, choose **Unable to verify**. A flight with no usable route is **No route available**. A different-date route is not confirmation of this flight. [FR24 search help](https://support.fr24.com/support/solutions/articles/3000115497-how-can-i-find-flights-) and [history limits](https://support.fr24.com/support/solutions/articles/3000115499-is-it-possible-to-see-playback-of-past-flights-).

The review page is a narrowly scoped public study of these curated, historical flight cases. It has no access to live observations, private location, authentication secrets or provider operations. The normal [aircraft display](https://perch-aero-pane-stage3a.vercel.app/?mode=live) retains its PIN and iPad/landscape requirements. No Production access has changed.

## Evidence and interpretation

- [Investigation report and policy options](REPORT.md)
- [HexDB timestamp findings](TIMESTAMP.md)
- [Frozen cases](cases.json), [public-source checks](independent-checks.json), [initial counts](initial-analysis.json)
- [Raw bounded observation](raw-collection.json), [actual stop status](collection-status.json), [acquisition access closure](capture-access-closed.json)
- Mobile/iPad screenshots and browser results are in this directory. They assess software behavior, not physical-device verification.

The sample fingerprint binds exports to their cases. Identical exports are idempotent; conflicting verdicts are flagged rather than silently counted twice. Codex will run the offline analysis script after receiving your file and report raw matches, mismatches and unknowns separately for each age category. No route-age policy changes automatically from your answers.

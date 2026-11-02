# Temporary on-screen diagnostic export

This extends the existing Stage 2C collector from baseline
`133682ee74bb12d6a03bd6dd8a5d0c9b9829f5dc` on the same development branch/PR #3.
No deployment or hosted observation is included. Deployment still requires separate
approval; keep the protected Stage 2B Preview and public demonstration unchanged.

## Use on an iPad

1. After a diagnostic-enabled test environment is separately authorised and built,
   open `/?mode=live&diagnostics=45` in Safari, in landscape. Both public build flags
   `VITE_AERO_LIVE_ENABLED=true` and `VITE_AERO_DIAGNOSTICS_ENABLED=true` are needed.
   An explicit duration from 30 to 60 minutes is accepted. Enrichment is independent
   and optional. Existing server-only live configuration/guards are unchanged.
2. Leave the page open for the observation. The compact footer shows **Export
   diagnostics** and “Export before closing this page”. There is no need to watch
   individual aircraft. Keep Safari visible and online for useful coverage.
3. Tap **Export diagnostics** once. This requests a JSON download immediately and
   opens a small confirmation/fallback panel. Accept any Safari download prompt.
   A filename such as `aero-pane-diagnostics-2026-11-02-193000.json` uses the actual
   export time in UTC. The button stays available after the collection time limit.
4. Find the file using Safari's Downloads button or **Files → Browse → Downloads**
   under iCloud Drive or On My iPad, depending on Safari's configured download
   location. See [Apple's download instructions](https://support.apple.com/en-gb/102440).
   From Files, touch and hold the file and choose Share, or attach the saved JSON
   directly in ChatGPT. No Mac, console or developer menu is needed.
5. If no file appears, use **Download JSON** in the panel to retry the same snapshot.
   Safari does not report reliable download completion to the page: “Download
   requested” is not a claim that a file has been saved. If downloading is blocked,
   expand **Show JSON if the download is unavailable**, tap **Select JSON**, and
   use Safari's Copy command to share the selected text for analysis. No Clipboard
   API permission is required. This also works when Blob URL creation fails.
6. Close the export panel to continue watching. Collection is neither restarted nor
   cleared. Close and reopen it for an updated snapshot; Download JSON retries the
   snapshot already shown. A 1.5-second tap guard and one open panel prevent accidental
   duplicate exports. The fallback is local and does not send any data.

Export **before closing or reloading the page**. Unexported results exist only in
browser memory and will be lost. Closing the export panel is safe. There is no
persistent storage or background collection after closing the application.
To disable the trial, save your results, then reopen `/?mode=live` without the
`diagnostics` parameter. For a normal build leave `VITE_AERO_DIAGNOSTICS_ENABLED=false`.
Simulation never displays this control, even with a diagnostics query parameter.

Guided Access may restrict Safari's Downloads UI, Files or the system share sheet.
It is not required. If those actions are restricted, save/export before leaving the
page, or end Guided Access without reloading Safari and use Downloads/Files. This
workflow and the exact installed iPadOS patch version need physical acceptance testing.

## File contract and privacy

The file contains **every existing collector summary field at the top level**,
including its bounded polls, episodes and lifecycle records. No measurement,
threshold, association or counter calculation changes. One additive field describes
the export itself:

```json
"exportMetadata": {
  "exportedAtMs": 1793647800000,
  "sessionStatus": "incomplete"
}
```

`incomplete` means the planned collection window has not finished, or the collector
was stopped early. `complete` means the time window ended, **not** that observation
coverage was continuous. Inspect `observedMs`, `inactiveMs`, `unavailableMs`, lifecycle,
poll gaps and anomalies before interpreting a session. Existing ongoing-episode
and truncated-window indicators retain their meaning. Evidence associations remain
correlations, not a causal diagnosis. See [the delay investigation](STAGE_2C_DELAYS.md).

Developer access through `window.aeroPaneDiagnostics.summary()` and `.export()`
remains unchanged; the latter returns the original collector JSON without file metadata.
[The example file](aero-pane-diagnostics-example.json) is a **synthetic browser-test
fixture**, not a live observation or evidence of the user's delay rate.

No private coordinates, aircraft positions/identifiers/callsigns/registrations/routes,
credentials, cookies, tokens, deployment links or personal browser identifiers are
included. Generation is entirely client-side and requires a tap. There is no upload,
analytics, remote export endpoint, localStorage or new provider request. One bounded
snapshot and one Blob URL are retained for download/fallback; the URL is revoked on
the next deliberate export or unmount, rather than immediately interrupting a download.
Closing/retrying never clears the collector. There is no new dependency or timer.

## Compatibility and visual checks

The primary mechanism is an ordinary `application/json` Blob, `URL.createObjectURL`
and a user-initiated anchor with `download`. [MDN browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/html/elements/a.json)
records iOS Safari support for `download` since version 13. Blob/Object URLs,
`performance.now`, `details`, text selection and the existing React portal mechanism
are compatible with Safari 15. No File System Access API, native HTML dialog, async
clipboard, Web Share dependency or new library is introduced. Explicit Safari 15
JS/CSS build targets remain. A native-share-first path was avoided because of the
[documented non-resolving sharing promise in early iOS 15](https://bugs.webkit.org/show_bug.cgi?id=234187);
sharing a saved file through Files remains available. Native download prompts,
Files integration and Guided Access have not been verified on physical hardware.

During diagnostics only, the footer has a small text control with a transparent
44-pixel touch target and a memory-lifetime note. Its text does not overlap cards,
status or credits. No card dimensions/font sizes/colours change. The temporary export
panel appears only after the user requests export; it has touch controls, scrollable
JSON fallback, keyboard focus containment, Escape/Close and focus restoration. No
space or control is added to ordinary live/simulated displays.

Local Chromium fixtures at 1024×624, 1024×768 and 1112×834 verify real Blob downloads,
private valid JSON, active/finished sessions, double taps, download failure, manual
selection and cleanup with no browser errors or export-related API requests. Nine
ordinary-live comparisons (current/delayed/unavailable at three sizes) are pixel
identical to the approved Stage 2C baseline; diagnostic aircraft cards are also pixel
identical. Existing simulation, live-state, selection and enrichment checks pass.
Screenshots: [control](stage-2c-diagnostic-control.png),
[export panel](stage-2c-diagnostic-export.png).

These are desktop synthetic checks and source/build compatibility assessments, not
physical Safari or Air 2 certification. Before a separately authorised live trial,
confirm download acceptance, file location, Files sharing/ChatGPT attachment, JSON
fallback and touch readability on the actual iPad, including Guided Access if used.
Tracking, enrichment, freshness and selection policies are unchanged. Additional
provider/function invocations and remote logging costs from exporting are zero.

## Reproduce local checks

`npm test` runs the inherited tests plus ten export tests and the compiled-server
HTTP checks. Also run `npm run lint`, `npm run build`, and:

```sh
VITE_AERO_LIVE_ENABLED=true VITE_AERO_ENRICHMENT_ENABLED=true VITE_AERO_DIAGNOSTICS_ENABLED=true npm run build
```

Browser fixtures use optional Playwright Core/Chromium already outside the project;
no package dependency is added. With server provider flags disabled and all public
flags enabled, start this checkout on loopback :5173. Use an unchanged approved
Stage 2C checkout (`133682ee`) with the same flags on :5175 for live pixel comparisons,
and the original production checkout on :5174 for inherited simulation comparisons.
Run the three inherited `scripts/*browser-check.mjs` files and
`scripts/diagnostic-export-browser-check.mjs`, setting `PERCH_PLAYWRIGHT_MODULE` to
the installed Playwright Core module if needed. All API traffic is intercepted by
synthetic fixtures; do not enable real provider credentials for browser regressions.
See [machine-readable results](stage-2c-export-browser-checks.json).

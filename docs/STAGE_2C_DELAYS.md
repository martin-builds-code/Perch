# Data-delay investigation and bounded trial

## Current conclusion

The user's live episodes have **not yet been attributed or measured**. No hosted
monitoring was performed during development. Deterministic code/fixture tests
identify several plausible mechanisms, not the actual frequency or dominant cause.
No change was made to the 30-second delayed threshold, 120-second expiry, Stage 2B
weights, 36-second hold, switching margins, provider cadence or server request gate.
The investigation currently returns outcome D: evidence gathering is still needed,
with tested mechanisms and an instrumented trial ready for separate authorisation.

## Verified state logic and interactions

The unmodified `liveScene` marks the display delayed when any of these holds:
- The last positional request failed.
- Snapshot anomalies are reported.
- The server snapshot's `fetchedAtMs` is at least 30 seconds old.
- **Any displayed aircraft**, including any of the three secondaries, has a
  position age of at least 30 seconds.

This is a group status, not a measurement only of the prominent aircraft. The
primary's delayed styling also follows that group status in the existing display.
Consequently a fresh primary can appear during a delayed indication caused only
by a secondary. That mechanism is reproduced by a fresh primary plus a 45-second
secondary in `tests/diagnostics.test.tsx`. It is not proof of an incorrect position
age calculation or a provider outage. No group-status policy change was made.

Provider time is epoch milliseconds. Normalisation derives position time from
`provider.now - seen_pos * 1000`. Request latency is never substituted for position
age. Negative ages/future timestamps remain anomalies, not zero-age readings.
A fresh HTTP response can contain an older position. A newly acquired primary can
also already be older than 30 seconds: Stage 2B intentionally keeps valid positions
eligible up to 120 seconds, applying its freshness penalty and delayed presentation.
Both cases are covered by fixtures and show that request success and position
freshness are distinct.

Stage 2B can briefly retain a primary missing from a subsequent nonempty snapshot.
Its position timestamp is unchanged; it can cross 30 seconds during the less-than-
30-second missing grace. Retention does not manufacture freshness. The existing
expiry timer enforces grace and source expiry even while another request is pending.
A failed request keeps the previous snapshot explicitly delayed, while a successful
empty result is a separate standby condition. Those behaviours remain unchanged.

The client schedules starts at least 15 seconds apart, prevents overlap and times
out after 8 seconds. The provider request is bounded at 5 seconds. The server has
a 10-second process success cache and a 15-second start gate; the CDN success TTL
is 10 seconds. A deterministic test proves that a request arriving at 14,999 ms
after the server's previous start is outside its cache but inside its gate, and
receives `cooldown`. A request at 30 seconds succeeds. Variable browser-to-server
latency could therefore produce an approximately one-cycle delay. The synthetic
test establishes a possible timing mechanism; **it does not establish that this
occurs in the user's deployment**. Changing this gate/cache relationship could
alter provider load or snapshot age and is not bundled into this investigation.
The diagnostics now record the safe `cooldown` code separately from network errors.

A browser pause can also leave records aged at resume. Existing visibility/online/
pageshow recovery republishes age status, then fetches within the normal cadence.
CDN/process cache responses can carry earlier server timestamps. Source timestamps
are not reset when cached data is received. Cache metadata is recorded only when
available; absence of a header is not inferred as a miss.

## Instrumentation

`src/dataDiagnostics.ts` is a browser-local collector. Normally it is absent:
`VITE_AERO_DIAGNOSTICS_ENABLED` defaults false, and even a diagnostic-enabled build
requires `?mode=live&diagnostics=45` (30–60 minutes). It adds no UI control, polling
timer, provider request, analytics service, server log stream or database.

Recorded information:
- Attempt start/completion times, HTTP status, success/failure, safe error category,
  request duration, available `x-vercel-cache` and `Age` header values.
- Per-completed-poll context: snapshot/provider/primary/oldest-displayed-secondary
  ages, age since primary last appeared in a server snapshot, primary-change and
  missing-retention booleans, visibility and online state, clock anomaly flag.
- Delayed entries/exits, observed duration, and associated evidence flags:
  aged primary, newly selected aged primary, aged secondary, aged snapshot,
  retained/missing primary, failed request, clock anomaly, or undetermined.

No ICAO/callsign/registration, coordinates, positions, routes, owner, token,
credentials, URL, request headers or personal/browser identifier is exported.
No complete aircraft history is stored. The independent Stage 2B selector keeps
its already-authorised temporary distance history; the collector receives scalar
ages/booleans only. Enrichment completions never feed positional diagnostic events.

The summary includes attempts/successes/failures, delayed episode count, median/
longest observed delayed duration, failed-request-associated episodes, evidence
association counts, observed/inactive/unavailable time, delayed time and delayed fraction (null without
coverage), plus bounded
poll/episode details. Associations are nonexclusive correlations, **not causal labels**.
An undetermined category is retained when evidence is insufficient.

Bounds: 256 completed poll records, 256 completed episodes, one active episode,
counters saturated at 10,000, 64 lifecycle transitions, and at most 60 minutes. A truncated episode window
is explicitly flagged; duration medians/association counts then describe the retained
window, while total episode count and observed/delayed time remain cumulative.
An ongoing episode has `endMs=null`; its duration is censored at export time.
The normal 15-second cadence gives at most about 240 completed requests/hour.

Observed duration integrates the last reported active (visible and online) state.
Hidden/offline segments are excluded; suspension ends the current observed segment,
so a resumed delay may form another segment. Attempt gaps and context are available
for review. Deep suspension without a lifecycle notification, local clock changes,
or closing before export can limit evidence. Negative request durations become null;
clock anomalies are flagged. Timings are wall-clock diagnostics, not a guarantee
of monotonic measurement across clock changes. Classification of a live incident
requires examining the exported evidence, not merely the association counters.

## Subsequent trial, not started here

1. Separately authorise a replacement protected Preview of the Stage 2C commit.
   Keep both webpage and APIs protected; do not create a shareable link before
   validating the authenticated live operation. Leave production unchanged.
2. In that authorised environment only, enable the public diagnostic build flag.
   Open `/?mode=live&diagnostics=45` for a bounded 45-minute visible/online session.
   Enrichment can be disabled for a comparison trial; diagnostics do not require it.
3. The user need not watch each aircraft. After the period, explicitly export using
   `window.aeroPaneDiagnostics.export()` in authorised browser developer tools, or
   inspect `window.aeroPaneDiagnostics.summary()`. These return local data; they do
   not upload or save it. Any sharing/storage of that export is a separate deliberate
   action. Export before closing/reloading; temporary results are otherwise lost.
4. Review aged-secondary vs aged-primary evidence, newly acquired/retained cases,
   successful responses with older records, cache ages and errors (especially
   cooldown vs timeout/network/invalid-response). Check attempt gaps/visibility and
   clock flags before interpreting durations. Report live frequencies only then.
5. Collection stops accepting records at its time boundary on the next event/export.
   Existing aircraft operation continues normally. Unmount/live-mode stop freezes
   the collector, aborts pending application requests and removes the window handle.
   There is no background collection after closing the app. The bounded result stays
   local until exported or garbage-collected. Disable the build flag for normal use.

A narrowly evidenced correction can be reviewed after the trial. No reduction of
honest delayed indications, threshold change, Stage 2B retuning, or Stage 2D work
is implied by delivery of this instrumentation.

# Positional polling cooldown remediation

Source baseline: `c478576e1c2eda69c42f54175467e653cc798445`, branch
`stage-2c-aircraft-enrichment`, draft PR #3 targeting Stage 2B. The working tree was
clean; the remote PR head matched before implementation. No earlier PR/branch,
deployment, protection setting, live configuration or production alias was changed.

## Evidence and confirmed cause

The supplied original `aero-pane-diagnostics-2026-11-02-211027.json` was inspected
read-only. Its SHA-256 is
`302993382dc7b84ca4e0a93126258828fc65d0c2f14473445f8d4251a0552bbc`.
The original file is not copied into the repository; these are aggregate findings.

| Recorded measurement | Verified value |
| --- | --- |
| Planned duration | 45 minutes |
| Observed / inactive time | 2,690,697 / 9,303 ms |
| Polls / successful / failed | 180 / 117 / 63 |
| All failure statuses / categories | HTTP 503 / `cooldown` |
| CDN result | `MISS` on all 180 requests |
| Browser start interval, minimum / median | 15,000 / 15,001 ms |
| Delayed episodes / median / maximum | 33 / 15,234 / 15,626 ms |
| Delayed observed proportion | 18.54014% |
| Episodes associated with failed requests | 33 |
| Primary changes / clock anomalies | 18 / 3 |

All 62 failures with a subsequent poll in the retained file are followed by a
success; the final failure has no following poll inside this observation window.
On failures the previous snapshot age at completion is 14,371–14,953 ms (median
14,894). Successful replies have median snapshot age 113 ms and median provider
age 1,269 ms. Successful primary positions, where present, have median age 1,429.5 ms.
The three recorded clock anomalies and a minimum successful snapshot age of -6 ms
remain separate evidence; no timestamp clamping or clock-policy change was made.

The browser's at-least-15-second start schedule is correct. Network/processing time
varies between requests, so **server arrival spacing** can be slightly less than
15 seconds. In the original `server/service.ts`, a success was reusable only while
`now - cached.fetchedAtMs < 10000`, but the next provider request was forbidden until
15,000 ms after its predecessor's **start**. Once the first fetch completed, the
cache could expire before that gate opened. With no in-flight fetch and no prior
provider failure, `get()` then returned `ProviderError('cooldown', remainingMs)`.
`api/aircraft.ts` correctly surfaced that service error as HTTP 503, which the
unmodified client correctly reported as delayed when useful aircraft remained.

`cooldown` originates in that gate, not in adsb.fi's HTTP-error mapping. The observed
failure categories, fresh intervening successes, cache ages and client cadence
agree with this code path. The export does not contain server-start timestamps or
instance IDs, so individual server arrival gaps cannot be reconstructed exactly.
It does not establish that all delays or every future interruption have this cause.

Before editing the service, the new regression test **“a normal arrival at 14,999
ms reuses the original snapshot instead of cooldown”** failed against this exact
baseline with `ProviderError: cooldown`, `retryAfterMs: 1`. The same test passes
with the correction. No display threshold or client retry workaround was used.

## Narrow correction

The normal process cache TTL remains 10 seconds. While the 15-second provider gate
is closed, the service may return the previous successful snapshot if its receipt
age is nonnegative and **strictly less than 15 seconds**, and no refresh has failed.
This bridges only the cache/gate gap. It neither extends nor restarts the gate.
When the gate is open and the ordinary cache has expired, the provider is queried
immediately; this is not a blanket 15-second TTL measured from fetch completion.

The service reads the clock once for its admission decision. It returns the exact
cached object without advancing `fetchedAtMs`, `providerTimeMs` or aircraft position
times. Data freshness and selection still use the original timestamps. Cached
positions that are genuinely aged or anomalous continue to appear delayed/expired
under the unchanged 30/120-second policy. An in-progress fetch is still shared.

The last-error check also applies to the ordinary cache, so even a backward clock
adjustment cannot turn a failed refresh into an older cached success. Without a
safe cached result the gate still rejects; real provider errors/timeouts remain
failures and retain their existing cooldowns. At gate expiry a new request can
recover normally. No new retries, polling timers, state stores or dependencies.

Rejected alternatives: reducing the gate/timing tolerance would permit earlier
provider starts; globally increasing the TTL to 15 seconds after receipt can defer
a permitted refresh after a slow fetch; immediate browser retries add traffic and
leave the actual conflict in place. Reusing a recent success only within the
existing gate avoids these effects with one small server-only policy change.

## Request budget, concurrency and costs

| Behaviour | Before | After |
| --- | --- | --- |
| Browser starts, continuous default cadence | ≤240/hour, 5,760/day per client | Unchanged |
| Provider minimum start separation, warm process | 15 seconds | Unchanged |
| Maximum provider starts, warm process | ≤240/hour, 5,760/day | Unchanged |
| Same-process callers during provider fetch | Shared promise | Unchanged |
| Recent success between cache expiry and gate opening | HTTP 503 | Original cached success, with original ages |
| Genuine failure / rate / denial cooldowns | Existing error and retry-after handling | Unchanged |
| CDN success TTL / browser cache policy | 10 seconds / no-store | Unchanged |
| HexDB budget, concurrency and cache lifetimes | Separate policy | Unchanged |

Controlled comparison: 180 synthetic browser starts, 15 seconds apart, with repeating
arrival latencies `[250,150,220,180,260,160]` ms. The actual original and corrected
service modules were both exercised offline (the original was checked byte-for-byte
against the baseline Git blob). Original: **90 successes, 90 cooldowns, 90 provider
starts**. Corrected: **180 successes, zero cooldowns, 90 provider starts**. Minimum
provider-start gap in both was 29,970 ms. This is a timing scenario, not a replay
or an estimate of the live file's different 63-failure pattern.

Provider traffic does not increase merely to satisfy a request inside the existing
gate. Warm-process reuse can improve; at an open gate the same normal refresh
conditions apply. Function invocations remain bounded by browser requests and CDN
behaviour, not by any new retry loop. Cached successes replace short error bodies
with normal snapshots, so downstream bandwidth increases for those requests. For
illustration, 63 replacements at 20 KiB each add roughly 1.23 MiB over 45 minutes;
the diagnostic file does not measure payload bytes, and actual bodies vary.
There is no new paid service or billing configuration. Existing Hobby/account
headroom still needs hosted usage validation; these are request bounds, not a cost
guarantee for unlimited visitors.

**Process-local limitation:** separate warm/cold function instances and CDN regions
do not share this cache, promise or gate. Two simultaneous clients reaching two
instances can each trigger a provider request. N continuously active clients can
therefore still produce up to roughly N×240 provider starts/hour without effective
sharing. A distributed global cap is not introduced or claimed. The existing
protected personal Preview boundary and one-display trial remain important context.

## Validation

- All **111 named tests** pass: the existing 90 plus 21 cooldown tests. Boundary
  checks cover first request, 9,999 / 10,000 / 10,001 / 14,900 / 14,999 / 15,000 /
  15,001 ms; slow completion; 180 jittered polls; multiple callers and active-fetch
  coalescing; bursts; HTTP/timeout/rate/denial failures, error cooldown/recovery,
  safe age bounds, clock reversal, distinct instances and immutable timestamps.
- Updated inherited cache/gate tests now require cached success in the formerly
  failing window; inherited failure, rate protection and diagnostic tests remain.
- All **13 compiled-server HTTP checks** pass, including the inherited 11 plus
  plain-Node timing/burst and failed-refresh/recovery scenarios. Existing `.js`
  ESM imports are preserved; no Vite/TypeScript loader runs those HTTP handlers.
- Local `@vercel/node@29.0.1` packaging, explicitly targeting `nodejs24.x` with
  TypeScript 5.9.3, generated independent positional/enrichment artifacts. All
  seven positional and six enrichment HTTP checks also pass against those artifacts.
  Packaging reused installed dependencies in temporary directories; it was not a
  clean dependency-install test or hosted deployment. No project dependency changed.
- Lint, TypeScript/NodeNext checks and default/all-feature Safari 15 builds pass.
  All-feature browser assets still exclude synthetic private-config canaries.
- Existing Chromium landscape regressions pass: 18 pixel-identical simulations,
  12 live-state layouts, Stage 2B handover, optional enrichment, and on-screen export.
  Export JSON/schema, privacy, completion state, fallback and cleanup are unchanged.
  The poller/service integration test records five successful jittered requests,
  three provider starts, original cached snapshot ages and no additional timers.

No frontend, diagnostic schema/collector/export, selection, enrichment, endpoint
guard, Vercel configuration or dependency file changed. Safari 15 client assets are
identical to baseline. Physical iPad and hosted corrected-Preview acceptance were
not performed. Local emitted/packaged handler checks are not hosted certification.

## Separately authorised follow-up

Review PR #3, then separately authorise a corrected **protected Stage 2C Preview**.
Do not alter the current Preview or production as part of this assignment. Verify
authenticated positional API/rendering, then use the existing diagnostic-enabled
build and `/?mode=live&diagnostics=30` for a shorter 30-minute visible/online trial.
Tap **Export diagnostics** before closing/reloading; see [iPad instructions](DIAGNOSTIC_EXPORT.md).

Compare attempts, successes, HTTP/category counts, delay proportions, cached/source
ages and visibility/clock anomalies with the original evidence. Expected outcome:
normal near-boundary requests receive a recent original snapshot instead of 503.
Do not expect all delayed states to disappear: a skipped provider refresh can leave
positions genuinely aged before the following cycle, or a secondary/retained record
can age. Actual outages, rate limits and clock anomalies must remain visible.
No freshness/selection retuning or Stage 2D work is authorised by this correction.

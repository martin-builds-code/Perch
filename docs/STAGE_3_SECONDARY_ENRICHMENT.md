# Selective secondary route enrichment

Baseline: `39eab343311ffbb46f1cdc84d8d0973de378cc58`, verified locally,
on the remote `stage-3a-display-redesign` branch, and on open Draft PR #5.
This implements the subsequent authorised 90-second secondary lookup policy.
It supersedes the primary-only scheduling limitation described in the historical
[readability investigation](STAGE_3_ROUTE_TIMING.md).

## Scheduling and lifecycle

The existing `createEnricher` still owns one in-flight request. Existing scene
publications are the only scheduling opportunities; no timer, polling loop or
provider has been added. Primary identification for an unknown model comes first,
then its eligible route lookup, then other eligible primary identification.
Only when none of those is due may a secondary route use an idle opportunity.
An already running secondary request finishes or is aborted by normal lifecycle
cleanup; it cannot overlap a new primary request. Completion publishes cached
fields promptly but does not recursively schedule another request.

All attempts share the unchanged **30,000 ms** minimum interval. Secondary route
attempts also share one **90,000 ms** interval across every secondary aircraft.
Attempts consume both allowances even on failure or a server cache hit. The
90-second allowance is a ceiling, not a target: primary demand, absence of valid
callsigns, caches, errors and update timing can all reduce secondary traffic.

Production browser deadlines use `performance.now()`, independent of wall-clock
changes. Provider timestamps and HTTP-date Retry-After still use wall time; their
remaining duration is applied to the elapsed-time deadline. Numeric Retry-After,
error cooldowns and the single-request lock are retained. A non-finite or backward
elapsed clock cannot advance the local budget. The two deadlines remain in page
memory across `LiveApp` remounts when a tab is hidden or the appliance sleeps.
Aircraft records, cache contents and fairness history are cleared on stop; no
persistent storage has been introduced. Reloading or opening a separate page
creates a new page budget, as with the existing client-side architecture.

The existing appliance unmounts live tracking while asleep/hidden; disabling live
enrichment prevents creation of the enricher. Its active guard prevents new work
while hidden/offline, and stop aborts the pending request and clears its timeout.
No work runs after stop and no sleep/background timer was added. Authentication
and the independent 15-second positional path are unchanged.

## Eligibility, fairness and cache safety

Only aircraft in the latest displayed secondary array of an available or delayed
scene are considered. Expiry/geographical eligibility remains the existing
selector's responsibility; unavailable/standby scenes cannot start secondary work.
The identifier must be six hexadecimal characters and the callsign must satisfy
the existing normalized 2–8 alphanumeric validation. Primary/duplicate aircraft
are skipped. Neither callsign prefixes nor registration/operator guesses are used.

A complete valid native/cached route prevents a secondary request while it remains
unexpired, including during the existing refresh-lead window. A partial positive
result may refresh under the existing 30-second lead rule. A not-found result
cannot refresh before its five-minute negative TTL expires. Primary refresh-lead
behavior is unchanged. Route keys still contain both hex and normalized callsign;
changed callsigns cannot inherit a previous flight's route. Late results decorate
only matching aircraft in the latest scene, including after primary/secondary
handover, and never resurrect departed aircraft.

Among due secondaries, choose the flight least recently attempted. Unattempted
flights tie in the selector's existing relevance/display order. This prevents an
unsuccessful first card monopolising later opportunities. History contains only
currently displayed flights, is capped at 64 keys, and is cleared on stop. An
aircraft leaving/reappearing loses its fairness history, but its valid cache and
the page-wide 90-second deadline remain effective.

Existing TTLs/capacities remain: routes and negative results five minutes,
identity 30 minutes, client cache 64, server-process cache 128, client timeout five
seconds, provider timeout 2.5 seconds. Existing validation, source safeguards,
access-denial handling and Retry-After are unchanged. Failure cools down the
shared client scheduler for at least five minutes; it does not make positional
data unavailable. No cache or limit is claimed to be globally shared across Vercel
instances or multiple pages.

## Paired offline comparison

[Machine-readable results](stage3-secondary-enrichment/comparison.json) compare
the **actual baseline scheduler** extracted with `git show` against the revised
scheduler. Both receive identical 15-second scenes for **18 simulated hours per
pattern**. No HTTP/provider requests are made. Run from the repository root:

```sh
node --import tsx scripts/compare-secondary-enrichment.mjs
```

Quiet traffic has three arrivals per 20 minutes, moderate one per 120 seconds,
and busy one per 45 seconds. Aircraft enter/leave and at most four are displayed,
ordered by a deterministic synthetic pass-age signal. This isolates the scheduler;
it does not alter or attempt to calibrate Stage 2B. Every fourth model is unknown,
every third operator absent, every seventeenth callsign absent and every fifth
mock route unavailable. Mock replies complete within the same observation tick.
Transport latency/failures and multi-instance contention are not simulated.

Each cell below is **primary-only baseline → proposed**:

| Metric over 18 hours | Quiet | Moderate | Busy |
| --- | --- | --- | --- |
| Distinct successful flight-route identifications | 122 → 122 | 407 → 407 | 996 → 1,036 |
| Distinct secondary flights ever showing a route | 81/162 → 122/162 | 406/540 → 407/540 | 996/1,437 → 1,036/1,437 |
| Secondary flight coverage | 50.0% → 75.3% | 75.2% → 75.4% | 69.3% → 72.1% |
| Secondary display samples with complete routes | 33.4% → 75.0% | 37.7% → 47.6% | 38.5% → 43.3% |
| First detection to any route, median / p95 seconds | 210/240 → 0/30 | 180/210 → 90/180 | 60/90 → 60/90 |
| First detection to secondary route, median / p95 seconds | 300/300 → 0/300 | 300/300 → 90/300 | 105/105 → 105/105 |
| Primary first selection to route, median / p95 seconds | 0/30 → 0/30 | 0/30 → 0/0 | 0/30 → 0/30 |
| Total requests | 313 → 387 | 779 → 1,004 | 1,858 → 1,978 |
| Secondary requests | 0 → 134 | 0 → 661 | 0 → 420 |
| Total requests/hour | 17.39 → 21.50 | 43.28 → 55.78 | 103.22 → 109.89 |
| Secondary requests/hour | 0 → 7.44 | 0 → 36.72 | 0 → 23.33 |
| Unsuccessful route lookups | 39 → 62 | 101 → 141 | 249 → 262 |
| Unnecessary repeat lookups before cache refresh eligibility | 0 → 0 | 0 → 0 | 0 → 0 |
| Cached secondary route display samples | 1,082 → 2,430 | 4,862 → 6,146 | 4,977 → 5,599 |
| Cached secondary samples per route request | 4.66 → 7.94 | 9.55 → 8.37 | 4.00 → 4.31 |

The main benefit in moderate traffic is **earlier display**, rather than many more
unique flights: most eventually become primary even under the old policy. Cache
reuse metrics count sampled displayed routes, not independent cache-hit/provider
request statistics. Denominators include aircraft with absent callsigns or missing
mock routes, and latency metrics include only flights that obtained routes.

Paired primary-flight latency differences were zero or improvements in quiet and
moderate traffic. In busy traffic, **78 of 996 paired successful primary flights
were delayed by 15 seconds**, 278 improved and 640 were unchanged. Median extra
delay was zero, p95/max extra delay 15 seconds. A secondary can consume an idle
slot before a new primary appears; current-primary priority cannot predict future
handover. The shared gate was not weakened to avoid that tradeoff. Busy primary
flights without a route fell from 439 to 409; that count includes absent callsigns,
mock missing results and flights truncated at the trial boundary.

Every run asserted a minimum global gap of 30 seconds, secondary gap of 90 seconds,
maximum concurrency one, bounded cache, no absent-aircraft lookups and no premature
route repeats. These are **synthetic scheduling results**, not measured HexDB
coverage, flight-route accuracy or household performance. Real latency and a new
secondary provider failure can impose the existing shared cooldown on a subsequent
primary; that risk increases with actual use of previously idle slots.

## Cost and operational limits

Per continuously active page: secondary ceiling **40/hour, 720/18 hours**, within
the unchanged total ceiling **120/hour, 2,160/18 hours**. The ceilings are not added
together. The three proposed simulations used 134, 661 and 420 secondary requests,
all below 720, and never exceeded the global ceiling. Additional attempts count as
Vercel enrichment function invocations, even if a warm server cache avoids a
HexDB call. At an illustrative 2 KB/response, 720 secondary attempts are about
1.44 MB over 18 hours; actual payloads/compute and aggregate Hobby headroom remain
unmeasured. No paid service or new infrastructure is involved.

The server's existing one-per-process 30-second provider gate, caches, deduplication
and cooldowns remain unchanged. Several pages or Vercel processes do not provide a
globally shared 90-second provider allowance. The policy is for one household
display/page, with that existing architectural limitation explicitly retained.

## Validation and review

- 185 automated tests, including 22 new scheduler tests: primary priority, both
  deadlines, concurrency, fairness, positive/partial/negative caching, HTTP 429
  (numeric/date Retry-After), malformed JSON, network/503 errors, timeout, matching,
  role changes, disappearing/invalid records, inactivity, stop, clock jumps,
  bounded history and budget/cooldown retention through remount.
- 13 compiled plain-Node ESM HTTP checks; unchanged server implementation.
- Default and live/enrichment/diagnostics/appliance builds with Safari 15 targets,
  TypeScript/NodeNext and ESLint.
- New mocked live-browser checks at 1024×768 and 1024×624 show primary route first,
  identity next, secondary routes at 60 and 150 seconds, immediate secondary card
  publication without an extra position poll, no illustration movement/remount,
  unchanged 15-second polling, and stop/sleep/wake/disabled-enrichment behavior.
- Existing Stage 3 readability/layout, artwork, PIN, quiet-hours, diagnostics/export
  and unavailable-state regressions are rerun. See accompanying verification data.

[Browser evidence and screenshots](stage3-secondary-enrichment/browser-checks.json):
[regular](stage3-secondary-enrichment/secondary-routes-1024x768.png),
[compact](stage3-secondary-enrichment/secondary-routes-1024x624.png).
No CSS, artwork, tracking/selection, authentication, private observation or
quiet-hours source has changed. No provider calls, hosted trial, deployment,
configuration change or merge is performed for this work. Physical iPad/Safari
and real-route timing acceptance require a separately authorised Preview update;
the existing readability Preview remains available for comparison.

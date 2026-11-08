# Stage 3 — route availability investigation

Baseline: `b22a5c2ecefcf9c903aa91ee4dfe52b15eecdcdf`. Evidence is source inspection
and controlled fixtures/tests. No household or hosted monitoring was performed;
this investigation does not measure the frequency of real-world provider delays.

## Findings and the implemented correction

Routes originate from **HexDB**, through the existing server-side
`/api/enrichment?kind=route&hex=…&callsign=…` path. adsb.fi supplies positional and
aircraft records; `src/live.ts` deliberately initialises route fields to null.
`server/hexdb.ts` validates provider associations and airport metadata; no route is
guessed from the operator, aircraft type or callsign prefix.

The browser's `createEnricher` already decorates **both** `scene.primary` and
`scene.secondary` from its cache. However, the previous `Secondary` component
rendered type, callsign and measurements and **never rendered the available route
fields**. Thus a valid cached route could be present internally without appearing
on a secondary card. The readability revision corrects this: secondary cards now
render a complete validated IATA route through the existing `prominentRoute`
function. This is a small presentation correction with **zero additional requests**.

| Existing condition                                      | Availability/display effect                                                                                                | Treatment                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Native aircraft description is usable                   | Primary route lookup is prioritised before optional operator/registration lookup                                           | Unchanged                                                          |
| Primary model is missing                                | Identity lookup happens first; the next eligible update requests the route after the shared 30-second gate                 | Unchanged to preserve identification priority and budget           |
| Aircraft is only secondary and has no cached route      | It does not initiate enrichment; a route may remain unavailable until it becomes primary                                   | Documented limitation; no speculative/bulk secondary lookups added |
| Positive route cache                                    | Five-minute TTL; refresh becomes eligible in the final 30 seconds, subject to the common gate                              | Unchanged                                                          |
| Missing/negative route result                           | Cached for five minutes; no request on every positional poll                                                               | Unchanged                                                          |
| Failure or rate limit                                   | Five-minute error cooldown or a longer valid Retry-After                                                                   | Unchanged                                                          |
| Valid response completes while aircraft remains visible | `publish()` immediately decorates the latest scene and updates React; no need to wait for the next 15-second position poll | Preserved and tested                                               |
| Aircraft changes primary/secondary role                 | Matching cached data follows it, keyed by hex **and callsign**                                                             | Preserved and tested; routes now visible in secondary cards        |
| Callsign changes or cached association expires          | The old route is not reused for the new flight; cache is pruned at scene publication                                       | Preserved and tested                                               |
| Only ICAO codes or a partial route are supplied         | No large complete IATA route block is rendered                                                                             | Source-quality safeguard retained                                  |

The shared browser lookup gate permits at most **one lookup per 30 seconds total**
across aircraft identity and routes, with one in flight. It is driven by scene
updates, normally 15-second positional polls plus existing freshness/lifecycle
publications. With an initially unknown model, identity-first sequencing commonly
makes the route eligible about 30–45 seconds later, depending on update timing;
this is an architectural expectation, not a measured household latency guarantee.
Provider latency, missing data, negative caching and cooldowns can delay or prevent
the information. A full route is never fabricated to fill the visual space.

The client cache remains bounded to 64 entries, and each server process to 128.
Server memory is not globally shared between Vercel instances. Route associations
retain existing age/mismatch/contradiction validation and are best-effort
entertainment data. No database, new service, telemetry or provider was introduced.

## Regression evidence

Two additional integration tests in `tests/enrichment.test.tsx` establish:

- The aircraft renders before enrichment. A response that completes after its
  primary-to-secondary handover immediately populates the matching secondary route.
- Positional changes and promotion back to primary retain that route without a
  new lookup. A changed callsign or expired cache entry does not reuse it.
- Showing secondary cards does not cause any additional lookups. A missing model
  still obtains identity first and a route in the next permitted 30-second slot.

The browser readability checks also add routes to partially enriched cards while
the scene remains visible, verify that the route blocks appear immediately, and
prove that the primary illustration's coordinates do not move.

## Remaining decision

No request scheduling, TTL, cooldown, source validation or provider budget was
changed. At the existing ceiling, one continuously active display could make up to
120 enrichment lookups/hour if continuously needed, sharing identity and route
slots; actual use is usually lower because of caches and unavailable identifiers.
This revision adds **none**. Positional polling remains 15 seconds.

A separate improvement could consider selective secondary-route enrichment within
the same gate, after primary needs are met. Even without raising the ceiling,
using previously idle slots can increase actual provider traffic. It needs an
explicit request-budget decision and provider/hosting assessment before
implementation. Shorter negative caching or route-first unknown-model scheduling
would likewise be separate policy changes. No such change is hidden in this UI work.

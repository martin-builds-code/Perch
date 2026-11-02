import { fetchHexdb, EnrichmentError, validateLookup } from './hexdb.js';
import {
  ENRICHMENT_POLICY as P,
  enrichmentKey,
} from '../src/enrichmentTypes.js';
import type {
  EnrichmentKind,
  EnrichmentResult,
  Supplement,
} from '../src/enrichmentTypes.js';
export function createEnrichmentService(
  load: (
    kind: EnrichmentKind,
    hex: string,
    callsign: string | null,
  ) => Promise<Supplement | null> = fetchHexdb,
  now = Date.now,
) {
  const cache = new Map<string, EnrichmentResult>();
  let pending: { key: string; promise: Promise<EnrichmentResult> } | null =
      null,
    nextAllowed = 0;
  async function get(
    kind: EnrichmentKind,
    hex: string,
    callsign: string | null,
  ) {
    const input = validateLookup(kind, hex, callsign),
      key = enrichmentKey(input.kind, input.hex, input.callsign),
      time = now();
    for (const [k, v] of cache)
      if (v.expiresAtMs <= time || v.fetchedAtMs > time) cache.delete(k);
    const hit = cache.get(key);
    if (
      hit &&
      (hit.status === 'not-found' ||
        hit.expiresAtMs - time > P.refreshLeadMs ||
        pending ||
        time < nextAllowed)
    )
      return { result: hit, cache: 'hit' };
    if (pending?.key === key)
      return { result: await pending.promise, cache: 'coalesced' };
    if (pending || time < nextAllowed)
      throw new EnrichmentError(
        'cooldown',
        Math.max(P.intervalMs, nextAllowed - time),
      );
    nextAllowed = time + P.intervalMs;
    const promise = load(input.kind, input.hex, input.callsign)
      .then((data) => {
        const fetchedAtMs = now();
        const ttl = data
          ? kind === 'aircraft'
            ? P.identityTtlMs
            : P.routeTtlMs
          : P.negativeTtlMs;
        const result: EnrichmentResult = {
          ...input,
          source: 'hexdb.io',
          status: data ? 'found' : 'not-found',
          data: data ?? {},
          fetchedAtMs,
          expiresAtMs: fetchedAtMs + ttl,
        };
        if (cache.size >= P.serverCapacity)
          cache.delete(cache.keys().next().value!);
        cache.set(key, result);
        return result;
      })
      .catch((error) => {
        const failure =
          error instanceof EnrichmentError
            ? error
            : new EnrichmentError('unavailable');
        nextAllowed = Math.max(nextAllowed, now() + failure.retryAfterMs);
        throw failure;
      })
      .finally(() => {
        pending = null;
      });
    pending = { key, promise };
    return { result: await promise, cache: 'miss' };
  }
  return {
    get,
    inspect: () => ({ entries: cache.size, inFlight: pending ? 1 : 0 }),
  };
}
const service = createEnrichmentService();
export { service as enrichmentService };

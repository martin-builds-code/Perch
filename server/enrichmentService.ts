import type { ProviderTrace } from '../src/routeTraceTypes.js';
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
export class LocalEnrichmentDeferral extends EnrichmentError {
  constructor(
    public reason: 'global-gate' | 'in-flight',
    retryAfterMs: number,
  ) {
    super('cooldown', retryAfterMs);
    this.serverCache = 'none';
  }
}
function requestFailure(error: unknown, cache: 'miss' | 'coalesced') {
  const failure =
    error instanceof EnrichmentError
      ? error
      : new EnrichmentError('unavailable');
  const copy = new EnrichmentError(failure.code, failure.retryAfterMs);
  copy.origin =
    error instanceof EnrichmentError ? failure.origin : 'unexpected';
  copy.trace = failure.trace;
  copy.serverCache = cache;
  return copy;
}
export function createEnrichmentService(
  load: (
    kind: EnrichmentKind,
    hex: string,
    callsign: string | null,
    observe?: (trace: ProviderTrace) => void,
  ) => Promise<Supplement | null> = (kind, hex, callsign, observe) =>
    fetchHexdb(kind, hex, callsign, fetch, Date.now, P.timeoutMs, observe),
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
    diagnostics = false,
  ) {
    const input = validateLookup(kind, hex, callsign),
      key = enrichmentKey(input.kind, input.hex, input.callsign),
      time = now();
    for (const [k, v] of cache)
      if (v.expiresAtMs <= time || v.fetchedAtMs > time ||
          (v.data.associationTimeMs != null && time-v.data.associationTimeMs>P.maxRouteAgeMs)) cache.delete(k);
    const hit = cache.get(key);
    if (
      hit &&
      (hit.status === 'not-found' ||
        hit.expiresAtMs - time > P.refreshLeadMs ||
        pending ||
        time < nextAllowed)
    )
      return { result: hit, cache: 'hit' as const };
    if (pending?.key === key) {
      try {
        return {
          result: await pending.promise,
          cache: 'coalesced' as const,
        };
      } catch (error) {
        throw requestFailure(error, 'coalesced');
      }
    }
    if (pending || time < nextAllowed)
      throw new LocalEnrichmentDeferral(
        pending ? 'in-flight' : 'global-gate',
        Math.max(P.intervalMs, nextAllowed - time),
      );
    nextAllowed = time + P.intervalMs;
    let providerTrace: ProviderTrace | undefined;
    const promise = load(
      input.kind,
      input.hex,
      input.callsign,
      diagnostics
        ? (t) => {
            providerTrace = t;
          }
        : undefined,
    )
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
          ...(providerTrace ? { providerTrace } : {}),
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
        if (!(error instanceof EnrichmentError))
          failure.origin = 'unexpected';
        nextAllowed = Math.max(nextAllowed, now() + failure.retryAfterMs);
        throw failure;
      })
      .finally(() => {
        pending = null;
      });
    pending = { key, promise };
    try {
      return { result: await promise, cache: 'miss' as const };
    } catch (error) {
      throw requestFailure(error, 'miss');
    }
  }
  return {
    get,
    inspect: () => ({ entries: cache.size, inFlight: pending ? 1 : 0 }),
  };
}
const service = createEnrichmentService();
export { service as enrichmentService };

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  ADAPTIVE_POLICY as A,
  advanceAdaptiveState,
  adaptiveEligibility,
  adaptiveView,
  reserveAdaptive,
  finishAdaptive,
} from '../src/adaptiveBudget.js';
import type { AdaptiveView } from '../src/adaptiveBudget.js';
import type {
  EnrichmentKind,
  EnrichmentResult,
  Supplement,
} from '../src/enrichmentTypes.js';
import {
  ENRICHMENT_POLICY as P,
  enrichmentKey,
} from '../src/enrichmentTypes.js';
import type { ProviderTrace } from '../src/routeTraceTypes.js';
import type { Coordinator } from './adaptiveCoordinator.js';
import { createCoordinator } from './adaptiveCoordinator.js';
import { EnrichmentError, fetchHexdb, validateLookup } from './hexdb.js';

export class AdaptiveDeferral extends EnrichmentError {
  constructor(
    public reason: string,
    retryAfterMs: number,
    public budget?: AdaptiveView,
  ) {
    super('cooldown', Math.max(1000, Math.ceil(retryAfterMs)));
    this.serverCache = 'none';
  }
}
export interface AdaptiveResponse {
  result: EnrichmentResult;
  cache: 'hit' | 'miss';
  budget: AdaptiveView;
  upstreamStartedAtMs?: number;
}
function usable(
  result: EnrichmentResult | null,
  input: ReturnType<typeof validateLookup>,
  now: number,
): result is EnrichmentResult {
  return (
    !!result &&
    result.kind === input.kind &&
    result.hex === input.hex &&
    result.callsign === input.callsign &&
    result.source === 'hexdb.io' &&
    ['found', 'not-found'].includes(result.status) &&
    !!result.data &&
    Number.isFinite(result.fetchedAtMs) &&
    result.fetchedAtMs <= now &&
    Number.isFinite(result.expiresAtMs) &&
    result.expiresAtMs > now &&
    result.expiresAtMs <=
      result.fetchedAtMs +
        (input.kind === 'aircraft' ? P.identityTtlMs : P.routeTtlMs) &&
    (result.data.associationTimeMs == null ||
      (Number.isFinite(result.data.associationTimeMs) &&
        result.data.associationTimeMs <= now &&
        now - result.data.associationTimeMs <= P.maxRouteAgeMs))
  );
}
export function createAdaptiveEnrichmentService(
  coordinator: () => Coordinator = () => createCoordinator(),
  load: (
    kind: EnrichmentKind,
    hex: string,
    callsign: string | null,
    observe: (trace: ProviderTrace) => void,
  ) => Promise<Supplement | null> = (kind, hex, callsign, observe) =>
    fetchHexdb(kind, hex, callsign, fetch, Date.now, P.timeoutMs, observe),
  monotonicNow = () => performance.now(),
  wallNow = Date.now,
) {
  async function get(
    kind: EnrichmentKind,
    hex: string,
    callsign: string | null,
    normal = false,
  ): Promise<AdaptiveResponse> {
    const input = validateLookup(kind, hex, callsign);
    let store: Coordinator;
    try {
      store = coordinator();
    } catch {
      throw new AdaptiveDeferral('coordination-unavailable', 30_000);
    }
    const key = store.key(
        enrichmentKey(input.kind, input.hex, input.callsign),
      ),
      id = randomUUID();
    let acquired = false,
      startedAt = 0,
      trace: ProviderTrace | undefined;
    const read = async () => {
      try {
        return await store.read(key);
      } catch {
        throw new AdaptiveDeferral('coordination-unavailable', 30_000);
      }
    };
    const swap: Coordinator['swap'] = async (...args) => {
      try {
        return await store.swap(...args);
      } catch {
        throw new AdaptiveDeferral('coordination-unavailable', 30_000);
      }
    };
    for (let i = 0; i < 3; i++) {
      const r = await read(),
        state = advanceAdaptiveState(r.state, r.nowMs);
      // Persist an abandoned-lease recovery before anybody can dispatch again.
      if (state.recoveries !== r.state.recoveries) {
        if (!(await swap(key, r, state))) continue;
        continue;
      }
      const hit = store.cacheValue(r);
      if (
        usable(hit, input, r.nowMs) &&
        (hit.status === 'not-found' ||
          hit.expiresAtMs - r.nowMs > P.refreshLeadMs ||
          state.pending ||
          adaptiveEligibility(state, normal).waitMs > 0)
      )
        return { result: hit, cache: 'hit', budget: adaptiveView(state) };
      const gate = adaptiveEligibility(state, normal);
      if (gate.waitMs || state.pending)
        throw new AdaptiveDeferral(
          gate.reason,
          gate.waitMs,
          adaptiveView(state),
        );
      const start = monotonicNow();
      if (!(await swap(key, r, reserveAdaptive(state, id, key, normal))))
        continue;
      acquired = true;
      // A late/paused handler must not dispatch using an old reservation. The
      // 120s recovery lease additionally exceeds the platform's hard 15s limit.
      if (
        !Number.isFinite(start) ||
        monotonicNow() - start < 0 ||
        monotonicNow() - start > A.dispatchValidityMs
      )
        throw new AdaptiveDeferral('coordination-unavailable', 30_000);
      break;
    }
    if (!acquired)
      throw new AdaptiveDeferral('coordination-unavailable', 10_000);
    let data: Supplement | null = null,
      failure: EnrichmentError | undefined;
    try {
      startedAt = wallNow();
      data = await load(input.kind, input.hex, input.callsign, (t) => {
        trace = t;
      });
    } catch (error) {
      failure =
        error instanceof EnrichmentError
          ? error
          : new EnrichmentError('unavailable');
      if (!(error instanceof EnrichmentError))
        failure.origin = 'unexpected';
    }
    try {
      for (let i = 0; i < 3; i++) {
        const r = await read(),
          state = advanceAdaptiveState(r.state, r.nowMs);
        if (state.pending?.id !== id)
          throw new AdaptiveDeferral(
            'coordination-unavailable',
            30_000,
            adaptiveView(state),
          );
        const finished = finishAdaptive(
          state,
          id,
          failure,
          trace
            ? {
                started: trace.requestStarted,
                responded: trace.httpStatus !== null,
                outcome: trace.outcome,
                reason: trace.reason,
                historical:
                  trace.outcome === 'complete' &&
                  data?.associationTimeMs != null &&
                  state.updatedAtMs - data.associationTimeMs >
                    P.recentRouteAgeMs,
              }
            : undefined,
        );
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
          fetchedAtMs: r.nowMs,
          expiresAtMs: r.nowMs + ttl,
          ...(trace ? { providerTrace: trace } : {}),
        };
        if (!(await swap(key, r, finished, failure ? undefined : result)))
          continue;
        if (failure) {
          // Shared escalating provider backoff cannot be shortened by a viewer.
          failure.retryAfterMs = Math.max(
            failure.retryAfterMs,
            finished.cooldownUntilMs - finished.updatedAtMs,
          );
          failure.serverCache = 'miss';
          failure.trace = trace ?? failure.trace;
          throw failure;
        }
        return {
          result,
          cache: 'miss',
          budget: adaptiveView(finished),
          upstreamStartedAtMs: trace?.requestStartedAtMs ?? startedAt,
        };
      }
      // An uncertain completion remains charged; subsequent callers fail closed
      // or recover after the verified runtime bound. No duplicate fetch/retry here.
      throw new AdaptiveDeferral('coordination-unavailable', 30_000);
    } catch (error) {
      if (error === failure) throw error;
      const e = new EnrichmentError('coordination-after-request', 300_000);
      e.origin = 'application';
      e.serverCache = 'miss';
      e.trace = trace ?? {
        requestStarted: true,
        httpStatus: null,
        outcome: 'error',
        reason: 'coordination-after-request',
        endpoint:
          kind === 'route' ? 'v2/routes/:callsign' : 'v2/aircraft/:hex',
      };
      throw e;
    }
  }
  return { get };
}
export const adaptiveEnrichmentService = createAdaptiveEnrichmentService();

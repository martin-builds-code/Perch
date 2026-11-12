// Frozen R03 baseline c230231; test/replay only.
import type { EnrichmentEvent, LookupRef } from '../../src/routeDiagnostics';
import { parseEnrichmentDiagnostic } from '../../src/routeTraceTypes';
import type { EnrichmentDiagnostic } from '../../src/routeTraceTypes';
import {
  parseEnrichmentFailure,
  readEnrichmentFailure,
  verifiedLocalDeferral,
} from '../../src/enrichmentFailure';
import type {
  EnrichmentFailure,
  EnrichmentScheduling,
} from '../../src/enrichmentFailure';
import type { Aircraft, Scene } from '../../src/simulation';
import type {
  EnrichmentResult,
  EnrichmentKind,
  Supplement,
} from '../../src/enrichmentTypes';
import {
  ENRICHMENT_POLICY as P,
  enrichmentKey,
  flightKey,
  validHex,
} from '../../src/enrichmentTypes';
export interface EnrichmentBudget {
  nextAllowed: number;
  nextSecondaryAllowed: number;
}
export interface EnrichmentEnvironment {
  fetch: typeof fetch;
  now: () => number;
  // Wall time still validates provider timestamps; elapsed time budgets requests.
  monotonicNow?: () => number;
  // A page may reuse deadlines across visibility/sleep remounts, never caches.
  budget?: EnrichmentBudget;
  active: () => boolean;
  observe?: (event: EnrichmentEvent) => void;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}
function validResult(
  v: unknown,
  kind: EnrichmentKind,
  hex: string,
  callsign: string | null,
  now: number,
): v is EnrichmentResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as EnrichmentResult;
  if (
    r.kind !== kind ||
    r.hex !== hex ||
    r.callsign !== callsign ||
    r.source !== 'hexdb.io' ||
    !['found', 'not-found'].includes(r.status) ||
    !r.data ||
    typeof r.data !== 'object' ||
    Array.isArray(r.data)
  )
    return false;
  const ttl = kind === 'aircraft' ? P.identityTtlMs : P.routeTtlMs;
  if (
    !Number.isFinite(r.fetchedAtMs) ||
    !Number.isFinite(r.expiresAtMs) ||
    r.fetchedAtMs > now ||
    r.expiresAtMs <= now ||
    r.expiresAtMs > r.fetchedAtMs + ttl
  )
    return false;
  for (const field of ['description', 'registration', 'operator'] as const)
    if (
      r.data[field] !== undefined &&
      (typeof r.data[field] !== 'string' || r.data[field]!.length > 120)
    )
      return false;
  for (const field of ['origin', 'destination'] as const) {
    const a = r.data[field];
    if (
      a !== undefined &&
      (!a ||
        typeof a.code !== 'string' ||
        !/^[A-Z]{3,4}$/.test(a.code) ||
        typeof a.name !== 'string' ||
        a.name.length > 64)
    )
      return false;
  }
  if (r.data.associationTimeMs !== undefined && r.data.associationTimeMs !== null &&
    (!Number.isFinite(r.data.associationTimeMs) || r.data.associationTimeMs > now || now-r.data.associationTimeMs > P.maxRouteAgeMs)) return false;
  return true;
}
export function supplementAircraft(
  a: Aircraft,
  identity: Supplement | undefined,
  route: Supplement | undefined,
  now = Date.now(),
): { aircraft: Aircraft; used: boolean } {
  const next = { ...a };
  if (identity) {
    if (!a.registration && identity.registration)
      next.registration = identity.registration;
    if (!a.operator && identity.operator)
      next.operator = identity.operator;
    if (
      (a.model === null ||
        a.model === 'Aircraft' ||
        a.model.startsWith('Aircraft ·')) &&
      identity.description
    ) {
      const match = identity.description.match(
        /^(Airbus|Boeing|Embraer|Cessna|ATR)\s+(.+)$/,
      );
      next.manufacturer = match ? match[1] : null;
      next.model = match ? match[2] : identity.description;
    }
  }
  if (route) {
    next.routeHistorical = route.associationTimeMs == null ? undefined : now - route.associationTimeMs > P.recentRouteAgeMs;
    if (!a.origin && route.origin) next.origin = route.origin;
    if (!a.destination && route.destination)
      next.destination = route.destination;
  }
  return {
    aircraft: next,
    used:
      next.registration !== a.registration ||
      next.operator !== a.operator ||
      next.model !== a.model ||
      next.origin !== a.origin ||
      next.destination !== a.destination ||
      next.routeHistorical !== a.routeHistorical,
  };
}
export function createEnricher(
  onScene: (scene: Scene, credited: boolean) => void,
  env: EnrichmentEnvironment,
) {
  let stopped = false,
    base: Scene | null = null,
    inFlight = false,
    budgetTime = 0,
    controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cache = new Map<string, EnrichmentResult>();
  const budget = env.budget ?? { nextAllowed: 0, nextSecondaryAllowed: 0 };
  const secondaryAttempts = new Map<string, number>();
  let pending: LookupRef | null = null;
  function emit(event: EnrichmentEvent) {
    try {
      env.observe?.(event);
    } catch {
      /* Diagnostic failure cannot change tracking. */
    }
  }
  function report(scene?: Scene) {
    if (!env.observe || !base || stopped) return;
    const current = scene ?? {
      ...base,
      primary: base.primary ? decorate(base.primary).aircraft : null,
      secondary: base.secondary.map((a) => decorate(a).aircraft),
    };
    const t = budgetNow();
    emit({
      type: 'scene',
      atMs: env.now(),
      scene: current,
      globalWaitMs: Math.max(0, budget.nextAllowed - t),
      secondaryWaitMs: Math.max(0, budget.nextSecondaryAllowed - t),
      active: env.active(),
      pending,
      primaryEligible: !!(
        base.primary &&
        validHex(base.primary.id) &&
        primaryCandidate(base.primary)
      ),
      routes: [base.primary, ...base.secondary]
        .filter((a): a is Aircraft => !!a)
        .map((a) => ({
          key: a.id.toLowerCase() + ':' + (flightKey(a.callsign) ?? ''),
          result: cache.get(
            enrichmentKey('route', a.id, flightKey(a.callsign)),
          ),
        })),
    });
  }
  function budgetNow() {
    const time = (env.monotonicNow ?? env.now)();
    if (!Number.isFinite(time)) return budgetTime;
    // A broken/backwards clock cannot reopen an already consumed request slot.
    budgetTime = Math.max(budgetTime, time);
    return budgetTime;
  }
  function prune() {
    for (const [key, value] of cache)
      if (value.expiresAtMs <= env.now() || value.fetchedAtMs > env.now() ||
        (value.data.associationTimeMs != null && env.now()-value.data.associationTimeMs>P.maxRouteAgeMs))
        cache.delete(key);
  }
  function due(key: string) {
    const value = cache.get(key);
    return (
      !value ||
      (value.status === 'found' &&
        value.expiresAtMs - env.now() <= P.refreshLeadMs)
    );
  }
  function decorate(a: Aircraft) {
    const hex = a.id.toLowerCase(),
      flight = flightKey(a.callsign);
    return supplementAircraft(
      a,
      cache.get(enrichmentKey('aircraft', hex, null))?.data,
      flight
        ? cache.get(enrichmentKey('route', hex, flight))?.data
        : undefined,
      env.now(),
    );
  }
  function publish() {
    if (stopped || !base) return;
    prune();
    const primary = base.primary ? decorate(base.primary) : null;
    const secondary = base.secondary.map(decorate);
    const scene = {
      ...base,
      primary: primary?.aircraft ?? null,
      secondary: secondary.map((a) => a.aircraft),
    };
    onScene(scene, !!primary?.used || secondary.some((a) => a.used));
    report(scene);
  }
  async function lookup(
    kind: EnrichmentKind,
    hex: string,
    callsign: string | null,
    secondary = false,
  ) {
    inFlight = true;
    const started = budgetNow(),
      wallStarted = env.now();
    const lookupRef: LookupRef = { kind, hex, callsign, secondary };
    pending = lookupRef;
    let errorCode = 'network-or-timeout';
    let apiStatus: number | null = null,
      diagnostic: EnrichmentDiagnostic | undefined;
    let failure: EnrichmentFailure | undefined;
    let retryAfterMs = NaN;
    function applyWait(
      delay: number,
      local?: ReturnType<typeof verifiedLocalDeferral>,
    ): EnrichmentScheduling {
      const at = budgetNow(),
        wall = env.now();
      const priorGlobalWaitMs = Math.max(0, budget.nextAllowed - at);
      budget.nextAllowed = Math.max(
        budget.nextAllowed,
        at + (local ? local.waitMs : P.errorCooldownMs),
        Number.isFinite(delay) ? at + delay : 0,
      );
      const globalWaitMs = Math.max(0, budget.nextAllowed - at),
        secondaryWaitMs = Math.max(0, budget.nextSecondaryAllowed - at);
      return {
        treatment: local ? 'local-deferral' : 'failure-backoff',
        reason: local
          ? (local.failure.reason as 'global-gate' | 'in-flight')
          : 'failure',
        serverRetryAfterMs: local
          ? local.failure.retryAfterMs
          : Number.isFinite(delay)
            ? delay
            : null,
        serverWaitMs: local
          ? local.waitMs
          : Number.isFinite(delay)
            ? delay
            : null,
        priorGlobalWaitMs,
        globalWaitMs,
        secondaryWaitMs,
        nextGlobalEligibleAtMs: wall + globalWaitMs,
        nextSecondaryEligibleAtMs:
          wall + Math.max(globalWaitMs, secondaryWaitMs),
      };
    }
    emit({
      type: 'attempt',
      atMs: wallStarted,
      elapsedMs: started,
      lookup: lookupRef,
    });
    budget.nextAllowed = started + P.intervalMs;
    if (secondary) {
      budget.nextSecondaryAllowed = started + P.secondaryIntervalMs;
      secondaryAttempts.set(enrichmentKey(kind, hex, callsign), started);
      if (secondaryAttempts.size > P.clientCapacity)
        secondaryAttempts.delete(secondaryAttempts.keys().next().value!);
    }
    controller = new AbortController();
    const request = controller;
    timeout = env.setTimer(() => request.abort(), P.clientTimeoutMs);
    try {
      const query = new URLSearchParams({ kind, hex });
      if (callsign) query.set('callsign', callsign);
      const response = await env.fetch(
        '/api/enrichment?' + query.toString(),
        {
          signal: request.signal,
        },
      );
      if (stopped) return;
      // Retain the authoritative header before reading a potentially slow or
      // malformed body, including when the body subsequently times out.
      const rawRetry = response.headers.get('retry-after');
      const retrySeconds = rawRetry === null ? NaN : Number(rawRetry);
      retryAfterMs = Number.isFinite(retrySeconds)
        ? retrySeconds * 1000
        : rawRetry
          ? Date.parse(rawRetry) - env.now()
          : NaN;
      if (request.signal.aborted) throw Error('request-aborted');
      apiStatus = response.status;
      if (!response.ok) {
        let error = 'api-http-error';
        const body = await readEnrichmentFailure(response);
        if (stopped) return;
        if (body && typeof body === 'object') {
          const payload = body as {
            error?: unknown;
            failure?: unknown;
            diagnostic?: unknown;
          };
          diagnostic = parseEnrichmentDiagnostic(payload.diagnostic);
          failure = parseEnrichmentFailure(payload.failure);
          if (
            typeof payload.error === 'string' &&
            /^[a-z0-9-]{1,64}$/.test(payload.error)
          )
            error = payload.error;
        }
        // Validated body metadata may lengthen protection, never shorten it.
        retryAfterMs = Math.max(
          Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
          failure?.retryAfterMs ?? 0,
        );
        if (request.signal.aborted) throw Error('request-aborted');
        const local = verifiedLocalDeferral(response, body);
        const scheduling = applyWait(
          local ? local.waitMs : retryAfterMs,
          local,
        );
        emit({
          type: 'response',
          atMs: env.now(),
          lookup: lookupRef,
          ok: false,
          apiStatus,
          diagnostic,
          failure,
          scheduling,
          error,
          durationMs: budgetNow() - started,
          startedElapsedMs: started,
          elapsedMs: budgetNow(),
          clientCooldownMs: Math.max(0, budget.nextAllowed - budgetNow()),
        });
        return;
      }
      errorCode = 'api-invalid-json';
      const result: unknown = await response.json();
      if (env.observe && result && typeof result === 'object')
        diagnostic = parseEnrichmentDiagnostic(
          (result as EnrichmentResult).diagnostic,
        );
      if (!validResult(result, kind, hex, callsign, env.now())) {
        const v = result as Partial<EnrichmentResult> | null;
        errorCode =
          v &&
          typeof v === 'object' &&
          Number.isFinite(v.fetchedAtMs) &&
          v.fetchedAtMs! > env.now()
            ? 'client-future-server-timestamp'
            : v &&
                typeof v === 'object' &&
                Number.isFinite(v.expiresAtMs) &&
                v.expiresAtMs! <= env.now()
              ? 'client-expired-server-cache'
              : v &&
                  typeof v === 'object' &&
                  (v.hex !== hex || v.callsign !== callsign)
                ? 'client-identity-mismatch'
                : 'client-validation-failed';
        throw Error('invalid-enrichment');
      }
      if (stopped || request.signal.aborted) return;
      if (cache.size >= P.clientCapacity)
        cache.delete(cache.keys().next().value!);
      cache.set(
        enrichmentKey(kind, hex, callsign),
        env.observe ? { ...result, diagnostic } : result,
      );
      emit({
        type: 'response',
        atMs: env.now(),
        lookup: lookupRef,
        ok: true,
        apiStatus,
        diagnostic,
        durationMs: budgetNow() - started,
        startedElapsedMs: started,
        elapsedMs: budgetNow(),
        clientCooldownMs: 0,
      });
      publish();
    } catch {
      if (!stopped) {
        const scheduling = applyWait(retryAfterMs);
        emit({
          type: 'response',
          atMs: env.now(),
          lookup: lookupRef,
          ok: false,
          apiStatus,
          diagnostic,
          failure,
          scheduling,
          error: errorCode,
          durationMs: budgetNow() - started,
          startedElapsedMs: started,
          elapsedMs: budgetNow(),
          clientCooldownMs: Math.max(0, budget.nextAllowed - budgetNow()),
        });
      }
    } finally {
      if (timeout !== undefined) env.clearTimer(timeout);
      timeout = undefined;
      inFlight = false;
      controller = null;
      pending = null;
      report();
    }
  }
  function update(scene: Scene) {
    if (stopped) return;
    base = scene;
    publish();
    const present = new Set(
      scene.secondary.map((a) =>
        enrichmentKey('route', a.id, flightKey(a.callsign)),
      ),
    );
    for (const key of secondaryAttempts.keys())
      if (!present.has(key)) secondaryAttempts.delete(key);
    const time = budgetNow();
    const a = scene.primary;
    if (
      !a ||
      !env.active() ||
      inFlight ||
      !Number.isFinite(time) ||
      time < budget.nextAllowed
    )
      return;
    const primary = validHex(a.id) ? primaryCandidate(a) : null;
    if (primary) {
      void lookup(primary.kind, primary.hex, primary.callsign);
      return;
    }
    if (
      time < budget.nextSecondaryAllowed ||
      !['available', 'delayed'].includes(scene.state)
    )
      return;
    // Oldest attempt first; unattempted flights tie in selector/display order.
    // Only current displayed flights participate; routes follow hex + callsign.
    let candidate:
      | { hex: string; callsign: string; last: number }
      | undefined;
    const seen = new Set([a.id.toLowerCase()]);
    for (const other of scene.secondary) {
      const hex = other.id.toLowerCase(),
        callsign = flightKey(other.callsign);
      if (seen.has(hex) || !validHex(hex) || !callsign) continue;
      seen.add(hex);
      const key = enrichmentKey('route', hex, callsign);
      const current = decorate(other).aircraft;
      const complete =
        [current.origin, current.destination].every(
          (airport) => airport && /^[A-Z]{3,4}$/.test(airport.code),
        ) && current.origin!.code !== current.destination!.code;
      if (complete || !due(key)) continue;
      const last = secondaryAttempts.get(key) ?? -Infinity;
      if (!candidate || last < candidate.last)
        candidate = { hex, callsign, last };
    }
    if (candidate)
      void lookup('route', candidate.hex, candidate.callsign, true);
  }
  function primaryCandidate(a: Aircraft): LookupRef | null {
    const hex = a.id.toLowerCase(),
      callsign = flightKey(a.callsign);
    const missingModel =
      a.model === null ||
      a.model === 'Aircraft' ||
      a.model.startsWith('Aircraft ·');
    if (missingModel && due(enrichmentKey('aircraft', hex, null))) {
      return { kind: 'aircraft', hex, callsign: null, secondary: false };
    }
    if (
      callsign &&
      (!a.origin || !a.destination) &&
      due(enrichmentKey('route', hex, callsign))
    ) {
      return { kind: 'route', hex, callsign, secondary: false };
    }
    if (
      (!a.operator ||
        !a.registration ||
        a.model === null ||
        a.model === 'Aircraft' ||
        a.model.startsWith('Aircraft ·')) &&
      due(enrichmentKey('aircraft', hex, null))
    ) {
      return { kind: 'aircraft', hex, callsign: null, secondary: false };
    }
    return null;
  }
  return {
    update,
    inspect: () => ({
      entries: cache.size,
      inFlight: inFlight ? 1 : 0,
      secondaryAttempts: secondaryAttempts.size,
    }),
    stop: () => {
      stopped = true;
      controller?.abort();
      if (timeout !== undefined) env.clearTimer(timeout);
      cache.clear();
      secondaryAttempts.clear();
      base = null;
    },
  };
}

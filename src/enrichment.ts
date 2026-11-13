import { urgencyFor, urgentPass, OBSERVATION_POLICY } from './observation';
import { routeUtilityHint } from './routeUtility';
import { ADAPTIVE_POLICY as A, parseAdaptiveView } from './adaptiveBudget';
import type { AdaptiveView } from './adaptiveBudget';
import { verifiedAdaptiveDeferral } from './adaptiveFailure';
import type { EnrichmentEvent, LookupRef } from './routeDiagnostics';
import { parseEnrichmentDiagnostic } from './routeTraceTypes';
import type { EnrichmentDiagnostic } from './routeTraceTypes';
import {
  parseEnrichmentFailure,
  readEnrichmentFailure,
  verifiedLocalDeferral,
} from './enrichmentFailure';
import type {
  EnrichmentFailure,
  EnrichmentScheduling,
} from './enrichmentFailure';
import type { Aircraft, Scene } from './simulation';
import type {
  EnrichmentResult,
  EnrichmentKind,
  Supplement,
} from './enrichmentTypes';
import {
  ENRICHMENT_POLICY as P,
  enrichmentKey,
  flightKey,
  validHex,
} from './enrichmentTypes';
export interface EnrichmentBudget {
  nextAllowed: number;
  nextSecondaryAllowed: number;
  nextMarginalAllowed?: number;
}
export interface EnrichmentEnvironment {
  adaptive?: boolean;
  // Injectable bounded cache for offline replay; normal live operation creates
  // its own temporary cache. No persistence or provider response is implied.
  cache?: Map<string, EnrichmentResult>;
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
  if (
    r.data.associationTimeMs !== undefined &&
    r.data.associationTimeMs !== null &&
    (!Number.isFinite(r.data.associationTimeMs) ||
      r.data.associationTimeMs > now ||
      now - r.data.associationTimeMs > P.maxRouteAgeMs)
  )
    return false;
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
    next.routeHistorical =
      route.associationTimeMs == null
        ? undefined
        : now - route.associationTimeMs > P.recentRouteAgeMs;
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
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;
  let sceneAtMs = 0,
    cancelledForLifecycle = false;
  let lastAdaptiveView: AdaptiveView | undefined;
  const cache = env.cache ?? new Map<string, EnrichmentResult>();
  const budget = env.budget ?? { nextAllowed: 0, nextSecondaryAllowed: 0 };
  const secondaryAttempts = new Map<string, number>();
  const secondarySeen = new Map<string, number>();
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
      secondaryWaitMs: env.adaptive
        ? 0
        : Math.max(0, budget.nextSecondaryAllowed - t),
      ...(lastAdaptiveView ? { adaptiveBudget: lastAdaptiveView } : {}),
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
      if (
        value.expiresAtMs <= env.now() ||
        value.fetchedAtMs > env.now() ||
        (value.data.associationTimeMs != null &&
          env.now() - value.data.associationTimeMs > P.maxRouteAgeMs)
      )
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
    normal = false,
  ) {
    inFlight = true;
    const started = budgetNow(),
      wallStarted = env.now();
    const lookupRef: LookupRef = { kind, hex, callsign, secondary };
    const priorDeadline = budget.nextAllowed;
    cancelledForLifecycle = false;
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
    budget.nextAllowed =
      started + (env.adaptive ? A.spacingMs : P.intervalMs);
    if (secondary) {
      if (!env.adaptive)
        budget.nextSecondaryAllowed = started + P.secondaryIntervalMs;
      secondaryAttempts.set(enrichmentKey(kind, hex, callsign), started);
      if (secondaryAttempts.size > P.clientCapacity)
        secondaryAttempts.delete(secondaryAttempts.keys().next().value!);
    }
    controller = new AbortController();
    const request = controller;
    timeout = env.setTimer(
      () => request.abort(),
      env.adaptive ? A.clientTimeoutMs : P.clientTimeoutMs,
    );
    try {
      const query = new URLSearchParams({ kind, hex });
      if (callsign) query.set('callsign', callsign);
      if (env.adaptive)
        query.set('priority', normal ? 'normal' : 'protected');
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
        const adaptive = env.adaptive
          ? verifiedAdaptiveDeferral(response, body)
          : undefined;
        if (adaptive) {
          const at = budgetNow(),
            wall = env.now();
          lastAdaptiveView = adaptive.budget;
          budget.nextAllowed = Math.max(
            priorDeadline,
            at + (adaptive.budget?.protectedWaitMs ?? adaptive.waitMs),
          );
          budget.nextMarginalAllowed = Math.max(
            budget.nextAllowed,
            at + (adaptive.budget?.normalWaitMs ?? adaptive.waitMs),
          );
          emit({
            type: 'response',
            atMs: wall,
            lookup: lookupRef,
            ok: false,
            apiStatus,
            durationMs: at - started,
            startedElapsedMs: started,
            elapsedMs: at,
            adaptiveBudget: adaptive.budget,
            error: 'cooldown',
            clientCooldownMs: Math.max(0, budget.nextAllowed - at),
            scheduling: {
              treatment: 'local-deferral',
              reason: adaptive.failure.reason,
              serverRetryAfterMs: adaptive.failure.retryAfterMs,
              serverWaitMs: adaptive.waitMs,
              priorGlobalWaitMs: Math.max(0, priorDeadline - at),
              globalWaitMs: Math.max(0, budget.nextAllowed - at),
              secondaryWaitMs: 0,
              nextGlobalEligibleAtMs:
                wall + Math.max(0, budget.nextAllowed - at),
              nextSecondaryEligibleAtMs:
                wall +
                Math.max(0, (budget.nextMarginalAllowed ?? at) - at),
            },
          });
          return;
        }
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
      if (env.adaptive) {
        const view = parseAdaptiveView(
          (result as EnrichmentResult & { adaptiveBudget?: unknown })
            .adaptiveBudget,
        );
        if (!view) {
          errorCode = 'invalid-adaptive-budget';
          throw Error('invalid-adaptive-budget');
        }
        lastAdaptiveView = view;
        const at = budgetNow();
        budget.nextAllowed = Math.max(
          priorDeadline,
          at + view.protectedWaitMs,
        );
        budget.nextMarginalAllowed = Math.max(
          budget.nextAllowed,
          at + view.normalWaitMs,
        );
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
        ...(lastAdaptiveView ? { adaptiveBudget: lastAdaptiveView } : {}),
        durationMs: budgetNow() - started,
        startedElapsedMs: started,
        elapsedMs: budgetNow(),
        clientCooldownMs: 0,
      });
      publish();
    } catch {
      if (
        !stopped &&
        !(env.adaptive && request.signal.aborted && cancelledForLifecycle)
      ) {
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
      if (env.adaptive) schedule();
    }
  }
  function update(scene: Scene) {
    if (stopped) return;
    base = scene;
    sceneAtMs = env.now();
    publish();
    const present = new Set(
      [...scene.secondary, ...(scene.enrichmentCandidates ?? [])].map(
        (a) => enrichmentKey('route', a.id, flightKey(a.callsign)),
      ),
    );
    for (const key of present)
      if (!secondarySeen.has(key)) secondarySeen.set(key, env.now());
    for (const key of secondarySeen.keys())
      if (!present.has(key)) secondarySeen.delete(key);
    while (secondarySeen.size > P.clientCapacity)
      secondarySeen.delete(secondarySeen.keys().next().value!);
    for (const key of secondaryAttempts.keys())
      if (!present.has(key)) secondaryAttempts.delete(key);
    if (env.adaptive) {
      if (
        pending &&
        ![
          scene.primary,
          ...scene.secondary,
          ...(scene.enrichmentCandidates ?? []),
        ].some(
          (a) =>
            a &&
            a.id.toLowerCase() === pending!.hex &&
            (pending!.kind === 'aircraft' ||
              flightKey(a.callsign) === pending!.callsign),
        )
      ) {
        cancelledForLifecycle = true;
        controller?.abort();
      }
      schedule();
      return;
    }
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
    const plan = planLookup();
    if (plan.length) {
      const first = plan[0];
      void lookup(first.kind, first.hex, first.callsign, first.secondary);
    }
  }
  function planLookup() {
    if (!base?.primary) return [];
    const a = base.primary,
      now = env.now();
    const primary = validHex(a.id) ? primaryCandidate(a) : null;
    const requests: (LookupRef & { utility: number; reason: string })[] =
      [];
    const primarySky = urgencyFor(a.observation, now);
    const primaryUtility = Math.max(
      primarySky,
      45 +
        (25 * (a.observation?.elevationDegrees ?? 0)) / 90 +
        15 / (1 + (a.distanceKm ?? 15)),
    );
    const missingModel =
      a.model === null ||
      a.model === 'Aircraft' ||
      a.model.startsWith('Aircraft ·');
    const seen = new Set([a.id.toLowerCase()]);
    if (
      (env.adaptive || budgetNow() >= budget.nextSecondaryAllowed) &&
      ['available', 'delayed'].includes(base.state)
    ) {
      const displayed = new Set(
        base.secondary.map((a) => a.id.toLowerCase()),
      );
      for (const other of [
        ...base.secondary,
        ...(base.enrichmentCandidates ?? []),
      ]) {
        const hex = other.id.toLowerCase(),
          callsign = flightKey(other.callsign);
        if (seen.has(hex) || !validHex(hex) || !callsign) continue;
        seen.add(hex);
        const key = enrichmentKey('route', hex, callsign),
          current = decorate(other).aircraft;
        const complete =
          [current.origin, current.destination].every(
            (v) => v && /^[A-Z]{3,4}$/.test(v.code),
          ) && current.origin!.code !== current.destination!.code;
        if (complete || !due(key)) continue;
        const urgency = urgencyFor(other.observation, now);
        // Defer low-horizon secondary work briefly rather than spend the next
        // 90-second opportunity on a flight with no predicted sky opportunity.
        // This is not a category exclusion; residency or a useful approach releases it.
        if (
          other.observation?.elevationDegrees != null &&
          other.observation.elevationDegrees <
            OBSERVATION_POLICY.lowElevationDegrees &&
          (other.distanceKm ?? 0) >
            OBSERVATION_POLICY.peripheralDistanceKm &&
          urgency === 0 &&
          now - (secondarySeen.get(key) ?? now) <
            OBSERVATION_POLICY.peripheralResidenceMs
        )
          continue;
        if (!displayed.has(hex) && !urgentPass(other.observation, now))
          continue;
        if (
          other.observation?.phase === 'departing' &&
          (other.distanceKm ?? 15) > 3 &&
          (other.observation.elevationDegrees ?? 90) < 20
        )
          continue;
        requests.push({
          kind: 'route',
          hex,
          callsign,
          secondary: true,
          utility:
            (urgency > 0
              ? urgency
              : other.observation
                ? 10 +
                  (10 * (other.observation.elevationDegrees ?? 0)) / 90 +
                  10 / (1 + (other.distanceKm ?? 15))
                : 0) * routeUtilityHint(other),
          reason:
            urgency > 0
              ? 'predicted opportunity × bounded information-value hint'
              : 'displayed route; conservative unknown-trajectory fallback',
        });
      }
    }
    requests.sort(
      (x, y) =>
        y.utility - x.utility ||
        (secondaryAttempts.get(
          enrichmentKey('route', x.hex, x.callsign),
        ) ?? -Infinity) -
          (secondaryAttempts.get(
            enrichmentKey('route', y.hex, y.callsign),
          ) ?? -Infinity),
    );
    if (primary) {
      const urgent = requests.find((r) => {
        const candidate = [
          ...base!.secondary,
          ...(base!.enrichmentCandidates ?? []),
        ].find((a) => a.id.toLowerCase() === r.hex);
        return (
          candidate &&
          urgentPass(candidate.observation, now) &&
          r.utility > primaryUtility + OBSERVATION_POLICY.prefetchAdvantage
        );
      });
      const protectedRoute =
        primary.kind === 'route' &&
        (urgentPass(a.observation, now) ||
          ((a.observation?.elevationDegrees ?? 0) >= 60 &&
            (a.distanceKm ?? 15) < 1) ||
          a.observation?.phase === 'passing');
      const requiredIdentity = primary.kind === 'aircraft' && missingModel;
      const useSecondary =
        !requiredIdentity &&
        !protectedRoute &&
        (primary.kind === 'aircraft'
          ? a.observation !== undefined && requests.length > 0
          : !!urgent);
      const row = {
        ...primary,
        utility: primaryUtility,
        reason: requiredIdentity
          ? 'required primary identification'
          : primary.kind === 'route'
            ? 'current primary route'
            : 'optional primary metadata',
      };
      if (useSecondary) {
        const first = urgent ?? requests[0];
        return [first, row, ...requests.filter((r) => r !== first)];
      }
      return [row, ...requests];
    }
    return requests;
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
    // Native type/registration are already useful. A known route miss or a
    // fast peripheral pass is a poor reason to spend a slot on optional branding.
    const cachedRoute = callsign
      ? cache.get(enrichmentKey('route', hex, callsign))
      : undefined;
    const peripheral =
      a.observation?.predictionQuality === 'supported' &&
      (a.observation.speedKnots ?? 0) >= OBSERVATION_POLICY.fastKnots &&
      ((a.observation.cpaDistanceKm ?? 0) >
        OBSERVATION_POLICY.optionalIdentityMaxCpaKm ||
        (a.observation.phase === 'departing' &&
          (a.distanceKm ?? 0) >
            OBSERVATION_POLICY.optionalIdentityMaxCpaKm));
    if (
      a.observation &&
      !missingModel &&
      a.registration &&
      (cachedRoute?.status === 'not-found' || peripheral)
    )
      return null;
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
  function freshCandidate(a: Aircraft) {
    const now = env.now(),
      position = a.observation?.positionTimeMs;
    return position == null
      ? now >= sceneAtMs && now - sceneAtMs < 30_000
      : Number.isFinite(position) &&
          now >= position &&
          now - position < 120_000;
  }
  function normalCandidate(row: LookupRef) {
    if (!base?.primary) return true;
    if (row.hex === base.primary.id.toLowerCase()) {
      if (row.kind === 'route') return false;
      const m = base.primary.model;
      return !(
        m === null ||
        m === 'Aircraft' ||
        m.startsWith('Aircraft ·')
      );
    }
    const a = [
      ...base.secondary,
      ...(base.enrichmentCandidates ?? []),
    ].find((a) => a.id.toLowerCase() === row.hex);
    return (
      !a ||
      !(
        urgentPass(a.observation, env.now()) ||
        urgencyFor(a.observation, env.now()) >= 50
      )
    );
  }
  function schedule() {
    if (wakeTimer !== undefined) env.clearTimer(wakeTimer);
    wakeTimer = undefined;
    if (
      stopped ||
      !base?.primary ||
      !env.active() ||
      inFlight ||
      !['available', 'delayed'].includes(base.state)
    )
      return;
    prune();
    const rows = planLookup().filter((r) =>
      [
        base!.primary,
        ...base!.secondary,
        ...(base!.enrichmentCandidates ?? []),
      ].some(
        (a) => a && a.id.toLowerCase() === r.hex && freshCandidate(a),
      ),
    );
    const time = budgetNow();
    let next = Infinity;
    for (const row of rows) {
      const normal = normalCandidate(row),
        at = Math.max(
          budget.nextAllowed,
          normal ? (budget.nextMarginalAllowed ?? 0) : 0,
        );
      if (time >= at) {
        void lookup(
          row.kind,
          row.hex,
          row.callsign,
          row.secondary,
          normal,
        );
        return;
      }
      next = Math.min(next, at);
    }
    if (Number.isFinite(next))
      wakeTimer = env.setTimer(
        () => {
          wakeTimer = undefined;
          schedule();
        },
        Math.min(60_000, Math.max(1, next - time)),
      );
  }
  return {
    update,
    plan: () => planLookup(),
    inspect: () => ({
      entries: cache.size,
      inFlight: inFlight ? 1 : 0,
      secondaryAttempts: secondaryAttempts.size,
      ...(env.adaptive
        ? {
            adaptiveBudget: lastAdaptiveView,
            wakeScheduled: wakeTimer !== undefined,
          }
        : {}),
    }),
    contextChanged: () => {
      if (!env.adaptive) return;
      if (!env.active()) {
        if (wakeTimer !== undefined) env.clearTimer(wakeTimer);
        wakeTimer = undefined;
        cancelledForLifecycle = true;
        controller?.abort();
      } else schedule();
    },
    stop: () => {
      stopped = true;
      controller?.abort();
      if (timeout !== undefined) env.clearTimer(timeout);
      if (wakeTimer !== undefined) env.clearTimer(wakeTimer);
      wakeTimer = undefined;
      cache.clear();
      secondaryAttempts.clear();
      secondarySeen.clear();
      base = null;
    },
  };
}

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
}
export interface EnrichmentEnvironment {
  fetch: typeof fetch;
  now: () => number;
  // Wall time still validates provider timestamps; elapsed time budgets requests.
  monotonicNow?: () => number;
  // A page may reuse deadlines across visibility/sleep remounts, never caches.
  budget?: EnrichmentBudget;
  active: () => boolean;
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
  return true;
}
export function supplementAircraft(
  a: Aircraft,
  identity: Supplement | undefined,
  route: Supplement | undefined,
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
      next.destination !== a.destination,
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
  function budgetNow() {
    const time = (env.monotonicNow ?? env.now)();
    if (!Number.isFinite(time)) return budgetTime;
    // A broken/backwards clock cannot reopen an already consumed request slot.
    budgetTime = Math.max(budgetTime, time);
    return budgetTime;
  }
  function prune() {
    for (const [key, value] of cache)
      if (value.expiresAtMs <= env.now() || value.fetchedAtMs > env.now())
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
    );
  }
  function publish() {
    if (stopped || !base) return;
    prune();
    const primary = base.primary ? decorate(base.primary) : null;
    const secondary = base.secondary.map(decorate);
    onScene(
      {
        ...base,
        primary: primary?.aircraft ?? null,
        secondary: secondary.map((a) => a.aircraft),
      },
      !!primary?.used || secondary.some((a) => a.used),
    );
  }
  async function lookup(
    kind: EnrichmentKind,
    hex: string,
    callsign: string | null,
    secondary = false,
  ) {
    inFlight = true;
    const started = budgetNow();
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
      if (!response.ok) {
        const raw = response.headers.get('retry-after'),
          seconds = raw === null ? NaN : Number(raw);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : raw
            ? Date.parse(raw) - env.now()
            : 0;
        budget.nextAllowed = Math.max(
          budget.nextAllowed,
          budgetNow() + P.errorCooldownMs,
          Number.isFinite(delay) ? budgetNow() + delay : 0,
        );
        return;
      }
      const result: unknown = await response.json();
      if (!validResult(result, kind, hex, callsign, env.now()))
        throw Error('invalid-enrichment');
      if (stopped || request.signal.aborted) return;
      if (cache.size >= P.clientCapacity)
        cache.delete(cache.keys().next().value!);
      cache.set(enrichmentKey(kind, hex, callsign), result);
      publish();
    } catch {
      if (!stopped)
        budget.nextAllowed = Math.max(
          budget.nextAllowed,
          budgetNow() + P.errorCooldownMs,
        );
    } finally {
      if (timeout !== undefined) env.clearTimer(timeout);
      timeout = undefined;
      inFlight = false;
      controller = null;
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
    if (validHex(a.id) && primaryLookup(a)) return;
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
  function primaryLookup(a: Aircraft) {
    const hex = a.id.toLowerCase(),
      callsign = flightKey(a.callsign);
    const missingModel =
      a.model === null ||
      a.model === 'Aircraft' ||
      a.model.startsWith('Aircraft ·');
    if (missingModel && due(enrichmentKey('aircraft', hex, null))) {
      void lookup('aircraft', hex, null);
      return true;
    }
    if (
      callsign &&
      (!a.origin || !a.destination) &&
      due(enrichmentKey('route', hex, callsign))
    ) {
      void lookup('route', hex, callsign);
      return true;
    }
    if (
      (!a.operator ||
        !a.registration ||
        a.model === null ||
        a.model === 'Aircraft' ||
        a.model.startsWith('Aircraft ·')) &&
      due(enrichmentKey('aircraft', hex, null))
    ) {
      void lookup('aircraft', hex, null);
      return true;
    }
    return false;
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

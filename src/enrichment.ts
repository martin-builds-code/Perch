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
export interface EnrichmentEnvironment {
  fetch: typeof fetch;
  now: () => number;
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
    if (!a.operator && identity.operator) next.operator = identity.operator;
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
    nextAllowed = 0,
    controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cache = new Map<string, EnrichmentResult>();
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
      flight ? cache.get(enrichmentKey('route', hex, flight))?.data : undefined,
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
  ) {
    inFlight = true;
    nextAllowed = env.now() + P.intervalMs;
    controller = new AbortController();
    const request = controller;
    timeout = env.setTimer(() => request.abort(), P.clientTimeoutMs);
    try {
      const query = new URLSearchParams({ kind, hex });
      if (callsign) query.set('callsign', callsign);
      const response = await env.fetch('/api/enrichment?' + query.toString(), {
        signal: request.signal,
      });
      if (!response.ok) {
        const raw = response.headers.get('retry-after'),
          seconds = raw === null ? NaN : Number(raw);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : raw
            ? Date.parse(raw) - env.now()
            : 0;
        nextAllowed = Math.max(
          nextAllowed,
          env.now() + P.errorCooldownMs,
          Number.isFinite(delay) ? env.now() + delay : 0,
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
        nextAllowed = Math.max(nextAllowed, env.now() + P.errorCooldownMs);
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
    const a = scene.primary;
    if (
      !a ||
      !env.active() ||
      inFlight ||
      env.now() < nextAllowed ||
      !validHex(a.id)
    )
      return;
    const hex = a.id.toLowerCase(),
      callsign = flightKey(a.callsign);
    const missingModel =
      a.model === null ||
      a.model === 'Aircraft' ||
      a.model.startsWith('Aircraft ·');
    if (missingModel && due(enrichmentKey('aircraft', hex, null))) {
      void lookup('aircraft', hex, null);
      return;
    }
    if (
      callsign &&
      (!a.origin || !a.destination) &&
      due(enrichmentKey('route', hex, callsign))
    ) {
      void lookup('route', hex, callsign);
      return;
    }
    if (
      (!a.operator ||
        !a.registration ||
        a.model === null ||
        a.model === 'Aircraft' ||
        a.model.startsWith('Aircraft ·')) &&
      due(enrichmentKey('aircraft', hex, null))
    )
      void lookup('aircraft', hex, null);
  }
  return {
    update,
    inspect: () => ({ entries: cache.size, inFlight: inFlight ? 1 : 0 }),
    stop: () => {
      stopped = true;
      controller?.abort();
      if (timeout !== undefined) env.clearTimer(timeout);
      cache.clear();
      base = null;
    },
  };
}

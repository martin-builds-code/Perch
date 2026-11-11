import type { Snapshot } from './liveTypes';
import type { Aircraft, Scene } from './simulation';
import type { EnrichmentResult, EnrichmentKind } from './enrichmentTypes';
import type { EnrichmentDiagnostic } from './routeTraceTypes';
import { parseEnrichmentDiagnostic } from './routeTraceTypes';
import { flightKey, validHex } from './enrichmentTypes';
import { prominentRoute } from './artwork';
export type LookupRef = {
  kind: EnrichmentKind;
  hex: string;
  callsign: string | null;
  secondary: boolean;
};
export type EnrichmentEvent =
  | {
      type: 'scene';
      atMs: number;
      scene: Scene;
      globalWaitMs: number;
      secondaryWaitMs: number;
      active: boolean;
      pending: LookupRef | null;
      primaryEligible: boolean;
      routes: { key: string; result?: EnrichmentResult }[];
    }
  | { type: 'attempt'; atMs: number; lookup: LookupRef }
  | {
      type: 'response';
      atMs: number;
      lookup: LookupRef;
      ok: boolean;
      apiStatus: number | null;
      durationMs: number;
      diagnostic?: EnrichmentDiagnostic;
      error?: string;
      clientCooldownMs: number;
    };
const key = (a: Aircraft) =>
  a.id.toLowerCase() + ':' + (flightKey(a.callsign) ?? '');
export const ROUTE_STATES = {
  awaiting: 'Awaiting lookup',
  waiting: 'Waiting for scheduler',
  checking: 'Checking route',
  found: 'Route found',
  partial: 'Partial route',
  negative: 'No route found — HexDB',
  rejected: 'Route rejected',
  unavailable: 'Lookup unavailable',
  cachedNegative: 'Cached negative result',
} as const;
interface Row {
  ref: string;
  model: string;
  validCallsign: boolean;
  firstSeenMs: number;
  firstLookupMs: number | null;
  firstRouteMs: number | null;
  role: 'primary' | 'secondary';
  state: string;
  reason: string;
  displayedRoute: string | null;
  internalRoute: string | null;
  cache: string;
  cacheRemainingMs: number;
  lastRequestAtMs: number | null;
  primaryWithoutRouteMs: number;
  observedMs: number;
  present: boolean;
  firstLookupRole?: 'primary' | 'secondary';
  firstRouteRole?: 'primary' | 'secondary';
  cacheObservedAtMs?: number;
  responseAtMs?: number;
  publicationDelayMs?: number;
  response?: {
    apiStatus: number | null;
    diagnostic?: EnrichmentDiagnostic;
    error?: string;
  };
}
const MAX_FLIGHTS = 4096,
  MAX_EVENTS = 1024,
  MAX_DURATION = 18 * 3600_000;
export function createRouteDiagnostics(
  startMs: number,
  expiresAtMs: number,
) {
  const flights = new Map<string, Row>(),
    aircraft = new Set<string>(),
    primaryAircraft = new Set<string>(),
    validCallsignAircraft = new Set<string>();
  const secondaryAircraft = new Set<string>(),
    primaryComplete = new Set<string>(),
    secondaryComplete = new Set<string>();
  const detections = new Map<string, number>();
  const listeners = new Set<() => void>();
  const counters: Record<string, number> = {};
  const events: Record<string, unknown>[] = [];
  let stopped = false,
    lastMs = startMs,
    active = true,
    truncated = false;
  let current: (EnrichmentEvent & { type: 'scene' }) | undefined;
  const endMs = Math.min(expiresAtMs, startMs + MAX_DURATION);
  const exposure = {
    primaryMs: 0,
    secondaryMs: 0,
    primaryCompleteMs: 0,
    secondaryCompleteMs: 0,
  };
  function count(name: string, amount = 1) {
    counters[name] = Math.min(
      1_000_000_000,
      (counters[name] ?? 0) + amount,
    );
  }
  function addEvent(e: Record<string, unknown>) {
    if (events.length >= MAX_EVENTS) {
      events.shift();
      truncated = true;
    }
    events.push(e);
  }
  function advance(now: number) {
    if (!Number.isFinite(now) || now < lastMs) {
      count('clockAnomalies');
      return;
    }
    const dt = Math.max(0, Math.min(now, endMs) - lastMs);
    if (active && !stopped)
      for (const row of flights.values())
        if (row.present) {
          row.observedMs += dt;
          if (row.role === 'primary') {
            exposure.primaryMs += dt;
            if (row.displayedRoute) exposure.primaryCompleteMs += dt;
            else row.primaryWithoutRouteMs += dt;
          } else {
            exposure.secondaryMs += dt;
            if (row.displayedRoute) exposure.secondaryCompleteMs += dt;
          }
        }
    lastMs = Math.max(lastMs, Math.min(now, endMs));
    if (now >= endMs) stopped = true;
  }
  function ensure(k: string, a?: Aircraft) {
    let r = flights.get(k);
    if (!r && flights.size < MAX_FLIGHTS) {
      r = {
        ref: 'F' + String(flights.size + 1).padStart(4, '0'),
        model: a
          ? [a.manufacturer, a.model]
              .filter(Boolean)
              .join(' ')
              .slice(0, 120)
          : 'Aircraft',
        validCallsign: !!flightKey(a?.callsign ?? k.split(':')[1] ?? null),
        firstSeenMs: detections.get(k) ?? lastMs,
        firstLookupMs: null,
        firstRouteMs: null,
        role: 'secondary',
        state: ROUTE_STATES.awaiting,
        reason: 'not-yet-attempted',
        displayedRoute: null,
        internalRoute: null,
        cache: 'missing',
        cacheRemainingMs: 0,
        lastRequestAtMs: null,
        primaryWithoutRouteMs: 0,
        observedMs: 0,
        present: false,
      };
      flights.set(k, r);
    } else if (!r) {
      truncated = true;
      count('flightCapacityExceeded');
    }
    return r;
  }
  function observe(e: EnrichmentEvent) {
    advance(e.atMs);
    if (stopped) return;
    if (e.type === 'scene') {
      current = e;
      active = e.active;
      const present = new Set(
        [e.scene.primary, ...e.scene.secondary]
          .filter((a): a is Aircraft => !!a)
          .map(key),
      );
      for (const [k, r] of flights)
        if (r.present && !present.has(k)) {
          if (r.firstLookupMs === null) {
            count('disappearedBeforeLookup');
            count(r.role + 'DisappearedBeforeLookup');
          }
          r.present = false;
        }
      const list = [e.scene.primary, ...e.scene.secondary].filter(
        (a): a is Aircraft => !!a,
      );
      for (const a of list) {
        const k = key(a),
          row = ensure(k, a);
        if (!row) continue;
        if (aircraft.size < MAX_FLIGHTS) aircraft.add(a.id.toLowerCase());
        if (
          flightKey(a.callsign) &&
          validCallsignAircraft.size < MAX_FLIGHTS
        )
          validCallsignAircraft.add(a.id.toLowerCase());
        row.role = a === e.scene.primary ? 'primary' : 'secondary';
        row.present = true;
        if (row.role === 'primary' && primaryAircraft.size < MAX_FLIGHTS)
          primaryAircraft.add(a.id.toLowerCase());
        const result = e.routes.find((x) => x.key === k)?.result;
        row.cache = result
          ? result.status === 'not-found'
            ? 'negative'
            : 'positive'
          : 'missing';
        row.cacheRemainingMs = result
          ? Math.max(0, result.expiresAtMs - e.atMs)
          : 0;
        if (
          row.role === 'secondary' &&
          secondaryAircraft.size < MAX_FLIGHTS
        )
          secondaryAircraft.add(a.id.toLowerCase());
        const route = prominentRoute(a);
        row.displayedRoute = route ? route.from + ' → ' + route.to : null;
        if (route) {
          const complete =
            row.role === 'primary' ? primaryComplete : secondaryComplete;
          if (complete.size < MAX_FLIGHTS)
            complete.add(a.id.toLowerCase());
        }
        row.internalRoute =
          a.origin || a.destination
            ? (a.origin?.code ?? '?') +
              ' → ' +
              (a.destination?.code ?? '?')
            : null;
        if (row.displayedRoute && row.firstRouteMs === null) {
          row.firstRouteMs = e.atMs;
          row.firstRouteRole = row.role;
          if (row.responseAtMs !== undefined)
            row.publicationDelayMs = Math.max(
              0,
              e.atMs - row.responseAtMs,
            );
        }
        if (result && row.cacheObservedAtMs !== e.atMs) {
          row.cacheObservedAtMs = e.atMs;
          count(
            result.status === 'found'
              ? 'clientPositiveCacheSceneUses'
              : 'clientNegativeCacheSceneUses',
          );
        }
        const pending =
          e.pending?.kind === 'route' &&
          e.pending.hex === a.id.toLowerCase() &&
          e.pending.callsign === flightKey(a.callsign);
        const d = result?.diagnostic;
        if (row.displayedRoute) {
          row.state = ROUTE_STATES.found;
          row.reason = 'complete-iata-pair-displayed';
        } else if (pending) {
          row.state = ROUTE_STATES.checking;
          row.reason = 'application-request-in-flight';
        } else if (d?.outcome === 'rejected') {
          row.state = ROUTE_STATES.rejected;
          row.reason = d.reason;
        } else if (result?.status === 'not-found') {
          row.state =
            e.atMs - result.fetchedAtMs < 1000
              ? ROUTE_STATES.negative
              : ROUTE_STATES.cachedNegative;
          row.reason = d?.reason ?? 'provider-negative-without-trace';
        } else if (row.internalRoute) {
          row.state =
            a.origin && a.destination
              ? ROUTE_STATES.found
              : ROUTE_STATES.partial;
          row.reason =
            a.origin && a.destination
              ? 'complete-pair-hidden-without-iata'
              : 'incomplete-airport-pair';
        } else if (!validHex(a.id) || !flightKey(a.callsign)) {
          row.state = ROUTE_STATES.awaiting;
          row.reason = !validHex(a.id)
            ? 'invalid-identifier'
            : 'missing-or-invalid-callsign';
        } else if (e.globalWaitMs > 0 && row.response?.error) {
          row.state = ROUTE_STATES.unavailable;
          row.reason = row.response.error;
        } else {
          row.state = ROUTE_STATES.waiting;
          row.reason = !e.active
            ? 'inactive'
            : e.pending
              ? 'single-request-busy'
              : e.globalWaitMs > 0
                ? 'global-interval-or-cooldown'
                : row.role === 'secondary' && e.primaryEligible
                  ? 'primary-priority'
                  : row.role === 'secondary' && e.secondaryWaitMs > 0
                    ? 'secondary-interval'
                    : row.role === 'primary' && e.primaryEligible
                      ? 'primary-identification-or-route-due'
                      : 'eligible-next-scene-opportunity';
        }
      }
    } else {
      const k =
        e.lookup.hex +
        ':' +
        (e.lookup.kind === 'route' ? (e.lookup.callsign ?? '') : '');
      // Identity requests are still counted but do not pretend a route was queried.
      count(
        e.lookup.secondary
          ? 'secondary' + (e.type === 'attempt' ? 'Attempts' : 'Responses')
          : 'primary' + (e.type === 'attempt' ? 'Attempts' : 'Responses'),
      );
      if (e.type === 'attempt') {
        count('applicationAttempts');
        count(
          e.lookup.kind === 'route'
            ? 'routeLookupAttempts'
            : 'identityLookupAttempts',
        );
        if (e.lookup.kind === 'route')
          count(
            (e.lookup.secondary ? 'secondary' : 'primary') +
              'RouteLookupAttempts',
          );
        if (e.lookup.kind === 'route') {
          const row = ensure(k);
          if (row) {
            if (row.firstLookupMs === null) {
              row.firstLookupMs = e.atMs;
              row.firstLookupRole = e.lookup.secondary
                ? 'secondary'
                : 'primary';
            }
            row.lastRequestAtMs = e.atMs;
            row.state = ROUTE_STATES.checking;
            row.reason = 'application-request-in-flight';
          }
        }
      } else {
        count('applicationResponses');
        if (!e.ok) {
          count('applicationErrors');
          if (e.apiStatus === null) count('applicationNetworkErrors');
          else if (e.apiStatus >= 400) count('applicationHttpErrors');
          else count('clientValidationErrors');
        }
        const d = e.diagnostic;
        if (d) {
          count('hexdbRequestsStarted', d.upstreamRequestsStarted);
          count('hexdbResponsesReceived', d.upstreamResponses);
          if (d.serverCache === 'hit' || d.serverCache === 'coalesced')
            count('serverCacheHits');
          count(
            (e.lookup.secondary ? 'secondary' : 'primary') +
              'HexdbRequestsStarted',
            d.upstreamRequestsStarted,
          );
          count(
            e.lookup.kind + 'HexdbRequestsStarted',
            d.upstreamRequestsStarted,
          );
          if (e.lookup.kind === 'route' && d.upstreamResponses === 1)
            count(
              'hexdbRoute' +
                d.outcome[0].toUpperCase() +
                d.outcome.slice(1) +
                'Responses',
            );
          if (d.origin === 'application' && d.reason === 'cooldown')
            count('serverCooldownIncidents');
          if (d.origin === 'hexdb' && d.outcome === 'error')
            count('upstreamErrors');
          if (e.lookup.kind === 'route') {
            count(
              'route' +
                d.outcome[0].toUpperCase() +
                d.outcome.slice(1) +
                'Responses',
            );
            count(
              (e.lookup.secondary ? 'secondary' : 'primary') +
                'Route' +
                d.outcome[0].toUpperCase() +
                d.outcome.slice(1) +
                'Responses',
            );
          }
        } else count('responsesWithoutServerEvidence');
        if (e.clientCooldownMs > 0) count('clientCooldownIncidents');
        const row = e.lookup.kind === 'route' ? ensure(k) : undefined;
        if (row) {
          row.responseAtMs = e.atMs;
          row.response = {
            apiStatus: e.apiStatus,
            ...(d ? { diagnostic: d } : {}),
            ...(e.error ? { error: e.error } : {}),
          };
          row.state = !e.ok
            ? d?.outcome === 'rejected'
              ? ROUTE_STATES.rejected
              : ROUTE_STATES.unavailable
            : d?.outcome === 'rejected'
              ? ROUTE_STATES.rejected
              : d?.outcome === 'negative'
                ? ROUTE_STATES.negative
                : d?.outcome === 'partial'
                  ? ROUTE_STATES.partial
                  : row.state;
          row.reason =
            d?.reason ?? e.error ?? 'response-without-server-evidence';
        }
        addEvent({
          type: 'lookup-response',
          atMs: e.atMs,
          ref: row?.ref ?? 'identity',
          role: e.lookup.secondary ? 'secondary' : 'primary',
          kind: e.lookup.kind,
          apiStatus: e.apiStatus,
          durationMs: e.durationMs,
          ...(d ? { diagnostic: d } : {}),
          ...(e.error ? { error: e.error } : {}),
          clientCooldownMs: e.clientCooldownMs,
        });
      }
    }
    for (const fn of listeners) fn();
  }
  function copyRow(row: Row): Row {
    return {
      ...row,
      ...(row.response
        ? {
            response: {
              ...row.response,
              ...(row.response.diagnostic
                ? {
                    diagnostic: parseEnrichmentDiagnostic(
                      row.response.diagnostic,
                    ),
                  }
                : {}),
            },
          }
        : {}),
    };
  }
  function summary(now: number, includeEvidence = true) {
    advance(now);
    const rows = [...flights.values()];
    const delays = (
      field: 'firstLookupMs' | 'firstRouteMs',
      role?: 'primary' | 'secondary',
    ) =>
      rows
        .filter(
          (r) =>
            r[field] !== null &&
            (!role ||
              (field === 'firstLookupMs'
                ? r.firstLookupRole
                : r.firstRouteRole) === role),
        )
        .map((r) => Math.max(0, r[field]! - r.firstSeenMs));
    const stats = (xs: number[]) => {
      const sorted = [...xs].sort((a, b) => a - b);
      return {
        count: xs.length,
        medianMs: xs.length ? sorted[Math.floor(xs.length / 2)] : null,
        maxMs: xs.length ? sorted[sorted.length - 1] : null,
      };
    };
    return {
      schemaVersion: 1,
      startedAtMs: startMs,
      endedAtMs: Math.min(now, endMs),
      expiresAtMs: endMs,
      finished: stopped,
      truncated,
      distinctAircraft: aircraft.size,
      distinctDetectedFlights: detections.size,
      distinctDisplayedFlights: flights.size,
      distinctFlights: flights.size,
      aircraftBecomingPrimary: primaryAircraft.size,
      aircraftWithValidCallsigns: validCallsignAircraft.size,
      primaryAircraftWithCompleteRoutes: primaryComplete.size,
      secondaryAircraftObserved: secondaryAircraft.size,
      secondaryAircraftWithCompleteRoutes: secondaryComplete.size,
      primaryAircraftCompleteRoutePercent: primaryAircraft.size
        ? (100 * primaryComplete.size) / primaryAircraft.size
        : null,
      secondaryAircraftCompleteRoutePercent: secondaryAircraft.size
        ? (100 * secondaryComplete.size) / secondaryAircraft.size
        : null,
      counters: { ...counters },
      exposure: { ...exposure },
      primaryCompleteRoutePercent: exposure.primaryMs
        ? (100 * exposure.primaryCompleteMs) / exposure.primaryMs
        : null,
      secondaryCompleteRoutePercent: exposure.secondaryMs
        ? (100 * exposure.secondaryCompleteMs) / exposure.secondaryMs
        : null,
      firstDetectionToLookup: stats(delays('firstLookupMs')),
      firstDetectionToUsableRoute: stats(delays('firstRouteMs')),
      primaryFirstDetectionToLookup: stats(
        delays('firstLookupMs', 'primary'),
      ),
      secondaryFirstDetectionToLookup: stats(
        delays('firstLookupMs', 'secondary'),
      ),
      primaryFirstDetectionToUsableRoute: stats(
        delays('firstRouteMs', 'primary'),
      ),
      secondaryFirstDetectionToUsableRoute: stats(
        delays('firstRouteMs', 'secondary'),
      ),
      responseToScenePublication: stats(
        rows
          .filter((r) => r.publicationDelayMs !== undefined)
          .map((r) => r.publicationDelayMs!),
      ),
      routesAvailableInternallyNotDisplayed: rows.filter(
        (r) => r.present && r.internalRoute && !r.displayedRoute,
      ).length,
      globalWaitMs: current
        ? Math.max(0, current.globalWaitMs - (now - current.atMs))
        : 0,
      secondaryWaitMs: current
        ? Math.max(0, current.secondaryWaitMs - (now - current.atMs))
        : 0,
      current: rows
        .filter((r) => r.present)
        .map((r) => ({
          ...copyRow(r),
          cacheRemainingMs: Math.max(
            0,
            r.cacheRemainingMs - (current ? now - current.atMs : 0),
          ),
        })),
      flights: includeEvidence ? rows.map(copyRow) : [],
      events: includeEvidence
        ? events.map(
            (e): Record<string, unknown> => ({
              ...e,
              ...(e.diagnostic
                ? { diagnostic: parseEnrichmentDiagnostic(e.diagnostic) }
                : {}),
            }),
          )
        : [],
      notes: [
        'Bounded page-memory evidence; no coordinates, raw provider bodies, full hex/callsign or credentials.',
        'Percentages measure observed displayed aircraft-time, not traffic detection or independent route accuracy.',
        'upstreamRequestsStarted counts initiated server HTTP attempts; upstreamResponsesReceived confirms responses.',
        'Sampling uses scene publications; disappearances between polls and unshown ADS-B aircraft are separate limitations.',
      ],
    };
  }
  function snapshot(s: Snapshot, now = Date.now()) {
    advance(now);
    if (stopped) return;
    count('positionalSnapshots');
    for (const a of s.aircraft) {
      if (aircraft.size < MAX_FLIGHTS) aircraft.add(a.id.toLowerCase());
      else truncated = true;
      if (
        flightKey(a.callsign) &&
        validCallsignAircraft.size < MAX_FLIGHTS
      )
        validCallsignAircraft.add(a.id.toLowerCase());
      const k = a.id.toLowerCase() + ':' + (flightKey(a.callsign) ?? '');
      if (!detections.has(k)) {
        if (detections.size < MAX_FLIGHTS) detections.set(k, lastMs);
        else truncated = true;
      }
    }
  }
  return {
    observe,
    summary,
    snapshot,
    reference: (hex: string, callsign: string | null) =>
      flights.get(hex.toLowerCase() + ':' + (flightKey(callsign) ?? ''))
        ?.ref ?? null,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    stop: (now: number) => {
      advance(now);
      stopped = true;
      active = false;
      listeners.clear();
    },
    context: (on: boolean, now: number) => {
      advance(now);
      active = on;
    },
  };
}
export type RouteDiagnostics = ReturnType<typeof createRouteDiagnostics>;

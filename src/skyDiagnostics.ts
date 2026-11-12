import { createAircraftSelector as createR03Selector } from './selectionR03';
import type { SelectionResult } from './selection';
import type { LiveAircraft, Snapshot } from './liveTypes';
import type { Scene, Aircraft } from './simulation';
import type { EnrichmentEvent } from './routeDiagnostics';
import { prominentRoute } from './artwork';
import { aircraftCategory } from './routeUtility';
const MAX_FRAMES = 240,
  MAX_ROWS = 32,
  MAX_EVENTS = 1024,
  MAX_IDS = 1024;
export function createSkyDiagnostics(until: number) {
  const shadow = createR03Selector(),
    ids = new Map<string, string>(),
    flights = new Map<string, string>();
  const frames: unknown[] = [],
    events: unknown[] = [],
    evaluations: unknown[] = [];
  let lastFrame = '',
    dropped = 0,
    stopped = false;
  let latest: ReturnType<typeof current> | null = null;
  let scheduling: {
    atMs: number;
    globalWaitMs: number;
    secondaryWaitMs: number;
    pending: string | null;
  } | null = null;
  let lastLookup: unknown = null;
  function ref(id: string) {
    let v = ids.get(id);
    if (!v && ids.size < MAX_IDS) {
      v =
        (/^[a-f0-9]{6}$/i.test(id) ? '' : '~') +
        (ids.size + 1).toString(16).padStart(6, '0');
      ids.set(id, v);
    }
    return v ?? 'ffffff';
  }
  function flight(a: Pick<LiveAircraft, 'id' | 'callsign'>) {
    if (!a.callsign) return null;
    const key = a.id + ':' + a.callsign;
    let v = flights.get(key);
    if (!v && flights.size < MAX_IDS) {
      v = 'R' + String(flights.size + 1).padStart(6, '0');
      flights.set(key, v);
    }
    return v ?? null;
  }
  const bounded = (xs: unknown[], v: unknown, max: number) => {
    if (xs.length >= max) {
      xs.shift();
      dropped++;
    }
    xs.push(v);
  };
  function current(
    s: SelectionResult,
    snapshot: Snapshot | null,
    now: number,
    failed: boolean,
  ) {
    const old = shadow.select(snapshot, now, failed);
    return {
      atMs: now,
      failed,
      primary: s.primary ? ref(s.primary.id) : null,
      baselinePrimary: old.primary ? ref(old.primary.id) : null,
      decision: {
        ...s.decision,
        primaryId: s.decision.primaryId ? ref(s.decision.primaryId) : null,
        challengerId: s.decision.challengerId
          ? ref(s.decision.challengerId)
          : null,
      },
      ranked: s.ranked.slice(0, MAX_ROWS).map((r) => ({
        ref: ref(r.aircraft.id),
        model: r.aircraft.description,
        typeCode: r.aircraft.typeCode,
        distanceKm: r.aircraft.distanceKm,
        altitudeFt: r.aircraft.barometricAltitudeFt,
        score: r.score,
        motion: r.motion.state,
        observation: r.observation,
        factors: r.factors,
      })),
    };
  }
  function selection(
    s: SelectionResult,
    snapshot: Snapshot | null,
    now: number,
    failed: boolean,
  ) {
    if (stopped || now >= until) return;
    latest = current(s, snapshot, now, failed);
    // Keep lightweight timer evaluations too: an unchanged snapshot/primary can
    // still reset challenger confirmation as individual positions age.
    bounded(
      evaluations,
      { atMs: now, snapshotTimeMs: snapshot?.fetchedAtMs ?? null, failed },
      MAX_EVENTS,
    );
    const key =
      String(snapshot?.fetchedAtMs) +
      ':' +
      String(failed) +
      ':' +
      String(s.primary?.id) +
      ':' +
      String(latest.baselinePrimary);
    if (!snapshot || key === lastFrame) return;
    lastFrame = key;
    const safe: Snapshot = {
      fetchedAtMs: snapshot.fetchedAtMs,
      providerTimeMs: snapshot.providerTimeMs,
      pollIntervalMs: snapshot.pollIntervalMs,
      rejectedRecords: snapshot.rejectedRecords,
      anomalies: snapshot.anomalies.filter((v) =>
        ['provider-clock'].includes(v),
      ),
      aircraft: snapshot.aircraft.slice(0, MAX_ROWS).map((a) => ({
        id: ref(a.id),
        callsign: flight(a),
        registration: null,
        description: a.description?.slice(0, 80) ?? null,
        typeCode: a.typeCode,
        distanceKm: a.distanceKm,
        bearingDegrees: a.bearingDegrees,
        heightAboveObserverKm: a.heightAboveObserverKm,
        heightReference: a.heightReference,
        barometricAltitudeFt: a.barometricAltitudeFt,
        geometricAltitudeFt: a.geometricAltitudeFt,
        onGround: a.onGround,
        groundSpeedKnots: a.groundSpeedKnots,
        trackDegrees: a.trackDegrees,
        positionTimeMs: a.positionTimeMs,
        source: 'adsb.fi',
        validity: {
          position: a.validity.position,
          timestamp: a.validity.timestamp,
          anomalies: a.validity.anomalies.filter((v) =>
            ['invalid-position-age', 'provider-clock'].includes(v),
          ),
        },
      })),
    };
    bounded(
      frames,
      { atMs: now, failed, snapshot: safe, result: latest },
      MAX_FRAMES,
    );
  }
  function scene(s: Scene, now: number) {
    if (stopped || now >= until) return;
    const row = (a: Aircraft) => ({
      ref: ref(a.id),
      category: aircraftCategory(a),
      complete: !!prominentRoute(a),
      historical: a.routeHistorical === true,
    });
    bounded(
      events,
      {
        type: 'scene',
        atMs: now,
        primary: s.primary ? row(s.primary) : null,
        secondary: s.secondary.map(row),
      },
      MAX_EVENTS,
    );
  }
  function enrichment(e: EnrichmentEvent) {
    if (stopped || e.atMs >= until) return;
    if (e.type === 'scene') {
      scheduling = {
        atMs: e.atMs,
        globalWaitMs: e.globalWaitMs,
        secondaryWaitMs: e.secondaryWaitMs,
        pending: e.pending ? ref(e.pending.hex) : null,
      };
      return;
    }
    const r = {
      type: e.type,
      atMs: e.atMs,
      ref: ref(e.lookup.hex),
      kind: e.lookup.kind,
      secondary: e.lookup.secondary,
      flightRef:
        e.lookup.kind === 'route'
          ? flight({ id: e.lookup.hex, callsign: e.lookup.callsign })
          : null,
    };
    if (e.type === 'response')
      lastLookup = {
        ...r,
        ok: e.ok,
        outcome: e.diagnostic?.outcome ?? e.error ?? 'unknown',
      };
    bounded(
      events,
      e.type === 'response'
        ? {
            ...r,
            ok: e.ok,
            apiStatus: e.apiStatus,
            diagnostic: e.diagnostic,
            failure: e.failure,
            scheduling: e.scheduling,
            error: e.error,
            durationMs: e.durationMs,
          }
        : r,
      MAX_EVENTS,
    );
  }
  let queue: unknown[] = [];
  return {
    selection,
    reference: (hex: string) => ref(hex),
    scene,
    enrichment,
    plan: (
      rows: {
        hex: string;
        kind: string;
        utility: number;
        reason: string;
        secondary: boolean;
      }[],
    ) => {
      if (!stopped)
        queue = rows.slice(0, 8).map((r) => ({
          ref: ref(r.hex),
          kind: r.kind,
          utility: r.utility,
          reason: r.reason,
          secondary: r.secondary,
        }));
    },
    latest: () => ({ latest, queue, scheduling, lastLookup }),
    summary: () => ({
      schemaVersion: 1,
      untilMs: until,
      frames: [...frames],
      events: [...events],
      evaluations: [...evaluations],
      dropped,
      latest,
      queue,
      scheduling,
      lastLookup,
      stopped,
      privacy:
        'Session-local synthetic IDs/callsigns. No registration, exact positions, observer configuration or secrets.',
    }),
    stop: () => {
      stopped = true;
      shadow.clear();
    },
  };
}
export type SkyDiagnostics = ReturnType<typeof createSkyDiagnostics>;

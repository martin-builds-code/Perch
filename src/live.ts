import type { Snapshot, LiveAircraft } from './liveTypes';
import { CURRENT_AGE_MS, EXPIRE_AGE_MS } from './liveTypes';
import type { Aircraft, Scene } from './simulation';

function presentation(a: LiveAircraft): Aircraft {
  const match = a.description?.match(
    /^(Airbus|Boeing|Embraer|Cessna|ATR)\s+(.+)$/,
  );
  const directions = [
    'North',
    'North-east',
    'East',
    'South-east',
    'South',
    'South-west',
    'West',
    'North-west',
  ];
  return {
    id: a.id,
    manufacturer: match ? match[1] : a.description ? null : 'Unidentified',
    model: match
      ? match[2]
      : (a.description ??
        (a.typeCode ? `Aircraft · ${a.typeCode}` : 'Aircraft')),
    operator: null,
    altitudeFt: a.barometricAltitudeFt,
    distanceKm: a.distanceKm,
    origin: null,
    destination: null,
    callsign: a.callsign,
    registration: a.registration,
    direction:
      a.trackDegrees === null
        ? null
        : directions[Math.round(a.trackDegrees / 45) % 8],
  };
}
// Stage 2A provisional only: nearest valid, unexpired position; tie by ICAO.
// This is not an audibility/relevance score. Stage 2B replaces this function.
export function selectAircraft(aircraft: LiveAircraft[], now: number) {
  return aircraft
    .filter(
      (a) =>
        a.validity.position &&
        a.validity.timestamp &&
        a.positionTimeMs !== null &&
        now - a.positionTimeMs >= 0 &&
        now - a.positionTimeMs < EXPIRE_AGE_MS &&
        a.distanceKm !== null &&
        a.distanceKm >= 0 &&
        a.distanceKm <= 15,
    )
    .sort((a, b) => a.distanceKm! - b.distanceKm! || a.id.localeCompare(b.id));
}
export function liveScene(
  snapshot: Snapshot | null,
  now: number,
  failed: boolean,
): Scene {
  const base = {
    id: 'live',
    label: 'Live · adsb.fi',
    duration: 0,
    secondary: [],
  };
  if (
    !snapshot ||
    now < snapshot.fetchedAtMs ||
    now - snapshot.fetchedAtMs >= EXPIRE_AGE_MS
  )
    return { ...base, state: 'unavailable', primary: null };
  const eligible = selectAircraft(snapshot.aircraft, now);
  if (!eligible.length) {
    const uncertain =
      failed ||
      snapshot.anomalies.length > 0 ||
      snapshot.rejectedRecords > 0 ||
      snapshot.aircraft.length > 0 ||
      now - snapshot.fetchedAtMs >= CURRENT_AGE_MS;
    return {
      ...base,
      state: uncertain ? 'unavailable' : 'standby',
      primary: null,
    };
  }
  const delayed =
    failed ||
    snapshot.anomalies.length > 0 ||
    now - snapshot.fetchedAtMs >= CURRENT_AGE_MS ||
    eligible.slice(0, 4).some((a) => now - a.positionTimeMs! >= CURRENT_AGE_MS);
  return {
    ...base,
    state: delayed ? 'delayed' : 'available',
    primary: presentation(eligible[0]),
    secondary: eligible.slice(1, 4).map(presentation),
  };
}
function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Snapshot;
  return (
    Number.isFinite(s.fetchedAtMs) &&
    Number.isFinite(s.providerTimeMs) &&
    Number.isFinite(s.pollIntervalMs) &&
    s.pollIntervalMs >= 15_000 &&
    s.pollIntervalMs <= 300_000 &&
    Number.isInteger(s.rejectedRecords) &&
    s.rejectedRecords >= 0 &&
    Array.isArray(s.anomalies) &&
    Array.isArray(s.aircraft) &&
    s.aircraft.length <= 1000 &&
    s.aircraft.every(
      (a) =>
        a &&
        typeof a.id === 'string' &&
        typeof a.validity?.position === 'boolean' &&
        typeof a.validity?.timestamp === 'boolean' &&
        (a.positionTimeMs === null || Number.isFinite(a.positionTimeMs)) &&
        (a.distanceKm === null || Number.isFinite(a.distanceKm)) &&
        [a.description, a.callsign, a.registration, a.typeCode].every(
          (v) => v === null || typeof v === 'string',
        ) &&
        [
          a.barometricAltitudeFt,
          a.geometricAltitudeFt,
          a.groundSpeedKnots,
          a.trackDegrees,
        ].every((v) => v === null || Number.isFinite(v)) &&
        a.source === 'adsb.fi' &&
        typeof a.onGround === 'boolean' &&
        Array.isArray(a.validity.anomalies),
    )
  );
}
export interface PollEnvironment {
  fetch: typeof fetch;
  now: () => number;
  active: () => boolean;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}
export function createPoller(
  onChange: (scene: Scene) => void,
  env: PollEnvironment,
) {
  let stopped = false,
    snapshot: Snapshot | null = null,
    failed = false,
    inFlight = false,
    lastStart = -Infinity;
  let interval = 15_000,
    notBefore = 0,
    request: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined,
    expiryTimer: ReturnType<typeof setTimeout> | undefined;
  function clear() {
    if (pollTimer !== undefined) env.clearTimer(pollTimer);
    if (expiryTimer !== undefined) env.clearTimer(expiryTimer);
  }
  function publish() {
    if (stopped) return;
    onChange(liveScene(snapshot, env.now(), failed));
    if (expiryTimer !== undefined) env.clearTimer(expiryTimer);
    const deadlines = snapshot
      ? [
          snapshot.fetchedAtMs + CURRENT_AGE_MS,
          snapshot.fetchedAtMs + EXPIRE_AGE_MS,
          ...selectAircraft(snapshot.aircraft, env.now())
            .slice(0, 4)
            .flatMap((a) =>
              a.positionTimeMs === null
                ? []
                : [
                    a.positionTimeMs + CURRENT_AGE_MS,
                    a.positionTimeMs + EXPIRE_AGE_MS,
                  ],
            ),
        ]
      : [];
    const next = Math.min(...deadlines.filter((t) => t > env.now()));
    if (Number.isFinite(next) && env.active())
      expiryTimer = env.setTimer(publish, next - env.now());
  }
  function schedule() {
    if (pollTimer !== undefined) env.clearTimer(pollTimer);
    if (!stopped && env.active())
      pollTimer = env.setTimer(
        () => {
          void poll();
        },
        Math.max(0, lastStart + interval - env.now(), notBefore - env.now()),
      );
  }
  async function poll() {
    if (stopped || inFlight || !env.active()) return;
    if (env.now() < Math.max(lastStart + interval, notBefore)) {
      schedule();
      return;
    }
    inFlight = true;
    lastStart = env.now();
    request = new AbortController();
    const thisRequest = request;
    const timeout = env.setTimer(() => thisRequest.abort(), 8000);
    try {
      const response = await env.fetch('/api/aircraft', {
        signal: thisRequest.signal,
      });
      if (!response.ok) {
        const retry = response.headers.get('retry-after'),
          seconds = retry === null ? NaN : Number(retry);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : retry
            ? Date.parse(retry) - env.now()
            : 0;
        if (Number.isFinite(delay))
          notBefore = Math.max(notBefore, env.now() + Math.max(0, delay));
        throw Error('unavailable');
      }
      const value: unknown = await response.json();
      if (!validSnapshot(value)) throw Error('invalid-response');
      if (!stopped && !thisRequest.signal.aborted) {
        snapshot = value;
        interval = value.pollIntervalMs;
        failed = false;
      }
    } catch {
      if (!stopped) failed = true;
    } finally {
      env.clearTimer(timeout);
      inFlight = false;
      request = null;
      if (!stopped) {
        publish();
        schedule();
      }
    }
  }
  function resume() {
    if (stopped) return;
    clear();
    publish();
    if (!env.active()) {
      request?.abort();
      return;
    }
    void poll();
  }
  return {
    start: resume,
    resume,
    stop: () => {
      stopped = true;
      clear();
      request?.abort();
    },
  };
}

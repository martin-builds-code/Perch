import type { Snapshot, LiveAircraft } from './liveTypes';
import { CURRENT_AGE_MS, EXPIRE_AGE_MS } from './liveTypes';
import type { Aircraft, Scene } from './simulation';
import { createAircraftSelector, scoreAircraft } from './selection';
import type { SelectionResult } from './selection';
import type {
  DataDiagnostics,
  DiagnosticContext,
  DiagnosticState,
} from './dataDiagnostics';

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
    typeCode: a.typeCode,
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
// Stateless relevance order for diagnostics/tests; the poller owns the stable selector.
export function selectAircraft(aircraft: LiveAircraft[], now: number) {
  return aircraft
    .map((a) => scoreAircraft(a, now))
    .filter((a) => a !== null)
    .sort(
      (a, b) => b.score - a.score || a.aircraft.id.localeCompare(b.aircraft.id),
    )
    .map((a) => a.aircraft);
}
export function liveScene(
  snapshot: Snapshot | null,
  now: number,
  failed: boolean,
  selection = createAircraftSelector().select(snapshot, now, failed),
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
  const eligible = selection.primary
    ? [selection.primary, ...selection.secondary]
    : [];
  if (!eligible.length) {
    const uncertain =
      failed ||
      snapshot.anomalies.length > 0 ||
      snapshot.rejectedRecords > 0 ||
      snapshot.aircraft.some((a) => a.onGround !== true) ||
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
        (a.onGround === null || typeof a.onGround === 'boolean') &&
        Array.isArray(a.validity.anomalies),
    )
  );
}
export interface PollEnvironment {
  observer?: DataDiagnostics;
  context?: () => DiagnosticContext;
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
  const selector = createAircraftSelector();
  let selection: SelectionResult | null = null;
  let lastDiagnosticState: DiagnosticState | undefined;
  let observedPrimaryId: string | null = null,
    lastObservedAt: number | null = null;
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
    const now = env.now();
    selection = selector.select(snapshot, now, failed);
    const scene = liveScene(snapshot, now, failed, selection);
    if (env.observer) {
      const primary = selection.primary;
      const changed = (primary?.id ?? null) !== observedPrimaryId;
      if (changed) lastObservedAt = null;
      if (primary && snapshot?.aircraft.some((a) => a.id === primary.id))
        lastObservedAt = Math.max(
          lastObservedAt ?? -Infinity,
          snapshot.fetchedAtMs,
        );
      const age =
        primary?.positionTimeMs === null || !primary
          ? null
          : now - primary.positionTimeMs;
      const secondaryAges = selection.secondary
        .map((a) => (a.positionTimeMs === null ? null : now - a.positionTimeMs))
        .filter((v): v is number => v !== null);
      const snapshotAge = snapshot ? now - snapshot.fetchedAtMs : null,
        providerAge = snapshot ? now - snapshot.providerTimeMs : null;
      lastDiagnosticState = {
        ...(env.context?.() ?? {
          active: env.active(),
          visible: null,
          online: null,
        }),
        state: scene.state,
        requestFailed: failed,
        primaryAgeMs: age,
        secondaryAgeMs: secondaryAges.length
          ? Math.max(...secondaryAges)
          : null,
        snapshotAgeMs: snapshotAge,
        providerAgeMs: providerAge,
        lastObservedAgeMs:
          lastObservedAt === null ? null : now - lastObservedAt,
        primaryChanged: changed,
        retainedMissing: selection.decision.retainedMissing,
        clockAnomaly:
          [age, snapshotAge, providerAge].some((v) => v !== null && v < 0) ||
          !!snapshot?.anomalies.includes('provider-clock'),
      };
      env.observer.observe(lastDiagnosticState, now);
      observedPrimaryId = primary?.id ?? null;
    }
    onChange(scene);
    if (expiryTimer !== undefined) env.clearTimer(expiryTimer);
    const deadlines = snapshot
      ? [
          ...(selection.reevaluateAtMs !== null
            ? [selection.reevaluateAtMs]
            : []),
          snapshot.fetchedAtMs + CURRENT_AGE_MS,
          snapshot.fetchedAtMs + EXPIRE_AGE_MS,
          ...(selection.primary
            ? [selection.primary, ...selection.secondary]
            : []
          ).flatMap((a) =>
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
    env.observer?.pollStart(lastStart);
    let status: number | null = null,
      cache: string | null = null,
      cacheAgeSeconds: number | null = null,
      failureCode: string | null = null,
      timedOut = false;
    const thisRequest = request;
    const timeout = env.setTimer(() => {
      timedOut = true;
      thisRequest.abort();
    }, 8000);
    try {
      const response = await env.fetch('/api/aircraft', {
        signal: thisRequest.signal,
      });
      status = response.status;
      const cacheHeader = response.headers.get('x-vercel-cache');
      cache =
        cacheHeader && ['HIT', 'MISS', 'STALE', 'BYPASS'].includes(cacheHeader)
          ? cacheHeader
          : null;
      const rawAge = response.headers.get('age');
      const age = rawAge === null || !rawAge.trim() ? NaN : Number(rawAge);
      cacheAgeSeconds = Number.isFinite(age) && age >= 0 ? age : null;
      if (!response.ok) {
        failureCode = 'http-error';
        if (env.observer) {
          try {
            const body = await response.clone().json();
            if (
              [
                'cooldown',
                'rate-limited',
                'access-denied',
                'http-error',
                'timeout',
                'configuration',
                'live-disabled',
                'network-error',
                'invalid-json',
                'invalid-structure',
                'response-too-large',
                'unavailable',
              ].includes(body?.error)
            )
              failureCode = body.error;
          } catch {
            /* No raw error bodies in diagnostics. */
          }
        }
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
      failureCode = 'invalid-response';
      const value: unknown = await response.json();
      if (!validSnapshot(value)) throw Error('invalid-response');
      if (!stopped && !thisRequest.signal.aborted) {
        snapshot = value;
        interval = value.pollIntervalMs;
        failed = false;
        failureCode = null;
      }
    } catch {
      failureCode = timedOut
        ? 'timeout'
        : thisRequest.signal.aborted
          ? 'aborted'
          : (failureCode ?? 'network-error');
      if (!stopped) failed = true;
    } finally {
      env.clearTimer(timeout);
      inFlight = false;
      request = null;
      if (!stopped) {
        const completeAt = env.now(),
          duration = completeAt - lastStart;
        publish();
        env.observer?.pollComplete({
          atMs: completeAt,
          startedAtMs: lastStart,
          context: lastDiagnosticState,
          durationMs: duration >= 0 ? duration : null,
          ok: failureCode === null,
          status,
          error: failureCode,
          cache,
          cacheAgeSeconds,
        });
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
    diagnostics: () => ({ history: selector.inspect(), selection }),
    stop: () => {
      stopped = true;
      env.observer?.stop(env.now());
      selector.clear();
      selection = null;
      snapshot = null;
      observedPrimaryId = null;
      lastObservedAt = null;
      lastDiagnosticState = undefined;
      clear();
      request?.abort();
    },
  };
}

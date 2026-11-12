import type { LiveAircraft } from './liveTypes';
import { CURRENT_AGE_MS } from './liveTypes';
// Transparent trial parameters, not fitted probabilities of seeing/hearing a flight.
export const OBSERVATION_POLICY = {
  horizonSeconds: 180,
  coneElevationDegrees: 35,
  predictionMaxAgeMs: 20_000,
  minimumSpeedKnots: 15,
  maximumSpeedKnots: 650,
  radialToleranceKmPerSecond: 0.003,
  passingSeconds: 12,
  urgentSeconds: 120,
  fastKnots: 250,
  vectorToleranceKmPerSecond: 0.03,
  vectorSpeedTolerance: 0.5,
  vectorJitterKm: 0.05,
  optionalIdentityMaxCpaKm: 5,
  lowElevationDegrees: 5,
  peripheralDistanceKm: 5,
  peripheralResidenceMs: 90_000,
  closeCpaKm: 2.5,
  prefetchAdvantage: 15,
  maximumCandidates: 6,
  urgencyProximityWeight: 35,
  urgencyDistanceScaleKm: 3,
  urgencyElevationWeight: 30,
  urgencyImmediacyWeight: 20,
  urgencyTimeScaleSeconds: 90,
  urgencySpeedWeight: 15,
};
export interface ObservationEstimate {
  computedAtMs: number;
  positionTimeMs: number | null;
  elevationDegrees: number | null;
  heightKm: number | null;
  heightBasis:
    | 'geometric'
    | 'barometric'
    | 'altitude-proxy'
    | 'unavailable';
  slantKm: number | null;
  speedKnots: number | null;
  predictionQuality: 'unavailable' | 'provisional' | 'supported';
  cpaDistanceKm: number | null;
  secondsToCpa: number | null;
  secondsToCone: number | null;
  secondsToExitCone: number | null;
  predictionDistanceKm: number | null;
  radialKmPerSecond: number | null;
  phase: 'approaching' | 'passing' | 'departing' | 'unknown';
  urgency: number;
  reason: string;
}
export function observation(
  a: LiveAircraft,
  now: number,
  samples = 0,
  consistent = true,
): ObservationEstimate {
  const validAltitude = (v: number | null) =>
    v !== null && Number.isFinite(v) && v >= -1500 && v <= 60000;
  const proxy = validAltitude(a.geometricAltitudeFt)
    ? a.geometricAltitudeFt
    : validAltitude(a.barometricAltitudeFt)
      ? a.barometricAltitudeFt
      : null;
  const height =
    a.heightAboveObserverKm === undefined
      ? proxy === null
        ? null
        : proxy * 0.0003048
      : a.heightAboveObserverKm;
  const h =
    height !== null &&
    Number.isFinite(height) &&
    height >= -1 &&
    height <= 20
      ? height
      : null;
  const d =
    a.distanceKm !== null &&
    Number.isFinite(a.distanceKm) &&
    a.distanceKm >= 0 &&
    a.distanceKm <= 15
      ? a.distanceKm
      : null;
  const elevation =
    h === null || d === null
      ? null
      : d === 0 && h <= 0
        ? 0
        : (Math.atan2(Math.max(0, h), d) * 180) / Math.PI;
  const estimate: ObservationEstimate = {
    computedAtMs: now,
    positionTimeMs: a.positionTimeMs,
    elevationDegrees: elevation,
    heightKm: h,
    heightBasis:
      h === null
        ? 'unavailable'
        : a.heightAboveObserverKm === undefined
          ? 'altitude-proxy'
          : (a.heightReference ?? 'unavailable'),
    slantKm: h === null || d === null ? null : Math.hypot(h, d),
    speedKnots: a.groundSpeedKnots,
    predictionQuality: 'unavailable',
    cpaDistanceKm: null,
    secondsToCpa: null,
    secondsToCone: null,
    secondsToExitCone: null,
    predictionDistanceKm: null,
    radialKmPerSecond: null,
    phase: 'unknown',
    urgency: 0,
    reason: 'Insufficient fresh bearing, track or speed',
  };
  const p = OBSERVATION_POLICY,
    age = a.positionTimeMs === null ? NaN : now - a.positionTimeMs;
  const fresh =
    Number.isFinite(age) &&
    age >= 0 &&
    age < p.predictionMaxAgeMs &&
    a.validity.position &&
    a.validity.timestamp &&
    !a.validity.anomalies.length &&
    a.onGround !== true;
  const bearing = a.bearingDegrees,
    track = a.trackDegrees,
    speed = a.groundSpeedKnots;
  if (!consistent) {
    estimate.reason = 'Ground track conflicts with recent displacement';
    return estimate;
  }
  if (
    !fresh ||
    d === null ||
    bearing == null ||
    !Number.isFinite(bearing) ||
    bearing < 0 ||
    bearing >= 360 ||
    track === null ||
    !Number.isFinite(track) ||
    track < 0 ||
    track >= 360 ||
    speed === null ||
    !Number.isFinite(speed) ||
    speed < p.minimumSpeedKnots ||
    speed > p.maximumSpeedKnots
  )
    return estimate;
  const rad = Math.PI / 180,
    v = speed * 0.000514444;
  // r is observation-point -> aircraft; track is direction of ground movement.
  const x = d * Math.sin(bearing * rad),
    y = d * Math.cos(bearing * rad),
    vx = v * Math.sin(track * rad),
    vy = v * Math.cos(track * rad);
  const rx = x + (vx * age) / 1000,
    ry = y + (vy * age) / 1000;
  const dot = rx * vx + ry * vy,
    rawTime = -dot / (v * v),
    t = Math.abs(rawTime) < 1e-6 ? 0 : rawTime,
    radial = Math.hypot(rx, ry) > 0 ? dot / Math.hypot(rx, ry) : 0;
  const predicted = Math.max(0, Math.min(p.horizonSeconds, t));
  estimate.predictionQuality = samples >= 2 ? 'supported' : 'provisional';
  estimate.radialKmPerSecond = radial;
  estimate.predictionDistanceKm = Math.hypot(
    rx + vx * predicted,
    ry + vy * predicted,
  );
  // Do not label the horizon boundary as the true closest approach.
  if (t >= 0 && t <= p.horizonSeconds) {
    estimate.secondsToCpa = t;
    estimate.cpaDistanceKm = estimate.predictionDistanceKm;
  }
  estimate.phase =
    t >= -p.passingSeconds && t <= p.passingSeconds
      ? 'passing'
      : radial < -p.radialToleranceKmPerSecond
        ? 'approaching'
        : radial > p.radialToleranceKmPerSecond
          ? 'departing'
          : 'unknown';
  if (h !== null && h > 0) {
    const radius = h / Math.tan((p.coneElevationDegrees * Math.PI) / 180),
      discriminant =
        dot * dot - v * v * (rx * rx + ry * ry - radius * radius);
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant),
        enter = (-dot - root) / (v * v),
        exit = (-dot + root) / (v * v);
      if (exit >= 0) {
        if (enter <= 0) estimate.secondsToCone = 0;
        else if (enter <= p.horizonSeconds) estimate.secondsToCone = enter;
        if (exit <= p.horizonSeconds) estimate.secondsToExitCone = exit;
      }
    }
  }
  estimate.reason =
    'Constant ground track/speed, horizontal CPA; vertical speed and turns not predicted';
  if (
    estimate.secondsToCpa !== null &&
    estimate.cpaDistanceKm !== null &&
    estimate.phase === 'approaching'
  ) {
    const cpa = estimate.cpaDistanceKm,
      time = estimate.secondsToCpa;
    const futureElevation =
      h === null
        ? 0.4
        : cpa === 0
          ? h > 0
            ? 1
            : 0
          : Math.max(0, h) / Math.hypot(h, cpa);
    estimate.urgency =
      (p.urgencyProximityWeight / (1 + cpa / p.urgencyDistanceScaleKm) +
        p.urgencyElevationWeight * futureElevation +
        p.urgencyImmediacyWeight /
          (1 +
            Math.min(time, estimate.secondsToCone ?? time) /
              p.urgencyTimeScaleSeconds) +
        p.urgencySpeedWeight * Math.min(1, speed / p.fastKnots)) *
      (samples >= 2 ? 1 : 0.5);
  }
  return estimate;
}
export function urgencyFor(
  o: ObservationEstimate | undefined,
  now: number,
) {
  return o &&
    o.predictionQuality === 'supported' &&
    o.positionTimeMs !== null &&
    now >= o.computedAtMs &&
    now - o.positionTimeMs < OBSERVATION_POLICY.predictionMaxAgeMs
    ? o.urgency
    : 0;
}
export function urgentPass(
  o: ObservationEstimate | undefined,
  now: number,
) {
  return (
    urgencyFor(o, now) > 0 &&
    o!.secondsToCpa !== null &&
    o!.secondsToCpa <= OBSERVATION_POLICY.urgentSeconds &&
    o!.cpaDistanceKm !== null &&
    (o!.cpaDistanceKm <= OBSERVATION_POLICY.closeCpaKm ||
      o!.secondsToCone !== null) &&
    (o!.speedKnots ?? 0) >= OBSERVATION_POLICY.fastKnots
  );
}
// Legacy feeds have no bearing. Their conservative fallback still uses geometry,
// but does not invent a CPA or prefetch priority from distance slope alone.
export const predictionFreshnessMs = CURRENT_AGE_MS;

export function consistentVector(
  a: LiveAircraft,
  samples: readonly {
    timeMs: number;
    distanceKm: number;
    bearingDegrees?: number | null;
  }[],
) {
  if (
    samples.length < 2 ||
    a.groundSpeedKnots === null ||
    a.trackDegrees === null
  )
    return true;
  const first = samples[samples.length - 2],
    last = samples[samples.length - 1];
  if (first.bearingDegrees == null || last.bearingDegrees == null)
    return true;
  const dt = (last.timeMs - first.timeMs) / 1000;
  if (dt <= 0) return false;
  const rad = Math.PI / 180,
    dx =
      last.distanceKm * Math.sin(last.bearingDegrees * rad) -
      first.distanceKm * Math.sin(first.bearingDegrees * rad),
    dy =
      last.distanceKm * Math.cos(last.bearingDegrees * rad) -
      first.distanceKm * Math.cos(first.bearingDegrees * rad);
  if (Math.hypot(dx, dy) < OBSERVATION_POLICY.vectorJitterKm)
    return a.groundSpeedKnots < 50;
  const v = a.groundSpeedKnots * 0.000514444,
    tolerance =
      OBSERVATION_POLICY.vectorToleranceKmPerSecond +
      OBSERVATION_POLICY.vectorSpeedTolerance * v;
  return (
    Math.hypot(
      dx / dt - v * Math.sin(a.trackDegrees * rad),
      dy / dt - v * Math.cos(a.trackDegrees * rad),
    ) <= tolerance
  );
}

// Frozen R03 baseline c230231; test/replay only.
import type { LiveAircraft, Snapshot } from './liveTypes';
import { CURRENT_AGE_MS, EXPIRE_AGE_MS } from './liveTypes';

// Starting heuristics, not statistically fitted audibility probabilities.
export const DEFAULT_SELECTION_POLICY = {
  proximityWeight: 50,
  distanceScaleKm: 3,
  altitudeWeight: 20,
  altitudeScaleFt: 8000,
  movementWeight: 20,
  passingFactor: 0.6,
  neutralFactor: 0.5,
  qualityWeight: 10,
  expiryPenalty: 0.8,
  minimumHoldMs: 36_000,
  takeoverMargin: 8,
  substantialMargin: 22,
  confirmations: 2,
  missingGraceMs: 30_000,
  historyWindowMs: 90_000,
  maximumHistoryGapMs: 45_000,
  minimumSpanMs: 20_000,
  minimumSamples: 3,
  samplesPerAircraft: 6,
  maximumAircraft: 1000,
  jitterKm: 0.05,
  minimumMovementKm: 0.15,
  radialThresholdKmPerSecond: 0.003,
  passingBandKm: 0.25,
  unknownSpeedLimitKmPerSecond: 0.6,
  speedToleranceFactor: 1.5,
  speedToleranceKmPerSecond: 0.03,
};
export type SelectionPolicy = typeof DEFAULT_SELECTION_POLICY;
export type Movement = 'approaching' | 'passing' | 'departing' | 'unknown';
export interface Sample {
  timeMs: number;
  distanceKm: number;
  speedKnots: number | null;
}
export interface Motion {
  state: Movement;
  radialKmPerSecond: number | null;
  samples: number;
}
export interface RankedAircraft {
  aircraft: LiveAircraft;
  score: number;
  motion: Motion;
  ageMs: number;
  factors: {
    proximity: number;
    altitude: number;
    movement: number;
    quality: number;
    freshness: number;
  };
}
export type DecisionReason =
  | 'acquired'
  | 'no-candidates'
  | 'snapshot-expired'
  | 'primary-ineligible'
  | 'feed-interruption'
  | 'minimum-hold'
  | 'hysteresis'
  | 'confirming'
  | 'retained-best'
  | 'substantial-challenger'
  | 'departing-handover'
  | 'fresher-challenger'
  | 'confirmed-challenger';
export interface SelectionResult {
  primary: LiveAircraft | null;
  secondary: LiveAircraft[];
  ranked: RankedAircraft[];
  reevaluateAtMs: number | null;
  decision: {
    reason: DecisionReason;
    primaryId: string | null;
    challengerId: string | null;
    margin: number;
    heldMs: number;
    confirmations: number;
    retainedMissing: boolean;
  };
}

export function eligibleAircraft(a: LiveAircraft, now: number): boolean {
  return (
    a.onGround !== true &&
    a.validity.position &&
    a.validity.timestamp &&
    a.validity.anomalies.length === 0 &&
    Number.isFinite(a.positionTimeMs) &&
    a.positionTimeMs !== null &&
    now >= a.positionTimeMs &&
    now - a.positionTimeMs < EXPIRE_AGE_MS &&
    a.distanceKm !== null &&
    Number.isFinite(a.distanceKm) &&
    a.distanceKm >= 0 &&
    a.distanceKm <= 15
  );
}
const unknownMotion = (samples = 0): Motion => ({
  state: 'unknown',
  radialKmPerSecond: null,
  samples,
});

export function assessMovement(
  samples: readonly Sample[],
  now: number,
  policy = DEFAULT_SELECTION_POLICY,
): Motion {
  const recent = samples
    .filter((s) => now >= s.timeMs && now - s.timeMs <= policy.historyWindowMs)
    .slice(-policy.minimumSamples);
  if (
    recent.length < Math.max(3, policy.minimumSamples) ||
    now - recent[recent.length - 1].timeMs >= CURRENT_AGE_MS
  )
    return unknownMotion(recent.length);
  const first = recent[0],
    last = recent[recent.length - 1];
  if (last.timeMs - first.timeMs < policy.minimumSpanMs)
    return unknownMotion(recent.length);
  const gap = recent.some(
    (s, i) =>
      i > 0 &&
      (s.timeMs <= recent[i - 1].timeMs ||
        s.timeMs - recent[i - 1].timeMs > policy.maximumHistoryGapMs),
  );
  if (gap) return unknownMotion(recent.length);
  // A turn at the middle sample is evidence of passing, rather than a jitter sign change.
  const middle = recent[recent.length - 2];
  if (
    first.distanceKm - middle.distanceKm >= policy.minimumMovementKm &&
    last.distanceKm >= middle.distanceKm - policy.jitterKm &&
    last.distanceKm - middle.distanceKm <= policy.passingBandKm
  ) {
    return {
      state: 'passing',
      radialKmPerSecond: null,
      samples: recent.length,
    };
  }
  const meanTime =
    recent.reduce((v, s) => v + (s.timeMs - first.timeMs) / 1000, 0) /
    recent.length;
  const meanDistance =
    recent.reduce((v, s) => v + s.distanceKm, 0) / recent.length;
  let numerator = 0,
    denominator = 0;
  for (const s of recent) {
    const dt = (s.timeMs - first.timeMs) / 1000 - meanTime;
    numerator += dt * (s.distanceKm - meanDistance);
    denominator += dt * dt;
  }
  const slope = numerator / denominator;
  if (
    Math.abs(last.distanceKm - first.distanceKm) < policy.minimumMovementKm ||
    Math.abs(slope) < policy.radialThresholdKmPerSecond
  )
    return unknownMotion(recent.length);
  return {
    state: slope < 0 ? 'approaching' : 'departing',
    radialKmPerSecond: slope,
    samples: recent.length,
  };
}

export function scoreAircraft(
  a: LiveAircraft,
  now: number,
  motion = unknownMotion(),
  policy = DEFAULT_SELECTION_POLICY,
): RankedAircraft | null {
  if (!eligibleAircraft(a, now)) return null;
  const ageMs = now - a.positionTimeMs!;
  const altitude = a.barometricAltitudeFt;
  if (ageMs >= CURRENT_AGE_MS) motion = unknownMotion(motion.samples);
  const factors = {
    proximity:
      policy.proximityWeight / (1 + a.distanceKm! / policy.distanceScaleKm),
    altitude:
      altitude !== null && Number.isFinite(altitude)
        ? policy.altitudeWeight /
          (1 + Math.max(0, altitude) / policy.altitudeScaleFt)
        : policy.altitudeWeight * policy.neutralFactor,
    movement:
      policy.movementWeight *
      (motion.state === 'approaching'
        ? 1
        : motion.state === 'departing'
          ? 0
          : motion.state === 'passing'
            ? policy.passingFactor
            : policy.neutralFactor),
    quality: policy.qualityWeight,
    freshness: 1 - (policy.expiryPenalty * ageMs) / EXPIRE_AGE_MS,
  };
  return {
    aircraft: a,
    ageMs,
    motion,
    factors,
    score:
      (factors.proximity +
        factors.altitude +
        factors.movement +
        factors.quality) *
      factors.freshness,
  };
}
const byRelevance = (a: RankedAircraft, b: RankedAircraft) =>
  b.score - a.score || a.aircraft.id.localeCompare(b.aircraft.id);

export function createAircraftSelector(
  overrides: Partial<SelectionPolicy> = {},
) {
  const policy = { ...DEFAULT_SELECTION_POLICY, ...overrides };
  const history = new Map<string, Sample[]>();
  let current: LiveAircraft | null = null,
    selectedAt = 0,
    lastSeenAt = 0,
    lastNow = -Infinity;
  let challengerId: string | null = null,
    confirmations = 0,
    lastConfirmationTime = -Infinity;
  function resetChallenge() {
    challengerId = null;
    confirmations = 0;
    lastConfirmationTime = -Infinity;
  }
  function clear() {
    history.clear();
    current = null;
    selectedAt = 0;
    lastSeenAt = 0;
    lastNow = -Infinity;
    resetChallenge();
  }
  function select(
    snapshot: Snapshot | null,
    now: number,
    failed = false,
  ): SelectionResult {
    if (now < lastNow) clear(); // A backwards local clock cannot justify retaining old history/holds.
    lastNow = now;
    for (const [id, samples] of history) {
      const kept = samples.filter(
        (s) => now >= s.timeMs && now - s.timeMs <= policy.historyWindowMs,
      );
      if (kept.length) history.set(id, kept);
      else history.delete(id);
    }
    const snapshotValid =
      snapshot &&
      now >= snapshot.fetchedAtMs &&
      now - snapshot.fetchedAtMs < EXPIRE_AGE_MS;
    const records = new Map<string, LiveAircraft>();
    // Duplicate IDs prefer the newest position. Equal timestamp: closest valid distance.
    for (const a of snapshotValid ? snapshot.aircraft : []) {
      const previous = records.get(a.id);
      if (
        !previous ||
        (a.positionTimeMs ?? -Infinity) >
          (previous.positionTimeMs ?? -Infinity) ||
        (a.positionTimeMs === previous.positionTimeMs &&
          (a.distanceKm ?? Infinity) < (previous.distanceKm ?? Infinity))
      )
        records.set(a.id, a);
    }
    if (snapshotValid) {
      for (const a of records.values()) {
        if (!eligibleAircraft(a, now)) {
          history.delete(a.id);
          continue;
        }
        if (now - a.positionTimeMs! >= CURRENT_AGE_MS) continue;
        let samples = history.get(a.id) ?? [];
        const previous = samples[samples.length - 1];
        if (previous && a.positionTimeMs! <= previous.timeMs) continue; // Cached/repeated/out-of-order positions add no evidence.
        if (previous) {
          const seconds = (a.positionTimeMs! - previous.timeMs) / 1000;
          const speeds = [previous.speedKnots, a.groundSpeedKnots].filter(
            (v): v is number => v !== null && Number.isFinite(v) && v >= 0,
          );
          const limit = speeds.length
            ? Math.max(...speeds) * 0.000514444 * policy.speedToleranceFactor +
              policy.speedToleranceKmPerSecond
            : policy.unknownSpeedLimitKmPerSecond;
          if (
            seconds * 1000 > policy.maximumHistoryGapMs ||
            Math.abs(a.distanceKm! - previous.distanceKm) >
              limit * seconds + policy.jitterKm
          )
            samples = [];
        }
        samples = [
          ...samples,
          {
            timeMs: a.positionTimeMs!,
            distanceKm: a.distanceKm!,
            speedKnots: a.groundSpeedKnots,
          },
        ].slice(-policy.samplesPerAircraft);
        history.delete(a.id); // Refresh insertion order only for a newer valid position.
        if (history.size >= policy.maximumAircraft)
          history.delete(history.keys().next().value!);
        history.set(a.id, samples);
      }
    }
    let retainedMissing = false;
    if (current && snapshotValid) {
      const observed = records.get(current.id);
      if (observed) {
        // An explicitly invalid/ground/out-of-area replacement must release immediately.
        if (eligibleAircraft(observed, now)) {
          if (observed.positionTimeMs! >= current.positionTimeMs!) {
            current = observed;
            lastSeenAt = Math.max(lastSeenAt, snapshot.fetchedAtMs);
          } else if (!eligibleAircraft(current, now)) current = null;
          else records.set(current.id, current);
        } else current = null;
      } else if (
        [...records.values()].some((a) => eligibleAircraft(a, now)) &&
        now - lastSeenAt < policy.missingGraceMs &&
        eligibleAircraft(current, now)
      ) {
        records.set(current.id, current);
        retainedMissing = true;
      } else current = null; // A successful empty feed is authoritative; never manufacture traffic.
    }
    if (!snapshotValid) current = null;
    const ranked: RankedAircraft[] = [];
    for (const a of records.values()) {
      const score = scoreAircraft(
        a,
        now,
        assessMovement(history.get(a.id) ?? [], now, policy),
        policy,
      );
      if (score) ranked.push(score);
    }
    ranked.sort(byRelevance);
    const incumbent = current
      ? ranked.find((a) => a.aircraft.id === current!.id)
      : undefined;
    const best = ranked[0];
    const heldMs = current ? now - selectedAt : 0;
    let reason: DecisionReason = 'retained-best',
      margin = 0;
    let chosen = incumbent;
    if (!best) {
      chosen = undefined;
      reason = snapshotValid ? 'no-candidates' : 'snapshot-expired';
      resetChallenge();
    } else if (!incumbent) {
      chosen = best;
      reason = selectedAt ? 'primary-ineligible' : 'acquired';
      resetChallenge();
    } else if (best.aircraft.id === incumbent.aircraft.id) {
      resetChallenge();
    } else {
      margin = best.score - incumbent.score;
      if (challengerId !== best.aircraft.id) {
        resetChallenge();
        challengerId = best.aircraft.id;
      }
      if (margin < policy.takeoverMargin) resetChallenge();
      if (
        !failed &&
        margin >= policy.takeoverMargin &&
        best.aircraft.positionTimeMs! > lastConfirmationTime
      ) {
        confirmations++;
        lastConfirmationTime = best.aircraft.positionTimeMs!;
      }
      if (failed) reason = 'feed-interruption';
      else if (margin >= policy.substantialMargin) {
        chosen = best;
        reason = 'substantial-challenger';
      } else if (
        incumbent.motion.state === 'departing' &&
        best.motion.state === 'approaching' &&
        margin >= policy.takeoverMargin
      ) {
        chosen = best;
        reason = 'departing-handover';
      } else if (
        incumbent.ageMs >= CURRENT_AGE_MS &&
        best.ageMs < CURRENT_AGE_MS &&
        margin >= 0
      ) {
        chosen = best;
        reason = 'fresher-challenger';
      } else if (heldMs < policy.minimumHoldMs) reason = 'minimum-hold';
      else if (margin < policy.takeoverMargin) {
        reason = 'hysteresis';
        resetChallenge();
      } else if (confirmations < policy.confirmations) reason = 'confirming';
      else {
        chosen = best;
        reason = 'confirmed-challenger';
      }
    }
    const retainedChosen =
      retainedMissing && chosen?.aircraft.id === current?.id;
    const decision = {
      reason,
      primaryId: chosen?.aircraft.id ?? null,
      challengerId:
        incumbent && best && best.aircraft.id !== incumbent.aircraft.id
          ? best.aircraft.id
          : null,
      margin,
      heldMs,
      confirmations,
      retainedMissing: retainedChosen,
    };
    if (chosen?.aircraft.id !== current?.id) {
      selectedAt = now;
      lastSeenAt = snapshot?.fetchedAtMs ?? now;
      resetChallenge();
    }
    current = chosen?.aircraft ?? null;
    if (!current) selectedAt = 0;
    return {
      primary: current,
      reevaluateAtMs:
        retainedMissing && current ? lastSeenAt + policy.missingGraceMs : null,
      secondary: ranked
        .filter((a) => a.aircraft.id !== current?.id)
        .slice(0, 3)
        .map((a) => a.aircraft),
      ranked,
      decision,
    };
  }
  return {
    select,
    clear,
    inspect: () => ({
      aircraft: history.size,
      samples: [...history.values()].reduce((sum, a) => sum + a.length, 0),
      primaryId: current?.id ?? null,
    }),
  };
}

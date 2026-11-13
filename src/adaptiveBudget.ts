// R05 policy is application-defined, not a claim about a HexDB quota.
export const ADAPTIVE_POLICY = {
  capacity: 3,
  refillMs: 30_000,
  spacingMs: 10_000,
  windowMs: 300_000,
  windowLimit: 10,
  dayMs: 86_400_000,
  dailyLimit: 2_000,
  reserve: 1,
  rpcTimeoutMs: 2_000,
  clientTimeoutMs: 18_000,
  handlerSeconds: 15,
  // API function maxDuration is 15s. Abandoned ownership is held far longer.
  leaseMs: 120_000,
  dispatchValidityMs: 3_000,
} as const;
export type BudgetReason =
  | 'in-flight'
  | 'spacing'
  | 'tokens'
  | 'reserved-capacity'
  | 'rolling-five'
  | 'rolling-day'
  | 'provider-backoff'
  | 'coordination-unavailable';
const counterNames = [
  'reserved',
  'confirmedStarts',
  'upstreamResponses',
  'complete',
  'historical',
  'notFound',
  'rejected',
  'failures',
  'uncertain',
] as const;
export type AdaptiveCounters = Record<
  (typeof counterNames)[number],
  number
>;
const freshCounters = () =>
  Object.fromEntries(counterNames.map((k) => [k, 0])) as AdaptiveCounters;
function validCounters(v: unknown): v is AdaptiveCounters {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v).length === counterNames.length &&
    counterNames.every(
      (k) =>
        Number.isSafeInteger((v as AdaptiveCounters)[k]) &&
        (v as AdaptiveCounters)[k] >= 0 &&
        (v as AdaptiveCounters)[k] <= 1_000_000_000,
    )
  );
}
const copyCounters = (v: AdaptiveCounters) =>
  Object.fromEntries(
    counterNames.map((k) => [k, v[k]]),
  ) as AdaptiveCounters;
const count = (v: AdaptiveCounters, k: (typeof counterNames)[number]) => {
  v[k] = Math.min(1_000_000_000, v[k] + 1);
};
export interface AdaptiveState {
  schemaVersion: 1;
  updatedAtMs: number;
  tokens: number;
  nextStartMs: number;
  cooldownUntilMs: number;
  dailyLimit: number;
  // Conservative upper bounds on charged start times, not flight histories.
  // Pending starts never age out before ownership is safely recovered.
  charges: number[];
  pending: {
    id: string;
    key: string;
    acquiredAtMs: number;
    expiresAtMs: number;
  } | null;
  throttleStreak: number;
  errorStreak: number;
  recoveries: number;
  counters: AdaptiveCounters;
}
export interface AdaptiveView {
  schemaVersion: 1;
  policy: 'r05-10';
  serverTimeMs: number;
  tokens: number;
  rollingFive: number;
  rollingDay: number;
  dailyLimit: number;
  inFlight: boolean;
  protectedWaitMs: number;
  normalWaitMs: number;
  recoveries: number;
  counters: AdaptiveCounters;
}
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
export function adaptiveObservationUntil(
  search: string,
  now = Date.now(),
) {
  const duration = Number(new URLSearchParams(search).get('observe'));
  return integer(now) &&
    Number.isInteger(duration) &&
    duration >= 1 &&
    duration <= 90
    ? now + duration * 60000
    : undefined;
}
export function initialAdaptiveState(
  now: number,
  dailyLimit: number = ADAPTIVE_POLICY.dailyLimit,
): AdaptiveState {
  if (
    !integer(now) ||
    !integer(dailyLimit) ||
    dailyLimit < 1 ||
    dailyLimit > 2880
  )
    throw Error('adaptive-invalid-configuration');
  return {
    schemaVersion: 1,
    updatedAtMs: now,
    tokens: 3,
    nextStartMs: now,
    cooldownUntilMs: now,
    dailyLimit,
    charges: [],
    pending: null,
    throttleStreak: 0,
    errorStreak: 0,
    recoveries: 0,
    counters: freshCounters(),
  };
}
export function validAdaptiveState(v: unknown): v is AdaptiveState {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as AdaptiveState;
  return (
    s.schemaVersion === 1 &&
    integer(s.updatedAtMs) &&
    Number.isFinite(s.tokens) &&
    s.tokens >= 0 &&
    s.tokens <= 3 &&
    integer(s.nextStartMs) &&
    integer(s.cooldownUntilMs) &&
    integer(s.dailyLimit) &&
    s.dailyLimit >= 1 &&
    s.dailyLimit <= 2880 &&
    Array.isArray(s.charges) &&
    s.charges.length <= 2881 &&
    s.charges.every(
      (t, i) => integer(t) && (i === 0 || t >= s.charges[i - 1]),
    ) &&
    integer(s.throttleStreak) &&
    s.throttleStreak <= 3 &&
    integer(s.errorStreak) &&
    s.errorStreak <= 3 &&
    integer(s.recoveries) &&
    validCounters(s.counters) &&
    (s.pending === null ||
      (typeof s.pending === 'object' &&
        /^[a-f0-9-]{36}$/.test(s.pending.id) &&
        /^[a-f0-9]{64}$/.test(s.pending.key) &&
        integer(s.pending.acquiredAtMs) &&
        integer(s.pending.expiresAtMs) &&
        s.pending.expiresAtMs ===
          s.pending.acquiredAtMs + ADAPTIVE_POLICY.leaseMs &&
        s.charges[s.charges.length - 1] === s.pending.expiresAtMs))
  );
}
// Used only by trusted server code with database time. Never use browser time
// or initialise missing shared state to a new full bucket.
export function advanceAdaptiveState(value: unknown, now: number) {
  if (
    !validAdaptiveState(value) ||
    !integer(now) ||
    now < value.updatedAtMs
  )
    throw Error('adaptive-invalid-state-or-clock');
  const s: AdaptiveState = {
    ...value,
    charges: [...value.charges],
    pending: value.pending ? { ...value.pending } : null,
    counters: copyCounters(value.counters),
  };
  s.tokens = Math.min(
    3,
    s.tokens + (now - s.updatedAtMs) / ADAPTIVE_POLICY.refillMs,
  );
  s.updatedAtMs = now;
  if (s.pending && now >= s.pending.expiresAtMs) {
    // Only safe in the verified <=15s Vercel runtime; 120s is not an arbitrary
    // lock TTL. A stale handler also has a 3s dispatch validity guard.
    s.charges[s.charges.length - 1] = now;
    s.pending = null;
    s.recoveries++;
    count(s.counters, 'uncertain');
    s.errorStreak = Math.min(3, s.errorStreak + 1);
    s.nextStartMs = Math.max(
      s.nextStartMs,
      now + ADAPTIVE_POLICY.spacingMs,
    );
    // A crash has an uncertain upstream outcome. Keep provider protection.
    s.cooldownUntilMs = Math.max(
      s.cooldownUntilMs,
      now + [300_000, 900_000, 3_600_000][s.errorStreak - 1],
    );
  }
  s.charges = s.charges.filter((t) => t > now - ADAPTIVE_POLICY.dayMs);
  return s;
}
export function adaptiveEligibility(s: AdaptiveState, normal = false) {
  const now = s.updatedAtMs,
    p = ADAPTIVE_POLICY;
  let at = now,
    reason: BudgetReason = 'spacing';
  const gate = (deadline: number, why: BudgetReason) => {
    if (deadline > at) {
      at = deadline;
      reason = why;
    }
  };
  if (s.pending) gate(now + p.spacingMs, 'in-flight');
  gate(s.nextStartMs, 'spacing');
  gate(s.cooldownUntilMs, 'provider-backoff');
  const five = s.charges.filter((t) => t > now - p.windowMs);
  if (five.length >= p.windowLimit)
    gate(five[five.length - p.windowLimit] + p.windowMs, 'rolling-five');
  if (s.charges.length >= s.dailyLimit)
    gate(
      s.charges[s.charges.length - s.dailyLimit] + p.dayMs,
      'rolling-day',
    );
  const required = normal ? 1 + p.reserve : 1;
  if (s.tokens < required)
    gate(
      now + Math.max(1, Math.ceil((required - s.tokens) * p.refillMs)),
      normal && s.tokens >= 1 ? 'reserved-capacity' : 'tokens',
    );
  return {
    atMs: Math.ceil(at),
    waitMs: Math.max(0, Math.ceil(at - now)),
    reason,
  };
}
export function adaptiveView(s: AdaptiveState): AdaptiveView {
  return {
    schemaVersion: 1,
    policy: 'r05-10',
    serverTimeMs: s.updatedAtMs,
    tokens: s.tokens,
    rollingFive: s.charges.filter(
      (t) => t > s.updatedAtMs - ADAPTIVE_POLICY.windowMs,
    ).length,
    rollingDay: s.charges.length,
    dailyLimit: s.dailyLimit,
    inFlight: !!s.pending,
    protectedWaitMs: adaptiveEligibility(s).waitMs,
    normalWaitMs: adaptiveEligibility(s, true).waitMs,
    recoveries: s.recoveries,
    counters: copyCounters(s.counters),
  };
}
export function reserveAdaptive(
  s: AdaptiveState,
  id: string,
  key: string,
  normal = false,
): AdaptiveState {
  if (
    adaptiveEligibility(s, normal).waitMs ||
    s.pending ||
    s.tokens < (normal ? 1 + ADAPTIVE_POLICY.reserve : 1) ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !/^[a-f0-9]{64}$/.test(key)
  )
    throw Error('adaptive-admission-denied');
  const next = {
    ...s,
    charges: [...s.charges, s.updatedAtMs + ADAPTIVE_POLICY.leaseMs],
    pending: {
      id,
      key,
      acquiredAtMs: s.updatedAtMs,
      expiresAtMs: s.updatedAtMs + ADAPTIVE_POLICY.leaseMs,
    },
    tokens: s.tokens - 1,
    counters: copyCounters(s.counters),
  };
  count(next.counters, 'reserved');
  return next;
}
export function finishAdaptive(
  s: AdaptiveState,
  id: string,
  failure?: { code: string; retryAfterMs: number },
  evidence?: {
    started: boolean;
    responded: boolean;
    outcome: string;
    historical?: boolean;
    reason?: string;
  },
) {
  if (!s.pending || s.pending.id !== id)
    throw Error('adaptive-owner-mismatch');
  const next = {
    ...s,
    charges: [...s.charges],
    pending: null,
    counters: copyCounters(s.counters),
  };
  if (evidence?.started) {
    count(next.counters, 'confirmedStarts');
    if (evidence.responded) count(next.counters, 'upstreamResponses');
    if (evidence.outcome === 'complete') count(next.counters, 'complete');
    if (evidence.historical) count(next.counters, 'historical');
    if (evidence.reason === 'http-404') count(next.counters, 'notFound');
    if (evidence.outcome === 'rejected') count(next.counters, 'rejected');
    if (failure) count(next.counters, 'failures');
  } else count(next.counters, 'uncertain');
  // A completed HTTP attempt started no later than this trusted DB time. Keep
  // it charged for the full rolling periods from here (conservative bound).
  next.charges[next.charges.length - 1] = s.updatedAtMs;
  next.nextStartMs = s.updatedAtMs + ADAPTIVE_POLICY.spacingMs;
  if (failure) {
    const throttled = failure.code === 'rate-limited';
    if (throttled) next.throttleStreak = Math.min(3, s.throttleStreak + 1);
    else next.errorStreak = Math.min(3, s.errorStreak + 1);
    const streak = throttled ? next.throttleStreak : next.errorStreak;
    const backoff = [300_000, 900_000, 3_600_000][streak - 1];
    next.cooldownUntilMs = Math.max(
      next.cooldownUntilMs,
      s.updatedAtMs + backoff,
      s.updatedAtMs + Math.max(0, failure.retryAfterMs),
    );
  } else {
    next.throttleStreak = 0;
    next.errorStreak = 0;
  }
  return next;
}
export function parseAdaptiveView(v: unknown): AdaptiveView | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return;
  const x = v as AdaptiveView;
  if (
    x.schemaVersion !== 1 ||
    x.policy !== 'r05-10' ||
    !integer(x.serverTimeMs) ||
    !Number.isFinite(x.tokens) ||
    x.tokens < 0 ||
    x.tokens > 3 ||
    !integer(x.rollingFive) ||
    x.rollingFive > 10 ||
    !integer(x.rollingDay) ||
    !integer(x.dailyLimit) ||
    x.dailyLimit < 1 ||
    x.dailyLimit > 2880 ||
    x.rollingDay > x.dailyLimit ||
    typeof x.inFlight !== 'boolean' ||
    !integer(x.protectedWaitMs) ||
    !integer(x.normalWaitMs) ||
    x.normalWaitMs < x.protectedWaitMs ||
    !integer(x.recoveries) ||
    !validCounters(x.counters)
  )
    return;
  return {
    schemaVersion: 1,
    policy: 'r05-10',
    serverTimeMs: x.serverTimeMs,
    tokens: x.tokens,
    rollingFive: x.rollingFive,
    rollingDay: x.rollingDay,
    dailyLimit: x.dailyLimit,
    inFlight: x.inFlight,
    protectedWaitMs: x.protectedWaitMs,
    normalWaitMs: x.normalWaitMs,
    recoveries: x.recoveries,
    counters: copyCounters(x.counters),
  };
}

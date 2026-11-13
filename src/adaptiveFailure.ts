import { parseAdaptiveView } from './adaptiveBudget.js';
import type { AdaptiveView } from './adaptiveBudget.js';
const reasons = [
  'in-flight',
  'spacing',
  'tokens',
  'reserved-capacity',
  'rolling-five',
  'rolling-day',
  'provider-backoff',
  'coordination-unavailable',
];
export interface AdaptiveFailure {
  schemaVersion: 2;
  origin: 'application';
  category: 'local-deferral';
  reason: string;
  retryAfterMs: number;
  issuedAtMs: number;
  upstreamRequestsStarted: 0;
  upstreamResponses: 0;
}
export function verifiedAdaptiveDeferral(
  response: Response,
  body: unknown,
):
  | { failure: AdaptiveFailure; waitMs: number; budget?: AdaptiveView }
  | undefined {
  if (
    response.status !== 503 ||
    response.headers.get('content-type')?.split(';')[0].trim() !==
      'application/json' ||
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  )
    return;
  const b = body as Record<string, unknown>;
  if (
    b.error !== 'cooldown' ||
    Object.keys(b).some(
      (k) => !['error', 'failure', 'adaptiveBudget'].includes(k),
    ) ||
    !b.failure ||
    typeof b.failure !== 'object' ||
    Array.isArray(b.failure)
  )
    return;
  const f = b.failure as AdaptiveFailure;
  if (
    Object.keys(f).some(
      (k) =>
        ![
          'schemaVersion',
          'origin',
          'category',
          'reason',
          'retryAfterMs',
          'issuedAtMs',
          'upstreamRequestsStarted',
          'upstreamResponses',
        ].includes(k),
    ) ||
    f.schemaVersion !== 2 ||
    f.origin !== 'application' ||
    f.category !== 'local-deferral' ||
    !reasons.includes(f.reason) ||
    !Number.isSafeInteger(f.retryAfterMs) ||
    f.retryAfterMs < 1000 ||
    f.retryAfterMs > 172800000 ||
    !Number.isSafeInteger(f.issuedAtMs) ||
    f.issuedAtMs < 0 ||
    f.upstreamRequestsStarted !== 0 ||
    f.upstreamResponses !== 0
  )
    return;
  const raw = response.headers.get('retry-after');
  if (!raw || !/^\d+$/.test(raw)) return;
  const waitMs = Number(raw) * 1000;
  if (
    !Number.isSafeInteger(waitMs) ||
    waitMs < f.retryAfterMs ||
    waitMs - f.retryAfterMs >= 1000
  )
    return;
  const budget = parseAdaptiveView(b.adaptiveBudget);
  if ('adaptiveBudget' in b && !budget) return;
  if (!budget && f.reason !== 'coordination-unavailable') return;
  if (
    budget &&
    ((f.reason === 'in-flight' && !budget.inFlight) ||
      (f.reason === 'tokens' && budget.tokens >= 1) ||
      (f.reason === 'reserved-capacity' && budget.tokens >= 2) ||
      (f.reason === 'rolling-five' && budget.rollingFive < 10) ||
      (f.reason === 'rolling-day' &&
        budget.rollingDay < budget.dailyLimit) ||
      (f.reason === 'reserved-capacity'
        ? budget.normalWaitMs === 0
        : f.reason !== 'coordination-unavailable' &&
          budget.protectedWaitMs === 0))
  )
    return;
  if (
    budget &&
    (f.reason === 'reserved-capacity'
      ? budget.normalWaitMs
      : budget.protectedWaitMs) > f.retryAfterMs
  )
    return;
  return { failure: f, waitMs, budget };
}

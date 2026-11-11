import { ENRICHMENT_POLICY as P } from './enrichmentTypes.js';
import { parseEnrichmentDiagnostic } from './routeTraceTypes.js';

export interface EnrichmentFailure {
  schemaVersion: 1;
  origin: 'application' | 'hexdb' | 'unexpected';
  category:
    | 'local-deferral'
    | 'upstream-failure'
    | 'request-error'
    | 'unexpected-error';
  reason: string;
  retryAfterMs: number;
  issuedAtMs: number;
  upstreamRequestsStarted: number;
  upstreamResponses: number;
}
export interface EnrichmentScheduling {
  treatment: 'local-deferral' | 'failure-backoff';
  reason: 'global-gate' | 'in-flight' | 'failure';
  serverRetryAfterMs: number | null;
  serverWaitMs: number | null;
  priorGlobalWaitMs: number;
  globalWaitMs: number;
  secondaryWaitMs: number;
  nextGlobalEligibleAtMs: number;
  nextSecondaryEligibleAtMs: number;
}
export function copyEnrichmentScheduling(
  v: EnrichmentScheduling,
): EnrichmentScheduling {
  return {
    treatment: v.treatment,
    reason: v.reason,
    serverRetryAfterMs: v.serverRetryAfterMs,
    serverWaitMs: v.serverWaitMs,
    priorGlobalWaitMs: v.priorGlobalWaitMs,
    globalWaitMs: v.globalWaitMs,
    secondaryWaitMs: v.secondaryWaitMs,
    nextGlobalEligibleAtMs: v.nextGlobalEligibleAtMs,
    nextSecondaryEligibleAtMs: v.nextSecondaryEligibleAtMs,
  };
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const fields = [
  'schemaVersion',
  'origin',
  'category',
  'reason',
  'retryAfterMs',
  'issuedAtMs',
  'upstreamRequestsStarted',
  'upstreamResponses',
];
export function parseEnrichmentFailure(
  v: unknown,
): EnrichmentFailure | undefined {
  if (
    !object(v) ||
    Object.keys(v).some((k) => !fields.includes(k)) ||
    v.schemaVersion !== 1 ||
    !['application', 'hexdb', 'unexpected'].includes(String(v.origin)) ||
    ![
      'local-deferral',
      'upstream-failure',
      'request-error',
      'unexpected-error',
    ].includes(String(v.category)) ||
    typeof v.reason !== 'string' ||
    !/^[a-z0-9-]{1,64}$/.test(v.reason) ||
    !Number.isSafeInteger(v.retryAfterMs) ||
    (v.retryAfterMs as number) < 0 ||
    !Number.isSafeInteger(v.issuedAtMs) ||
    (v.issuedAtMs as number) < 0 ||
    ![0, 1].includes(v.upstreamRequestsStarted as number) ||
    ![0, 1].includes(v.upstreamResponses as number) ||
    (v.upstreamResponses as number) > (v.upstreamRequestsStarted as number)
  )
    return;
  return {
    schemaVersion: 1,
    origin: v.origin as EnrichmentFailure['origin'],
    category: v.category as EnrichmentFailure['category'],
    reason: v.reason,
    retryAfterMs: v.retryAfterMs as number,
    issuedAtMs: v.issuedAtMs as number,
    upstreamRequestsStarted: v.upstreamRequestsStarted as number,
    upstreamResponses: v.upstreamResponses as number,
  };
}

// A generic 503, legacy diagnostic label, or a contradictory envelope is never
// enough to shorten provider protection. This is a same-origin API contract,
// not a classification supplied by an upstream JSON payload.
export function verifiedLocalDeferral(response: Response, body: unknown) {
  if (
    response.status !== 503 ||
    response.headers
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase() !== 'application/json' ||
    !object(body) ||
    body.error !== 'cooldown' ||
    Object.keys(body).some(
      (k) => !['error', 'failure', 'diagnostic'].includes(k),
    )
  )
    return;
  const failure = parseEnrichmentFailure(body.failure);
  if (
    !failure ||
    failure.origin !== 'application' ||
    failure.category !== 'local-deferral' ||
    !['global-gate', 'in-flight'].includes(failure.reason) ||
    failure.retryAfterMs < P.intervalMs ||
    failure.upstreamRequestsStarted !== 0 ||
    failure.upstreamResponses !== 0
  )
    return;
  if ('diagnostic' in body) {
    const d = parseEnrichmentDiagnostic(body.diagnostic);
    if (
      !d ||
      d.origin !== 'application' ||
      d.serverCache !== 'none' ||
      d.outcome !== 'error' ||
      d.reason !== 'cooldown' ||
      d.httpStatus !== null ||
      d.upstreamRequestsStarted !== 0 ||
      d.upstreamResponses !== 0 ||
      d.retryAfterMs !== failure.retryAfterMs
    )
      return;
  }
  const raw = response.headers.get('retry-after')?.trim();
  if (!raw) return;
  let waitMs: number;
  if (/^[0-9]+$/.test(raw)) {
    waitMs = Number(raw) * 1000;
    if (
      !Number.isSafeInteger(waitMs) ||
      waitMs < failure.retryAfterMs ||
      waitMs - failure.retryAfterMs >= 1000
    )
      return;
  } else {
    const date = Date.parse(raw);
    if (
      !Number.isFinite(date) ||
      new Date(date).toUTCString() !== raw ||
      Math.abs(date - failure.issuedAtMs - failure.retryAfterMs) >= 1000
    )
      return;
    // Use the server's relative clock, then wait from receipt using monotonic
    // client time. A browser wall-clock discrepancy cannot cause an early retry.
    waitMs = Math.max(failure.retryAfterMs, date - failure.issuedAtMs);
  }
  return { failure, waitMs };
}

// Error responses are tiny; never buffer an unbounded HTML/proxy error body.
export const MAX_ENRICHMENT_FAILURE_BYTES = 8192;
export async function readEnrichmentFailure(
  response: Response,
): Promise<unknown> {
  if (
    response.headers
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase() !== 'application/json' ||
    Number(response.headers.get('content-length')) >
      MAX_ENRICHMENT_FAILURE_BYTES ||
    !response.body
  )
    return;
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ENRICHMENT_FAILURE_BYTES) {
        await reader.cancel();
        return;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    return;
  } finally {
    reader.releaseLock();
  }
}

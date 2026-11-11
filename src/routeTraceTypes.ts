// Explicit allowlist: no provider payload, URL, coordinates, credentials or IDs.
export type RouteOutcome =
  | 'complete'
  | 'partial'
  | 'negative'
  | 'rejected'
  | 'error'
  | 'identity';
export interface ProviderTrace {
  outcome: RouteOutcome;
  reason: string;
  httpStatus: number | null;
  requestStarted: boolean;
  endpoint: 'v2/routes/:callsign' | 'v2/aircraft/:hex';
  summary?: {
    callsignMatches: boolean;
    origin: boolean;
    destination: boolean;
    iataPair: boolean;
    associationAgeDays: number | null;
  };
}
export interface EnrichmentDiagnostic {
  origin: 'application' | 'hexdb' | 'unexpected';
  serverCache: 'hit' | 'miss' | 'coalesced' | 'none';
  upstreamRequestsStarted: number;
  upstreamResponses: number;
  outcome: RouteOutcome;
  reason: string;
  httpStatus: number | null;
  retryAfterMs?: number;
  durationMs: number;
  summary?: ProviderTrace['summary'];
}
export function parseEnrichmentDiagnostic(
  v: unknown,
): EnrichmentDiagnostic | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const d = v as EnrichmentDiagnostic;
  if (
    !['application', 'hexdb', 'unexpected'].includes(d.origin) ||
    !['hit', 'miss', 'coalesced', 'none'].includes(d.serverCache) ||
    ![
      'complete',
      'partial',
      'negative',
      'rejected',
      'error',
      'identity',
    ].includes(d.outcome) ||
    typeof d.reason !== 'string' ||
    !/^[a-z0-9-]{1,64}$/.test(d.reason) ||
    ![0, 1].includes(d.upstreamRequestsStarted) ||
    ![0, 1].includes(d.upstreamResponses) ||
    !(
      d.httpStatus === null ||
      (Number.isInteger(d.httpStatus) &&
        d.httpStatus >= 100 &&
        d.httpStatus <= 599)
    ) ||
    !Number.isFinite(d.durationMs) ||
    d.durationMs < 0 ||
    d.durationMs > 3600000
  )
    return undefined;
  const s = d.summary;
  const summary =
    s &&
    [s.callsignMatches, s.origin, s.destination, s.iataPair].every(
      (x) => typeof x === 'boolean',
    ) &&
    (s.associationAgeDays === null ||
      Number.isFinite(s.associationAgeDays))
      ? {
          callsignMatches: s.callsignMatches,
          origin: s.origin,
          destination: s.destination,
          iataPair: s.iataPair,
          associationAgeDays: s.associationAgeDays,
        }
      : undefined;
  return {
    origin: d.origin,
    serverCache: d.serverCache,
    upstreamRequestsStarted: d.upstreamRequestsStarted,
    upstreamResponses: d.upstreamResponses,
    outcome: d.outcome,
    reason: d.reason,
    httpStatus: d.httpStatus,
    durationMs: d.durationMs,
    ...(Number.isFinite(d.retryAfterMs) && d.retryAfterMs! >= 0
      ? { retryAfterMs: d.retryAfterMs }
      : {}),
    ...(summary ? { summary } : {}),
  };
}

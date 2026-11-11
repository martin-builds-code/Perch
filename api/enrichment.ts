import { routeTrial } from '../server/routeTrial.js';
import type { EnrichmentDiagnostic } from '../src/routeTraceTypes.js';
import type { EnrichmentFailure } from '../src/enrichmentFailure.js';
import { authorised } from '../server/auth.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  enrichmentService,
  LocalEnrichmentDeferral,
} from '../server/enrichmentService.js';
import { EnrichmentError, validateLookup } from '../server/hexdb.js';
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (
    process.env.AERO_ENRICHMENT_ENABLED !== 'true' ||
    process.env.AERO_LIVE_ENABLED !== 'true' ||
    (process.env.VERCEL_ENV === 'production' &&
      process.env.AERO_PRODUCTION_LIVE_ENABLED !== 'true')
  ) {
    res.statusCode = 404;
    res.end('{"error":"enrichment-disabled"}');
    return;
  }
  if (!authorised(req, res)) return;
  const trial = routeTrial(),
    started = Date.now();
  try {
    if (req.method !== 'GET') throw new EnrichmentError('invalid-request');
    const url = new URL(req.url ?? '', 'https://local.invalid');
    if (
      [...url.searchParams.keys()].some(
        (k) => !['kind', 'hex', 'callsign'].includes(k),
      ) ||
      ['kind', 'hex', 'callsign'].some(
        (k) => url.searchParams.getAll(k).length > 1,
      )
    )
      throw new EnrichmentError('invalid-request');
    const input = validateLookup(
      url.searchParams.get('kind'),
      url.searchParams.get('hex'),
      url.searchParams.get('callsign'),
    );
    const result = await enrichmentService.get(
      input.kind,
      input.hex,
      input.callsign,
      !!trial,
    );
    res.statusCode = 200;
    res.setHeader('X-Aero-Enrichment-Cache', result.cache);
    const { providerTrace, ...payload } = result.result;
    const diagnostic: EnrichmentDiagnostic | undefined = trial
      ? {
          origin: 'hexdb',
          serverCache: result.cache,
          upstreamRequestsStarted:
            result.cache === 'miss' && providerTrace?.requestStarted
              ? 1
              : 0,
          upstreamResponses:
            result.cache === 'miss' && providerTrace?.httpStatus ? 1 : 0,
          outcome:
            providerTrace?.outcome ??
            (payload.status === 'not-found'
              ? 'negative'
              : input.kind === 'aircraft'
                ? 'identity'
                : payload.data.origin && payload.data.destination
                  ? 'complete'
                  : 'partial'),
          reason: providerTrace?.reason ?? 'cached-outcome-without-trace',
          httpStatus: providerTrace?.httpStatus ?? null,
          durationMs: Math.max(0, Date.now() - started),
          ...(providerTrace?.summary
            ? { summary: providerTrace.summary }
            : {}),
        }
      : undefined;
    res.end(
      JSON.stringify({
        ...payload,
        ...(diagnostic ? { diagnostic } : {}),
      }),
    );
  } catch (error) {
    const failure =
      error instanceof EnrichmentError
        ? error
        : new EnrichmentError('unavailable');
    if (!(error instanceof EnrichmentError)) failure.origin = 'unexpected';
    const upstreamRequestsStarted =
      failure.serverCache === 'coalesced'
        ? 0
        : failure.trace?.requestStarted
          ? 1
          : 0;
    const upstreamResponses =
      failure.serverCache === 'coalesced'
        ? 0
        : failure.trace?.httpStatus
          ? 1
          : 0;
    const contract: EnrichmentFailure = {
      schemaVersion: 1,
      origin: failure.origin,
      category:
        error instanceof LocalEnrichmentDeferral
          ? 'local-deferral'
          : failure.origin === 'hexdb'
            ? 'upstream-failure'
            : failure.origin === 'unexpected'
              ? 'unexpected-error'
              : 'request-error',
      reason:
        error instanceof LocalEnrichmentDeferral
          ? error.reason
          : failure.code,
      retryAfterMs: Math.ceil(failure.retryAfterMs),
      issuedAtMs: Date.now(),
      upstreamRequestsStarted,
      upstreamResponses,
    };
    res.statusCode = failure.code === 'invalid-request' ? 400 : 503;
    res.setHeader(
      'Retry-After',
      String(Math.ceil(failure.retryAfterMs / 1000)),
    );
    const diagnostic: EnrichmentDiagnostic | undefined = trial
      ? {
          origin: failure.origin,
          serverCache: failure.serverCache ?? 'none',
          upstreamRequestsStarted,
          upstreamResponses,
          outcome: failure.trace?.outcome ?? 'error',
          reason: failure.code,
          httpStatus: failure.trace?.httpStatus ?? null,
          retryAfterMs: contract.retryAfterMs,
          durationMs: Math.max(0, Date.now() - started),
          ...(failure.trace?.summary
            ? { summary: failure.trace.summary }
            : {}),
        }
      : undefined;
    res.end(
      JSON.stringify({
        error: failure.code,
        failure: contract,
        ...(diagnostic ? { diagnostic } : {}),
      }),
    );
  }
}

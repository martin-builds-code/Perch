import { routeTrial } from './routeTrial.js';
import type { EnrichmentDiagnostic } from '../src/routeTraceTypes.js';
import type { EnrichmentFailure } from '../src/enrichmentFailure.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  enrichmentService,
  LocalEnrichmentDeferral,
} from './enrichmentService.js';
import { EnrichmentError, validateLookup } from './hexdb.js';
import { adaptiveEnabled, R05_BRANCH } from './adaptiveCoordinator.js';
import {
  adaptiveEnrichmentService,
  AdaptiveDeferral,
} from './adaptiveEnrichmentService.js';
import type { AdaptiveResponse } from './adaptiveEnrichmentService.js';
export function enrichmentEnabled() {
  return (
    process.env.AERO_ENRICHMENT_ENABLED === 'true' &&
    process.env.AERO_LIVE_ENABLED === 'true' &&
    (process.env.VERCEL_ENV !== 'production' ||
      process.env.AERO_PRODUCTION_LIVE_ENABLED === 'true')
  );
}
// Business logic shared by the normal PIN route and the separately authenticated
// R05 machine endpoint. No browser can invoke this export as an HTTP route.
export async function handleAuthenticatedEnrichment(
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  if (!enrichmentEnabled()) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 404;
    res.end('{"error":"enrichment-disabled"}');
    return;
  }
  const trial = routeTrial(),
    r05 = adaptiveEnabled(),
    started = Date.now();
  try {
    if (
      !r05 &&
      (process.env.AERO_R05_ENABLED === 'true' ||
        process.env.VERCEL_GIT_COMMIT_REF === R05_BRANCH)
    )
      throw new AdaptiveDeferral('coordination-unavailable', 30_000);
    if (req.method !== 'GET') throw new EnrichmentError('invalid-request');
    const url = new URL(req.url ?? '', 'https://local.invalid');
    if (
      [...url.searchParams.keys()].some(
        (k) =>
          !(
            r05
              ? ['kind', 'hex', 'callsign', 'priority']
              : ['kind', 'hex', 'callsign']
          ).includes(k),
      ) ||
      ['kind', 'hex', 'callsign', 'priority'].some(
        (k) => url.searchParams.getAll(k).length > 1,
      )
    )
      throw new EnrichmentError('invalid-request');
    const input = validateLookup(
      url.searchParams.get('kind'),
      url.searchParams.get('hex'),
      url.searchParams.get('callsign'),
    );
    const priority = url.searchParams.get('priority');
    if (priority !== null && !['protected', 'normal'].includes(priority))
      throw new EnrichmentError('invalid-request');
    const result = r05
      ? await adaptiveEnrichmentService.get(
          input.kind,
          input.hex,
          input.callsign,
          priority === 'normal',
        )
      : await enrichmentService.get(
          input.kind,
          input.hex,
          input.callsign,
          !!trial,
        );
    res.statusCode = 200;
    res.setHeader('X-Aero-Enrichment-Cache', result.cache);
    const { providerTrace, ...payload } = result.result;
    const diagnostic: EnrichmentDiagnostic | undefined =
      trial || r05
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
            reason:
              providerTrace?.reason ?? 'cached-outcome-without-trace',
            httpStatus: providerTrace?.httpStatus ?? null,
            durationMs: Math.max(0, Date.now() - started),
            ...(result.cache === 'miss' &&
            providerTrace?.requestStartedAtMs !== undefined
              ? { upstreamStartedAtMs: providerTrace.requestStartedAtMs }
              : {}),
            ...(providerTrace?.summary
              ? { summary: providerTrace.summary }
              : {}),
          }
        : undefined;
    res.end(
      JSON.stringify({
        ...payload,
        ...(r05
          ? {
              adaptiveBudget: (result as AdaptiveResponse).budget,
              upstreamStartedAtMs: (result as AdaptiveResponse)
                .upstreamStartedAtMs,
            }
          : {}),
        ...(diagnostic ? { diagnostic } : {}),
      }),
    );
  } catch (error) {
    if (error instanceof AdaptiveDeferral) {
      res.statusCode = 503;
      res.setHeader(
        'Retry-After',
        String(Math.ceil(error.retryAfterMs / 1000)),
      );
      res.end(
        JSON.stringify({
          error: 'cooldown',
          failure: {
            schemaVersion: 2,
            origin: 'application',
            category: 'local-deferral',
            reason: error.reason,
            retryAfterMs: Math.ceil(error.retryAfterMs),
            issuedAtMs: Date.now(),
            upstreamRequestsStarted: 0,
            upstreamResponses: 0,
          },
          ...(error.budget ? { adaptiveBudget: error.budget } : {}),
        }),
      );
      return;
    }
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
    const diagnostic: EnrichmentDiagnostic | undefined =
      trial || r05
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
            ...(upstreamRequestsStarted &&
            failure.trace?.requestStartedAtMs !== undefined
              ? { upstreamStartedAtMs: failure.trace.requestStartedAtMs }
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

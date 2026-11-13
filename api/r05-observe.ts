import type { IncomingMessage, ServerResponse } from 'node:http';
import { r05TestAccess } from '../server/r05TestAccess.js';
import { liveSnapshot } from '../server/service.js';
import { ProviderError } from '../server/provider.js';
import { handleAuthenticatedEnrichment } from '../server/enrichmentHandler.js';
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  const access = r05TestAccess(req);
  if (!access) {
    res.statusCode = 401;
    res.end('{"error":"authentication-required"}');
    return;
  }
  const url = new URL(req.url ?? '', 'https://local.invalid'),
    resource = url.searchParams.get('resource');
  if (
    url.searchParams.getAll('resource').length !== 1 ||
    !['session', 'aircraft', 'enrichment'].includes(resource ?? '') ||
    (resource !== 'enrichment' &&
      [...url.searchParams.keys()].some((k) => k !== 'resource'))
  ) {
    res.statusCode = 400;
    res.end('{"error":"invalid-request"}');
    return;
  }
  if (resource === 'session') {
    res.end(
      JSON.stringify({ authenticated: true, r05Automation: access }),
    );
    return;
  }
  if (resource === 'enrichment') {
    url.searchParams.delete('resource');
    const prior = req.url;
    req.url = '/api/enrichment?' + url.searchParams.toString();
    try {
      await handleAuthenticatedEnrichment(req, res);
    } finally {
      req.url = prior;
    }
    return;
  }
  if (process.env.AERO_LIVE_ENABLED !== 'true') {
    res.statusCode = 404;
    res.end('{"error":"live-disabled"}');
    return;
  }
  try {
    // Exactly the normal positional provider/cache path; no coordinates or
    // server credentials are added to the existing public aircraft contract.
    const snapshot = await liveSnapshot((source) =>
      res.setHeader('X-Aero-Position-Source', source),
    );
    res.end(JSON.stringify(snapshot));
  } catch (error) {
    const e =
      error instanceof ProviderError
        ? error
        : new ProviderError('unavailable');
    res.statusCode = 503;
    res.setHeader('Retry-After', String(Math.ceil(e.retryAfterMs / 1000)));
    res.end(JSON.stringify({ error: e.code }));
  }
}

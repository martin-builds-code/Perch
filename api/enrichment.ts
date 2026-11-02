import type { IncomingMessage, ServerResponse } from 'node:http';
import { enrichmentService } from '../server/enrichmentService.js';
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
    process.env.VERCEL_ENV === 'production'
  ) {
    res.statusCode = 404;
    res.end('{"error":"enrichment-disabled"}');
    return;
  }
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
    );
    res.statusCode = 200;
    res.setHeader('X-Aero-Enrichment-Cache', result.cache);
    res.end(JSON.stringify(result.result));
  } catch (error) {
    const failure =
      error instanceof EnrichmentError
        ? error
        : new EnrichmentError('unavailable');
    res.statusCode = failure.code === 'invalid-request' ? 400 : 503;
    res.setHeader(
      'Retry-After',
      String(Math.ceil(failure.retryAfterMs / 1000)),
    );
    res.end(JSON.stringify({ error: failure.code }));
  }
}

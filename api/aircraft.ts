import {authorised} from '../server/auth.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { liveSnapshot } from '../server/service.js';
import { ProviderError } from '../server/provider.js';
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET' || req.url?.includes('?')) {
    res.statusCode = 400;
    res.end('{"error":"invalid-request"}');
    return;
  }
  if(process.env.AERO_LIVE_ENABLED!=='true'||(process.env.VERCEL_ENV==='production'&&process.env.AERO_PRODUCTION_LIVE_ENABLED!=='true')){res.statusCode=404;res.end('{"error":"live-disabled"}');return;}
  if (!authorised(req,res)) return;
  try {
    const snapshot = await liveSnapshot();
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(JSON.stringify(snapshot));
  } catch (error) {
    const failure =
      error instanceof ProviderError ? error : new ProviderError('unavailable');
    res.statusCode = failure.code === 'live-disabled' ? 404 : 503;
    res.setHeader(
      'Retry-After',
      String(Math.ceil(failure.retryAfterMs / 1000)),
    );
    res.end(JSON.stringify({ error: failure.code }));
  }
}

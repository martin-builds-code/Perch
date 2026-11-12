// Only frozen research cases. No live-data, authentication or provider imports.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { isolatedStage3Preview } from '../server/previewIdentity.js';
import { routeReviewCases } from '../server/routeReviewCases.js';
import { canonical, parseReviewDataset } from '../src/routeReviewModel.js';
export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!isolatedStage3Preview()) {
    res.statusCode = 404;
    res.end('{"error":"review-unavailable"}');
    return;
  }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('{"error":"method-not-allowed"}');
    return;
  }
  const data = parseReviewDataset(routeReviewCases);
  if (
    !data ||
    createHash('sha256').update(canonical(data.cases)).digest('hex') !==
      data.fingerprint
  ) {
    res.statusCode = 503;
    res.end('{"error":"review-unavailable"}');
    return;
  }
  res.end(JSON.stringify(data));
}

// R02 acquisition is closed. This endpoint cannot be re-enabled by a flag.
import type { IncomingMessage, ServerResponse } from 'node:http';
export default function handler(
  _req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 404;
  res.end('{"error":"not-found"}');
}

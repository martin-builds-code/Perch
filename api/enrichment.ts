import type { IncomingMessage, ServerResponse } from 'node:http';
import { authorised } from '../server/auth.js';
import {
  enrichmentEnabled,
  handleAuthenticatedEnrichment,
} from '../server/enrichmentHandler.js';
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // Retain disabled-endpoint behaviour without weakening the PIN path.
  if (!enrichmentEnabled()) return handleAuthenticatedEnrichment(req, res);
  if (!authorised(req, res)) return;
  return handleAuthenticatedEnrichment(req, res);
}

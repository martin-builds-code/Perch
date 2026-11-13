// A separate machine principal for one bounded trial. This does not authorise
// the normal display/API, sign a household session or accept a browser flag.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { adaptiveEnabled } from './adaptiveCoordinator.js';
export function r05TestAccess(
  req: IncomingMessage,
  env = process.env,
  now = Date.now(),
) {
  if (!adaptiveEnabled(env) || req.method !== 'GET') return null;
  try {
    if (
      new URL(req.url ?? '', 'https://local.invalid').pathname !==
      '/api/r05-observe'
    )
      return null;
  } catch {
    return null;
  }
  const expected = env.AERO_R05_TEST_KEY,
    provided = req.headers['x-aero-r05-test'];
  if (
    !expected ||
    !/^[a-f0-9]{64}$/.test(expected) ||
    typeof provided !== 'string' ||
    !/^[a-f0-9]{64}$/.test(provided) ||
    !timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(provided, 'hex'),
    )
  )
    return null;
  try {
    const v: unknown = JSON.parse(env.AERO_R05_TEST_WINDOW ?? 'null');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const x = v as { startedAtMs: number; expiresAtMs: number };
    if (
      Object.keys(x).some(
        (k) => !['startedAtMs', 'expiresAtMs'].includes(k),
      ) ||
      !Number.isSafeInteger(x.startedAtMs) ||
      !Number.isSafeInteger(x.expiresAtMs) ||
      x.startedAtMs < 0 ||
      x.expiresAtMs <= x.startedAtMs ||
      x.expiresAtMs - x.startedAtMs > 90 * 60000 ||
      !Number.isFinite(now) ||
      now < x.startedAtMs ||
      now >= x.expiresAtMs
    )
      return null;
    return { expiresAtMs: x.expiresAtMs };
  } catch {
    return null;
  }
}

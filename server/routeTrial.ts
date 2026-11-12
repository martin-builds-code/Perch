// Server-only, fail-closed lease. Never trust a browser flag, hostname or cookie.
export const ROUTE_TRIAL_PROJECT = 'prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW';
export const MAX_ROUTE_TRIAL_MS = 48 * 60 * 60 * 1000;
export function routeTrial(env = process.env, now = Date.now()) {
  if (
    env.VERCEL !== '1' ||
    env.VERCEL_ENV !== 'preview' ||
    (env.VERCEL_TARGET_ENV && env.VERCEL_TARGET_ENV !== 'preview') ||
    env.VERCEL_PROJECT_ID !== ROUTE_TRIAL_PROJECT
  )
    return null;
  try {
    const v: unknown = JSON.parse(env.AERO_ROUTE_DIAGNOSTICS ?? 'null');
    if (!v || typeof v !== 'object') return null;
    const x = v as {
      enabled?: unknown;
      startedAtMs?: unknown;
      expiresAtMs?: unknown;
    };
    if (
      x.enabled !== true ||
      typeof x.startedAtMs !== 'number' ||
      typeof x.expiresAtMs !== 'number' ||
      !Number.isSafeInteger(x.startedAtMs) ||
      !Number.isSafeInteger(x.expiresAtMs) ||
      x.expiresAtMs <= x.startedAtMs ||
      x.expiresAtMs - x.startedAtMs > MAX_ROUTE_TRIAL_MS ||
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

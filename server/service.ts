import { fetchAircraft, ProviderError } from './provider';
import { validPosition } from './aircraft';
import type { Snapshot } from '../src/liveTypes';
export function configuration(env: NodeJS.ProcessEnv) {
  if (env.AERO_LIVE_ENABLED !== 'true' || env.VERCEL_ENV === 'production')
    throw new ProviderError('live-disabled');
  const coordinate = (v: string | undefined) => (v?.trim() ? Number(v) : NaN);
  const point = {
    latitude: coordinate(env.AERO_OBSERVATION_LATITUDE),
    longitude: coordinate(env.AERO_OBSERVATION_LONGITUDE),
  };
  const pollIntervalMs = env.AERO_POLL_INTERVAL_MS
    ? Number(env.AERO_POLL_INTERVAL_MS)
    : 15_000;
  if (
    !validPosition(point) ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs < 15_000 ||
    pollIntervalMs > 300_000
  )
    throw new ProviderError('configuration');
  return { point, pollIntervalMs };
}
// One cache and promise per warm process. Deliberately not presented as a global lock.
export function createService(load: () => Promise<Snapshot>, now = Date.now) {
  let cached: Snapshot | undefined,
    inFlight: Promise<Snapshot> | undefined,
    nextAllowed = 0,
    lastError: ProviderError | undefined;
  return function get(): Promise<Snapshot> {
    if (
      cached &&
      now() - cached.fetchedAtMs >= 0 &&
      now() - cached.fetchedAtMs < 10_000
    )
      return Promise.resolve(cached);
    if (inFlight) return inFlight;
    if (now() < nextAllowed)
      return Promise.reject(
        lastError ?? new ProviderError('cooldown', nextAllowed - now()),
      );
    nextAllowed = now() + 15_000;
    inFlight = load()
      .then(
        (value) => {
          cached = value;
          lastError = undefined;
          return value;
        },
        (error) => {
          lastError =
            error instanceof ProviderError
              ? error
              : new ProviderError('unavailable');
          nextAllowed = Math.max(nextAllowed, now() + lastError.retryAfterMs);
          throw lastError;
        },
      )
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
let service: ReturnType<typeof createService> | undefined;
export function liveSnapshot() {
  const config = configuration(process.env);
  service ??= createService(() =>
    fetchAircraft(config.point, config.pollIntervalMs),
  );
  return service();
}

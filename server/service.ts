import { fetchAircraft, ProviderError } from './provider.js';
import { validPosition } from './aircraft.js';
import type { Snapshot } from '../src/liveTypes.js';
const CACHE_TTL_MS = 10_000,
  MIN_PROVIDER_INTERVAL_MS = 15_000;
export function configuration(env: NodeJS.ProcessEnv) {
  if (
    env.AERO_LIVE_ENABLED !== 'true' ||
    (env.VERCEL_ENV === 'production' &&
      env.AERO_PRODUCTION_LIVE_ENABLED !== 'true')
  )
    throw new ProviderError('live-disabled');
  const coordinate = (v: string | undefined) =>
    v?.trim() ? Number(v) : NaN;
  const point = {
    latitude: coordinate(env.AERO_OBSERVATION_LATITUDE),
    longitude: coordinate(env.AERO_OBSERVATION_LONGITUDE),
    ...(env.AERO_OBSERVATION_ELEVATION_M?.trim()
      ? { elevationM: Number(env.AERO_OBSERVATION_ELEVATION_M) }
      : {}),
  };
  const pollIntervalMs = env.AERO_POLL_INTERVAL_MS
    ? Number(env.AERO_POLL_INTERVAL_MS)
    : 15_000;
  if (
    !validPosition(point) ||
    (point.elevationM !== undefined &&
      (!Number.isFinite(point.elevationM) ||
        point.elevationM < -500 ||
        point.elevationM > 9000)) ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs < 15_000 ||
    pollIntervalMs > 300_000
  )
    throw new ProviderError('configuration');
  return { point, pollIntervalMs };
}
// One cache and promise per warm process. Deliberately not presented as a global lock.
export function createService(
  load: () => Promise<Snapshot>,
  now = Date.now,
) {
  let cached: Snapshot | undefined,
    inFlight: Promise<Snapshot> | undefined,
    nextAllowed = 0,
    lastError: ProviderError | undefined;
  return function get(
    observe?: (
      source: 'cache' | 'coalesced' | 'provider' | 'blocked',
    ) => void,
  ): Promise<Snapshot> {
    const trace = (
      source: 'cache' | 'coalesced' | 'provider' | 'blocked',
    ) => {
      try {
        observe?.(source);
      } catch {
        /* instrumentation cannot affect requests */
      }
    };
    const time = now();
    const cacheAge = cached ? time - cached.fetchedAtMs : NaN;
    if (cached && !lastError && cacheAge >= 0 && cacheAge < CACHE_TTL_MS) {
      trace('cache');
      return Promise.resolve(cached);
    }
    if (inFlight) {
      trace('coalesced');
      return inFlight;
    }
    if (time < nextAllowed) {
      // Bridge the success-cache/gate gap without advancing any timestamps or
      // allowing an earlier provider request. Never mask a failed refresh.
      if (
        cached &&
        !lastError &&
        cacheAge >= 0 &&
        cacheAge < MIN_PROVIDER_INTERVAL_MS
      ) {
        trace('cache');
        return Promise.resolve(cached);
      }
      trace('blocked');
      return Promise.reject(
        lastError ?? new ProviderError('cooldown', nextAllowed - time),
      );
    }
    nextAllowed = time + MIN_PROVIDER_INTERVAL_MS;
    trace('provider');
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
          nextAllowed = Math.max(
            nextAllowed,
            now() + lastError.retryAfterMs,
          );
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
export function liveSnapshot(
  observe?: (
    source: 'cache' | 'coalesced' | 'provider' | 'blocked',
  ) => void,
) {
  const config = configuration(process.env);
  service ??= createService(() =>
    fetchAircraft(config.point, config.pollIntervalMs),
  );
  return service(observe);
}

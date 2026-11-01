import { normalise, publicAircraft, validPosition } from './aircraft';
import type { Position } from './aircraft';
import type { Snapshot } from '../src/liveTypes';
export const MAX_BYTES = 256 * 1024;
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryAfterMs = 15_000,
  ) {
    super(code);
  }
}
export function retryDelay(value: string | null, now: number): number {
  const seconds = value === null ? NaN : Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : value
      ? Date.parse(value) - now
      : NaN;
  return Number.isFinite(delay) ? Math.max(15_000, delay) : 60_000;
}
export async function fetchAircraft(
  point: Position,
  pollIntervalMs: number,
  fetcher: typeof fetch = fetch,
  now = Date.now,
  timeoutMs = 5000,
): Promise<Snapshot> {
  if (!validPosition(point)) throw new ProviderError('configuration');
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const radiusNm = 15 / 1.852;
    const response = await fetcher(
      `https://opendata.adsb.fi/api/v3/lat/${point.latitude}/lon/${point.longitude}/dist/${radiusNm.toFixed(6)}`,
      {
        signal: controller.signal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Perch-Aero-Pane/Stage2A (personal; github.com/martin-builds-code/Perch)',
        },
      },
    );
    if (response.status === 429)
      throw new ProviderError(
        'rate-limited',
        retryDelay(response.headers.get('retry-after'), now()),
      );
    if (response.status === 401 || response.status === 403)
      throw new ProviderError('access-denied', 300_000);
    if (!response.ok) throw new ProviderError('http-error');
    if (Number(response.headers.get('content-length')) > MAX_BYTES)
      throw new ProviderError('response-too-large');
    if (!response.body) throw new ProviderError('invalid-json');
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BYTES) throw new ProviderError('response-too-large');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let data;
    try {
      data = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      throw new ProviderError('invalid-json');
    }
    if (
      !data ||
      !Array.isArray(data.ac) ||
      data.ac.length > 1000 ||
      typeof data.now !== 'number' ||
      !Number.isFinite(data.now) ||
      data.now <= 0 ||
      data.msg !== 'No error'
    )
      throw new ProviderError('invalid-structure');
    const fetchedAtMs = now();
    let rejectedRecords = 0;
    const unique = new Map();
    for (const raw of data.ac) {
      const aircraft = normalise(raw, data.now, fetchedAtMs, point);
      if (!aircraft) {
        rejectedRecords++;
        continue;
      }
      if (aircraft.distanceKm === null) {
        rejectedRecords++;
        continue;
      }
      if (aircraft.distanceKm <= 15 && !unique.has(aircraft.id))
        unique.set(aircraft.id, publicAircraft(aircraft));
    }
    return {
      aircraft: [...unique.values()],
      fetchedAtMs,
      providerTimeMs: data.now,
      pollIntervalMs,
      rejectedRecords,
      anomalies: data.now > fetchedAtMs ? ['provider-clock'] : [],
    };
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError('timeout');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('network-error');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

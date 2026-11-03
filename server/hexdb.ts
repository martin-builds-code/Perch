import {
  ENRICHMENT_POLICY,
  flightKey,
  validHex,
} from '../src/enrichmentTypes.js';
import type {
  Supplement,
  EnrichmentKind,
  EnrichedAirport,
} from '../src/enrichmentTypes.js';
export class EnrichmentError extends Error {
  constructor(
    public code: string,
    public retryAfterMs = ENRICHMENT_POLICY.errorCooldownMs,
  ) {
    super(code);
  }
}
const text = (v: unknown, max = 120) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function validateLookup(kind: unknown, hex: unknown, callsign: unknown) {
  if (
    (kind !== 'aircraft' && kind !== 'route') ||
    typeof hex !== 'string' ||
    !validHex(hex)
  )
    throw new EnrichmentError('invalid-request');
  const flight = typeof callsign === 'string' ? flightKey(callsign) : null;
  if (kind === 'route' && !flight) throw new EnrichmentError('invalid-request');
  return {
    kind: kind as EnrichmentKind,
    hex: hex.toLowerCase(),
    callsign: kind === 'route' ? flight : null,
  };
}
function airport(v: unknown): EnrichedAirport | undefined {
  if (v === null || v === undefined) return undefined;
  if (!object(v)) throw new EnrichmentError('invalid-structure');
  const icao =
    typeof v.icao === 'string' && /^[A-Z]{4}$/.test(v.icao) ? v.icao : null;
  const iata =
    typeof v.iata === 'string' && /^[A-Z]{3}$/.test(v.iata) ? v.iata : null;
  if (!icao && !iata) throw new EnrichmentError('invalid-structure');
  return {
    code: iata ?? icao!,
    name: text(v.name, 64) ?? 'Not reported',
    icao,
    iata,
  };
}
export function normaliseHexdb(
  kind: EnrichmentKind,
  hex: string,
  callsign: string | null,
  value: unknown,
  now: number,
): Supplement | null {
  if (!object(value)) throw new EnrichmentError('invalid-structure');
  if (kind === 'aircraft') {
    if (typeof value.hex !== 'string' || value.hex.toLowerCase() !== hex)
      throw new EnrichmentError('contradictory-aircraft');
    const manufacturer = text(value.manufacturer, 50),
      model = text(value.type, 70),
      registration = text(value.registration, 24);
    const data: Supplement = {};
    if (model)
      data.description =
        manufacturer &&
        !model.toLowerCase().startsWith(manufacturer.toLowerCase())
          ? `${manufacturer} ${model}`
          : model;
    if (registration) data.registration = registration;
    // Owner alone is not an operator. These bounded evidence pairs have supported brand associations.
    const owner = text(value.registered_owner)?.toLowerCase(),
      flag = text(value.operator_flag_code);
    if (
      owner &&
      /^(easyjet airline(?: company)?(?: limited)?|easyjet uk(?: limited)?)$/.test(
        owner,
      ) &&
      flag === 'EZY'
    )
      data.operator = 'easyJet';
    if (
      owner &&
      /^(ryanair(?: dac| ltd| limited)?|malta air(?: limited)?)$/.test(owner) &&
      ['RYR', 'MAY'].includes(flag ?? '')
    )
      data.operator = 'Ryanair';
    return Object.keys(data).length ? data : null;
  }
  if (value.callsign !== callsign)
    throw new EnrichmentError('contradictory-route');
  let updated: number | null = null;
  if (value.updated_at !== null && value.updated_at !== undefined) {
    updated =
      typeof value.updated_at === 'string' ? Date.parse(value.updated_at) : NaN;
    if (!Number.isFinite(updated) || updated > now)
      throw new EnrichmentError('invalid-route-time');
    if (now - updated > ENRICHMENT_POLICY.maxRouteAgeMs) return null;
  }
  const origin = airport(value.origin),
    destination = airport(value.destination);
  const sameAirport = (a: EnrichedAirport, b: EnrichedAirport) =>
    a.icao && b.icao
      ? a.icao === b.icao
      : a.iata && b.iata
        ? a.iata === b.iata
        : a.code === b.code;
  if (
    value.airports !== undefined &&
    value.airports !== null &&
    !Array.isArray(value.airports)
  )
    throw new EnrichmentError('invalid-structure');
  if (origin && destination && sameAirport(origin, destination))
    throw new EnrichmentError('contradictory-route');
  if (Array.isArray(value.airports) && value.airports.length) {
    const first = airport(value.airports[0]),
      last = airport(value.airports[value.airports.length - 1]);
    if (
      (origin && first && !sameAirport(origin, first)) ||
      (destination && last && !sameAirport(destination, last))
    )
      throw new EnrichmentError('contradictory-route');
  }
  return origin || destination
    ? {
        ...(origin ? { origin } : {}),
        ...(destination ? { destination } : {}),
        associationTimeMs: updated,
      }
    : null;
}
export async function fetchHexdb(
  kind: EnrichmentKind,
  hex: string,
  callsign: string | null,
  fetcher: typeof fetch = fetch,
  now = Date.now,
  timeoutMs = ENRICHMENT_POLICY.timeoutMs,
): Promise<Supplement | null> {
  validateLookup(kind, hex, callsign);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const path = kind === 'aircraft' ? `aircraft/${hex}` : `routes/${callsign}`;
    const response = await fetcher(`https://hexdb.io/api/v2/${path}`, {
      signal: controller.signal,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Perch-Aero-Pane/Stage2C (personal; github.com/martin-builds-code/Perch)',
      },
    });
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403)
      throw new EnrichmentError('access-denied', 600_000);
    if (response.status === 429) {
      const raw = response.headers.get('retry-after');
      const seconds = raw === null ? NaN : Number(raw);
      const delay = Number.isFinite(seconds)
        ? seconds * 1000
        : raw
          ? Date.parse(raw) - now()
          : NaN;
      throw new EnrichmentError(
        'rate-limited',
        Number.isFinite(delay)
          ? Math.max(ENRICHMENT_POLICY.errorCooldownMs, delay)
          : ENRICHMENT_POLICY.errorCooldownMs,
      );
    }
    if (!response.ok) throw new EnrichmentError('http-error');
    if (
      Number(response.headers.get('content-length')) >
      ENRICHMENT_POLICY.maxBytes
    )
      throw new EnrichmentError('response-too-large');
    if (!response.body) throw new EnrichmentError('invalid-json');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > ENRICHMENT_POLICY.maxBytes)
          throw new EnrichmentError('response-too-large');
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
    let value;
    try {
      value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      throw new EnrichmentError('invalid-json');
    }
    return normaliseHexdb(kind, hex, callsign, value, now());
  } catch (error) {
    if (controller.signal.aborted) throw new EnrichmentError('timeout');
    if (error instanceof EnrichmentError) throw error;
    throw new EnrichmentError('network-error');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

import type { LiveAircraft } from '../src/liveTypes';
export interface Position {
  latitude: number;
  longitude: number;
}
export interface ObservedAircraft extends LiveAircraft {
  latitude: number | null;
  longitude: number | null;
  rawDescription: string | null;
}
export function validPosition(p: unknown): p is Position {
  if (!p || typeof p !== 'object') return false;
  const { latitude, longitude } = p as Position;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}
export function horizontalDistanceKm(a: unknown, b: unknown): number | null {
  if (!validPosition(a) || !validPosition(b)) return null;
  const rad = Math.PI / 180,
    dl = (b.latitude - a.latitude) * rad,
    dg = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dl / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dg / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
const number = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 160) : null;
// Cosmetic casing only. Preserve variants and all other description content.
export function readableDescription(raw: string | null): string | null {
  return (
    raw
      ?.replace(/^AIRBUS\b/, 'Airbus')
      .replace(/^BOEING\b/, 'Boeing')
      .replace(/^EMBRAER\b/, 'Embraer')
      .replace(/^CESSNA\b/, 'Cessna') ?? null
  );
}
export function normalise(
  record: unknown,
  providerTimeMs: number,
  receivedAtMs: number,
  point: Position,
): ObservedAircraft | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>,
    id = text(r.hex)?.toLowerCase();
  if (!id || !/^~?[a-f0-9]{6}$/.test(id)) return null;
  const latitude = number(r.lat),
    longitude = number(r.lon),
    position = validPosition({ latitude, longitude });
  const age = number(r.seen_pos),
    anomalies: string[] = [];
  if (age === null || age < 0) anomalies.push('invalid-position-age');
  if (
    !Number.isFinite(providerTimeMs) ||
    providerTimeMs <= 0 ||
    providerTimeMs > receivedAtMs
  )
    anomalies.push('provider-clock');
  const positionTimeMs =
    age !== null && age >= 0 && anomalies.length === 0
      ? providerTimeMs - age * 1000
      : null;
  const rawDescription = text(r.desc),
    track = number(r.track);
  return {
    id,
    callsign: text(r.flight),
    registration: text(r.r),
    description: readableDescription(rawDescription),
    rawDescription,
    typeCode: text(r.t),
    latitude,
    longitude,
    distanceKm: position
      ? horizontalDistanceKm(point, { latitude, longitude })
      : null,
    barometricAltitudeFt: number(r.alt_baro),
    geometricAltitudeFt: number(r.alt_geom),
    onGround: r.alt_baro === 'ground',
    groundSpeedKnots:
      typeof r.gs === 'number' && r.gs >= 0 ? number(r.gs) : null,
    trackDegrees: track !== null && track >= 0 && track < 360 ? track : null,
    positionTimeMs,
    source: 'adsb.fi',
    validity: { position, timestamp: positionTimeMs !== null, anomalies },
  };
}
export function publicAircraft(a: ObservedAircraft): LiveAircraft {
  return {
    id: a.id,
    callsign: a.callsign,
    registration: a.registration,
    description: a.description,
    typeCode: a.typeCode,
    distanceKm: a.distanceKm,
    barometricAltitudeFt: a.barometricAltitudeFt,
    geometricAltitudeFt: a.geometricAltitudeFt,
    onGround: a.onGround,
    groundSpeedKnots: a.groundSpeedKnots,
    trackDegrees: a.trackDegrees,
    positionTimeMs: a.positionTimeMs,
    source: a.source,
    validity: a.validity,
  };
}

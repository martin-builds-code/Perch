export type EnrichmentKind = 'aircraft' | 'route';
export interface EnrichedAirport {
  code: string;
  name: string;
  icao: string | null;
  iata: string | null;
}
export interface Supplement {
  description?: string;
  registration?: string;
  operator?: string;
  origin?: EnrichedAirport;
  destination?: EnrichedAirport;
  associationTimeMs?: number | null;
}
export interface EnrichmentResult {
  kind: EnrichmentKind;
  hex: string;
  callsign: string | null;
  source: 'hexdb.io';
  status: 'found' | 'not-found';
  data: Supplement;
  fetchedAtMs: number;
  expiresAtMs: number;
}
export const ENRICHMENT_POLICY = {
  intervalMs: 30_000,
  secondaryIntervalMs: 90_000,
  refreshLeadMs: 30_000,
  identityTtlMs: 1_800_000,
  routeTtlMs: 300_000,
  negativeTtlMs: 300_000,
  errorCooldownMs: 300_000,
  clientCapacity: 64,
  serverCapacity: 128,
  timeoutMs: 2500,
  clientTimeoutMs: 5000,
  maxBytes: 65536,
  maxRouteAgeMs: 180 * 86400000,
};
export function validHex(value: string) {
  return /^[0-9A-F]{6}$/i.test(value);
}
export function flightKey(value: string | null) {
  const key = value?.trim().toUpperCase();
  return key && /^[A-Z0-9]{2,8}$/.test(key) ? key : null;
}
export function enrichmentKey(
  kind: EnrichmentKind,
  hex: string,
  callsign: string | null,
) {
  return kind === 'aircraft'
    ? `aircraft:${hex.toLowerCase()}`
    : `route:${hex.toLowerCase()}:${callsign}`;
}

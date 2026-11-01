// Provider-independent contract. Positions and raw descriptions stay on the server.
export interface LiveAircraft {
  id: string;
  callsign: string | null;
  registration: string | null;
  description: string | null;
  typeCode: string | null;
  distanceKm: number | null;
  barometricAltitudeFt: number | null;
  geometricAltitudeFt: number | null;
  onGround: boolean;
  groundSpeedKnots: number | null;
  trackDegrees: number | null;
  positionTimeMs: number | null;
  source: 'adsb.fi';
  validity: { position: boolean; timestamp: boolean; anomalies: string[] };
}
export interface Snapshot {
  aircraft: LiveAircraft[];
  fetchedAtMs: number;
  providerTimeMs: number;
  pollIntervalMs: number;
  rejectedRecords: number;
  anomalies: string[];
}
export const CURRENT_AGE_MS = 30_000;
export const EXPIRE_AGE_MS = 120_000;

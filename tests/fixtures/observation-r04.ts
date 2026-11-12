import type { LiveAircraft, Snapshot } from '../../src/liveTypes';
const T = 1800000000000;
export function aircraft(
  id = 'aa0001',
  d = 5,
  alt = 35000,
  extra: Partial<LiveAircraft> = {},
): LiveAircraft {
  return {
    id,
    callsign: 'TEST1',
    registration: null,
    description: 'Boeing 737-800',
    typeCode: 'B738',
    distanceKm: d,
    bearingDegrees: 0,
    heightAboveObserverKm: alt * 0.0003048 - 0.031,
    heightReference: 'geometric',
    barometricAltitudeFt: alt,
    geometricAltitudeFt: alt,
    onGround: false,
    groundSpeedKnots: 450,
    trackDegrees: 180,
    positionTimeMs: T,
    source: 'adsb.fi',
    validity: { position: true, timestamp: true, anomalies: [] },
    ...extra,
  };
}
export const snapshot = (aircraft: LiveAircraft[], at = T): Snapshot => ({
  aircraft,
  fetchedAtMs: at,
  providerTimeMs: at,
  pollIntervalMs: 15000,
  rejectedRecords: 0,
  anomalies: [],
});

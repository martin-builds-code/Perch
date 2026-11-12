import type { LiveAircraft, Snapshot } from '../../src/liveTypes';
export const REPLAY_START = 1794477600000;
export interface Track {
  id: string;
  model: string;
  type: string;
  altitude: number;
  speed: number;
  cpaAt: number;
  offset: number;
  begin: number;
  end: number;
  route: 'recent' | 'historical' | 'missing';
  orbit?: number;
}
const jet = (
  id: string,
  cpaAt: number,
  extra: Partial<Track> = {},
): Track => ({
  id,
  model: 'Boeing 737-800',
  type: 'B738',
  altitude: 35000,
  speed: 450,
  cpaAt,
  offset: 0.3,
  begin: cpaAt - 63,
  end: cpaAt + 70,
  route: 'recent',
  ...extra,
});
const heli = (id = '000001', extra: Partial<Track> = {}): Track => ({
  id,
  model: 'Airbus H135',
  type: 'H135',
  altitude: 300,
  speed: 60,
  cpaAt: 0,
  offset: 11,
  orbit: 11,
  begin: 0,
  end: 1800,
  route: 'missing',
  ...extra,
});
const turbo = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  model: 'ATR 72-600',
  type: 'AT76',
  altitude: 2500,
  speed: 100,
  cpaAt: 120,
  offset: 1,
  begin: 0,
  end: 400,
  route: 'historical',
  ...extra,
});
export const SCENARIOS: {
  name: string;
  seconds: number;
  tracks: Track[];
}[] = [
  {
    name: 'high-jet-versus-horizon-helicopter',
    seconds: 420,
    tracks: [heli(), jet('000002', 180)],
  },
  {
    name: 'close-helicopter-versus-distant-jet',
    seconds: 240,
    tracks: [
      heli('000001', {
        orbit: undefined,
        altitude: 1000,
        speed: 45,
        offset: 0.1,
        cpaAt: 90,
        begin: 0,
        end: 220,
        route: 'recent',
      }),
      jet('000002', 180, { offset: 10 }),
    ],
  },
  {
    name: 'slow-primary-fast-approach',
    seconds: 360,
    tracks: [
      turbo('000001', { offset: 2, speed: 65, cpaAt: 0 }),
      heli('000003', { orbit: 6, offset: 6, altitude: 300 }),
      jet('000002', 120, { begin: 45 }),
    ],
  },
  {
    name: 'quiet',
    seconds: 1800,
    tracks: [
      turbo('000001', { cpaAt: 180, begin: 0, end: 450 }),
      jet('000002', 1000),
    ],
  },
  {
    name: 'moderate',
    seconds: 1800,
    tracks: [
      heli(),
      turbo('000003', { cpaAt: 200 }),
      ...Array.from({ length: 5 }, (_, i) =>
        jet((i + 16).toString(16).padStart(6, '0'), 450 + i * 270, {
          route: i === 2 ? 'missing' : i === 3 ? 'historical' : 'recent',
        }),
      ),
    ],
  },
  {
    name: 'busy',
    seconds: 1800,
    tracks: [
      heli(),
      heli('000002', { orbit: 6, offset: 6, altitude: 500 }),
      turbo('000003', { cpaAt: 180, offset: 4 }),
      turbo('000004', { cpaAt: 200, offset: 5 }),
      ...Array.from({ length: 16 }, (_, i) =>
        jet((i + 32).toString(16).padStart(6, '0'), 240 + i * 90, {
          route:
            i % 5 === 0
              ? 'missing'
              : i % 3 === 0
                ? 'historical'
                : 'recent',
          offset: i % 4 === 0 ? 2 : 0.3,
        }),
      ),
    ],
  },
  {
    name: 'unknown-trajectory',
    seconds: 360,
    tracks: [turbo('000001'), jet('000002', 180)],
  },
  {
    name: 'two-jets-30-seconds-apart',
    seconds: 360,
    tracks: [
      turbo('000001', { orbit: 0.8, offset: 0.8, speed: 65, end: 360 }),
      jet('000002', 120, { begin: 45 }),
      jet('000003', 150, { begin: 45 }),
    ],
  },
];
export function traffic(
  scene: (typeof SCENARIOS)[number],
  elapsed: number,
): Snapshot {
  const now = REPLAY_START + elapsed * 1000;
  const aircraft = scene.tracks.flatMap((t) => {
    if (elapsed < t.begin || elapsed > t.end) return [];
    const v = t.speed * 0.000514444;
    const x =
        t.orbit === undefined
          ? (elapsed - t.cpaAt) * v
          : t.orbit * Math.cos((elapsed * v) / t.orbit),
      y =
        t.orbit === undefined
          ? t.offset
          : t.orbit * Math.sin((elapsed * v) / t.orbit);
    const distanceKm = Math.hypot(x, y);
    if (distanceKm > 15) return [];
    const bearing = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
    const vx =
        t.orbit === undefined ? v : -v * Math.sin((elapsed * v) / t.orbit),
      vy =
        t.orbit === undefined ? 0 : v * Math.cos((elapsed * v) / t.orbit);
    const a: LiveAircraft = {
      id: t.id,
      callsign: 'R' + t.id,
      registration: 'SYNTHETIC',
      description: t.model,
      typeCode: t.type,
      distanceKm,
      bearingDegrees: bearing,
      heightAboveObserverKm: t.altitude * 0.0003048 - 0.031,
      heightReference: 'geometric',
      barometricAltitudeFt: t.altitude,
      geometricAltitudeFt: t.altitude,
      onGround: false,
      groundSpeedKnots: t.speed,
      trackDegrees: ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360,
      positionTimeMs: now,
      source: 'adsb.fi',
      validity: { position: true, timestamp: true, anomalies: [] },
    };
    if (scene.name === 'unknown-trajectory') {
      a.bearingDegrees = null;
      a.trackDegrees = null;
    }
    return [a];
  });
  return {
    aircraft,
    fetchedAtMs: now,
    providerTimeMs: now,
    pollIntervalMs: 15000,
    rejectedRecords: 0,
    anomalies: [],
  };
}

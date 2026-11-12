import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise,
  publicAircraft,
  relativeBearingDegrees,
} from '../server/aircraft';
import { configuration } from '../server/service';
import {
  observation,
  consistentVector,
  urgencyFor,
} from '../src/observation';
import { scoreAircraft, createAircraftSelector } from '../src/selection';
import { aircraftCategory, routeUtilityHint } from '../src/routeUtility';
import { createSkyDiagnostics } from '../src/skyDiagnostics';
import { fleet } from '../src/simulation';
import type { LiveAircraft } from '../src/liveTypes';
const T = 1800000000000;
import { aircraft, snapshot } from './fixtures/observation-r04';
test('R04 bearing cardinal directions, dateline and no manufactured bearing at coincident points', () => {
  const p = { latitude: 0, longitude: 0 };
  for (const [q, expected] of [
    [{ latitude: 1, longitude: 0 }, 0],
    [{ latitude: 0, longitude: 1 }, 90],
    [{ latitude: -1, longitude: 0 }, 180],
    [{ latitude: 0, longitude: -1 }, 270],
  ] as const)
    assert.ok(Math.abs(relativeBearingDegrees(p, q)! - expected) < 1e-8);
  assert.equal(relativeBearingDegrees(p, p), null);
  assert.equal(relativeBearingDegrees(null, p), null);
  assert.ok(
    relativeBearingDegrees(
      { latitude: 0, longitude: 179 },
      { latitude: 0, longitude: -179 },
    )! > 89,
  );
});
test('R04 observer elevation is server-only; geometric first, barometric fallback and unknown reference', () => {
  const point = { latitude: 60, longitude: 25, elevationM: 31 };
  const raw = {
    hex: 'abcdef',
    lat: 60.01,
    lon: 25,
    seen_pos: 1,
    alt_baro: 1000,
    alt_geom: 1100,
  };
  const a = normalise(raw, T, T, point)!;
  assert.equal(a.heightAboveObserverKm, 1100 * 0.0003048 - 0.031);
  assert.equal(a.heightReference, 'geometric');
  assert.equal(
    normalise({ ...raw, alt_geom: undefined }, T, T, point)!
      .heightReference,
    'barometric',
  );
  assert.equal(
    normalise(raw, T, T, { latitude: 60, longitude: 25 })!
      .heightAboveObserverKm,
    null,
  );
  assert.doesNotMatch(
    JSON.stringify(publicAircraft(a)),
    /latitude|longitude|elevationM|rawDescription/,
  );
  assert.throws(() =>
    configuration({
      AERO_LIVE_ENABLED: 'true',
      AERO_OBSERVATION_LATITUDE: '60',
      AERO_OBSERVATION_LONGITUDE: '25',
      AERO_OBSERVATION_ELEVATION_M: 'invalid',
    }),
  );
});
test('R04 elevated jet is relevant without confusing spatial and horizontal distance', () => {
  const jet = scoreAircraft(aircraft(), T)!;
  const heli = scoreAircraft(
    aircraft('bb0002', 10, 300, {
      groundSpeedKnots: 60,
      typeCode: 'H135',
    }),
    T,
  )!;
  assert.ok(jet.observation.slantKm! > heli.observation.slantKm!);
  assert.ok(jet.observation.elevationDegrees! > 60);
  assert.ok(jet.score > heli.score + 20);
  assert.ok(
    scoreAircraft(
      aircraft('cc0003', 1, 2500, { groundSpeedKnots: 120 }),
      T,
    )!.score > jet.score,
  );
});
test('R04 mandatory overhead airliner vs horizon helicopter, reverse helicopter, and type-blind display score', () => {
  const near = aircraft('aa0001', 0.2, 6500),
    far = aircraft('bb0002', 11, 300, {
      description: 'Airbus H135',
      typeCode: 'H135',
      groundSpeedKnots: 60,
    });
  const s = createAircraftSelector();
  assert.equal(s.select(snapshot([far]), T).primary?.id, far.id);
  assert.equal(
    s.select(
      snapshot([far, { ...near, positionTimeMs: T + 15000 }], T + 15000),
      T + 15000,
    ).primary?.id,
    near.id,
  );
  const closeHeli = aircraft('cc0003', 0.1, 1000, {
    description: 'Airbus H135',
    typeCode: 'H135',
    groundSpeedKnots: 45,
  });
  const distantJet = aircraft('dd0004', 12, 35000);
  assert.equal(
    createAircraftSelector().select(snapshot([closeHeli, distantJet]), T)
      .primary?.id,
    closeHeli.id,
  );
  assert.equal(
    scoreAircraft(
      { ...near, typeCode: 'H135', description: 'Helicopter' },
      T,
    )!.score,
    scoreAircraft(near, T)!.score,
  );
});
test('R04 true crossing, tangent, away motion, ground-track relative to observer and age-adjusted CPA', () => {
  const cross = observation(
    aircraft('aa0001', 5, 12000, { groundSpeedKnots: 400 }),
    T,
    2,
  );
  assert.ok(cross.cpaDistanceKm! < 1e-8);
  assert.ok(
    Math.abs(cross.secondsToCpa! - 5 / (400 * 0.000514444)) < 1e-6,
  );
  const tangent = observation(
    aircraft('aa0001', 5, 12000, { trackDegrees: 90 }),
    T,
    2,
  );
  assert.ok(Math.abs(tangent.cpaDistanceKm! - 5) < 1e-6);
  assert.equal(
    observation(aircraft('aa0001', 5, 12000, { trackDegrees: 0 }), T, 2)
      .phase,
    'departing',
  );
  const old = observation(
    aircraft('aa0001', 5, 12000, { groundSpeedKnots: 400 }),
    T + 10000,
    2,
  );
  assert.ok(Math.abs(cross.secondsToCpa! - old.secondsToCpa! - 10) < 1e-5);
});
test('R04 cone entry and exit are distinct from CPA and remain short-horizon estimates', () => {
  const a = aircraft('aa0001', 5, 6500, { groundSpeedKnots: 300 });
  const outside = observation(a, T, 2);
  assert.ok(outside.secondsToCone! > 0);
  assert.ok(outside.secondsToCone! < outside.secondsToCpa!);
  assert.ok(outside.secondsToExitCone! > outside.secondsToCpa!);
  const inside = observation(a, T + 19000, 2);
  assert.equal(inside.secondsToCone, 0);
  assert.ok(inside.secondsToCpa! < outside.secondsToCpa!);
  const unknown = observation({ ...a, heightAboveObserverKm: null }, T, 2);
  assert.equal(unknown.secondsToCone, null);
  assert.equal(unknown.secondsToExitCone, null);
  assert.notEqual(
    unknown.secondsToCpa,
    null,
    'horizontal CPA does not require altitude',
  );
});
test('R04 supported fast pass can interrupt 36s hold after two meaningful fresh challenger samples', () => {
  const s = createAircraftSelector();
  const primary = aircraft('aa0001', 1.5, 2500, {
    groundSpeedKnots: 20,
    trackDegrees: 90,
  });
  s.select(snapshot([primary]), T);
  const results = [];
  for (const seconds of [0, 15, 30]) {
    const now = T + seconds * 1000;
    const challenger = aircraft(
      'bb0002',
      8 - seconds * 350 * 0.000514444,
      35000,
      { groundSpeedKnots: 350, positionTimeMs: now },
    );
    results.push(
      s.select(
        snapshot([{ ...primary, positionTimeMs: now }, challenger], now),
        now,
      ),
    );
  }
  assert.equal(results[1].primary?.id, primary.id);
  assert.equal(results[2].primary?.id, 'bb0002');
  assert.equal(results[2].decision.reason, 'fast-pass-handover');
  assert.equal(results[2].decision.heldMs, 30000);
  assert.ok(
    results[2].decision.margin < 22,
    'ordinary substantial-challenger rule did not cause the handover',
  );
});
for (const patch of [
  { positionTimeMs: T - 30000 },
  { positionTimeMs: T + 1 },
  { groundSpeedKnots: null },
  { groundSpeedKnots: 0 },
  { groundSpeedKnots: 1000 },
  { trackDegrees: null },
  { trackDegrees: 400 },
  { bearingDegrees: null },
  { bearingDegrees: NaN },
  { onGround: true },
  { validity: { position: true, timestamp: false, anomalies: [] } },
] as Partial<LiveAircraft>[])
  test('R04 no confident prediction for ' + JSON.stringify(patch), () => {
    const o = observation(aircraft('aa0001', 5, 10000, patch), T, 3);
    assert.equal(o.predictionQuality, 'unavailable');
    assert.equal(o.secondsToCpa, null);
    assert.equal(o.urgency, 0);
  });
test('R04 missing and implausible altitude are neutral, not zero or an eligibility cutoff', () => {
  for (const alt of [null, NaN, 80000]) {
    const a = aircraft('aa0001', 3, 6000, {
      barometricAltitudeFt: alt,
      geometricAltitudeFt: alt,
      heightAboveObserverKm: null,
    });
    assert.equal(observation(a, T).elevationDegrees, null);
    assert.ok(scoreAircraft(a, T));
  }
  const o = observation(
    aircraft('aa0001', 15, 35000, { groundSpeedKnots: 100 }),
    T,
    2,
  );
  assert.equal(o.cpaDistanceKm, null);
  assert.equal(o.secondsToCpa, null);
  assert.ok(o.predictionDistanceKm! > 0);
});
test('R04 vector disagreement, positional discontinuity, repeated frames and freshness cannot imply supported CPA', () => {
  const a = aircraft('aa0001', 4, 6000);
  assert.equal(
    consistentVector(a, [
      { timeMs: T - 15000, distanceKm: 3, bearingDegrees: 0 },
      { timeMs: T, distanceKm: 4, bearingDegrees: 0 },
    ]),
    false,
  );
  const s = createAircraftSelector();
  s.select(snapshot([aircraft('aa0001', 5, 6000)]), T);
  const r = s.select(
    snapshot(
      [
        aircraft('aa0001', 5, 6000, {
          bearingDegrees: 180,
          positionTimeMs: T + 15000,
        }),
      ],
      T + 15000,
    ),
    T + 15000,
  );
  assert.equal(r.ranked[0].observation.predictionQuality, 'provisional');
  assert.equal(urgencyFor(r.ranked[0].observation, T + 15000), 0);
});
test('R04 cached repetition of a rejected position jump cannot bypass the clear-sky exception', () => {
  const s = createAircraftSelector();
  const heli = aircraft('aa0001', 11, 300, {
    groundSpeedKnots: 60,
    trackDegrees: null,
  });
  const jet = aircraft('bb0002', 14, 300, { groundSpeedKnots: 400 });
  s.select(snapshot([heli]), T);
  s.select(snapshot([heli, jet]), T);
  const now = T + 35000;
  const bad = snapshot(
    [
      { ...heli, positionTimeMs: now },
      {
        ...jet,
        distanceKm: 0.2,
        barometricAltitudeFt: 6500,
        geometricAltitudeFt: 6500,
        heightAboveObserverKm: 6500 * 0.0003048 - 0.031,
        positionTimeMs: now,
      },
    ],
    now,
  );
  assert.equal(s.select(bad, now).primary?.id, heli.id);
  assert.equal(
    s.select(bad, now + 1).primary?.id,
    heli.id,
    'repeated/cached anomalous frame is still uncertain',
  );
});
test('R04 a120ms timestamp difference around30s cannot create a fleeting freshness takeover', () => {
  const s = createAircraftSelector();
  const primary = aircraft('aa0001', 11, 300, {
    positionTimeMs: T - 29900,
    trackDegrees: null,
    groundSpeedKnots: 60,
  });
  const challenger = aircraft('bb0002', 3, 35000, {
    positionTimeMs: T - 29780,
  });
  s.select(snapshot([primary]), T);
  s.select(snapshot([primary, challenger]), T);
  assert.equal(
    s.select(snapshot([primary, challenger]), T + 100).primary?.id,
    primary.id,
  );
  const recovered = { ...challenger, positionTimeMs: T + 101 };
  assert.equal(
    s.select(snapshot([primary, recovered], T + 101), T + 101).primary?.id,
    challenger.id,
    'a genuinely fresh observation still permits timely replacement',
  );
});
test('R04 aircraft-category hints are bounded and never route inference', () => {
  assert.equal(aircraftCategory(fleet[0]), 'commercial-jet');
  assert.equal(
    aircraftCategory({ ...fleet[0], typeCode: 'H135' }),
    'helicopter',
  );
  assert.equal(
    aircraftCategory({
      ...fleet[0],
      typeCode: 'AT76',
      manufacturer: 'ATR',
      model: '72-600',
    }),
    'regional',
  );
  for (const typeCode of ['B738', 'H135', 'P28A', '????']) {
    const hint = routeUtilityHint({
      ...fleet[0],
      typeCode,
      manufacturer: null,
      model: null,
    });
    assert.ok(hint >= 0.85 && hint <= 1.1);
  }
});
test('R04 diagnostic evidence is pseudonymous, bounded, fail-closed at trial end and strips unknown coordinates', () => {
  const d = createSkyDiagnostics(T + 1000);
  const a = Object.assign(aircraft(), {
    latitude: 51,
    longitude: 2,
    secret: 'PRIVATE',
  });
  const snap = snapshot([a]);
  d.selection(createAircraftSelector().select(snap, T), snap, T, false);
  const str = JSON.stringify(d.summary());
  assert.doesNotMatch(
    str,
    /aa0001|TEST1|"latitude"|"longitude"|PRIVATE|"secret"/,
  );
  const result = createAircraftSelector().select(snap, T);
  for (let i = 0; i < 1100; i++) d.selection(result, snap, T, false);
  assert.equal(d.summary().evaluations.length, 1024);
  assert.ok(d.summary().dropped > 0);
  d.stop();
  const count = d.summary().frames.length;
  const evaluations = d.summary().evaluations.length;
  d.selection(createAircraftSelector().select(snap, T), snap, T, false);
  assert.equal(d.summary().frames.length, count);
  assert.equal(d.summary().evaluations.length, evaluations);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createAircraftSelector,
  scoreAircraft,
  assessMovement,
  eligibleAircraft,
  DEFAULT_SELECTION_POLICY,
} from '../src/selection';
import type { Movement, Sample } from '../src/selection';
import type { LiveAircraft, Snapshot } from '../src/liveTypes';
import { liveScene, createPoller } from '../src/live';
import { normalise } from '../server/aircraft';
import { Display } from '../src/App';
const T = 1_800_000_000_000;
const A = 'aa0001',
  B = 'bb0002';
function aircraft(
  id = A,
  distance = 3,
  time = T,
  extra: Partial<LiveAircraft> = {},
): LiveAircraft {
  return {
    id,
    callsign: null,
    registration: null,
    description: 'Boeing 737 MAX 8',
    typeCode: 'B38M',
    distanceKm: distance,
    barometricAltitudeFt: 6000,
    geometricAltitudeFt: null,
    onGround: false,
    groundSpeedKnots: 220,
    trackDegrees: 90,
    positionTimeMs: time,
    source: 'adsb.fi',
    validity: { position: true, timestamp: true, anomalies: [] },
    ...extra,
  };
}
function snapshot(records: LiveAircraft[], time = T): Snapshot {
  return {
    aircraft: records,
    fetchedAtMs: time,
    providerTimeMs: time,
    pollIntervalMs: 15000,
    rejectedRecords: 0,
    anomalies: [],
  };
}
function motion(state: Movement) {
  return { state, radialKmPerSecond: null, samples: 3 };
}
function samples(
  distances: number[],
  times = distances.map((_, i) => i * 15000),
): Sample[] {
  return distances.map((distanceKm, i) => ({
    distanceKm,
    timeMs: T + times[i],
    speedKnots: 220,
  }));
}

test('distance is smooth and substantial, without a distance-only gate', () => {
  assert.ok(
    scoreAircraft(aircraft(A, 2), T)!.score >
      scoreAircraft(aircraft(B, 5), T)!.score,
  );
  assert.ok(
    Math.abs(
      scoreAircraft(aircraft(A, 1.99), T)!.score -
        scoreAircraft(aircraft(B, 2.01), T)!.score,
    ) < 0.2,
  );
  const low = scoreAircraft(
    aircraft(A, 5, T, { barometricAltitudeFt: 2000 }),
    T,
  )!;
  const high = scoreAircraft(
    aircraft(B, 3, T, { barometricAltitudeFt: 12000 }),
    T,
  )!;
  assert.ok(
    low.score > high.score,
    'lower aircraft can outrank a closer high aircraft',
  );
});
test('altitude supports preference, high aircraft remain eligible, unknown is neutral not zero', () => {
  const low = scoreAircraft(
    aircraft(A, 3, T, { barometricAltitudeFt: 2000 }),
    T,
  )!;
  const high = scoreAircraft(
    aircraft(B, 3, T, { barometricAltitudeFt: 18000 }),
    T,
  )!;
  assert.ok(low.score > high.score);
  assert.ok(high.score > 0);
  assert.equal(
    scoreAircraft(aircraft(A, 3, T, { barometricAltitudeFt: null }), T)!.factors
      .altitude,
    10,
  );
  assert.equal(
    scoreAircraft(aircraft(A, 3, T, { barometricAltitudeFt: -150 }), T)!.factors
      .altitude,
    20,
  );
  assert.equal(
    scoreAircraft(aircraft(A, 3, T, { barometricAltitudeFt: NaN }), T)!.factors
      .altitude,
    10,
  );
  assert.equal(
    createAircraftSelector().select(snapshot([high.aircraft]), T).primary?.id,
    B,
  );
});
test('approaching beats a slightly nearer departing aircraft, unknown movement is neutral', () => {
  const approaching = scoreAircraft(
    aircraft(B, 3.5),
    T,
    motion('approaching'),
  )!;
  const departing = scoreAircraft(aircraft(A, 3), T, motion('departing'))!;
  assert.ok(approaching.score > departing.score);
  assert.equal(scoreAircraft(aircraft(), T)!.factors.movement, 10);
  assert.equal(
    scoreAircraft(aircraft(), T, motion('passing'))!.factors.movement,
    12,
  );
});
test('invalid positions, ground, future/expired and timestamp anomalies are ineligible', () => {
  const invalid: Partial<LiveAircraft>[] = [
    { onGround: true },
    { distanceKm: null },
    { distanceKm: NaN },
    { distanceKm: -1 },
    { distanceKm: 15.01 },
    { positionTimeMs: null },
    { positionTimeMs: NaN },
    { positionTimeMs: T + 1 },
    { positionTimeMs: T - 120000 },
    { validity: { position: false, timestamp: true, anomalies: [] } },
    { validity: { position: true, timestamp: false, anomalies: [] } },
    {
      validity: {
        position: true,
        timestamp: true,
        anomalies: ['provider-clock'],
      },
    },
  ];
  for (const extra of invalid)
    assert.equal(
      scoreAircraft(aircraft(A, 3, T, extra), T),
      null,
      JSON.stringify(extra),
    );
  assert.ok(eligibleAircraft(aircraft(A, 15), T));
  assert.ok(eligibleAircraft(aircraft(A, 0), T));
});
test('stale observations lose score and movement confidence without resetting age', () => {
  const current = scoreAircraft(aircraft(), T, motion('approaching'))!;
  const delayed = scoreAircraft(aircraft(), T + 45000, motion('approaching'))!;
  assert.ok(delayed.score < current.score);
  assert.equal(delayed.motion.state, 'unknown');
  assert.equal(delayed.ageMs, 45000);
  assert.equal(delayed.factors.movement, 10);
});
test('normalisation distinguishes explicit ground, numeric altitude and missing ground status', () => {
  const point = { latitude: 60, longitude: 25 };
  assert.equal(
    normalise({ hex: 'abcdef', alt_baro: 'ground' }, T, T, point)!.onGround,
    true,
  );
  assert.equal(
    normalise({ hex: 'abcdef', alt_baro: 0 }, T, T, point)!.onGround,
    false,
  );
  assert.equal(normalise({ hex: 'abcdef' }, T, T, point)!.onGround, null);
  assert.ok(
    scoreAircraft(
      aircraft(A, 3, T, { onGround: null, barometricAltitudeFt: null }),
      T,
    ),
  );
});
for (const [label, distances, state] of [
  ['decreasing', [5, 4.7, 4.4], 'approaching'],
  ['increasing', [4, 4.3, 4.6], 'departing'],
  ['closest approach', [3.5, 3, 3.05], 'passing'],
  ['small jitter', [3, 3.01, 2.99], 'unknown'],
] as const) {
  test('movement: ' + label, () =>
    assert.equal(
      assessMovement(samples([...distances]), T + 30000).state,
      state,
    ),
  );
}
test('movement requires sufficient history and a minimum span, not northbound heading', () => {
  assert.equal(assessMovement(samples([4]), T).state, 'unknown');
  assert.equal(assessMovement(samples([4, 3.7]), T + 15000).state, 'unknown');
  assert.equal(
    assessMovement(samples([4, 3.7, 3.4], [0, 1000, 2000]), T + 2000).state,
    'unknown',
  );
  const selector = createAircraftSelector();
  const result = selector.select(
    snapshot([aircraft(A, 4, T, { groundSpeedKnots: null, trackDegrees: 0 })]),
    T,
  );
  assert.equal(result.ranked[0].motion.state, 'unknown');
});
test('movement tolerates irregular intervals and missing intermediate observations', () => {
  assert.equal(
    assessMovement(samples([5, 4.76, 4.2], [0, 12000, 40000]), T + 40000).state,
    'approaching',
  );
  assert.equal(
    assessMovement(samples([5, 4.4, 3.8], [0, 30000, 60000]), T + 60000).state,
    'approaching',
  );
  assert.equal(
    assessMovement(samples([5, 4, 3], [0, 60000, 75000]), T + 75000).state,
    'unknown',
  );
  assert.equal(assessMovement(samples([5, 4, 3]), T + 60000).state, 'unknown');
});
test('history derives motion despite absent speed/track and ignores duplicate/out-of-order position times', () => {
  const selector = createAircraftSelector();
  let result;
  for (let i = 0; i < 3; i++)
    result = selector.select(
      snapshot(
        [
          aircraft(A, 5 - i * 0.3, T + i * 15000, {
            groundSpeedKnots: null,
            trackDegrees: null,
          }),
        ],
        T + i * 15000,
      ),
      T + i * 15000,
    );
  assert.equal(result!.ranked[0].motion.state, 'approaching');
  assert.equal(selector.inspect().samples, 3);
  for (let i = 0; i < 4; i++)
    selector.select(
      snapshot([aircraft(A, 4.4, T + 30000)], T + 30000),
      T + 30000,
    );
  assert.equal(selector.inspect().samples, 3);
  result = selector.select(
    snapshot([aircraft(A, 5, T + 15000)], T + 31000),
    T + 31000,
  );
  assert.equal(result.primary?.positionTimeMs, T + 30000);
  assert.equal(selector.inspect().samples, 3);
});
test('implausible jumps reset movement history rather than claim approach', () => {
  const selector = createAircraftSelector();
  selector.select(snapshot([aircraft(A, 10)]), T);
  const r = selector.select(
    snapshot([aircraft(A, 1, T + 1000, { groundSpeedKnots: 20 })], T + 1000),
    T + 1000,
  );
  assert.equal(r.ranked[0].motion.state, 'unknown');
  assert.equal(selector.inspect().samples, 1);
});
test('reappearing aircraft restart movement after a long gap but tolerate a short omission', () => {
  const selector = createAircraftSelector();
  selector.select(snapshot([aircraft(A, 5)]), T);
  selector.select(snapshot([aircraft(B, 10, T + 15000)], T + 15000), T + 15000);
  let r = selector.select(
    snapshot([aircraft(A, 4.4, T + 30000)], T + 30000),
    T + 30000,
  );
  assert.equal(r.ranked[0].motion.samples, 2);
  r = selector.select(
    snapshot([aircraft(A, 3.2, T + 90000)], T + 90000),
    T + 90000,
  );
  assert.equal(r.ranked[0].motion.state, 'unknown');
  assert.equal(r.ranked[0].motion.samples, 1);
});
test('one primary remains selected without resetting its holding period', () => {
  const selector = createAircraftSelector();
  for (let i = 0; i < 10; i++) {
    const now = T + i * 15000;
    const r = selector.select(snapshot([aircraft(A, 3, now)], now), now);
    assert.equal(r.primary?.id, A);
    assert.equal(r.decision.heldMs, i * 15000);
  }
});
test('small alternating score differences do not oscillate', () => {
  const selector = createAircraftSelector();
  let switches = 0,
    last = A;
  for (let i = 0; i < 60; i++) {
    const now = T + i * 15000;
    const r = selector.select(
      snapshot(
        [aircraft(A, i % 2 ? 3.1 : 3, now), aircraft(B, i % 2 ? 3 : 3.1, now)],
        now,
      ),
      now,
    );
    if (r.primary!.id !== last) switches++;
    last = r.primary!.id;
  }
  assert.equal(switches, 0);
});
test('minimum hold and two observations allow a meaningful, timely normal takeover', () => {
  const selector = createAircraftSelector();
  selector.select(snapshot([aircraft(A, 5)]), T);
  for (const time of [15000, 30000]) {
    const now = T + time;
    const r = selector.select(
      snapshot([aircraft(A, 5, now), aircraft(B, 2, now)], now),
      now,
    );
    assert.equal(r.primary?.id, A);
    assert.equal(r.decision.reason, 'minimum-hold');
  }
  const now = T + 45000;
  const r = selector.select(
    snapshot([aircraft(A, 5, now), aircraft(B, 2, now)], now),
    now,
  );
  assert.equal(r.primary?.id, B);
  assert.equal(r.decision.reason, 'confirmed-challenger');
});
test('single transient challenger and cached samples cannot bypass confirmation', () => {
  const selector = createAircraftSelector();
  selector.select(snapshot([aircraft(A, 5)]), T);
  let now = T + 45000;
  const s = snapshot([aircraft(A, 5, now), aircraft(B, 2, now)], now);
  let r = selector.select(s, now);
  assert.equal(r.primary?.id, A);
  assert.equal(r.decision.reason, 'confirming');
  r = selector.select(s, now + 1);
  assert.equal(r.primary?.id, A);
  assert.equal(r.decision.confirmations, 1);
  now += 15000;
  r = selector.select(snapshot([aircraft(A, 5, now)], now), now);
  assert.equal(r.primary?.id, A);
});
test('substantially better candidate can interrupt the hold immediately', () => {
  const selector = createAircraftSelector();
  selector.select(snapshot([aircraft(A, 10)]), T);
  const r = selector.select(
    snapshot(
      [aircraft(A, 10, T + 15000), aircraft(B, 0.1, T + 15000)],
      T + 15000,
    ),
    T + 15000,
  );
  assert.equal(r.primary?.id, B);
  assert.equal(r.decision.reason, 'substantial-challenger');
});
test('departing primary hands over to approaching challenger before minimum hold', () => {
  const selector = createAircraftSelector();
  let r;
  for (let i = 0; i < 3; i++) {
    const now = T + i * 15000;
    r = selector.select(
      snapshot(
        [aircraft(A, 3.3 + i * 0.2, now), aircraft(B, 4.5 - i * 0.2, now)],
        now,
      ),
      now,
    );
    if (i < 2) assert.equal(r.primary?.id, A);
  }
  assert.equal(r!.primary?.id, B);
  assert.equal(r!.decision.reason, 'departing-handover');
  assert.equal(
    r!.ranked.find((a) => a.aircraft.id === A)?.motion.state,
    'departing',
  );
});
test('stale incumbent yields to a better fresh candidate without a freshness advantage from retention', () => {
  const selector = createAircraftSelector();
  selector.select(snapshot([aircraft(A, 3)]), T);
  const r = selector.select(
    snapshot([aircraft(A, 3), aircraft(B, 4, T + 45000)], T + 45000),
    T + 45000,
  );
  assert.equal(r.primary?.id, B);
  assert.equal(r.decision.reason, 'fresher-challenger');
});
const releaseCases: [string, Partial<LiveAircraft>][] = [
  ['expired', { positionTimeMs: T - 120000 }],
  [
    'invalid',
    { validity: { position: false, timestamp: true, anomalies: [] } },
  ],
  ['outside radius', { distanceKm: 16 }],
  ['ground', { onGround: true }],
];
for (const [label, extra] of releaseCases) {
  test('early primary release: ' + label, () => {
    const selector = createAircraftSelector();
    selector.select(snapshot([aircraft()]), T);
    const r = selector.select(
      snapshot(
        [aircraft(A, 3, T + 15000, extra), aircraft(B, 4, T + 15000)],
        T + 15000,
      ),
      T + 15000,
    );
    assert.equal(r.primary?.id, B);
  });
}
test('temporary missing primary has a finite grace and does not survive a successful empty or ground-only result', () => {
  const selector = createAircraftSelector();
  selector.select(snapshot([aircraft()]), T);
  let r = selector.select(
    snapshot([aircraft(B, 3.1, T + 15000)], T + 15000),
    T + 15000,
  );
  assert.equal(r.primary?.id, A);
  assert.equal(r.decision.retainedMissing, true);
  assert.equal(
    liveScene(
      snapshot([aircraft(B, 3.1, T + 15000)], T + 15000),
      T + 15000,
      false,
      r,
    ).state,
    'available',
  );
  r = selector.select(
    snapshot([aircraft(B, 3.1, T + 30000)], T + 30000),
    T + 30000,
  );
  assert.equal(r.primary?.id, B);
  assert.equal(
    selector.select(snapshot([], T + 31000), T + 31000).primary,
    null,
  );
  selector.select(snapshot([aircraft(A, 3, T + 45000)], T + 45000), T + 45000);
  r = selector.select(
    snapshot([aircraft(B, 0.1, T + 60000, { onGround: true })], T + 60000),
    T + 60000,
  );
  assert.equal(r.primary, null);
  assert.equal(
    liveScene(
      snapshot([aircraft(B, 0.1, T + 60000, { onGround: true })], T + 60000),
      T + 60000,
      false,
      r,
    ).state,
    'standby',
  );
});
test('brief failed feed retains selection; recovery continues history and handover; expiry clears display', () => {
  const selector = createAircraftSelector();
  selector.select(snapshot([aircraft(A, 5)]), T);
  const s = snapshot(
    [aircraft(A, 5, T + 15000), aircraft(B, 2, T + 15000)],
    T + 15000,
  );
  selector.select(s, T + 15000);
  let r = selector.select(s, T + 30000, true);
  assert.equal(r.primary?.id, A);
  assert.equal(r.decision.reason, 'feed-interruption');
  assert.equal(liveScene(s, T + 30000, true, r).state, 'delayed');
  r = selector.select(
    snapshot([aircraft(A, 5, T + 45000), aircraft(B, 2, T + 45000)], T + 45000),
    T + 45000,
  );
  assert.equal(r.primary?.id, B);
  r = selector.select(s, T + 136000, true);
  assert.equal(r.primary, null);
  assert.equal(liveScene(s, T + 136000, true, r).state, 'unavailable');
  assert.equal(selector.inspect().samples, 0);
});
test('initial/reloaded selector acquires without history; backwards clock clears state safely', () => {
  const s = snapshot([aircraft(A, 5), aircraft(B, 2)]);
  const selector = createAircraftSelector();
  assert.equal(selector.select(s, T).primary?.id, B);
  assert.equal(createAircraftSelector().select(s, T).primary?.id, B);
  const r = selector.select(s, T - 1);
  assert.equal(r.primary, null);
  assert.equal(selector.inspect().samples, 0);
});
test('secondary relevance ordering is deterministic, unique and capped as eligible aircraft change', () => {
  const selector = createAircraftSelector();
  const records = [
    aircraft(A, 3),
    aircraft(B, 4),
    aircraft('cc0003', 5),
    aircraft('dd0004', 6),
    aircraft('ee0005', 7),
    aircraft(A, 3),
  ];
  const r = selector.select(snapshot(records), T);
  assert.equal(r.secondary.length, 3);
  assert.ok(!r.secondary.some((a) => a.id === r.primary?.id));
  assert.equal(
    new Set([r.primary!.id, ...r.secondary.map((a) => a.id)]).size,
    4,
  );
  assert.deepEqual(
    createAircraftSelector()
      .select(snapshot([...records].reverse()), T)
      .secondary.map((a) => a.id),
    r.secondary.map((a) => a.id),
  );
  const next = selector.select(
    snapshot(
      [aircraft('ff0006', 2, T + 15000), aircraft(B, 20, T + 15000)],
      T + 15000,
    ),
    T + 15000,
  );
  assert.ok(!next.secondary.some((a) => a.id === B));
  assert.ok(next.ranked.some((a) => a.aircraft.id === 'ff0006'));
  const ties = createAircraftSelector().select(
    snapshot([aircraft(B), aircraft(A)]),
    T,
  );
  assert.equal(ties.primary?.id, A);
});
test('history is bounded in aircraft, samples and time; cleanup releases all state', () => {
  const selector = createAircraftSelector({
    maximumAircraft: 4,
    samplesPerAircraft: 3,
  });
  for (let step = 0; step < 20; step++) {
    const now = T + step * 15000;
    selector.select(
      snapshot(
        Array.from({ length: 10 }, (_, i) =>
          aircraft('aircraft-' + (i + step), 3 + i / 10, now),
        ),
        now,
      ),
      now,
    );
    assert.ok(selector.inspect().aircraft <= 4);
    assert.ok(selector.inspect().samples <= 12);
  }
  selector.select(null, T + 500000);
  assert.equal(selector.inspect().samples, 0);
  selector.clear();
  assert.deepEqual(selector.inspect(), {
    aircraft: 0,
    samples: 0,
    primaryId: null,
  });
});
test('rendering uses existing hierarchy/capacity without movement labels or new controls', () => {
  const s = snapshot([
    aircraft(A, 5),
    aircraft(B, 3, T, { barometricAltitudeFt: 12000 }),
  ]);
  const html = renderToStaticMarkup(
    <Display scene={liveScene(s, T, false)} live />,
  );
  assert.match(html, /737 MAX 8/);
  assert.match(html, /Also nearby/);
  assert.match(html, /Barometric altitude/);
  assert.match(html, /Horizontal distance/);
  assert.doesNotMatch(html, /audible|Approaching|Departing|<button|<input/);
  assert.equal(DEFAULT_SELECTION_POLICY.minimumHoldMs, 36000);
});

test('poller preserves selector between polls, adds no timers/requests and clears it on stop', async () => {
  let now = T,
    nextId = 0,
    requests = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const states: string[] = [];
  const poller = createPoller((s) => states.push(s.state), {
    now: () => now,
    active: () => true,
    fetch: async () => {
      requests++;
      return new Response(
        JSON.stringify(snapshot([aircraft(A, 5 - requests * 0.3, now)], now)),
      );
    },
    setTimer: (fn, ms) => {
      const key = ++nextId;
      timers.set(key, { fn, at: now + ms });
      return key as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id) => {
      timers.delete(id as unknown as number);
    },
  });
  const flush = async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  };
  poller.start();
  await flush();
  for (let i = 0; i < 3; i++) {
    assert.ok(timers.size <= 2);
    assert.equal(requests, i + 1);
    now += 15000;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.fn();
      }
    await flush();
  }
  assert.equal(
    poller.diagnostics().selection?.ranked[0].motion.state,
    'approaching',
  );
  assert.equal(requests, 4);
  assert.ok(states.every((s) => s === 'available' || s === 'unavailable'));
  poller.stop();
  assert.equal(timers.size, 0);
  assert.equal(poller.diagnostics().history.samples, 0);
  assert.equal(poller.diagnostics().selection, null);
});

test('missing grace is enforced by the existing expiry timer during a hung next poll', async () => {
  let now = T,
    id = 0,
    calls = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const poller = createPoller(() => {}, {
    now: () => now,
    active: () => true,
    fetch: async (_url, options) => {
      calls++;
      if (calls >= 3)
        return new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(Error('abort')),
          ),
        );
      return new Response(
        JSON.stringify(
          snapshot(
            calls === 1 ? [aircraft(A, 3, T - 1000)] : [aircraft(B, 6, now)],
            now,
          ),
        ),
      );
    },
    setTimer: (fn, ms) => {
      const key = ++id;
      timers.set(key, { fn, at: now + ms });
      return key as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (key) => {
      timers.delete(key as unknown as number);
    },
  });
  const flush = async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  };
  const advance = async (time: number) => {
    now = time;
    for (const [key, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(key);
        timer.fn();
      }
    await flush();
  };
  poller.start();
  await flush();
  await advance(T + 15000);
  assert.equal(poller.diagnostics().selection?.primary?.id, A);
  assert.equal(poller.diagnostics().selection?.reevaluateAtMs, T + 30000);
  await advance(T + 29000);
  assert.equal(poller.diagnostics().selection?.primary?.id, A);
  await advance(T + 30000);
  assert.equal(calls, 3);
  assert.equal(poller.diagnostics().selection?.primary?.id, B);
  poller.stop();
  await flush();
  assert.equal(timers.size, 0);
});

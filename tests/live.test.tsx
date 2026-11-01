import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  horizontalDistanceKm,
  normalise,
  publicAircraft,
  readableDescription,
} from '../server/aircraft';
import { fetchAircraft, MAX_BYTES, ProviderError } from '../server/provider';
import { configuration, createService } from '../server/service';
import handler from '../api/aircraft';
import { liveScene, selectAircraft, createPoller } from '../src/live';
import { displayMode } from '../src/mode';
import { Display } from '../src/App';
import type { Snapshot } from '../src/liveTypes';
import type { ServerResponse, IncomingMessage } from 'node:http';

const now = 1_793_500_000_000,
  point = { latitude: 60, longitude: 25 }; // Synthetic, not the observation location.
const record = {
  hex: 'abcdef',
  flight: ' TEST1 ',
  r: 'TEST-REG',
  desc: 'BOEING 737 MAX 8',
  t: 'B38M',
  lat: 60.01,
  lon: 25,
  alt_baro: 12000,
  alt_geom: 12400,
  gs: 210,
  track: 90,
  seen_pos: 1.5,
};
const envelope = (ac: unknown[] = [record]) => ({ ac, now, msg: 'No error' });
const response = (
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
) => new Response(JSON.stringify(data), { status, headers });
const fetcher = (r: Response) => async () => r;
const snapshot = (
  aircraft = [publicAircraft(normalise(record, now, now, point)!)],
): Snapshot => ({
  aircraft,
  fetchedAtMs: now,
  providerTimeMs: now,
  pollIntervalMs: 15000,
  rejectedRecords: 0,
  anomalies: [],
});

test('haversine known points, antipodes, zero, precision and invalid positions', () => {
  assert.equal(horizontalDistanceKm(point, point), 0);
  assert.ok(
    Math.abs(
      horizontalDistanceKm(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      )! - 111.19508,
    ) < 0.00001,
  );
  assert.ok(
    Math.abs(
      horizontalDistanceKm(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 180 },
      )! - 20015.114442,
    ) < 0.00001,
  );
  assert.equal(horizontalDistanceKm(null, point), null);
  for (const bad of [
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
    { latitude: NaN, longitude: 0 },
    { latitude: '60', longitude: 25 },
  ])
    assert.equal(horizontalDistanceKm(bad, point), null);
  assert.ok(
    horizontalDistanceKm(point, { latitude: 60.00001, longitude: 25 })! > 0,
  );
});

test('normalisation preserves variant, raw diagnostic description, units, high altitude and optional fields', () => {
  const a = normalise(record, now, now, point)!;
  assert.equal(a.description, 'Boeing 737 MAX 8');
  assert.equal(a.rawDescription, record.desc);
  assert.equal(a.callsign, 'TEST1');
  assert.equal(a.registration, 'TEST-REG');
  assert.equal(a.barometricAltitudeFt, 12000);
  assert.equal(a.geometricAltitudeFt, 12400);
  assert.equal(a.positionTimeMs, now - 1500);
  assert.equal(a.groundSpeedKnots, 210);
  for (const desc of [
    'AIRBUS A320neo',
    'AIRBUS A321neo',
    'BOEING 737-800',
    'BOEING 737 MAX 8',
  ])
    assert.equal(
      readableDescription(desc)?.split(' ').slice(1).join(' '),
      desc.split(' ').slice(1).join(' '),
    );
  const missing = normalise({ hex: '123456' }, now, now, point)!;
  for (const field of [
    'description',
    'callsign',
    'registration',
    'distanceKm',
    'positionTimeMs',
    'barometricAltitudeFt',
  ] as const)
    assert.equal(missing[field], null);
  assert.equal(normalise({}, now, now, point), null);
  assert.equal(normalise(null, now, now, point), null);
  const ground = normalise(
    { ...record, alt_baro: 'ground', alt_geom: undefined },
    now,
    now,
    point,
  )!;
  assert.equal(ground.onGround, true);
  assert.equal(ground.barometricAltitudeFt, null);
  assert.equal(ground.geometricAltitudeFt, null);
  assert.equal(
    normalise({ ...record, lat: 200 }, now, now, point)!.validity.position,
    false,
  );
  assert.equal(
    normalise({ ...record, seen_pos: -1 }, now, now, point)!.positionTimeMs,
    null,
  );
  assert.ok(
    normalise(
      { ...record, seen_pos: -1 },
      now,
      now,
      point,
    )!.validity.anomalies.includes('invalid-position-age'),
  );
  assert.equal(normalise(record, now + 1, now, point)!.positionTimeMs, null);
  assert.equal(
    normalise({ ...record, alt_baro: -150 }, now, now, point)!
      .barometricAltitudeFt,
    -150,
  );
  assert.equal(
    normalise(
      { ...record, alt_baro: '3000', track: 361, gs: -1 },
      now,
      now,
      point,
    )!.barometricAltitudeFt,
    null,
  );
});

test('adapter populated, empty, local radius, deduplication, missing fields and privacy', async () => {
  let url = '';
  let options: RequestInit | undefined;
  const result = await fetchAircraft(
    point,
    15000,
    async (u, o) => {
      url = String(u);
      options = o;
      return response(
        envelope([
          record,
          { ...record },
          { ...record, hex: '000001', lat: 61 },
          { hex: 'bad' },
        ]),
      );
    },
    () => now,
  );
  assert.equal(result.aircraft.length, 1);
  assert.equal(result.rejectedRecords, 1);
  assert.match(url, /\/api\/v3\/lat\/60\/lon\/25\/dist\/8.099352$/);
  assert.equal(options?.redirect, 'error');
  assert.ok(
    (options?.headers as Record<string, string>)['User-Agent'].includes(
      'Perch',
    ),
  );
  const body = JSON.stringify(result);
  for (const field of [
    'latitude',
    'longitude',
    'rawDescription',
    'opendata.adsb.fi',
  ])
    assert.ok(!body.includes(field));
  assert.deepEqual(
    (
      await fetchAircraft(
        point,
        15000,
        fetcher(response(envelope([]))),
        () => now,
      )
    ).aircraft,
    [],
  );
  assert.equal(
    (
      await fetchAircraft(
        point,
        15000,
        fetcher(response(envelope([{ hex: '123456' }]))),
        () => now,
      )
    ).aircraft.length,
    0,
  );
  const invalidClock = await fetchAircraft(
    point,
    15000,
    fetcher(response({ ...envelope(), now: now + 1 })),
    () => now,
  );
  assert.deepEqual(invalidClock.anomalies, ['provider-clock']);
});

test('adapter HTTP failures, denial and rate limit Retry-After are distinct', async () => {
  for (const [status, code] of [
    [500, 'http-error'],
    [401, 'access-denied'],
    [403, 'access-denied'],
    [429, 'rate-limited'],
  ] as const) {
    await assert.rejects(
      fetchAircraft(
        point,
        15000,
        fetcher(response({}, status, { 'Retry-After': '90' })),
        () => now,
      ),
      (e: unknown) =>
        e instanceof ProviderError &&
        e.code === code &&
        (status !== 429 || e.retryAfterMs === 90000),
    );
  }
});

test('adapter malformed JSON, structure, missing timestamp and oversized length/stream', async () => {
  for (const r of [
    new Response('{'),
    response({}),
    response({ ...envelope(), ac: {} }),
    response({ ...envelope(), now: undefined }),
    response({ ...envelope(), msg: 'Error' }),
  ])
    await assert.rejects(
      fetchAircraft(point, 15000, fetcher(r), () => now),
      ProviderError,
    );
  await assert.rejects(
    fetchAircraft(
      point,
      15000,
      fetcher(
        new Response('x', {
          headers: { 'Content-Length': String(MAX_BYTES + 1) },
        }),
      ),
      () => now,
    ),
    /response-too-large/,
  );
  await assert.rejects(
    fetchAircraft(
      point,
      15000,
      fetcher(new Response('x'.repeat(MAX_BYTES + 1))),
      () => now,
    ),
    /response-too-large/,
  );
});

test('adapter times out on fetch and body; cleans timeout without retries', async () => {
  let calls = 0;
  const pending: typeof fetch = async (_u, o) => {
    calls++;
    return new Promise((_resolve, reject) =>
      o?.signal?.addEventListener('abort', () => reject(Error('aborted'))),
    );
  };
  await assert.rejects(
    fetchAircraft(point, 15000, pending, () => now, 5),
    /timeout/,
  );
  assert.equal(calls, 1);
  const pendingBody: typeof fetch = async (_u, o) =>
    new Response(
      new ReadableStream({
        start(c) {
          o?.signal?.addEventListener('abort', () => c.error(Error('aborted')));
        },
      }),
    );
  await assert.rejects(
    fetchAircraft(point, 15000, pendingBody, () => now, 5),
    /timeout/,
  );
});

test('service coalesces clients, expires cache, gates cadence and honours cooldown', async () => {
  let time = now,
    calls = 0;
  let resolve!: (s: Snapshot) => void;
  const get = createService(
    () => {
      calls++;
      return new Promise<Snapshot>((r) => (resolve = r));
    },
    () => time,
  );
  const a = get(),
    b = get();
  assert.equal(a, b);
  assert.equal(calls, 1);
  resolve(snapshot());
  await a;
  time += 9000;
  await get();
  assert.equal(calls, 1);
  time += 2000;
  await assert.rejects(get(), /cooldown/);
  time = now + 15000;
  const c = get();
  assert.equal(calls, 2);
  resolve({ ...snapshot(), fetchedAtMs: time });
  await c;
  let errors = 0;
  const denied = createService(
    async () => {
      errors++;
      throw new ProviderError('access-denied', 300000);
    },
    () => time,
  );
  await assert.rejects(denied());
  time += 15000;
  await assert.rejects(denied());
  assert.equal(errors, 1);
  time += 300000;
  await assert.rejects(denied());
  assert.equal(errors, 2);
});

test('configuration fail-closed, never VITE location, production disabled, simulation independent', () => {
  for (const env of [
    {},
    { AERO_LIVE_ENABLED: 'true' },
    {
      AERO_LIVE_ENABLED: 'true',
      AERO_OBSERVATION_LATITUDE: '',
      AERO_OBSERVATION_LONGITUDE: '',
    },
    { AERO_LIVE_ENABLED: 'true', VERCEL_ENV: 'production' },
  ])
    assert.throws(() => configuration(env));
  assert.equal(
    configuration({
      AERO_LIVE_ENABLED: 'true',
      AERO_OBSERVATION_LATITUDE: '60',
      AERO_OBSERVATION_LONGITUDE: '25',
    }).pollIntervalMs,
    15000,
  );
  assert.throws(() =>
    configuration({
      AERO_LIVE_ENABLED: 'true',
      AERO_OBSERVATION_LATITUDE: '60',
      AERO_OBSERVATION_LONGITUDE: '25',
      AERO_POLL_INTERVAL_MS: '1000',
    }),
  );
  assert.equal(displayMode('?mode=live', false), 'simulation');
  assert.equal(displayMode('?mode=live', true), 'live');
  assert.equal(displayMode('', true), 'simulation');
});

test('API disabled and invalid query do not leak configuration or fetch provider', async () => {
  const original = process.env.AERO_LIVE_ENABLED;
  delete process.env.AERO_LIVE_ENABLED;
  const res = {
    statusCode: 0,
    setHeader() {},
    end(body: string) {
      assert.doesNotMatch(body, /latitude|longitude|opendata/);
    },
  };
  try {
    await handler(
      { method: 'GET', url: '/api/aircraft' } as IncomingMessage,
      res as unknown as ServerResponse,
    );
    assert.equal(res.statusCode, 404);
    await handler(
      { method: 'GET', url: '/api/aircraft?lat=123' } as IncomingMessage,
      res as unknown as ServerResponse,
    );
    assert.equal(res.statusCode, 400);
  } finally {
    if (original !== undefined) process.env.AERO_LIVE_ENABLED = original;
  }
});

test('live rendering: primary model, deterministic secondary, unavailable routes and all states', () => {
  const first = snapshot().aircraft[0],
    other = { ...first, id: '000001', distanceKm: 2 };
  const s = snapshot([other, first]);
  const selected = selectAircraft(s.aircraft, now);
  assert.equal(selected[0].id, first.id);
  const html = renderToStaticMarkup(
    <Display scene={liveScene(s, now, false)} live />,
  );
  assert.match(html, /737 MAX 8/);
  assert.match(html, /Other nearby aircraft/);
  assert.match(html, /Not reported/);
  assert.ok(html.indexOf('737 MAX 8') < html.indexOf('TEST1'));
  assert.match(html, /href="https:\/\/adsb.fi\/"/);
  assert.doesNotMatch(html, /Demo|SIMULATED/);
  assert.equal(liveScene(s, now + 31000, false).state, 'delayed');
  assert.equal(liveScene(s, now, true).state, 'delayed');
  assert.equal(liveScene(s, now + 121000, true).primary, null);
  assert.equal(liveScene(snapshot([]), now, false).state, 'standby');
  assert.equal(liveScene(snapshot([]), now, true).state, 'unavailable');
  assert.equal(liveScene(null, now, false).state, 'unavailable');
  const empty = renderToStaticMarkup(
    <Display scene={liveScene(snapshot([]), now, false)} live />,
  );
  assert.match(empty, /15 km/);
  assert.doesNotMatch(empty, /demonstration/);
  assert.equal(
    selectAircraft([{ ...first, positionTimeMs: now + 1 }], now).length,
    0,
  );
  assert.equal(
    selectAircraft([{ ...first, positionTimeMs: now - 121000 }], now).length,
    0,
  );
  assert.equal(
    selectAircraft([other, { ...other, id: '000000' }], now)[0].id,
    '000000',
  );
});

test('poller cadence, no overlap, failure recovery, suspension/resume, timeout and cleanup', async () => {
  let time = now,
    active = true,
    calls = 0,
    id = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let resolve!: (r: Response) => void;
  const states: string[] = [];
  const poller = createPoller((s) => states.push(s.state), {
    now: () => time,
    active: () => active,
    fetch: async (_u, o) => {
      calls++;
      return new Promise<Response>((r, reject) => {
        resolve = r;
        o?.signal?.addEventListener('abort', () => reject(Error('aborted')));
      });
    },
    setTimer: (fn, ms) => {
      const key = ++id;
      timers.set(key, { fn, at: time + ms });
      return key as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (key) => {
      timers.delete(key as unknown as number);
    },
  });
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    time += ms;
    for (const [key, timer] of [...timers])
      if (timer.at <= time) {
        timers.delete(key);
        timer.fn();
      }
    await flush();
  };
  poller.start();
  poller.resume();
  assert.equal(calls, 1);
  resolve(response(snapshot()));
  await flush();
  assert.equal(states[states.length - 1], 'available');
  await advance(14999);
  assert.equal(calls, 1);
  await advance(1);
  assert.equal(calls, 2);
  resolve(response({}, 500));
  await flush();
  assert.equal(states[states.length - 1], 'delayed');
  await advance(15000);
  assert.equal(calls, 3);
  resolve(
    response({
      ...snapshot(),
      fetchedAtMs: time,
      aircraft: snapshot().aircraft.map((a) => ({
        ...a,
        positionTimeMs: time - 1000,
      })),
    }),
  );
  await flush();
  assert.equal(states[states.length - 1], 'available');
  active = false;
  poller.resume();
  assert.equal(timers.size, 0);
  await advance(130000);
  assert.equal(calls, 3);
  active = true;
  poller.resume();
  assert.equal(states[states.length - 1], 'unavailable');
  assert.equal(calls, 4);
  await advance(8000);
  assert.equal(states[states.length - 1], 'unavailable');
  await advance(7000);
  assert.equal(calls, 5);
  poller.stop();
  await flush();
  assert.equal(timers.size, 0);
});

test('API success boundary: server-only config, safe projection, cache headers and bounded provider calls', async () => {
  const keys = [
    'AERO_LIVE_ENABLED',
    'AERO_OBSERVATION_LATITUDE',
    'AERO_OBSERVATION_LONGITUDE',
    'VERCEL_ENV',
  ];
  const saved = keys.map((k) => process.env[k]);
  const originalFetch = globalThis.fetch;
  let calls = 0,
    body = '';
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    end(value: string) {
      body = value;
    },
  };
  try {
    process.env.AERO_LIVE_ENABLED = 'true';
    process.env.AERO_OBSERVATION_LATITUDE = '60';
    process.env.AERO_OBSERVATION_LONGITUDE = '25';
    process.env.VERCEL_ENV = 'preview';
    globalThis.fetch = async () => {
      calls++;
      return response({ ...envelope(), now: Date.now() });
    };
    await handler(
      { method: 'GET', url: '/api/aircraft' } as IncomingMessage,
      res as unknown as ServerResponse,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(body).aircraft.length, 1);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.equal(headers['Vercel-CDN-Cache-Control'], 'max-age=10');
    assert.doesNotMatch(body, /latitude|longitude|rawDescription|opendata/);
    await handler(
      { method: 'GET', url: '/api/aircraft' } as IncomingMessage,
      res as unknown as ServerResponse,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
});

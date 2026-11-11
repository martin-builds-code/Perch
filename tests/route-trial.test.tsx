import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  routeTrial,
  ROUTE_TRIAL_PROJECT,
  MAX_ROUTE_TRIAL_MS,
} from '../server/routeTrial';
import session from '../api/session';
import { derivePin } from '../server/auth';
import { fetchHexdb, EnrichmentError } from '../server/hexdb';
import { createEnrichmentService } from '../server/enrichmentService';
import { createEnricher } from '../src/enrichment';
import {
  createRouteDiagnostics,
  ROUTE_STATES,
} from '../src/routeDiagnostics';
import { parseEnrichmentDiagnostic } from '../src/routeTraceTypes';
import type {
  ProviderTrace,
  EnrichmentDiagnostic,
} from '../src/routeTraceTypes';
import type { Snapshot } from '../src/liveTypes';
import { fleet } from '../src/simulation';
import type { Scene } from '../src/simulation';
const T = Date.parse('2026-11-11T10:00:00Z');
const config = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_TARGET_ENV: 'preview',
  VERCEL_PROJECT_ID: ROUTE_TRIAL_PROJECT,
  AERO_ROUTE_DIAGNOSTICS: JSON.stringify({
    enabled: true,
    startedAtMs: T,
    expiresAtMs: T + 3600000,
  }),
};
const airport = (code: string) => ({
  code,
  name: code,
  iata: code,
  icao: null,
});
const fields = {
  origin: { icao: 'EGCC', iata: 'MAN', name: 'Manchester' },
  destination: { icao: 'EHAM', iata: 'AMS', name: 'Amsterdam' },
};
const main = {
  ...fleet[0],
  id: 'abcdef',
  callsign: 'TEST1',
  operator: null,
  registration: 'NATIVE',
  origin: null,
  destination: null,
};
const scene: Scene = {
  id: 'live',
  label: 'Synthetic',
  state: 'available',
  duration: 0,
  primary: main,
  secondary: [],
};
const settle = () => new Promise<void>((r) => setImmediate(r));

test('trial lease requires platform Preview, exact isolated project, explicit flag, valid window and at most 48h', () => {
  assert.deepEqual(routeTrial(config, T), { expiresAtMs: T + 3600000 });
  for (const bad of [
    { ...config, VERCEL_ENV: 'production' },
    { ...config, VERCEL_PROJECT_ID: 'prj_other' },
    { ...config, VERCEL_PROJECT_ID: 'prj_Esh3e64v7aYtnf0vP7i5gzcipDnO' },
    { ...config, VERCEL_ENV: 'development' },
    { ...config, VERCEL: '0' },
    { ...config, VERCEL_TARGET_ENV: 'production' },
    { ...config, AERO_ROUTE_DIAGNOSTICS: 'true' },
    { ...config, AERO_ROUTE_DIAGNOSTICS: '{}' },
    { ...config, AERO_ROUTE_DIAGNOSTICS: '{bad' },
    {
      ...config,
      AERO_ROUTE_DIAGNOSTICS: JSON.stringify({
        enabled: false,
        startedAtMs: T,
        expiresAtMs: T + 1,
      }),
    },
    {
      ...config,
      AERO_ROUTE_DIAGNOSTICS: JSON.stringify({
        enabled: true,
        startedAtMs: T,
        expiresAtMs: T + MAX_ROUTE_TRIAL_MS + 1,
      }),
    },
  ])
    assert.equal(routeTrial(bad, T), null);
  assert.equal(routeTrial(config, T - 1), null);
  assert.equal(routeTrial(config, T + 3600000), null);
  assert.equal(
    routeTrial(
      {
        ...config,
        AERO_ROUTE_DIAGNOSTICS: JSON.stringify({
          enabled: true,
          startedAtMs: T,
          expiresAtMs: T + MAX_ROUTE_TRIAL_MS,
        }),
      },
      T + 1,
    )?.expiresAtMs,
    T + MAX_ROUTE_TRIAL_MS,
  );
});

test('real HTTP auth: bypass mints no cookie and cannot disable Production/other project/expired authentication', async () => {
  const keys = Object.keys(config).concat([
    'AERO_SESSION_SECRET',
    'AERO_PIN_PEPPER',
    'AERO_PIN_VERIFIER',
  ]);
  const previous = keys.map((k) => process.env[k]);
  const now = Date.now();
  Object.assign(process.env, config, {
    AERO_ROUTE_DIAGNOSTICS: JSON.stringify({
      enabled: true,
      startedAtMs: now - 1000,
      expiresAtMs: now + 60000,
    }),
    AERO_SESSION_SECRET: 's'.repeat(64),
    AERO_PIN_PEPPER: 'p'.repeat(64),
    AERO_PIN_VERIFIER: derivePin('00123456', 'p'.repeat(64)),
  });
  const server = createServer((req, res) => {
    void session(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw Error('address');
  const url = 'http://127.0.0.1:' + addr.port + '/api/session';
  try {
    const allowed = await fetch(url);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('set-cookie'), null);
    const body = await allowed.json();
    assert.ok(body.routeDiagnosticTrial.expiresAtMs);
    assert.doesNotMatch(
      JSON.stringify(body),
      /secret|pepper|verifier|latitude|longitude/,
    );
    process.env.VERCEL_ENV = 'production';
    assert.equal((await fetch(url)).status, 401);
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_PROJECT_ID = 'prj_other';
    assert.equal((await fetch(url)).status, 401);
    process.env.VERCEL_PROJECT_ID = ROUTE_TRIAL_PROJECT;
    process.env.AERO_ROUTE_DIAGNOSTICS = JSON.stringify({
      enabled: true,
      startedAtMs: now - 2000,
      expiresAtMs: now - 1,
    });
    assert.equal((await fetch(url)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});

for (const [name, body, status, outcome, reason] of [
  [
    'complete',
    { callsign: 'TEST1', ...fields, updated_at: null },
    200,
    'complete',
    'validated',
  ],
  [
    'partial',
    { callsign: 'TEST1', origin: fields.origin, destination: null },
    200,
    'partial',
    'validated',
  ],
  ['missing', {}, 404, 'negative', 'http-404'],
  [
    'old',
    { callsign: 'TEST1', ...fields, updated_at: '2014-04-20T11:02:19Z' },
    200,
    'rejected',
    'route-too-old',
  ],
  [
    'mismatch',
    { callsign: 'OTHER', ...fields },
    200,
    'rejected',
    'contradictory-route',
  ],
  [
    'ICAO only',
    {
      callsign: 'TEST1',
      origin: { icao: 'EGCC' },
      destination: { icao: 'EHAM' },
    },
    200,
    'complete',
    'icao-only-pair',
  ],
  ['invalid JSON', '{', 200, 'rejected', 'invalid-json'],
  ['rate limited', {}, 429, 'error', 'rate-limited'],
] as const)
  test('real adapter diagnostic classification: ' + name, async () => {
    let trace: ProviderTrace | undefined,
      calls = 0;
    try {
      await fetchHexdb(
        'route',
        'abcdef',
        'TEST1',
        async (url) => {
          calls++;
          assert.equal(
            String(url),
            'https://hexdb.io/api/v2/routes/TEST1',
          );
          return new Response(
            typeof body === 'string' ? body : JSON.stringify(body),
            { status, headers: { 'Retry-After': '600' } },
          );
        },
        () => T,
        100,
        (t) => {
          trace = t;
        },
      );
    } catch (e) {
      assert.ok(e instanceof EnrichmentError);
      assert.equal(e.trace?.requestStarted, true);
    }
    assert.equal(calls, 1);
    assert.equal(trace?.outcome, outcome);
    assert.equal(trace?.reason, reason);
    assert.equal(trace?.httpStatus, status);
    assert.doesNotMatch(
      JSON.stringify(trace),
      /latitude|longitude|TEST1|abcdef|https:/,
    );
  });

test('server cache trace counts one provider call, and local conflicts make none', async () => {
  let now = T,
    calls = 0;
  const s = createEnrichmentService(
    async (_kind, _hex, _call, record) => {
      calls++;
      record?.({
        outcome: 'complete',
        reason: 'validated',
        httpStatus: 200,
        requestStarted: true,
        endpoint: 'v2/routes/:callsign',
      });
      return { origin: airport('MAN'), destination: airport('AMS') };
    },
    () => now,
  );
  const first = await s.get('route', 'abcdef', 'TEST1', true);
  assert.equal(first.cache, 'miss');
  assert.equal(first.result.providerTrace?.outcome, 'complete');
  const cached = await s.get('route', 'abcdef', 'TEST1', true);
  assert.equal(cached.cache, 'hit');
  assert.equal(calls, 1);
  now += 29999;
  await assert.rejects(
    s.get('route', '111111', 'TEST2', true),
    (e: unknown) =>
      e instanceof EnrichmentError &&
      e.code === 'cooldown' &&
      e.origin === 'application' &&
      !e.trace,
  );
  assert.equal(calls, 1);
});

test('legacy unverified cooldown payload retains conservative backoff; R01 typed-contract recovery is tested separately', async () => {
  let wall = T,
    elapsed = 0,
    serverNow = T + 100,
    calls = 0;
  const events: unknown[] = [];
  const s = createEnrichmentService(
    async () => ({ origin: airport('MAN'), destination: airport('AMS') }),
    () => serverNow,
  );
  const client = createEnricher(() => {}, {
    now: () => wall,
    monotonicNow: () => elapsed,
    active: () => true,
    observe: (e) => events.push(e),
    setTimer: (f, ms) => setTimeout(f, ms),
    clearTimer: clearTimeout,
    fetch: async (url) => {
      calls++;
      const q = new URL(String(url), 'https://test.invalid').searchParams;
      try {
        const r = await s.get(
          q.get('kind') as 'route' | 'aircraft',
          q.get('hex')!,
          q.get('callsign'),
        );
        wall = serverNow + 100;
        return new Response(JSON.stringify(r.result));
      } catch (e) {
        assert.ok(e instanceof EnrichmentError);
        return new Response(
          JSON.stringify({
            error: e.code,
            diagnostic: {
              origin: 'application',
              serverCache: 'none',
              upstreamRequestsStarted: 0,
              upstreamResponses: 0,
              outcome: 'error',
              reason: e.code,
              httpStatus: null,
              retryAfterMs: e.retryAfterMs,
              durationMs: 0,
            },
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(e.retryAfterMs / 1000),
            },
          },
        );
      }
    },
  });
  try {
    client.update(scene);
    await settle();
    assert.equal(calls, 1);
    elapsed = 30000;
    wall = T + 30100;
    serverNow = T + 30050;
    client.update(scene);
    await settle();
    assert.equal(calls, 2);
    for (elapsed = 60000; elapsed < 330000; elapsed += 15000) {
      wall = T + elapsed + 100;
      serverNow = wall;
      client.update(scene);
    }
    assert.equal(calls, 2, 'five-minute suppression reproduced');
    const failed = events.find(
      (e) =>
        !!e &&
        typeof e === 'object' &&
        (e as { type?: string }).type === 'response' &&
        (e as { ok?: boolean }).ok === false,
    ) as { clientCooldownMs: number; diagnostic: EnrichmentDiagnostic };
    assert.equal(failed.clientCooldownMs, 300000);
    assert.equal(failed.diagnostic.origin, 'application');
    assert.equal(failed.diagnostic.upstreamRequestsStarted, 0);
  } finally {
    client.stop();
  }
});

test('route collector separates outcomes, publications, delays, roles and expiry without exporting identifiers', () => {
  const d = createRouteDiagnostics(T, T + 600000);
  const result = {
    kind: 'route' as const,
    hex: 'abcdef',
    callsign: 'TEST1',
    source: 'hexdb.io' as const,
    status: 'found' as const,
    data: { origin: airport('MAN'), destination: airport('AMS') },
    fetchedAtMs: T + 1000,
    expiresAtMs: T + 301000,
  };
  const state = (atMs: number, s = scene, r?: typeof result) => ({
    type: 'scene' as const,
    atMs,
    scene: s,
    globalWaitMs: 0,
    secondaryWaitMs: 0,
    active: true,
    pending: null,
    primaryEligible: true,
    routes: [{ key: 'abcdef:TEST1', result: r }],
  });
  d.observe(state(T));
  d.observe({
    type: 'attempt',
    atMs: T + 500,
    lookup: {
      kind: 'route',
      hex: 'abcdef',
      callsign: 'TEST1',
      secondary: false,
    },
  });
  d.observe({
    type: 'response',
    atMs: T + 1000,
    lookup: {
      kind: 'route',
      hex: 'abcdef',
      callsign: 'TEST1',
      secondary: false,
    },
    ok: true,
    apiStatus: 200,
    durationMs: 500,
    clientCooldownMs: 0,
    diagnostic: {
      origin: 'hexdb',
      serverCache: 'miss',
      upstreamRequestsStarted: 1,
      upstreamResponses: 1,
      outcome: 'complete',
      reason: 'validated',
      httpStatus: 200,
      durationMs: 500,
    },
  });
  d.observe(
    state(
      T + 1001,
      { ...scene, primary: { ...main, ...result.data } },
      result,
    ),
  );
  const s = d.summary(T + 2000);
  assert.equal(s.counters.hexdbRequestsStarted, 1);
  assert.equal(s.counters.routeCompleteResponses, 1);
  assert.equal(s.firstDetectionToLookup.medianMs, 500);
  assert.equal(s.firstDetectionToUsableRoute.medianMs, 1001);
  assert.equal(s.responseToScenePublication.maxMs, 1);
  assert.equal(s.current[0].state, ROUTE_STATES.found);
  assert.equal(s.current[0].primaryWithoutRouteMs, 1001);
  assert.doesNotMatch(
    JSON.stringify(s),
    /abcdef|TEST1|latitude|longitude|registration|cookie/,
  );
  const before = s.exposure.primaryMs;
  d.context(false, T + 2000);
  d.context(true, T + 5000);
  assert.equal(d.summary(T + 5000).exposure.primaryMs, before);
  d.stop(T + 5000);
  d.observe(state(T + 6000));
  assert.equal(d.summary(T + 7000).counters.hexdbRequestsStarted, 1);
});

test('diagnostics distinguish negative, rejection, ICAO-only presentation and no request; bounded summary copies and expiry', () => {
  const d = createRouteDiagnostics(T, T + 10000);
  const base = {
    type: 'scene' as const,
    atMs: T,
    scene,
    globalWaitMs: 9000,
    secondaryWaitMs: 9000,
    active: true,
    pending: null,
    primaryEligible: true,
    routes: [],
  };
  d.observe(base);
  assert.equal(d.summary(T).current[0].state, ROUTE_STATES.waiting);
  const diag: EnrichmentDiagnostic = {
    origin: 'hexdb',
    serverCache: 'miss',
    upstreamRequestsStarted: 1,
    upstreamResponses: 1,
    outcome: 'rejected',
    reason: 'route-too-old',
    httpStatus: 200,
    durationMs: 1,
  };
  const r = {
    kind: 'route' as const,
    hex: 'abcdef',
    callsign: 'TEST1',
    source: 'hexdb.io' as const,
    status: 'not-found' as const,
    data: {},
    fetchedAtMs: T,
    expiresAtMs: T + 300000,
    diagnostic: diag,
  };
  d.observe({
    ...base,
    atMs: T + 1000,
    routes: [{ key: 'abcdef:TEST1', result: r }],
  });
  assert.equal(
    d.summary(T + 1000).current[0].state,
    ROUTE_STATES.rejected,
  );
  d.observe({
    ...base,
    atMs: T + 2000,
    scene: {
      ...scene,
      primary: {
        ...main,
        origin: { code: 'EGCC', name: 'Manchester', iata: null },
        destination: { code: 'EHAM', name: 'Amsterdam', iata: null },
      },
    },
  });
  assert.equal(
    d.summary(T + 2000).routesAvailableInternallyNotDisplayed,
    1,
  );
  assert.equal(d.summary(T + 10000).finished, true);
  const copy = d.summary(T + 10000);
  copy.counters.test = 1;
  assert.equal(d.summary(T + 10000).counters.test, undefined);
  assert.equal(
    parseEnrichmentDiagnostic({
      ...diag,
      reason: 'https://secret.invalid',
    }),
    undefined,
  );
  assert.equal(
    parseEnrichmentDiagnostic({ ...diag, hiddenSecret: 'never-export' })
      ?.reason,
    'route-too-old',
  );
});

test('snapshot accounting includes aircraft not selected for a displayed card', () => {
  const d = createRouteDiagnostics(T, T + 60000);
  d.snapshot(
    {
      aircraft: [
        { id: 'abcdef', callsign: 'TEST1' },
        { id: '111111', callsign: null },
      ],
    } as Snapshot,
    T,
  );
  const s = d.summary(T);
  assert.equal(s.distinctAircraft, 2);
  assert.equal(s.aircraftWithValidCallsigns, 1);
  assert.equal(s.distinctDisplayedFlights, 0);
});

test('a throwing diagnostic observer cannot alter lookup ordering, concurrency or request limits', async () => {
  let elapsed = 0,
    calls = 0;
  const client = createEnricher(() => {}, {
    now: () => T + elapsed,
    monotonicNow: () => elapsed,
    active: () => true,
    observe: () => {
      throw Error('diagnostic-only failure');
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: clearTimeout,
    fetch: async (url) => {
      calls++;
      const q = new URL(String(url), 'https://test.invalid').searchParams;
      const kind = q.get('kind');
      return new Response(
        JSON.stringify({
          kind,
          hex: q.get('hex'),
          callsign: q.get('callsign'),
          source: 'hexdb.io',
          status: 'not-found',
          data: {},
          fetchedAtMs: T + elapsed,
          expiresAtMs: T + elapsed + 300000,
        }),
      );
    },
  });
  try {
    client.update(scene);
    await settle();
    for (let i = 1; i < 30; i++) {
      elapsed = i * 1000;
      client.update(scene);
    }
    assert.equal(calls, 1);
    elapsed = 30000;
    client.update(scene);
    await settle();
    assert.equal(calls, 2);
  } finally {
    client.stop();
  }
});

test('route evidence rings, flight maps and duration are bounded; exported copies cannot mutate retained response evidence', () => {
  const d = createRouteDiagnostics(T, T + 48 * 3600000);
  for (let i = 0; i < 4100; i++)
    d.observe({
      type: 'scene',
      atMs: T + i,
      scene: {
        ...scene,
        primary: {
          ...main,
          id: i.toString(16).padStart(6, '0'),
          callsign: 'TST' + i,
        },
      },
      globalWaitMs: 30000,
      secondaryWaitMs: 90000,
      active: true,
      pending: null,
      primaryEligible: true,
      routes: [],
    });
  const lookup = {
    kind: 'route' as const,
    hex: '000001',
    callsign: 'TST1',
    secondary: false,
  };
  for (let i = 0; i < 1100; i++)
    d.observe({
      type: 'response',
      atMs: T + 5000 + i,
      lookup,
      ok: false,
      apiStatus: 503,
      durationMs: 1,
      error: 'cooldown',
      clientCooldownMs: 300000,
    });
  const s = d.summary(T + 10000);
  assert.equal(s.flights.length, 4096);
  assert.equal(s.events.length, 1024);
  assert.equal(s.truncated, true);
  assert.equal(s.expiresAtMs, T + 18 * 3600000);
  const row = s.flights.find((r) => r.response)!;
  row.response!.error = 'changed';
  s.events[0].error = 'changed';
  assert.equal(
    d.summary(T + 10000).flights.find((r) => r.response)!.response!.error,
    'cooldown',
  );
  assert.equal(d.summary(T + 10000).events[0].error, 'cooldown');
  assert.equal(d.summary(T + 18 * 3600000).finished, true);
});

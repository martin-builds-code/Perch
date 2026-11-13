import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCoordinator } from '../server/adaptiveCoordinator';
import {
  initialAdaptiveState,
  ADAPTIVE_POLICY as A,
} from '../src/adaptiveBudget';
import type { CoordinatorRead } from '../server/adaptiveCoordinator';
import type { EnrichmentResult } from '../src/enrichmentTypes';
const T = 1_800_000_000_000;
const env = {
  AERO_R05_COORDINATOR_URL: 'https://jjtkwqscfukioutgnxgc.supabase.co',
  AERO_R05_COORDINATOR_API_KEY: 'test-publishable',
  AERO_R05_COORDINATOR_SECRET: 'a'.repeat(64),
};
const snapshot = (): CoordinatorRead => ({
  revision: 1,
  state: initialAdaptiveState(T),
  nowMs: T,
  cache: null,
});
const result: EnrichmentResult = {
  kind: 'route',
  hex: 'abcdef',
  callsign: 'EIN17A',
  source: 'hexdb.io',
  status: 'found',
  data: {
    origin: { code: 'MAN', name: 'Manchester', iata: 'MAN', icao: 'EGCC' },
    destination: {
      code: 'AMS',
      name: 'Amsterdam',
      iata: 'AMS',
      icao: 'EHAM',
    },
    associationTimeMs: T - 266 * 86400000,
  },
  fetchedAtMs: T,
  expiresAtMs: T + 300000,
};
test('RPC uses one pinned dedicated store/scope; cached aircraft data is authenticated encryption at rest', async () => {
  let saved: Record<string, unknown> | undefined;
  const coordinator = createCoordinator(env, async (url, init) => {
    assert.equal(
      String(url),
      env.AERO_R05_COORDINATOR_URL + '/rest/v1/rpc/perch_r05_exchange',
    );
    assert.equal(init!.redirect, 'error');
    assert.equal(init!.method, 'POST');
    const body = JSON.parse(String(init!.body));
    assert.equal(body.p_scope, 'live');
    assert.equal(body.p_secret, env.AERO_R05_COORDINATOR_SECRET);
    if (body.p_state) saved = body;
    return Response.json({ ok: true, ...snapshot() });
  });
  const key = coordinator.key('route:abcdef:EIN17A');
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(!key.includes('EIN17A'));
  const before = await coordinator.read(key);
  assert.equal(
    await coordinator.swap(key, before, before.state, result),
    true,
  );
  assert.equal(saved!.p_expected, 1);
  const payload = String(saved!.p_payload);
  for (const plain of ['EIN17A', 'abcdef', 'Manchester', 'Amsterdam'])
    assert.ok(!payload.includes(plain));
  const row = {
    ...snapshot(),
    cache: { payload, expiresAtMs: T + 300000 },
  };
  assert.deepEqual(coordinator.cacheValue(row), result);
  const damaged = Buffer.from(payload, 'base64');
  damaged[15] ^= 1;
  assert.equal(
    coordinator.cacheValue({
      ...row,
      cache: { ...row.cache, payload: damaged.toString('base64') },
    }),
    null,
  );
  assert.equal(
    coordinator.cacheValue({ ...row, nowMs: T + 300000 }),
    null,
  );
});
test('compare-and-swap conflict is not mistaken for successful admission', async () => {
  const c = createCoordinator(env, async () =>
    Response.json({ ok: false, conflict: true }),
  );
  assert.equal(
    await c.swap(c.key('test'), snapshot(), snapshot().state),
    false,
  );
  await assert.rejects(c.read(c.key('test')));
});
test('coordinator rejects malformed clocks, state, config drift, HTTP errors and oversized bodies', async () => {
  for (const body of [
    { ok: true, ...snapshot(), revision: '1' },
    { ok: true, ...snapshot(), nowMs: T - 1 },
    { ok: true, ...snapshot(), state: { ...snapshot().state, tokens: 4 } },
    {
      ok: true,
      ...snapshot(),
      state: { ...snapshot().state, dailyLimit: 1000 },
    },
  ]) {
    const c = createCoordinator(env, async () => Response.json(body));
    await assert.rejects(c.read(c.key('test')));
  }
  for (const response of [
    new Response('', { status: 503 }),
    new Response('{broken'),
    new Response('x'.repeat(131073)),
  ]) {
    const c = createCoordinator(env, async () => response);
    await assert.rejects(c.read(c.key('test')));
  }
  assert.throws(() =>
    createCoordinator({ ...env, AERO_R05_DAILY_LIMIT: '0' }),
  );
  assert.throws(() =>
    createCoordinator({
      ...env,
      AERO_R05_COORDINATOR_URL: 'https://other.supabase.co',
    }),
  );
});
test('streamed coordinator overflow is bounded even without Content-Length', async () => {
  let emitted = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      emitted++;
      controller.enqueue(new Uint8Array(8192));
    },
  });
  const c = createCoordinator(env, async () => new Response(stream));
  await assert.rejects(c.read(c.key('test')));
  assert.ok(
    emitted < 20,
    'the adapter does not buffer an unbounded upstream body',
  );
});
test('abandoned-owner recovery stays longer than the configured hard function runtime', () => {
  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  );
  const duration = config.functions['api/enrichment.ts'].maxDuration;
  assert.equal(duration, A.handlerSeconds);
  assert.equal(
    config.functions['api/r05-observe.ts'].maxDuration,
    A.handlerSeconds,
  );
  assert.ok(A.leaseMs > (duration * 1000 + A.dispatchValidityMs) * 5);
});

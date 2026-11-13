import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  ADAPTIVE_POLICY as A,
  initialAdaptiveState,
  advanceAdaptiveState,
  adaptiveEligibility,
  adaptiveView,
  reserveAdaptive,
  finishAdaptive,
  parseAdaptiveView,
} from '../src/adaptiveBudget';
import {
  createAdaptiveEnrichmentService,
  AdaptiveDeferral,
} from '../server/adaptiveEnrichmentService';
import type { Coordinator } from '../server/adaptiveCoordinator';
import {
  adaptiveEnabled,
  createCoordinator,
  R05_BRANCH,
  R05_PROJECT,
} from '../server/adaptiveCoordinator';
import { EnrichmentError, fetchHexdb } from '../server/hexdb';
import { verifiedAdaptiveDeferral } from '../src/adaptiveFailure';
import type { EnrichmentResult } from '../src/enrichmentTypes';
import type { ProviderTrace } from '../src/routeTraceTypes';
const T = 1_800_000_000_000;
const key = createHash('sha256').update('test').digest('hex');
const pair = {
  origin: { code: 'MAN', name: 'Manchester', iata: 'MAN', icao: 'EGCC' },
  destination: {
    code: 'AMS',
    name: 'Amsterdam',
    iata: 'AMS',
    icao: 'EHAM',
  },
  associationTimeMs: T - 266 * 86400000,
};
function harness() {
  let time = T,
    revision = 0,
    state = initialAdaptiveState(T),
    available = true;
  const cache = new Map<string, EnrichmentResult>();
  const store: Coordinator = {
    key: (v) => createHash('sha256').update(v).digest('hex'),
    read: async (k) => {
      if (!available) throw Error('offline');
      return {
        revision,
        state: structuredClone(state),
        nowMs: time,
        cache: cache.has(k)
          ? {
              payload: JSON.stringify(cache.get(k)),
              expiresAtMs: cache.get(k)!.expiresAtMs,
            }
          : null,
      };
    },
    swap: async (k, before, next, result) => {
      if (!available) throw Error('offline');
      if (before.revision !== revision) return false;
      state = structuredClone(next);
      revision++;
      if (result) cache.set(k, result);
      return true;
    },
    cacheValue: (r) =>
      r.cache ? (JSON.parse(r.cache.payload) as EnrichmentResult) : null,
  };
  return {
    store,
    cache,
    now: () => time,
    set: (t: number) => {
      time = t;
    },
    state: () => state,
    setState: (s: typeof state) => {
      state = s;
      revision++;
    },
    available: (v: boolean) => {
      available = v;
    },
    service: (
      load: Parameters<typeof createAdaptiveEnrichmentService>[1],
    ) =>
      createAdaptiveEnrichmentService(
        () => store,
        load,
        () => time,
        () => time,
      ),
  };
}
const trace: ProviderTrace = {
  outcome: 'complete',
  reason: 'validated',
  httpStatus: 200,
  requestStarted: true,
  endpoint: 'v2/routes/:callsign',
};
test('sub-millisecond token deficits at epoch-scale clocks cannot produce debt', () => {
  const s = initialAdaptiveState(T);
  s.tokens = 1 - Number.EPSILON;
  assert.equal(adaptiveEligibility(s).waitMs, 1);
  assert.throws(() => reserveAdaptive(s, randomUUID(), key));
  const ready = advanceAdaptiveState(s, T + 1);
  assert.ok(reserveAdaptive(ready, randomUUID(), key).tokens >= 0);
});
test('R05 three stored tokens, continuous refill, ten-second spacing and separate rolling log', () => {
  let s = initialAdaptiveState(T);
  const starts: number[] = [];
  for (let i = 0; i < 250; i++) {
    const at = adaptiveEligibility(s).atMs;
    s = advanceAdaptiveState(s, at);
    starts.push(at);
    const id = randomUUID();
    s = reserveAdaptive(s, id, key);
    assert.equal(adaptiveView(s).inFlight, true);
    assert.throws(() => reserveAdaptive(s, randomUUID(), key));
    s = finishAdaptive(advanceAdaptiveState(s, at + 1), id);
  }
  assert.equal(starts[0], T);
  assert.equal(starts[1] - T, 10001);
  assert.equal(starts[2] - T, 20002);
  for (let i = 0; i < starts.length; i++) {
    assert.ok(
      starts.filter((t) => t > starts[i] - A.windowMs && t <= starts[i])
        .length <= 10,
    );
    if (i) assert.ok(starts[i] - starts[i - 1] >= 10000);
  }
  assert.equal(
    advanceAdaptiveState(s, s.updatedAtMs + 10_000_000).tokens,
    3,
  );
});
test('token refill alone cannot bypass the exact rolling five-minute ceiling', () => {
  const s = initialAdaptiveState(T);
  s.charges = Array.from({ length: 10 }, (_, i) => T - 290000 + i);
  assert.equal(s.tokens, 3);
  assert.equal(adaptiveEligibility(s).reason, 'rolling-five');
  assert.equal(adaptiveEligibility(s).atMs, T + 10000);
  const after = advanceAdaptiveState(s, T + 10000);
  assert.equal(
    after.charges.filter((t) => t > after.updatedAtMs - A.windowMs).length,
    9,
  );
  assert.doesNotThrow(() => reserveAdaptive(after, randomUUID(), key));
});
test('marginal jobs preserve one token while a protected primary can use it', () => {
  const s = initialAdaptiveState(T);
  s.tokens = 1;
  assert.equal(adaptiveEligibility(s).waitMs, 0);
  assert.equal(adaptiveEligibility(s, true).waitMs, 30000);
  assert.equal(adaptiveEligibility(s, true).reason, 'reserved-capacity');
});
test('a paused reservation never expires from counts before safe abandoned-owner recovery', () => {
  const id = randomUUID();
  let s = reserveAdaptive(initialAdaptiveState(T), id, key);
  s = advanceAdaptiveState(s, T + 119999);
  assert.ok(s.pending);
  assert.equal(adaptiveView(s).rollingFive, 1);
  s = advanceAdaptiveState(s, T + 120000);
  assert.equal(s.pending, null);
  assert.equal(s.recoveries, 1);
  assert.equal(adaptiveEligibility(s).waitMs, 300000);
  assert.throws(() => finishAdaptive(s, id));
  assert.equal(s.charges.length, 1, 'uncertain request never refunded');
});
test('future, malformed and backwards coordinator clocks fail closed', () => {
  const s = initialAdaptiveState(T);
  for (const t of [NaN, Infinity, T - 1])
    assert.throws(() => advanceAdaptiveState(s, t));
  for (const bad of [
    null,
    {},
    { ...s, tokens: 4 },
    { ...s, tokens: -1 },
    { ...s, dailyLimit: 0 },
    { ...s, charges: [T, T - 1] },
  ])
    assert.throws(() => advanceAdaptiveState(bad, T));
});
test('rolling 24h default guard permits observed continuous usage but stops runaway demand', () => {
  assert.equal(A.dailyLimit, 2000);
  assert.ok(A.dailyLimit > 51 * 24);
  let s = initialAdaptiveState(T);
  for (let i = 0; i < 2000; i++) {
    const at = adaptiveEligibility(s).atMs;
    s = advanceAdaptiveState(s, at);
    const id = randomUUID();
    s = reserveAdaptive(s, id, key);
    s = finishAdaptive(advanceAdaptiveState(s, at + 1), id);
  }
  assert.ok(s.updatedAtMs < T + A.dayMs);
  assert.equal(adaptiveEligibility(s).reason, 'rolling-day');
  assert.equal(adaptiveEligibility(s).atMs, T + 1 + A.dayMs);
});
test('only the exact R05 Preview can opt into the shared path', () => {
  const e = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_PROJECT_ID: R05_PROJECT,
    VERCEL_GIT_COMMIT_REF: R05_BRANCH,
    AERO_R05_ENABLED: 'true',
  };
  assert.equal(adaptiveEnabled(e), true);
  for (const change of [
    { VERCEL_ENV: 'production' },
    { VERCEL_PROJECT_ID: 'another' },
    { VERCEL_TARGET_ENV: 'production' },
    { VERCEL_GIT_COMMIT_REF: 'stage-3a-display-redesign' },
    { AERO_R05_ENABLED: 'false' },
    { VERCEL: '0' },
  ])
    assert.equal(adaptiveEnabled({ ...e, ...change }), false);
  assert.throws(() => createCoordinator({}));
});
test('simultaneous viewers/instances admit exactly one provider request and coalesce via cache', async () => {
  const h = harness();
  let calls = 0,
    release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const services = Array.from({ length: 20 }, () =>
    h.service(async (_k, _h, _c, observe) => {
      calls++;
      observe(trace);
      await gate;
      return pair;
    }),
  );
  const tasks = services.map((s) =>
    s.get('route', 'abcdef', 'EIN17A').then(
      (v) => ({ value: v }),
      (error) => ({ error }),
    ),
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  release();
  const results = await Promise.all(tasks);
  assert.equal(results.filter((r) => 'value' in r).length, 1);
  assert.ok(
    results
      .filter((r) => 'error' in r)
      .every(
        (r) => (r as { error: unknown }).error instanceof AdaptiveDeferral,
      ),
  );
  const cached = await services[1].get('route', 'abcdef', 'EIN17A');
  assert.equal(cached.cache, 'hit');
  assert.equal(calls, 1);
  assert.equal(h.state().charges.length, 1);
});
test('all lookup types share the same capacity and cache correctness follows exact callsign', async () => {
  const h = harness();
  let calls = 0;
  const s = h.service(async (kind, _hex, _flight, observe) => {
    calls++;
    observe(trace);
    return kind === 'route' ? pair : { operator: 'Test Air' };
  });
  const first = await s.get('route', 'abcdef', 'EIN17A');
  assert.equal(
    first.result.data.associationTimeMs,
    pair.associationTimeMs,
  );
  await assert.rejects(
    s.get('aircraft', '123456', null),
    AdaptiveDeferral,
  );
  const cached = await s.get('route', 'abcdef', ' ein17a ');
  assert.equal(cached.cache, 'hit');
  assert.equal(calls, 1);
  h.set(T + 10000);
  await s.get('aircraft', 'abcdef', null);
  assert.equal(calls, 2);
  h.set(T + 20000);
  await s.get('route', 'abcdef', 'EIN18B');
  assert.equal(calls, 3);
  assert.notEqual(
    h.store.key('route:abcdef:EIN17A'),
    h.store.key('route:abcdef:EIN18B'),
  );
});
test('genuine misses retain five-minute negative TTL and never poison other flights', async () => {
  const h = harness();
  let calls = 0;
  const s = h.service(async () => {
    calls++;
    return null;
  });
  const first = await s.get('route', 'abcdef', 'EIN17A');
  assert.equal(first.result.status, 'not-found');
  assert.equal(
    first.result.expiresAtMs - first.result.fetchedAtMs,
    300000,
  );
  h.set(T + 299999);
  assert.equal((await s.get('route', 'abcdef', 'EIN17A')).cache, 'hit');
  assert.equal(calls, 1);
  h.set(T + 300000);
  await s.get('route', 'abcdef', 'EIN17A');
  assert.equal(calls, 2);
});
test('identity TTL remains thirty minutes and valid cached data is served during exhausted budgets', async () => {
  const h = harness();
  const s = h.service(async () => ({ operator: 'Test Air' }));
  const first = await s.get('aircraft', 'abcdef', null);
  assert.equal(
    first.result.expiresAtMs - first.result.fetchedAtMs,
    1800000,
  );
  const full = advanceAdaptiveState(h.state(), T + 10000);
  full.tokens = 0;
  full.charges = Array.from({ length: 10 }, () => T);
  h.setState(full);
  h.set(T + 10000);
  assert.equal((await s.get('aircraft', 'abcdef', null)).cache, 'hit');
});
test('coordinator failure never falls back to an instance-local provider call', async () => {
  const h = harness();
  let calls = 0;
  h.available(false);
  const s = h.service(async () => {
    calls++;
    return pair;
  });
  await assert.rejects(
    s.get('route', 'abcdef', 'EIN17A'),
    (e) =>
      e instanceof AdaptiveDeferral &&
      e.reason === 'coordination-unavailable',
  );
  assert.equal(calls, 0);
});
test('lost reservation acknowledgement remains charged, does not start upstream and recovers conservatively', async () => {
  const h = harness();
  let calls = 0;
  const swap = h.store.swap;
  h.store.swap = async (...args) => {
    await swap(...args);
    throw Error('lost acknowledgement');
  };
  const s = h.service(async () => {
    calls++;
    return pair;
  });
  await assert.rejects(
    s.get('route', 'abcdef', 'EIN17A'),
    AdaptiveDeferral,
  );
  assert.equal(calls, 0);
  assert.equal(h.state().charges.length, 1);
  h.store.swap = swap;
  h.set(T + A.leaseMs);
  await assert.rejects(
    s.get('route', 'abcdef', 'EIN17A'),
    (e) =>
      e instanceof AdaptiveDeferral && e.reason === 'provider-backoff',
  );
  assert.equal(h.state().recoveries, 1);
  assert.equal(calls, 0);
});
test('a late dispatch permit cannot initiate a provider request', async () => {
  const h = harness();
  let calls = 0,
    mono = 0;
  const s = createAdaptiveEnrichmentService(
    () => h.store,
    async () => {
      calls++;
      return pair;
    },
    () => {
      mono += 3500;
      return mono;
    },
    h.now,
  );
  await assert.rejects(
    s.get('route', 'abcdef', 'EIN17A'),
    AdaptiveDeferral,
  );
  assert.equal(calls, 0);
});
test('429 backoff escalates globally and longer Retry-After protection wins', async () => {
  const h = harness();
  const s = h.service(async () => {
    throw new EnrichmentError('rate-limited', 500000);
  });
  for (const expected of [500000, 900000, 3600000]) {
    const at = h.now();
    await assert.rejects(
      s.get('route', 'abcdef', 'EIN17A'),
      (e) => e instanceof EnrichmentError && e.retryAfterMs === expected,
    );
    assert.equal(h.state().cooldownUntilMs, at + expected);
    await assert.rejects(
      s.get('route', '123456', 'OTHER12'),
      AdaptiveDeferral,
    );
    h.set(at + expected);
  }
  assert.equal(h.state().charges.length, 3);
});
test('upstream numeric/date Retry-After and malformed responses retain genuine provider treatment', async () => {
  for (const value of ['1200', new Date(T + 1200000).toUTCString()]) {
    await assert.rejects(
      fetchHexdb(
        'route',
        'abcdef',
        'EIN17A',
        async () =>
          new Response('', {
            status: 429,
            headers: { 'retry-after': value },
          }),
        () => T,
      ),
      (e) =>
        e instanceof EnrichmentError &&
        e.code === 'rate-limited' &&
        e.retryAfterMs === 1200000,
    );
  }
  await assert.rejects(
    fetchHexdb(
      'route',
      'abcdef',
      'EIN17A',
      async () => new Response('{bad'),
      () => T,
    ),
    (e) => e instanceof EnrichmentError && e.code === 'invalid-json',
  );
});
test('a failed completion cannot report that zero upstream requests occurred', async () => {
  const h = harness();
  const s = h.service(async (_k, _h, _c, observe) => {
    observe(trace);
    h.available(false);
    return pair;
  });
  await assert.rejects(
    s.get('route', 'abcdef', 'EIN17A'),
    (e) =>
      e instanceof EnrichmentError &&
      !(e instanceof AdaptiveDeferral) &&
      e.trace?.requestStarted === true,
  );
});
test('strict R05 local-deferral contract shortens only verified local waits', () => {
  const s = initialAdaptiveState(T);
  s.nextStartMs = T + 10000;
  const body = {
    error: 'cooldown',
    failure: {
      schemaVersion: 2,
      origin: 'application',
      category: 'local-deferral',
      reason: 'spacing',
      retryAfterMs: 10000,
      issuedAtMs: T,
      upstreamRequestsStarted: 0,
      upstreamResponses: 0,
    },
    adaptiveBudget: adaptiveView(s),
  };
  const response = new Response('', {
    status: 503,
    headers: { 'content-type': 'application/json', 'retry-after': '10' },
  });
  assert.equal(verifiedAdaptiveDeferral(response, body)?.waitMs, 10000);
  for (const invalid of [
    { ...body, error: 'other' },
    { ...body, failure: { ...body.failure, origin: 'hexdb' } },
    { ...body, failure: { ...body.failure, upstreamRequestsStarted: 1 } },
    {
      ...body,
      adaptiveBudget: { ...body.adaptiveBudget, rollingFive: 11 },
    },
    { ...body, extra: true },
  ])
    assert.equal(verifiedAdaptiveDeferral(response, invalid), undefined);
  assert.equal(
    verifiedAdaptiveDeferral(new Response('', { status: 503 }), body),
    undefined,
  );
  assert.equal(
    parseAdaptiveView({ ...adaptiveView(s), dailyLimit: 0 }),
    undefined,
  );
});

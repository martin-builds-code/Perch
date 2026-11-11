import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnricher } from '../src/enrichment';
import type { EnrichmentEnvironment } from '../src/enrichment';
import {
  createEnrichmentService,
  LocalEnrichmentDeferral,
} from '../server/enrichmentService';
import { EnrichmentError, fetchHexdb } from '../server/hexdb';
import {
  verifiedLocalDeferral,
  parseEnrichmentFailure,
  readEnrichmentFailure,
} from '../src/enrichmentFailure';
import type { EnrichmentFailure } from '../src/enrichmentFailure';
import { ENRICHMENT_POLICY as P } from '../src/enrichmentTypes';
import { createRouteDiagnostics } from '../src/routeDiagnostics';
import type { EnrichmentEvent } from '../src/routeDiagnostics';
import { fleet } from '../src/simulation';
import type { Scene, Aircraft } from '../src/simulation';
const T = Date.parse('2026-11-11T12:00:00Z');
const airport = (code: string) => ({
  code,
  iata: code,
  icao: null,
  name: code,
});
const route = { origin: airport('MAN'), destination: airport('AMS') };
const plane = (id = 'abcdef', callsign = 'TEST1'): Aircraft => ({
  ...fleet[0],
  id,
  callsign,
  registration: 'SYNTHETIC',
  operator: 'Native operator',
  origin: null,
  destination: null,
});
const ready = { ...plane(), ...route };
const scene = (
  main: Aircraft | null = plane(),
  secondary: Aircraft[] = [],
): Scene => ({
  id: 'live',
  label: 'Fixture',
  duration: 0,
  state: 'available',
  primary: main,
  secondary,
});
const settle = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise<void>((r) => setImmediate(r));
};
function contract(
  reason = 'global-gate',
  retryAfterMs = 30000,
  issuedAtMs = T,
): EnrichmentFailure {
  return {
    schemaVersion: 1,
    origin: 'application',
    category: 'local-deferral',
    reason,
    retryAfterMs,
    issuedAtMs,
    upstreamRequestsStarted: 0,
    upstreamResponses: 0,
  };
}
function local(
  body: unknown = { error: 'cooldown', failure: contract() },
  retry = '30',
  status = 503,
  contentType = 'application/json',
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType, 'Retry-After': retry },
  });
}
interface Attempt {
  kind: 'aircraft' | 'route';
  hex: string;
  callsign: string | null;
  at: number;
}
function harness(
  t: { after: (fn: () => void) => void },
  load?: (a: Attempt, init?: RequestInit) => Promise<Response>,
) {
  let elapsed = 0,
    wall = T,
    active = true;
  const events: EnrichmentEvent[] = [],
    attempts: Attempt[] = [],
    published: Scene[] = [];
  const budget = { nextAllowed: 0, nextSecondaryAllowed: 0 };
  const timers: {
    timer: ReturnType<typeof setTimeout>;
    fn: () => void;
  }[] = [];
  const result = (a: Attempt, status: 'found' | 'not-found' = 'found') =>
    new Response(
      JSON.stringify({
        ...a,
        at: undefined,
        kind: a.kind,
        hex: a.hex,
        callsign: a.callsign,
        source: 'hexdb.io',
        status,
        data:
          status === 'not-found'
            ? {}
            : a.kind === 'route'
              ? route
              : { operator: 'Native operator', registration: 'SYNTHETIC' },
        fetchedAtMs: wall,
        expiresAtMs:
          wall +
          (status === 'not-found'
            ? P.negativeTtlMs
            : a.kind === 'route'
              ? P.routeTtlMs
              : P.identityTtlMs),
      }),
    );
  const env: EnrichmentEnvironment = {
    now: () => wall,
    monotonicNow: () => elapsed,
    active: () => active,
    budget,
    observe: (e) => events.push(e),
    fetch: async (url, init) => {
      const q = new URL(String(url), 'https://local.invalid').searchParams;
      const a: Attempt = {
        kind: q.get('kind') as Attempt['kind'],
        hex: q.get('hex')!,
        callsign: q.get('callsign'),
        at: elapsed,
      };
      attempts.push(a);
      return load ? load(a, init) : result(a);
    },
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      timers.push({ timer, fn });
      return timer;
    },
    clearTimer: clearTimeout,
  };
  const clients: ReturnType<typeof createEnricher>[] = [];
  const create = () => {
    const client = createEnricher((s) => published.push(s), env);
    clients.push(client);
    return client;
  };
  const client = create();
  t.after(() => {
    clients.forEach((c) => c.stop());
    timers.forEach((t) => clearTimeout(t.timer));
  });
  return {
    client,
    create,
    env,
    budget,
    events,
    attempts,
    published,
    timers,
    result,
    at: (ms: number) => {
      elapsed = ms;
      wall = T + ms;
    },
    wall: (ms: number) => {
      wall = ms;
    },
    active: (v: boolean) => {
      active = v;
    },
  };
}
const responseEvent = (events: EnrichmentEvent[]) =>
  events.find(
    (e): e is Extract<EnrichmentEvent, { type: 'response' }> =>
      e.type === 'response' && !e.ok,
  )!;

test('R01 original 50ms arrival variation: typed local deferral waits 30s and recovers at the next opportunity', async (t) => {
  let serverNow = T + 100,
    count = 0;
  const service = createEnrichmentService(
    async () => route,
    () => serverNow,
  );
  const h = harness(t, async (a) => {
    count++;
    try {
      const r = await service.get(a.kind, a.hex, a.callsign);
      h.wall(serverNow + 100);
      return new Response(JSON.stringify(r.result));
    } catch (e) {
      assert.ok(e instanceof LocalEnrichmentDeferral);
      return local(
        {
          error: e.code,
          failure: contract(e.reason, e.retryAfterMs, serverNow),
        },
        String(e.retryAfterMs / 1000),
      );
    }
  });
  h.client.update(scene());
  await settle();
  assert.equal(count, 1);
  h.at(30000);
  serverNow = T + 30050;
  h.client.update(scene(plane('111111', 'TEST2')));
  await settle();
  const e = responseEvent(h.events);
  assert.equal(e.scheduling?.treatment, 'local-deferral');
  assert.equal(e.clientCooldownMs, 30000);
  assert.equal(count, 2);
  h.at(59999);
  h.client.update(scene(plane('111111', 'TEST2')));
  await settle();
  assert.equal(count, 2);
  h.at(60000);
  serverNow = T + 60100;
  h.client.update(scene(plane('111111', 'TEST2')));
  await settle();
  assert.equal(count, 3);
  assert.equal(
    h.published[h.published.length - 1]?.primary?.origin?.code,
    'MAN',
  );
  assert.equal(
    h.events.filter(
      (e) =>
        e.type === 'response' &&
        e.scheduling?.treatment === 'failure-backoff',
    ).length,
    0,
  );
});

test('R01 contract accepts numeric and date retry values; a wall-clock discrepancy cannot shorten server wait', () => {
  const f = contract();
  assert.equal(
    verifiedLocalDeferral(local(), { error: 'cooldown', failure: f })
      ?.waitMs,
    30000,
  );
  const date = new Date(T + 30000).toUTCString();
  assert.equal(
    verifiedLocalDeferral(local({ error: 'cooldown', failure: f }, date), {
      error: 'cooldown',
      failure: f,
    })?.waitMs,
    30000,
  );
  const rounded = contract('global-gate', 30001);
  assert.equal(
    verifiedLocalDeferral(
      local({ error: 'cooldown', failure: rounded }, '31'),
      { error: 'cooldown', failure: rounded },
    )?.waitMs,
    31000,
  );
});

const invalidBodies: [string, unknown, string?, number?, string?][] = [
  ['generic 503', {}],
  ['legacy code', { error: 'cooldown' }],
  [
    'unknown version',
    { error: 'cooldown', failure: { ...contract(), schemaVersion: 2 } },
  ],
  [
    'upstream origin',
    { error: 'cooldown', failure: { ...contract(), origin: 'hexdb' } },
  ],
  [
    'wrong category',
    {
      error: 'cooldown',
      failure: { ...contract(), category: 'upstream-failure' },
    },
  ],
  [
    'unknown reason',
    { error: 'cooldown', failure: contract('unclassified') },
  ],
  [
    'upstream request contradiction',
    {
      error: 'cooldown',
      failure: { ...contract(), upstreamRequestsStarted: 1 },
    },
  ],
  [
    'upstream response contradiction',
    {
      error: 'cooldown',
      failure: { ...contract(), upstreamResponses: 1 },
    },
  ],
  [
    'diagnostic contradiction',
    {
      error: 'cooldown',
      failure: contract(),
      diagnostic: { origin: 'hexdb' },
    },
  ],
  [
    'unexpected field',
    { error: 'cooldown', failure: { ...contract(), providerStatus: 429 } },
  ],
  ['wrong parent code', { error: 'http-error', failure: contract() }],
  ['wrong header', { error: 'cooldown', failure: contract() }, '1'],
  ['missing header', { error: 'cooldown', failure: contract() }, ''],
  ['negative header', { error: 'cooldown', failure: contract() }, '-30'],
  [
    'inconsistent date',
    { error: 'cooldown', failure: contract() },
    new Date(T + 60000).toUTCString(),
  ],
  [
    'nonJSON media type',
    { error: 'cooldown', failure: contract() },
    '30',
    503,
    'text/plain',
  ],
  [
    'wrong HTTP status',
    { error: 'cooldown', failure: contract() },
    '30',
    429,
  ],
  [
    'too short duration',
    { error: 'cooldown', failure: contract('global-gate', 1) },
    '1',
  ],
];
for (const [name, body, retry, status, type] of invalidBodies)
  test('R01 fails closed: ' + name, async (t) => {
    const h = harness(t, async () => local(body, retry, status, type));
    h.client.update(scene());
    await settle();
    assert.equal(
      responseEvent(h.events).scheduling?.treatment,
      'failure-backoff',
    );
    assert.equal(h.budget.nextAllowed, 300000);
    h.at(299999);
    h.client.update(scene());
    await settle();
    assert.equal(h.attempts.length, 1);
  });

test('R01 bounded/malformed error bodies cannot assert local scheduling authority', async (t) => {
  for (const body of [
    'invalid-json',
    JSON.stringify({
      error: 'cooldown',
      failure: contract(),
      padding: 'x'.repeat(9000),
    }),
  ]) {
    const h = harness(
      t,
      async () =>
        new Response(body, {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '30',
          },
        }),
    );
    h.client.update(scene());
    await settle();
    assert.equal(h.budget.nextAllowed, 300000);
  }
  assert.equal(
    await readEnrichmentFailure(
      new Response('x'.repeat(10000), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
    undefined,
  );
  assert.equal(parseEnrichmentFailure({}), undefined);
});

for (const [name, status, code, retry] of [
  ['rate numeric', 429, 'rate-limited', '600'],
  ['rate date', 429, 'rate-limited', new Date(T + 900000).toUTCString()],
  ['access denied', 403, 'access-denied', '600'],
  ['timeout', null, 'timeout', '300'],
  ['network', null, 'network-error', '300'],
  ['invalid provider JSON', 200, 'invalid-json', '300'],
  ['invalid provider structure', 200, 'invalid-structure', '300'],
  ['provider error', 502, 'http-error', '300'],
  ['unexpected server error', null, 'unavailable', '300'],
] as const)
  test('R01 genuine failure protection: ' + name, async (t) => {
    const h = harness(t, async () =>
      local(
        {
          error: code,
          failure: {
            ...contract(),
            origin: code === 'unavailable' ? 'unexpected' : 'hexdb',
            category:
              code === 'unavailable'
                ? 'unexpected-error'
                : 'upstream-failure',
            reason: code,
            upstreamRequestsStarted: 1,
            upstreamResponses: status === null ? 0 : 1,
          },
        },
        retry,
      ),
    );
    h.client.update(scene());
    await settle();
    const wait = Number.isFinite(Number(retry))
      ? Number(retry) * 1000
      : Date.parse(retry) - T;
    assert.equal(h.budget.nextAllowed, Math.max(300000, wait));
    assert.equal(
      responseEvent(h.events).scheduling?.treatment,
      'failure-backoff',
    );
  });

for (const retry of ['600', new Date(T + 900000).toUTCString()])
  test(
    'R01 actual adapter preserves upstream 429 Retry-After ' + retry,
    async () => {
      await assert.rejects(
        fetchHexdb(
          'route',
          'abcdef',
          'TEST1',
          async () =>
            new Response('{}', {
              status: 429,
              headers: { 'Retry-After': retry },
            }),
          () => T,
        ),
        (e: unknown) =>
          e instanceof EnrichmentError &&
          e.code === 'rate-limited' &&
          e.retryAfterMs === (retry === '600' ? 600000 : 900000),
      );
    },
  );

test('R01 existing global deadline and collective 90s secondary deadline survive a local deferral', async (t) => {
  const h = harness(t, async () => local());
  h.client.update(scene(ready, [plane('111111', 'SEC1')]));
  await settle();
  assert.equal(h.budget.nextSecondaryAllowed, 90000);
  assert.equal(h.budget.nextAllowed, 30000);
  h.at(30000);
  h.client.update(scene(ready, [plane('222222', 'SEC2')]));
  await settle();
  assert.equal(h.attempts.length, 1);
  h.client.update(
    scene(plane('333333', 'NEWPRI'), [plane('111111', 'SEC1')]),
  );
  await settle();
  assert.equal(h.attempts.length, 2);
  assert.equal(h.attempts[1].hex, '333333');
  const pending = harness(t, async () => {
    pending.budget.nextAllowed = 120000;
    return local();
  });
  pending.client.update(scene());
  await settle();
  assert.equal(pending.budget.nextAllowed, 120000);
});

test('R01 an identity deferral does not block a new primary route for five minutes', async (t) => {
  const h = harness(t, async (a) =>
    h.attempts.length === 1
      ? local({ error: 'cooldown', failure: contract('in-flight') })
      : h.result(a),
  );
  h.client.update(
    scene({ ...plane(), model: 'Aircraft', registration: null }),
  );
  await settle();
  assert.equal(h.attempts[0].kind, 'aircraft');
  h.at(30000);
  h.client.update(scene(plane('111111', 'NEXT')));
  await settle();
  assert.equal(h.attempts[1].kind, 'route');
  assert.equal(
    h.published[h.published.length - 1]?.primary?.origin?.code,
    'MAN',
  );
});

test('R01 lifecycle: hidden, stopped/quiet, resumed, absent and promoted aircraft retain budgets and matching', async (t) => {
  const h = harness(t, async (a) =>
    h.attempts.length === 1 ? local() : h.result(a),
  );
  const secondary = plane('111111', 'SEC1');
  h.client.update(scene(ready, [secondary]));
  await settle();
  h.active(false);
  h.at(45000);
  h.client.update(scene(plane('222222', 'HIDDEN')));
  await settle();
  assert.equal(h.attempts.length, 1);
  h.client.stop();
  h.at(60000);
  h.active(true);
  const resumed = h.create();
  resumed.update(scene(null, []));
  await settle();
  assert.equal(h.attempts.length, 1);
  resumed.update(scene({ ...secondary, callsign: 'CHANGED' }));
  await settle();
  assert.equal(h.attempts[1].callsign, 'CHANGED');
  assert.equal(
    h.published[h.published.length - 1]?.primary?.origin?.code,
    'MAN',
  );
  h.at(90000);
  resumed.update(
    scene({ ...plane('333333', 'OTHER'), ...route }, [
      { ...secondary, callsign: 'CHANGED' },
    ]),
  );
  await settle();
  assert.equal(h.attempts.length, 2);
  assert.equal(
    h.published[h.published.length - 1]?.secondary[0].origin?.code,
    'MAN',
  );
  assert.equal(h.budget.nextSecondaryAllowed, 90000);
});

test('R01 no overlapping client requests; an abort after stop cannot publish or extend shared budget', async (t) => {
  let release!: (r: Response) => void;
  let signal: AbortSignal | null | undefined;
  const h = harness(t, async (_a, init) => {
    signal = init?.signal;
    return new Promise((r) => (release = r));
  });
  h.client.update(scene());
  h.at(45000);
  h.client.update(scene(plane('111111', 'OTHER')));
  assert.equal(h.attempts.length, 1);
  h.client.stop();
  assert.equal(signal?.aborted, true);
  const deadline = h.budget.nextAllowed;
  release(local());
  await settle();
  assert.equal(h.budget.nextAllowed, deadline);
  assert.equal(h.events.filter((e) => e.type === 'response').length, 0);
});

test('R01 genuine active timeout still backs off while stop-aborts do not masquerade as provider failures', async (t) => {
  const h = harness(
    t,
    async (_a, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(Error('aborted')),
        ),
      ),
  );
  h.client.update(scene());
  h.timers[0].fn();
  await settle();
  assert.equal(h.budget.nextAllowed, 300000);
});

test('R01 two clients sharing a server obey independent budgets, one upstream request and process gate', async (t) => {
  let serverNow = T,
    upstreamActive = 0,
    maxActive = 0;
  const providerTimes: number[] = [];
  const service = createEnrichmentService(
    async () => {
      providerTimes.push(serverNow);
      upstreamActive++;
      maxActive = Math.max(maxActive, upstreamActive);
      await settle();
      upstreamActive--;
      return route;
    },
    () => serverNow,
  );
  const wire = async (a: Attempt) => {
    try {
      const r = await service.get(a.kind, a.hex, a.callsign);
      return new Response(JSON.stringify(r.result));
    } catch (e) {
      assert.ok(e instanceof LocalEnrichmentDeferral);
      return local(
        {
          error: 'cooldown',
          failure: contract(e.reason, e.retryAfterMs, serverNow),
        },
        String(Math.ceil(e.retryAfterMs / 1000)),
      );
    }
  };
  const a = harness(t, wire),
    b = harness(t, wire);
  for (let at = 0; at <= 180000; at += 15000) {
    a.at(at);
    b.at(at);
    serverNow = T + at;
    a.client.update(
      scene(
        plane(
          (100 + at / 15000).toString(16).padStart(6, '0'),
          'AA' + at / 15000,
        ),
      ),
    );
    b.client.update(
      scene(
        plane(
          (200 + at / 15000).toString(16).padStart(6, '0'),
          'BB' + at / 15000,
        ),
      ),
    );
    await settle();
    await settle();
  }
  for (const h of [a, b]) {
    assert.ok(
      h.attempts.every(
        (v, i) => i === 0 || v.at - h.attempts[i - 1].at >= 30000,
      ),
    );
    assert.ok(h.attempts.length <= 7);
    assert.ok(
      !h.events.some(
        (e) =>
          e.type === 'response' &&
          e.scheduling?.treatment === 'failure-backoff',
      ),
    );
  }
  assert.equal(maxActive, 1);
  assert.ok(
    providerTimes.every(
      (v, i) => i === 0 || v - providerTimes[i - 1] >= 30000,
    ),
  );
  assert.ok(providerTimes.length <= 7);
});

test('R01 coalesced provider failures count a single HTTP request and retain provider protection', async () => {
  let release!: (v: never) => void;
  const service = createEnrichmentService(
    async () => new Promise((_r, reject) => (release = reject)),
  );
  const a = service.get('route', 'abcdef', 'TEST1', true),
    b = service.get('route', 'abcdef', 'TEST1', true);
  const error = new EnrichmentError('rate-limited', 600000);
  error.trace = {
    requestStarted: true,
    httpStatus: 429,
    outcome: 'error',
    reason: 'rate-limited',
    endpoint: 'v2/routes/:callsign',
  };
  release(error as never);
  const results = await Promise.allSettled([a, b]);
  assert.ok(results.every((x) => x.status === 'rejected'));
  const errors = results.map(
    (x) => (x as PromiseRejectedResult).reason as EnrichmentError,
  );
  assert.deepEqual(
    errors.map((e) => e.serverCache),
    ['miss', 'coalesced'],
  );
  assert.notEqual(errors[0], errors[1]);
  assert.ok(errors.every((e) => e.retryAfterMs === 600000));
});

test('R01 diagnostic evidence records server and browser deadlines, monotonic recovery and secondary restrictions', async (t) => {
  const d = createRouteDiagnostics(T, T + 600000);
  const h = harness(t, async (a) =>
    h.attempts.length === 1 ? local() : h.result(a),
  );
  const original = h.env.observe;
  h.env.observe = (e) => {
    original?.(e);
    d.observe(e);
  };
  h.client.update(scene(ready, [plane('111111', 'SEC1')]));
  await settle();
  let r = d.summary(T);
  assert.equal(r.counters.verifiedLocalDeferrals, 1);
  assert.equal(r.counters.localDeferralsAmplified ?? 0, 0);
  assert.equal(
    r.deferrals[0].scheduling.nextGlobalEligibleAtMs,
    T + 30000,
  );
  assert.equal(
    r.deferrals[0].scheduling.nextSecondaryEligibleAtMs,
    T + 90000,
  );
  h.at(45000);
  h.client.update(scene(ready, [plane('222222', 'SEC2')]));
  await settle();
  h.at(90000);
  h.client.update(scene(ready, [plane('222222', 'SEC2')]));
  await settle();
  r = d.summary(T + 90000);
  assert.equal(r.deferrals[0].actualDelayMs, 90000);
  assert.ok(
    r.deferrals[0].observedRestrictions.includes('secondary-interval'),
  );
  assert.equal(r.counters.clientCooldownIncidents ?? 0, 0);
  assert.equal(r.deferrals[0].nextAttemptKind, 'route');
  r.deferrals[0].observedRestrictions.push('latitude');
  assert.ok(
    !d
      .summary(T + 90000)
      .deferrals[0].observedRestrictions.includes('latitude'),
  );
  assert.doesNotMatch(
    JSON.stringify(d.summary(T + 90000)),
    /abcdef|TEST1|SEC1|latitude|longitude/,
  );
});

test('R01 normal mode without diagnostic observers honors local deferrals, including a long authoritative server wait', async (t) => {
  const h = harness(t, async () =>
    local(
      { error: 'cooldown', failure: contract('global-gate', 600000) },
      '600',
    ),
  );
  h.env.observe = undefined;
  h.client.update(scene());
  await settle();
  assert.equal(h.budget.nextAllowed, 600000);
  h.at(599999);
  h.client.update(scene());
  await settle();
  assert.equal(h.attempts.length, 1);
  h.at(600000);
  h.client.update(scene());
  await settle();
  assert.equal(h.attempts.length, 2);
});

test('R01 wall clock adjustment cannot reopen a monotonic local-deferral deadline or corrupt its actual recovery measurement', async (t) => {
  const d = createRouteDiagnostics(T, T + 600000);
  const h = harness(t, async (a) =>
    h.attempts.length === 1 ? local() : h.result(a),
  );
  h.env.observe = (e) => d.observe(e);
  h.client.update(scene());
  await settle();
  h.at(29999);
  h.wall(T + 120000);
  h.client.update(scene());
  await settle();
  assert.equal(h.attempts.length, 1);
  h.at(30000);
  h.wall(T - 120000);
  h.client.update(scene(plane('111111', 'NEXT')));
  await settle();
  assert.equal(h.attempts.length, 2);
  assert.equal(d.summary(T + 30000).deferrals[0].actualDelayMs, 30000);
});

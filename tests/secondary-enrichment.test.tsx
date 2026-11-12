import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Display } from '../src/App';
import { createEnricher } from '../src/enrichment';
import type { EnrichmentEnvironment } from '../src/enrichment';
import { ENRICHMENT_POLICY as P } from '../src/enrichmentTypes';
import type { EnrichmentResult } from '../src/enrichmentTypes';
import { fleet } from '../src/simulation';
import type { Aircraft, Scene } from '../src/simulation';

const T = 1_800_000_000_000;
const airport = (code: string) => ({
  code,
  iata: code,
  icao: null,
  name: code,
});
const route = { origin: airport('MAN'), destination: airport('AMS') };
const aircraft = (
  id = '111111',
  callsign: string | null = 'TEST1',
): Aircraft => ({
  ...fleet[0],
  id,
  callsign,
  registration: 'SYNTHETIC',
  operator: 'Test operator',
  origin: null,
  destination: null,
});
const primary = { ...aircraft('abcdef', 'PRIMARY'), ...route };
const scene = (
  secondary: Aircraft[],
  main: Aircraft = primary,
): Scene => ({
  id: 'live',
  label: 'Synthetic',
  duration: 0,
  state: 'available',
  primary: main,
  secondary,
});
interface Attempt {
  at: number;
  kind: string;
  hex: string;
  callsign: string | null;
}
const settle = () => new Promise<void>((r) => setImmediate(r));
function harness(
  t: { after: (fn: () => void) => void },
  load?: (attempt: Attempt, init?: RequestInit) => Promise<Response>,
) {
  let elapsed = 0,
    wall = T,
    active = true;
  const attempts: Attempt[] = [],
    published: Scene[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function result(
    a: Attempt,
    status: 'found' | 'not-found' = 'found',
    partial = false,
  ) {
    const value: EnrichmentResult = {
      kind: a.kind as 'route' | 'aircraft',
      hex: a.hex,
      callsign: a.callsign,
      source: 'hexdb.io',
      status,
      data:
        status === 'not-found'
          ? {}
          : a.kind === 'route'
            ? partial
              ? { origin: route.origin }
              : route
            : {
                registration: 'SYNTHETIC',
                operator: 'Test operator',
                description: 'Airbus A320neo',
              },
      fetchedAtMs: wall,
      expiresAtMs:
        wall +
        (status === 'not-found'
          ? P.negativeTtlMs
          : a.kind === 'route'
            ? P.routeTtlMs
            : P.identityTtlMs),
    };
    return new Response(JSON.stringify(value));
  }
  const env: EnrichmentEnvironment = {
    now: () => wall,
    monotonicNow: () => elapsed,
    active: () => active,
    fetch: async (url, init) => {
      const q = new URL(String(url), 'https://test.invalid').searchParams;
      const a = {
        at: elapsed,
        kind: q.get('kind')!,
        hex: q.get('hex')!,
        callsign: q.get('callsign'),
      };
      attempts.push(a);
      return load ? load(a, init) : result(a);
    },
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timers.add(timer);
      return timer;
    },
    clearTimer: (timer) => {
      clearTimeout(timer);
      timers.delete(timer);
    },
  };
  const client = createEnricher((s) => published.push(s), env);
  t.after(() => {
    client.stop();
    assert.equal(timers.size, 0);
  });
  return {
    client,
    attempts,
    published,
    result,
    timers,
    at: (ms: number) => {
      elapsed = ms;
      wall = T + ms;
    },
    wall: (ms: number) => {
      wall = ms;
    },
    active: (value: boolean) => {
      active = value;
    },
    latest: () => published[published.length - 1],
  };
}

test('idle primary allows only a normalized secondary route and publishes it without another update', async (t) => {
  const h = harness(t);
  h.client.update(scene([aircraft('111111', ' test1 ')]));
  assert.equal(
    h.latest().secondary[0].origin,
    null,
    'position renders immediately',
  );
  await settle();
  assert.deepEqual(h.attempts, [
    { at: 0, kind: 'route', hex: '111111', callsign: 'TEST1' },
  ]);
  assert.equal(h.latest().secondary[0].origin?.code, 'MAN');
  const html = renderToStaticMarkup(<Display scene={h.latest()} live />);
  assert.match(html, /secondary-route/);
  assert.equal(h.latest().primary?.id, primary.id);
});

for (const [name, main, kind] of [
  [
    'required identification',
    { ...aircraft('abcdef', 'PRIMARY'), model: 'Aircraft' },
    'aircraft',
  ],
  ['route', aircraft('abcdef', 'PRIMARY'), 'route'],
  ['other identity', { ...primary, operator: null }, 'aircraft'],
] as const)
  test(`primary ${name} always precedes a secondary request`, async (t) => {
    const h = harness(t);
    h.client.update(scene([aircraft()], main));
    await settle();
    assert.equal(h.attempts.length, 1);
    assert.equal(h.attempts[0].hex, 'abcdef');
    assert.equal(h.attempts[0].kind, kind);
  });

test('secondary 90s gate applies collectively, including new arrivals, within the global 30s gate', async (t) => {
  const h = harness(t);
  const first = aircraft(),
    second = aircraft('222222', 'TEST2');
  h.client.update(scene([first]));
  await settle();
  h.at(29_999);
  h.client.update(scene([second], aircraft('abcdef', 'PRIMARY')));
  assert.equal(h.attempts.length, 1);
  h.at(30_000);
  h.client.update(scene([second], aircraft('abcdef', 'PRIMARY')));
  await settle();
  assert.equal(h.attempts[1].hex, 'abcdef');
  h.at(89_999);
  h.client.update(scene([second]));
  assert.equal(h.attempts.length, 2);
  h.at(90_000);
  h.client.update(scene([second]));
  await settle();
  assert.deepEqual(
    h.attempts.map((a) => a.at),
    [0, 30_000, 90_000],
  );
  h.at(120_000);
  h.client.update(scene([aircraft('333333', 'TEST3')]));
  assert.equal(h.attempts.length, 3);
});

test('global gate still blocks a secondary when its 90s allowance is open', async (t) => {
  const h = harness(t);
  h.client.update(scene([], aircraft('abcdef', 'PRIMARY')));
  await settle();
  h.at(29_999);
  h.client.update(scene([aircraft()]));
  assert.equal(h.attempts.length, 1);
  h.at(30_000);
  h.client.update(scene([aircraft()]));
  await settle();
  assert.equal(h.attempts[1].hex, '111111');
});

test('in-flight secondary never overlaps a newly eligible primary, which takes the next permitted slot', async (t) => {
  let resolve!: (r: Response) => void;
  const h = harness(
    t,
    async () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  h.client.update(scene([aircraft()]));
  h.at(30_000);
  h.client.update(scene([], aircraft('abcdef', 'PRIMARY')));
  assert.equal(h.attempts.length, 1);
  assert.equal(h.client.inspect().inFlight, 1);
  resolve(h.result(h.attempts[0]));
  await settle();
  assert.equal(
    h.latest().primary?.origin,
    null,
    'late response does not decorate unrelated primary',
  );
  h.client.update(scene([], aircraft('abcdef', 'PRIMARY')));
  assert.equal(h.attempts[1].hex, 'abcdef');
  resolve(h.result(h.attempts[1]));
  await settle();
});

test('fair oldest-attempt scheduling uses display order for ties and negative cache prevents repeats', async (t) => {
  const h = harness(t, async (a) => h.result(a, 'not-found'));
  const a = aircraft(),
    b = aircraft('222222', 'TEST2'),
    c = aircraft('333333', 'TEST3');
  for (const at of [0, 90_000, 180_000]) {
    h.at(at);
    h.client.update(scene([a, b, c]));
    await settle();
  }
  assert.deepEqual(
    h.attempts.map((a) => a.hex),
    ['111111', '222222', '333333'],
  );
  h.at(270_000);
  h.client.update(scene([c, b, a]));
  assert.equal(h.attempts.length, 3);
  h.at(300_000);
  h.client.update(scene([c, b, a]));
  await settle();
  assert.equal(h.attempts[3].hex, a.id);
});

test('complete valid routes remain cached through refresh lead; partial responses retain ordinary refresh eligibility', async (t) => {
  const h = harness(t);
  h.client.update(scene([aircraft()]));
  await settle();
  h.at(P.routeTtlMs - P.refreshLeadMs);
  h.client.update(scene([aircraft()]));
  assert.equal(h.attempts.length, 1);
  h.at(P.routeTtlMs);
  h.client.update(scene([aircraft()]));
  await settle();
  assert.equal(h.attempts.length, 2);
  const partial = harness(t, async (a) =>
    partial.result(a, 'found', true),
  );
  partial.client.update(scene([aircraft()]));
  await settle();
  partial.at(90_000);
  partial.client.update(scene([aircraft()]));
  assert.equal(partial.attempts.length, 1);
  partial.at(P.routeTtlMs - P.refreshLeadMs);
  partial.client.update(scene([aircraft()]));
  await settle();
  assert.equal(partial.attempts.length, 2);
});

for (const retry of ['600', new Date(T + 600_000).toUTCString()])
  test(`secondary 429 honors Retry-After ${retry.length < 10 ? 'seconds' : 'date'} and preserves fairness after errors`, async (t) => {
    const h = harness(
      t,
      async () =>
        new Response('{}', {
          status: 429,
          headers: { 'Retry-After': retry },
        }),
    );
    const s = scene([aircraft(), aircraft('222222', 'TEST2')]);
    h.client.update(s);
    await settle();
    for (const at of [30_000, 90_000, 300_000, 599_999]) {
      h.at(at);
      h.client.update(s);
    }
    assert.equal(h.attempts.length, 1);
    h.at(600_000);
    h.client.update(s);
    await settle();
    assert.equal(h.attempts[1].hex, '222222');
  });

for (const name of ['network', '503', 'invalid JSON'] as const)
  test(`secondary ${name} failure uses existing cooldown and leaves aircraft visible`, async (t) => {
    const h = harness(t, async () => {
      if (name === 'network') throw Error('network');
      return new Response(name === 'invalid JSON' ? '{' : '{}', {
        status: name === '503' ? 503 : 200,
      });
    });
    h.client.update(scene([aircraft()]));
    await settle();
    h.at(P.errorCooldownMs - 1);
    h.client.update(scene([aircraft()]));
    assert.equal(h.attempts.length, 1);
    assert.equal(h.latest().state, 'available');
    assert.equal(h.latest().secondary[0].model, 'A320neo');
    h.at(P.errorCooldownMs);
    h.client.update(scene([aircraft()]));
    await settle();
    assert.equal(h.attempts.length, 2);
  });

test('vanished, invalid, duplicate and unavailable-scene aircraft are not queried', async (t) => {
  const h = harness(t);
  h.client.update(scene([aircraft()]));
  await settle();
  h.at(90_000);
  h.client.update(scene([]));
  assert.equal(h.attempts.length, 1);
  h.client.update(
    scene([
      aircraft('bad'),
      aircraft('222222', null),
      aircraft('333333', 'BAD/ID'),
      { ...primary, origin: null, destination: null },
    ]),
  );
  assert.equal(h.attempts.length, 1);
  h.client.update({
    ...scene([aircraft('444444', 'TEST4')]),
    state: 'unavailable',
  });
  assert.equal(h.attempts.length, 1);
  h.client.update(scene([aircraft('444444', 'TEST4')]));
  await settle();
  assert.equal(h.attempts[1].hex, '444444');
});

test('callsign changes and disappearance during a request cannot attach stale routes; cache follows role changes', async (t) => {
  let resolve!: (r: Response) => void;
  const h = harness(
    t,
    async () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const a = aircraft();
  h.client.update(scene([a]));
  h.client.update(scene([{ ...a, callsign: 'DIFFERENT' }]));
  resolve(h.result(h.attempts[0]));
  await settle();
  assert.equal(h.latest().secondary[0].origin, null);
  h.client.update(scene([a]));
  assert.equal(h.latest().secondary[0].origin?.code, 'MAN');
  h.client.update(scene([], a));
  assert.equal(h.latest().primary?.origin?.code, 'MAN');
  h.client.update(scene([a]));
  assert.equal(h.attempts.length, 1);
  h.at(90_000);
  h.client.update(scene([aircraft('222222', 'TEST2')]));
  h.client.update(scene([]));
  resolve(h.result(h.attempts[1]));
  await settle();
  assert.equal(h.latest().secondary.length, 0);
});

test('inactive/hidden/offline scenes cannot start work, stop aborts and prevents late publication', async (t) => {
  let signal: AbortSignal | null | undefined,
    resolve!: (r: Response) => void;
  const h = harness(t, async (_a, init) => {
    signal = init?.signal;
    return new Promise((r) => {
      resolve = r;
    });
  });
  h.active(false);
  h.client.update(scene([aircraft()]));
  assert.equal(h.attempts.length, 0);
  h.active(true);
  h.client.update(scene([aircraft()]));
  assert.equal(h.attempts.length, 1);
  const count = h.published.length;
  h.client.stop();
  assert.ok(signal?.aborted);
  assert.equal(h.timers.size, 0);
  resolve(h.result(h.attempts[0]));
  await settle();
  h.at(90_000);
  h.client.update(scene([aircraft('222222', 'TEST2')]));
  assert.equal(h.attempts.length, 1);
  assert.equal(h.published.length, count);
  assert.equal(h.client.inspect().secondaryAttempts, 0);
  assert.equal(h.client.inspect().entries, 0);
});

test('monotonic global/secondary gates survive wall-clock jumps and a backward elapsed clock', async (t) => {
  const h = harness(t);
  h.client.update(scene([aircraft()]));
  await settle();
  h.at(15_000);
  h.wall(T + 86_400_000);
  h.client.update(scene([aircraft('222222', 'TEST2')]));
  assert.equal(h.attempts.length, 1);
  h.at(89_999);
  h.wall(T - 1_000);
  h.client.update(scene([aircraft('222222', 'TEST2')]));
  assert.equal(h.attempts.length, 1);
  h.at(10_000);
  h.client.update(scene([aircraft('222222', 'TEST2')]));
  assert.equal(h.attempts.length, 1);
  h.at(90_000);
  h.client.update(scene([aircraft('222222', 'TEST2')]));
  await settle();
  assert.equal(h.attempts.length, 2);
});

test('secondary history is discarded when records leave and is bounded independently of traffic volume', async (t) => {
  const h = harness(t);
  for (let i = 0; i < 80; i++) {
    h.at(i * 90_000);
    h.client.update(
      scene([aircraft(i.toString(16).padStart(6, '0'), 'TEST' + i)]),
    );
    await settle();
    assert.ok(h.client.inspect().entries <= P.clientCapacity);
    assert.ok(h.client.inspect().secondaryAttempts <= 1);
  }
  h.client.update(scene([]));
  assert.equal(h.client.inspect().secondaryAttempts, 0);
});

test('page request deadlines survive stopping/recreating the scheduler without retaining aircraft data', async () => {
  let now = 0,
    calls = 0;
  const budget = { nextAllowed: 0, nextSecondaryAllowed: 0 };
  const env: EnrichmentEnvironment = {
    now: () => T + now,
    monotonicNow: () => now,
    budget,
    active: () => true,
    fetch: async (url) => {
      calls++;
      const q = new URL(String(url), 'https://test.invalid').searchParams;
      return new Response(
        JSON.stringify({
          kind: 'route',
          hex: q.get('hex'),
          callsign: q.get('callsign'),
          source: 'hexdb.io',
          status: 'not-found',
          data: {},
          fetchedAtMs: T + now,
          expiresAtMs: T + now + P.negativeTtlMs,
        }),
      );
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: clearTimeout,
  };
  const first = createEnricher(() => {}, env);
  first.update(scene([aircraft()]));
  await settle();
  first.stop();
  assert.equal(first.inspect().entries, 0);
  const second = createEnricher(() => {}, env);
  try {
    now = 15_000;
    second.update(scene([aircraft('222222', 'TEST2')]));
    assert.equal(calls, 1);
    now = 89_999;
    second.update(scene([aircraft('222222', 'TEST2')]));
    assert.equal(calls, 1);
    now = 90_000;
    second.update(scene([aircraft('222222', 'TEST2')]));
    await settle();
    assert.equal(calls, 2);
  } finally {
    second.stop();
  }
});

test('secondary timeout clears its request and cools down without resetting the scene', async () => {
  let elapsed = 0,
    calls = 0,
    timeout!: () => void;
  const client = createEnricher(() => {}, {
    now: () => T + elapsed,
    monotonicNow: () => elapsed,
    active: () => true,
    fetch: async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Error('timeout')),
        );
      });
    },
    setTimer: (fn) => {
      timeout = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
  });
  try {
    client.update(scene([aircraft()]));
    elapsed = P.clientTimeoutMs;
    timeout();
    await settle();
    assert.equal(client.inspect().inFlight, 0);
    elapsed += P.errorCooldownMs - 1;
    client.update(scene([aircraft()]));
    assert.equal(calls, 1);
    elapsed++;
    client.update(scene([aircraft()]));
    assert.equal(calls, 2);
  } finally {
    client.stop();
    await settle();
  }
});

test('a provider cooldown also survives a visibility remount and blocks primary as well as secondary traffic', async () => {
  let elapsed = 0,
    calls = 0;
  const budget = { nextAllowed: 0, nextSecondaryAllowed: 0 };
  const env: EnrichmentEnvironment = {
    now: () => T + elapsed,
    monotonicNow: () => elapsed,
    budget,
    active: () => true,
    fetch: async () => {
      calls++;
      return new Response('{}', { status: 503 });
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: clearTimeout,
  };
  const first = createEnricher(() => {}, env);
  first.update(scene([aircraft()]));
  await settle();
  first.stop();
  const second = createEnricher(() => {}, env);
  try {
    elapsed = P.errorCooldownMs - 1;
    second.update(scene([aircraft()], aircraft('abcdef', 'PRIMARY')));
    assert.equal(calls, 1);
    elapsed++;
    second.update(scene([aircraft()], aircraft('abcdef', 'PRIMARY')));
    await settle();
    assert.equal(calls, 2);
  } finally {
    second.stop();
  }
});

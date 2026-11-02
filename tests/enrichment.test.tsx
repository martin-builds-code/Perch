import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  fetchHexdb,
  normaliseHexdb,
  EnrichmentError,
  validateLookup,
} from '../server/hexdb';
import { createEnrichmentService } from '../server/enrichmentService';
import { createEnricher, supplementAircraft } from '../src/enrichment';
import { ENRICHMENT_POLICY as P, enrichmentKey } from '../src/enrichmentTypes';
import type {
  EnrichmentResult,
  Supplement,
  EnrichmentKind,
} from '../src/enrichmentTypes';
import { Display } from '../src/App';
import { fleet } from '../src/simulation';
import type { Scene } from '../src/simulation';
const T = 1_800_000_000_000,
  hex = 'abcdef';
const identity = {
  hex: 'ABCDEF',
  manufacturer: 'Airbus',
  type: 'A319 111',
  registration: 'TEST-REG',
  registered_owner: 'easyJet UK',
  operator_flag_code: 'EZY',
};
const route = {
  callsign: 'EIN17A',
  origin: { icao: 'EIDW', iata: 'DUB', name: 'Dublin Airport' },
  destination: { icao: 'EGLL', iata: 'LHR', name: 'Heathrow Airport' },
  updated_at: new Date(T - 1000).toISOString(),
};
const response = (
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) => new Response(JSON.stringify(body), { status, headers });
const base: Scene = {
  id: 'live',
  label: 'Live',
  duration: 0,
  state: 'available',
  primary: {
    ...fleet[0],
    id: hex,
    callsign: 'EIN17A',
    operator: null,
    registration: null,
    origin: null,
    destination: null,
  },
  secondary: [],
};
const data = (
  kind: EnrichmentKind,
  fields: Supplement,
  callsign: string | null = kind === 'route' ? 'EIN17A' : null,
  time = T,
): EnrichmentResult => ({
  kind,
  hex,
  callsign,
  source: 'hexdb.io',
  status: 'found',
  data: fields,
  fetchedAtMs: time,
  expiresAtMs: time + (kind === 'route' ? P.routeTtlMs : P.identityTtlMs),
});

test('HexDB identity and route preserve native codes, partial fields, owner/brand distinctions and matching', () => {
  const aircraft = normaliseHexdb('aircraft', hex, null, identity, T)!;
  assert.equal(aircraft.operator, 'easyJet');
  assert.equal(aircraft.description, 'Airbus A319 111');
  assert.equal(
    normaliseHexdb(
      'aircraft',
      hex,
      null,
      { ...identity, registered_owner: 'Finance Company' },
      T,
    )!.operator,
    undefined,
  );
  assert.equal(
    normaliseHexdb(
      'aircraft',
      hex,
      null,
      { ...identity, registered_owner: 'Malta Air', operator_flag_code: 'MAY' },
      T,
    )!.operator,
    'Ryanair',
  );
  const r = normaliseHexdb('route', hex, 'EIN17A', route, T)!;
  assert.equal(r.origin?.code, 'DUB');
  assert.equal(r.origin?.icao, 'EIDW');
  assert.equal(r.destination?.name, 'Heathrow Airport');
  assert.equal(
    normaliseHexdb('route', hex, 'EIN17A', { ...route, destination: null }, T)!
      .destination,
    undefined,
  );
  assert.equal(
    normaliseHexdb(
      'route',
      hex,
      'EIN17A',
      { ...route, origin: { icao: 'EIDW' } },
      T,
    )!.origin?.name,
    'Not reported',
  );
  assert.equal(
    normaliseHexdb(
      'route',
      hex,
      'EIN17A',
      { ...route, origin: null, destination: null },
      T,
    ),
    null,
  );
  assert.equal(
    normaliseHexdb('aircraft', hex, null, { hex: 'ABCDEF' }, T),
    null,
  );
  for (const value of [
    { ...route, callsign: 'EIN17B' },
    { ...route, destination: route.origin },
    { ...route, airports: [route.destination, route.origin] },
    { ...route, origin: { icao: 'INVALID' } },
    { ...route, updated_at: 'bad' },
    { ...route, updated_at: new Date(T + 1).toISOString() },
  ])
    assert.throws(() => normaliseHexdb('route', hex, 'EIN17A', value, T));
  assert.equal(
    normaliseHexdb(
      'route',
      hex,
      'EIN17A',
      { ...route, updated_at: '2014-04-20T11:02:19Z' },
      T,
    ),
    null,
  );
  assert.ok(
    normaliseHexdb('route', hex, 'EIN17A', { ...route, updated_at: null }, T),
  );
  assert.throws(() =>
    normaliseHexdb('aircraft', hex, null, { ...identity, hex: '123456' }, T),
  );
  for (const invalid of [null, [], {}, 'x'])
    assert.throws(() => normaliseHexdb('aircraft', hex, null, invalid, T));
});
test('lookup identifiers reject malformed or unrelated flight inputs before any request', async () => {
  for (const args of [
    ['route', hex, 'EIN/17'],
    ['aircraft', 'xxxxxx', null],
    ['route', hex, ''],
    ['other', hex, null],
    ['route', hex, 'EIN17A EXTRA'],
  ])
    assert.throws(() =>
      validateLookup(...(args as [unknown, unknown, unknown])),
    );
  assert.equal(validateLookup('route', hex, ' ein17a ').callsign, 'EIN17A');
  let calls = 0;
  await assert.rejects(
    fetchHexdb('route', hex, null, async () => {
      calls++;
      return response({});
    }),
  );
  assert.equal(calls, 0);
});
test('HexDB adapter uses current documented endpoints and handles populated, partial and missing results', async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    urls.push(String(url));
    return response(urls.length === 1 ? identity : route);
  };
  assert.equal(
    (await fetchHexdb('aircraft', hex, null, fetcher, () => T))?.registration,
    'TEST-REG',
  );
  assert.equal(
    (await fetchHexdb('route', hex, 'EIN17A', fetcher, () => T))?.destination
      ?.code,
    'LHR',
  );
  assert.deepEqual(urls, [
    'https://hexdb.io/api/v2/aircraft/abcdef',
    'https://hexdb.io/api/v2/routes/EIN17A',
  ]);
  for (const kind of ['aircraft', 'route'] as const)
    assert.equal(
      await fetchHexdb(
        kind,
        hex,
        kind === 'route' ? 'EIN17A' : null,
        async () => response({}, 404),
        () => T,
      ),
      null,
    );
});
for (const [status, code] of [
  [500, 'http-error'],
  [429, 'rate-limited'],
  [401, 'access-denied'],
  [403, 'access-denied'],
] as const)
  test('HexDB HTTP ' + status + ' fails safely', async () => {
    await assert.rejects(
      fetchHexdb(
        'aircraft',
        hex,
        null,
        async () => response({}, status, { 'Retry-After': '900' }),
        () => T,
      ),
      (e: unknown) =>
        e instanceof EnrichmentError &&
        e.code === code &&
        (status !== 429 || e.retryAfterMs === 900000),
    );
  });
test('HexDB rejects invalid JSON, structure, oversized responses, network errors and bounds fetch/body timeouts', async () => {
  for (const r of [
    new Response('{'),
    response([]),
    response({}),
    new Response('x', {
      headers: { 'Content-Length': String(P.maxBytes + 1) },
    }),
    new Response('x'.repeat(P.maxBytes + 1)),
  ])
    await assert.rejects(
      fetchHexdb(
        'aircraft',
        hex,
        null,
        async () => r,
        () => T,
      ),
    );
  await assert.rejects(
    fetchHexdb(
      'aircraft',
      hex,
      null,
      async () => {
        throw Error('secret URL');
      },
      () => T,
    ),
    /network-error/,
  );
  const pending: typeof fetch = async (_url, o) =>
    new Promise((_resolve, reject) =>
      o?.signal?.addEventListener('abort', () => reject(Error('abort'))),
    );
  await assert.rejects(
    fetchHexdb('aircraft', hex, null, pending, () => T, 5),
    /timeout/,
  );
  await assert.rejects(
    fetchHexdb(
      'aircraft',
      hex,
      null,
      async (_url, o) =>
        new Response(
          new ReadableStream({
            start(c) {
              o?.signal?.addEventListener('abort', () =>
                c.error(Error('abort')),
              );
            },
          }),
        ),
      () => T,
      5,
    ),
    /timeout/,
  );
});
test('server cache hits, expiry, negative results, deduplication and one in-flight/budget gate', async () => {
  let now = T,
    calls = 0;
  let resolve!: (value: Supplement | null) => void;
  const service = createEnrichmentService(
    async () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
    () => now,
  );
  const first = service.get('aircraft', hex, null),
    second = service.get('aircraft', hex, null);
  assert.equal(calls, 1);
  await assert.rejects(service.get('route', hex, 'EIN17A'), /cooldown/);
  resolve({ registration: 'TEST' });
  await first;
  await second;
  assert.equal((await service.get('aircraft', hex, null)).cache, 'hit');
  assert.equal(calls, 1);
  now += P.identityTtlMs;
  const expired = service.get('aircraft', hex, null);
  assert.equal(calls, 2);
  resolve(null);
  const negative = await expired;
  assert.equal(negative.result.status, 'not-found');
  now += 1000;
  await service.get('aircraft', hex, null);
  assert.equal(calls, 2);
  now += P.negativeTtlMs;
  const again = service.get('aircraft', hex, null);
  resolve({ operator: 'test' });
  await again;
  assert.equal(calls, 3);
  assert.equal(service.inspect().inFlight, 0);
});
test('server route keys distinguish hex and flight; errors cool down and cache capacity stays bounded', async () => {
  let now = T,
    calls = 0;
  const service = createEnrichmentService(
    async () => {
      calls++;
      return { registration: 'TEST' };
    },
    () => now,
  );
  for (let i = 0; i < 140; i++) {
    await service.get('aircraft', i.toString(16).padStart(6, '0'), null);
    now += P.intervalMs;
  }
  assert.ok(service.inspect().entries <= P.serverCapacity);
  assert.notEqual(
    enrichmentKey('route', hex, 'EIN17A'),
    enrichmentKey('route', hex, 'EIN17B'),
  );
  assert.notEqual(
    enrichmentKey('route', hex, 'EIN17A'),
    enrichmentKey('route', '123456', 'EIN17A'),
  );
  const failing = createEnrichmentService(
    async () => {
      calls++;
      throw new EnrichmentError('access-denied', 600000);
    },
    () => now,
  );
  await assert.rejects(failing.get('aircraft', hex, null));
  const before = calls;
  now += 30000;
  await assert.rejects(failing.get('aircraft', hex, null));
  assert.equal(calls, before);
  now += 600000;
  await assert.rejects(failing.get('aircraft', hex, null));
  assert.equal(calls, before + 1);
});
test('native identity/flight/registration remain authoritative, optional fields occupy existing slots', () => {
  const original = base.primary!;
  const result = supplementAircraft(
    original,
    {
      description: 'Wrong model',
      registration: 'HEX-REG',
      operator: 'easyJet',
    },
    {
      origin: {
        code: 'DUB',
        icao: 'EIDW',
        iata: 'DUB',
        name: 'Dublin Airport',
      },
    },
  );
  assert.equal(result.aircraft.model, original.model);
  assert.equal(result.aircraft.callsign, original.callsign);
  assert.equal(result.aircraft.operator, 'easyJet');
  assert.equal(original.operator, null);
  assert.equal(original.origin, null);
  const unknown = supplementAircraft(
    { ...original, model: 'Aircraft', manufacturer: 'Unidentified' },
    { description: 'Boeing 737 MAX 8' },
    undefined,
  );
  assert.equal(unknown.aircraft.model, '737 MAX 8');
  const html = renderToStaticMarkup(
    <Display
      scene={{ ...base, primary: result.aircraft }}
      live
      enrichmentCredit
    />,
  );
  for (const value of [
    'A320neo',
    'easyJet',
    'DUB',
    'Dublin Airport',
    'https://hexdb.io/',
  ])
    assert.ok(html.includes(value));
});
test('primary renders before enrichment, switching is independent, late route does not attach to another callsign', async () => {
  let now = T,
    calls = 0;
  let resolve!: (r: Response) => void;
  const published: { scene: Scene; credit: boolean }[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const client = createEnricher(
    (scene, credit) => published.push({ scene, credit }),
    {
      now: () => now,
      active: () => true,
      fetch: async () => {
        calls++;
        return new Promise((r) => (resolve = r));
      },
      setTimer: (fn, ms) => {
        const t = setTimeout(fn, ms);
        timers.add(t);
        return t;
      },
      clearTimer: (t) => {
        clearTimeout(t);
        timers.delete(t);
      },
    },
  );
  client.update(base);
  assert.equal(published[0].scene.primary?.model, 'A320neo');
  assert.equal(published[0].credit, false);
  assert.equal(calls, 1);
  client.update({ ...base, primary: { ...base.primary!, callsign: 'EIN17B' } });
  assert.equal(calls, 1);
  resolve(
    response(data('route', normaliseHexdb('route', hex, 'EIN17A', route, T)!)),
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(published[published.length - 1].scene.primary?.origin, null);
  assert.equal(timers.size, 0);
  now += 30000;
  client.update(base);
  await new Promise((r) => setImmediate(r));
  assert.equal(
    published[published.length - 1].scene.primary?.origin?.code,
    'DUB',
  );
  client.stop();
  resolve(response(data('aircraft', { operator: 'easyJet' }, null, now)));
  await new Promise((r) => setImmediate(r));
  assert.equal(client.inspect().entries, 0);
  assert.equal(timers.size, 0);
});
test('client cooldown, cache expiry/negative caching, stopped mode and absent flights make no unnecessary calls', async () => {
  let now = T,
    calls = 0;
  const publications: Scene[] = [];
  const client = createEnricher((s) => publications.push(s), {
    now: () => now,
    active: () => true,
    fetch: async (url) => {
      calls++;
      const kind = new URL(
        String(url),
        'https://local.invalid',
      ).searchParams.get('kind') as EnrichmentKind;
      return response({
        ...data(kind, {}, kind === 'route' ? 'EIN17A' : null, now),
        status: 'not-found',
        expiresAtMs: now + P.negativeTtlMs,
      });
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
  });
  client.update(base);
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20; i++) client.update(base);
  assert.equal(calls, 1);
  now += 30000;
  client.update(base);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  now += P.negativeTtlMs;
  client.update(base);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 3);
  client.stop();
  client.update(base);
  assert.equal(calls, 3);
  const failure = createEnricher(() => {}, {
    now: () => now,
    active: () => true,
    fetch: async () => {
      calls++;
      return response({}, 503);
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
  });
  failure.update(base);
  await new Promise((r) => setImmediate(r));
  const before = calls;
  now += 30000;
  failure.update(base);
  assert.equal(calls, before);
  failure.stop();
  assert.ok(
    publications.every((s) => s.state === 'available' && s.primary?.id === hex),
  );
});

test('client malformed optional response never changes position state and cannot exceed budget/capacity', async () => {
  let now = T,
    calls = 0;
  const scenes: Scene[] = [];
  const client = createEnricher((s) => scenes.push(s), {
    now: () => now,
    active: () => true,
    fetch: async () => {
      calls++;
      return response({ wrong: 'shape' });
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
  });
  client.update(base);
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20; i++) client.update(base);
  assert.equal(calls, 1);
  assert.ok(
    scenes.every((s) => s.primary?.id === hex && s.state === 'available'),
  );
  client.stop();
  const bounded = createEnricher(() => {}, {
    now: () => now,
    active: () => true,
    fetch: async (url) => {
      calls++;
      const query = new URL(String(url), 'https://local.invalid').searchParams;
      return response({
        ...data('aircraft', { registration: 'TEST' }, null, now),
        hex: query.get('hex'),
      });
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
  });
  const before = calls;
  for (let i = 0; i < 130; i++) {
    bounded.update({
      ...base,
      primary: {
        ...base.primary!,
        id: i.toString(16).padStart(6, '0'),
        callsign: null,
      },
    });
    await new Promise((r) => setImmediate(r));
    assert.ok(bounded.inspect().entries <= P.clientCapacity);
    now += 30000;
  }
  assert.equal(calls - before, 130);
  bounded.stop();
  assert.equal(bounded.inspect().entries, 0);
});

test('positive current-primary cache refresh is bounded and retains valid fields until its replacement arrives', async () => {
  let now = T,
    calls = 0;
  const service = createEnrichmentService(
    async () => {
      calls++;
      return { registration: 'TEST-' + calls };
    },
    () => now,
  );
  const initial = await service.get('aircraft', hex, null);
  now = initial.result.expiresAtMs - P.refreshLeadMs - 1;
  await service.get('aircraft', hex, null);
  assert.equal(calls, 1);
  now++;
  const fresh = await service.get('aircraft', hex, null);
  assert.equal(calls, 2);
  assert.ok(fresh.result.expiresAtMs > initial.result.expiresAtMs);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnricher } from '../src/enrichment';
import { observation } from '../src/observation';
import { createAircraftSelector } from '../src/selection';
import { liveScene } from '../src/live';
import { fleet } from '../src/simulation';
import type { Aircraft, Scene } from '../src/simulation';
import { createService } from '../server/service';
import { aircraft, snapshot } from './fixtures/observation-r04';
const T = 1800000000000;
const airport = (code: string) => ({
  code,
  name: code,
  iata: code,
  icao: null,
});
const settle = () => new Promise<void>((r) => setImmediate(r));
function harness(
  t: { after: (fn: () => void) => void },
  negative = false,
) {
  let now = T,
    active = true;
  const calls: {
      at: number;
      kind: string;
      id: string;
      secondary: boolean;
    }[] = [],
    scenes: Scene[] = [];
  let current: Scene;
  const client = createEnricher((s) => scenes.push(s), {
    now: () => now,
    active: () => active,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    fetch: async (url) => {
      const q = new URL(String(url), 'https://fixture.invalid')
          .searchParams,
        kind = q.get('kind')!,
        id = q.get('hex')!;
      calls.push({
        at: now,
        kind,
        id,
        secondary: current.primary?.id !== id,
      });
      return new Response(
        JSON.stringify({
          kind,
          hex: id,
          callsign: q.get('callsign'),
          source: 'hexdb.io',
          status: negative ? 'not-found' : 'found',
          data: negative
            ? {}
            : kind === 'aircraft'
              ? { operator: 'Synthetic' }
              : {
                  origin: airport('AMS'),
                  destination: airport('MAN'),
                  associationTimeMs: now - 542 * 86400000,
                },
          fetchedAtMs: now,
          expiresAtMs: now + (kind === 'aircraft' ? 1800000 : 300000),
        }),
      );
    },
  });
  t.after(client.stop);
  return {
    calls,
    scenes,
    client,
    at: (delta: number) => {
      now = T + delta;
    },
    active: (v: boolean) => {
      active = v;
    },
    update: (s: Scene) => {
      current = s;
      client.update(s);
    },
  };
}
const plane = (id = 'abcdef', callsign = 'PRIMARY'): Aircraft => ({
  ...fleet[0],
  id,
  callsign,
  registration: 'SYNTHETIC',
  operator: 'Known',
  origin: null,
  destination: null,
});
const sky = (id = '111111', speed = 450) =>
  observation(aircraft(id, 10, 35000, { groundSpeedKnots: speed }), T, 3);
const scene = (primary: Aircraft, secondary: Aircraft[]): Scene => ({
  id: 'live',
  label: 'Live',
  duration: 0,
  state: 'available',
  primary,
  secondary,
});
test('R04 urgent secondary beats optional primary metadata and slow unresolved primary route, but not required identity', async (t) => {
  const h = harness(t);
  const primary = {
      ...plane(),
      operator: null,
      observation: observation(
        aircraft('abcdef', 3, 2500, {
          groundSpeedKnots: 80,
          trackDegrees: null,
        }),
        T,
        3,
      ),
    },
    jet = { ...plane('111111', 'JET1'), observation: sky() };
  h.update(scene(primary, [jet]));
  await settle();
  assert.equal(h.calls[0].id, jet.id);
  assert.equal(h.calls[0].secondary, true);
  h.at(15000);
  h.update(scene(primary, [jet]));
  assert.equal(h.calls.length, 1);
  h.at(30000);
  h.update(scene(primary, [jet]));
  await settle();
  assert.equal(h.calls[1].id, primary.id);
  assert.equal(h.calls[1].kind, 'route');
});
test('R04 required primary identification remains first', async (t) => {
  const h = harness(t);
  h.update(
    scene({ ...plane(), model: 'Aircraft', observation: sky('abcdef') }, [
      { ...plane('111111', 'JET1'), observation: sky() },
    ]),
  );
  await settle();
  assert.equal(h.calls[0].kind, 'aircraft');
  assert.equal(h.calls[0].id, 'abcdef');
});
test('R04 current overhead primary route protected; better route utility never changes display identity', async (t) => {
  const h = harness(t);
  const main = {
    ...plane(),
    observation: observation(
      aircraft('abcdef', 0.1, 1000, {
        typeCode: 'H135',
        groundSpeedKnots: 45,
      }),
      T,
      3,
    ),
  };
  h.update(
    scene(main, [{ ...plane('111111', 'JET1'), observation: sky() }]),
  );
  await settle();
  assert.equal(h.calls[0].id, 'abcdef');
  assert.equal(h.scenes.slice(-1)[0].primary?.id, 'abcdef');
  assert.equal(h.scenes.slice(-1)[0].primary?.routeHistorical, true);
});
test('R04 horizon flight deferral preserves a slot for an entering jet; category is not an exclusion', async (t) => {
  const h = harness(t);
  const primary = {
    ...plane(),
    origin: airport('MAN'),
    destination: airport('DUB'),
    observation: observation(aircraft('abcdef', 2, 2500), T, 3),
  };
  const heli = {
    ...plane('222222', 'HELI1'),
    distanceKm: 11,
    typeCode: 'H135',
    observation: observation(
      aircraft('222222', 11, 300, {
        groundSpeedKnots: 60,
        trackDegrees: null,
      }),
      T,
      3,
    ),
  };
  h.update(scene(primary, [heli]));
  await settle();
  assert.equal(h.calls.length, 0);
  h.at(30000);
  const jet = {
    ...plane('111111', 'JET1'),
    observation: {
      ...sky(),
      computedAtMs: T + 30000,
      positionTimeMs: T + 30000,
    },
  };
  h.update(scene(primary, [heli, jet]));
  await settle();
  assert.equal(h.calls[0].id, jet.id);
  h.at(90000);
  h.update(scene(primary, [heli]));
  assert.equal(
    h.calls.length,
    1,
    'collective secondary gate still closed',
  );
  h.at(120000);
  h.update(scene(primary, [heli]));
  await settle();
  assert.equal(
    h.calls[1].id,
    heli.id,
    'resident helicopter still gets a route opportunity',
  );
});
test('R04 negative cache, disappearing flight, changed callsign and stop/hidden controls', async (t) => {
  const h = harness(t, true);
  const primary = {
      ...plane(),
      origin: airport('MAN'),
      destination: airport('DUB'),
    },
    sec = { ...plane('111111', 'JET1'), observation: sky() };
  h.update(scene(primary, [sec]));
  await settle();
  for (const at of [30000, 90000, 150000]) {
    h.at(at);
    h.update(scene(primary, [sec]));
    await settle();
  }
  assert.equal(h.calls.length, 1);
  h.at(180000);
  h.active(false);
  h.update(scene(primary, [{ ...sec, callsign: 'JET2' }]));
  assert.equal(h.calls.length, 1);
  h.active(true);
  h.update(scene(primary, []));
  assert.equal(h.calls.length, 1);
  h.update(scene(primary, [{ ...sec, callsign: 'JET2' }]));
  await settle();
  assert.equal(h.calls.length, 2);
  h.client.stop();
  h.at(400000);
  h.update(scene(primary, [sec]));
  assert.equal(h.calls.length, 2);
});
test('R04 unknown trajectories remain conservative; primary route priority survives near-equal utility', async (t) => {
  const h = harness(t);
  h.update(
    scene(
      {
        ...plane(),
        observation: observation(
          aircraft('abcdef', 3, 6000, { trackDegrees: null }),
          T,
        ),
      },
      [
        {
          ...plane('111111', 'JET1'),
          observation: observation(
            aircraft('111111', 3, 6000, { trackDegrees: null }),
            T,
          ),
        },
      ],
    ),
  );
  await settle();
  assert.equal(h.calls[0].id, 'abcdef');
});
test('R04 two-phase planning does not change selection when route data appears', async (t) => {
  const h = harness(t);
  const select = createAircraftSelector();
  const records = [
    aircraft('abcdef', 0.3, 6500),
    aircraft('111111', 11, 300, { typeCode: 'H135' }),
  ];
  const before = select.select(snapshot(records), T);
  h.update(liveScene(snapshot(records), T, false, before));
  await settle();
  assert.equal(h.scenes.slice(-1)[0].primary?.id, before.primary?.id);
  assert.equal(
    select.select(snapshot(records), T + 1).primary?.id,
    before.primary?.id,
  );
});
test('R04 position-provider source accounting distinguishes one load from coalesced/cache users without new requests', async () => {
  let loads = 0,
    release!: (v: ReturnType<typeof snapshot>) => void;
  const value = snapshot([]);
  const service = createService(
    () => {
      loads++;
      return new Promise((r) => (release = r));
    },
    () => T,
  );
  const traces: string[] = [];
  const a = service((s) => traces.push(s)),
    b = service((s) => traces.push(s));
  release(value);
  await Promise.all([a, b]);
  await service((s) => traces.push(s));
  assert.equal(loads, 1);
  assert.deepEqual(traces, ['provider', 'coalesced', 'cache']);
});

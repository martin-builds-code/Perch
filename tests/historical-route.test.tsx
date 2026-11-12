import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { normaliseHexdb, fetchHexdb } from '../server/hexdb';
import { supplementAircraft, createEnricher } from '../src/enrichment';
import { fleet } from '../src/simulation';
import type { Scene } from '../src/simulation';
import { Display } from '../src/App';
import { ENRICHMENT_POLICY as P } from '../src/enrichmentTypes';
import { routeReviewCases } from '../server/routeReviewCases';
const T = 1794427000000,
  day = 86400000;
const raw = (days: number) => ({
  callsign: 'TEST1',
  updated_at: new Date(T - days * day).toISOString(),
  origin: { iata: 'AMS', icao: 'EHAM', name: 'Amsterdam' },
  destination: { iata: 'MAN', icao: 'EGCC', name: 'Manchester' },
});
const base = {
  ...fleet[0],
  id: 'abcdef',
  callsign: 'TEST1',
  origin: null,
  destination: null,
  operator: 'Known',
  registration: 'TEST',
};
for (const [days, accepted, historical] of [
  [180, true, false],
  [180 + 1 / day, true, true],
  [266, true, true],
  [542, true, true],
  [730, true, true],
  [730 + 1 / day, false, false],
] as const) {
  test('R03 exact boundary ' + days, () => {
    const data = normaliseHexdb('route', 'abcdef', 'TEST1', raw(days), T);
    assert.equal(!!data, accepted);
    if (data) {
      const a = supplementAircraft(base, undefined, data, T).aircraft;
      assert.equal(a.routeHistorical, historical);
      const scene: Scene = {
        id: 'live',
        label: 'Live',
        duration: 0,
        state: 'available',
        primary: a,
        secondary: [{ ...a, id: '111111' }],
      };
      const html = renderToStaticMarkup(<Display scene={scene} />);
      assert.equal(
        (html.match(/Historical route/g) || []).length,
        historical ? 2 : 0,
      );
    }
  });
}
for (const days of [20, 266, 542, 731])
  for (const [name, patch] of Object.entries({
    callsign: { callsign: 'OTHER' },
    sameAirport: { destination: raw(0).origin },
    sequence: { airports: [raw(0).destination, raw(0).origin] },
    invalidAirport: { origin: { iata: '?', icao: '?' } },
    invalidTime: { updated_at: 'nonsense' },
    future: { updated_at: new Date(T + 1).toISOString() },
  }))
    test('R03 rejects ' + name + ' at ' + days + ' days', () =>
      assert.throws(() =>
        normaliseHexdb(
          'route',
          'abcdef',
          'TEST1',
          { ...raw(days), ...patch },
          T,
        ),
      ),
    );
test('R03 preserves partial, ICAO-only and unknown timestamp behavior', () => {
  const missing = normaliseHexdb(
    'route',
    'abcdef',
    'TEST1',
    { ...raw(0), updated_at: null },
    T,
  )!;
  assert.equal(missing.associationTimeMs, null);
  assert.equal(
    supplementAircraft(base, undefined, missing, T).aircraft
      .routeHistorical,
    undefined,
  );
  const partial = normaliseHexdb(
    'route',
    'abcdef',
    'TEST1',
    { ...raw(542), destination: null },
    T,
  )!;
  assert.ok(partial.origin);
  assert.equal(partial.destination, undefined);
  const icao = normaliseHexdb(
    'route',
    'abcdef',
    'TEST1',
    {
      ...raw(542),
      origin: { icao: 'EHAM' },
      destination: { icao: 'EGCC' },
    },
    T,
  )!;
  const html = renderToStaticMarkup(
    <Display
      scene={{
        id: 'live',
        label: 'Live',
        duration: 0,
        state: 'available',
        primary: supplementAircraft(base, undefined, icao, T).aircraft,
        secondary: [],
      }}
    />,
  );
  assert.ok(!html.includes('Historical route'));
});
test('R03 frozen R02 replay recovers seven historical pairs, never invents the positioning route', async () => {
  let recent = 0,
    historical = 0,
    missing = 0;
  for (const c of routeReviewCases.cases) {
    const data = await fetchHexdb(
      'route',
      c.hex,
      c.callsign,
      async () =>
        new Response(
          JSON.stringify({
            callsign: c.callsign,
            origin: c.origin,
            destination: c.destination,
            updated_at: c.updatedAtRaw,
          }),
          { status: c.httpStatus ?? 404 },
        ),
      () => c.lookedUpAtMs,
    );
    if (!data) {
      missing++;
      continue;
    }
    if (
      supplementAircraft(
        { ...base, id: c.hex, callsign: c.callsign },
        undefined,
        data,
        c.lookedUpAtMs,
      ).aircraft.routeHistorical
    )
      historical++;
    else recent++;
  }
  assert.deepEqual(
    { recent, historical, missing },
    { recent: 7, historical: 7, missing: 2 },
  );
  const owner = JSON.parse(
    readFileSync(
      'docs/route-r02/owner-review-2026-11-11-211716.json',
      'utf8',
    ),
  );
  assert.equal(
    owner.cases.find(
      (r: { case: { callsign: string } }) => r.case.callsign === 'EXS041A',
    ).answer.originCode,
    'LBA',
  );
});
test('R03 cache publication and role/callsign changes preserve route ownership without extra requests', async () => {
  let now = T,
    calls = 0;
  const scenes: Scene[] = [];
  const env = {
    fetch: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          kind: 'route',
          hex: 'abcdef',
          callsign: 'TEST1',
          source: 'hexdb.io',
          status: 'found',
          data: normaliseHexdb('route', 'abcdef', 'TEST1', raw(542), T),
          fetchedAtMs: T,
          expiresAtMs: T + P.routeTtlMs,
        }),
      );
    },
    now: () => now,
    active: () => true,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  };
  const e = createEnricher((s) => scenes.push(s), env);
  const scene: Scene = {
    id: 'live',
    label: 'Live',
    duration: 0,
    state: 'available',
    primary: base,
    secondary: [],
  };
  e.update(scene);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(scenes.slice(-1)[0]?.primary?.routeHistorical, true);
  now += 15000;
  e.update({ ...scene, primary: null, secondary: [base] });
  assert.equal(scenes.slice(-1)[0]?.secondary[0].routeHistorical, true);
  e.update(scene);
  assert.equal(scenes.slice(-1)[0]?.primary?.routeHistorical, true);
  assert.equal(calls, 1);
  e.update({ ...scene, primary: { ...base, callsign: 'OTHER' } });
  assert.equal(scenes.slice(-1)[0]?.primary?.origin, null);
  assert.ok(!scenes.slice(-1)[0]?.primary?.routeHistorical);
  e.stop();
});

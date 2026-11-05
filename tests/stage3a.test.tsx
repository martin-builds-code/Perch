import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { Display } from '../src/App';
import {
  artworkFor,
  artworkManifest,
  approvedAsset,
  prominentRoute,
  aircraftName,
} from '../src/artwork';
import type { ArtworkManifest } from '../src/artwork';
import { fleet, scenes } from '../src/simulation';
import type { Aircraft } from '../src/simulation';

const a380: Aircraft = {
  ...fleet[0],
  manufacturer: 'Airbus',
  model: 'A380-800',
  typeCode: 'A388',
};
test('approved handover assets remain byte-identical to supplied checksum/dimension metadata', () => {
  const source = JSON.parse(
    readFileSync('docs/artwork/source-manifest.json', 'utf8'),
  );
  assert.equal(source.files.length, 6);
  for (const asset of source.files) {
    const bytes = readFileSync('public/aircraft/' + asset.filename);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      asset.sha256,
    );
    assert.equal(bytes.length, asset.size_bytes);
    if (asset.format === 'PNG') {
      assert.equal(bytes.readUInt32BE(16), asset.dimensions.width);
      assert.equal(bytes.readUInt32BE(20), asset.dimensions.height);
      assert.equal(bytes[25], 6, 'RGBA source');
    }
  }
});
test('exact aircraft type and readable A380 select the accepted illustration', () => {
  assert.equal(artworkFor(a380)?.id, 'airbus-a380-800');
  assert.equal(
    artworkFor({ ...a380, typeCode: undefined })?.id,
    'airbus-a380-800',
  );
  const html = renderToStaticMarkup(
    <Display scene={{ ...scenes[0], primary: a380 }} />,
  );
  assert.match(html, /aeropane_a380_baseline.webp/);
  assert.match(html, /cloud-layer/);
  assert.match(html, /preserveAspectRatio="xMaxYMax meet"/);
});
test('every approved runtime asset exists with its declared intrinsic dimensions', () => {
  for (const asset of [...artworkManifest.aircraft, artworkManifest.clouds]) {
    if (!approvedAsset(asset)) continue;
    const source = readFileSync('public' + asset.src);
    if (asset.src!.endsWith('.png')) {
      assert.equal(source.readUInt32BE(16), asset.width);
      assert.equal(source.readUInt32BE(20), asset.height);
      assert.equal(source[25], 6);
    }
    if (asset.webp) assert.ok(readFileSync('public' + asset.webp).length > 0);
  }
});
for (const [maker, model, code, expected] of [
  ['Airbus', 'A320neo', 'A20N', 'generic-narrow-body'],
  ['Boeing', '737 MAX 8', 'B38M', 'generic-narrow-body'],
  ['Boeing', '787-9 Dreamliner', 'B789', undefined],
  ['ATR', '72-600', 'AT76', undefined],
  ['Piper', 'PA-28-140/150/160/180', 'P28A', undefined],
  ['Bombardier', 'BD-100 Challenger 350', 'CL35', undefined],
  ['Airbus', 'H135', 'EC35', undefined],
] as const)
  test(`artwork mapping preserves the ${maker} ${model} class`, () => {
    const aircraft = {
      ...a380,
      manufacturer: maker,
      model,
      typeCode: code,
      callsign: 'A388',
      registration: 'A388',
    };
    assert.equal(artworkFor(aircraft)?.id, expected);
    assert.equal(aircraftName(aircraft), maker + ' ' + model);
  });
test('unapproved, unsafe, missing and invalid-frame artwork is never fetched', () => {
  const asset = artworkManifest.aircraft[0];
  for (const invalid of [
    { ...asset, approval: 'pending' },
    { ...asset, src: 'https://untrusted.example/plane.png' },
    { ...asset, src: '/aircraft/../private.png' },
    { ...asset, width: 0 },
    { ...asset, frame: { x: 0, y: 0, width: 99999, height: 1 } },
  ]) {
    assert.equal(approvedAsset(invalid), false);
    const manifest: ArtworkManifest = {
      ...artworkManifest,
      aircraft: [invalid],
    };
    assert.equal(artworkFor(a380, manifest), undefined);
  }
});
test('complete reliable IATA route is prominent; partial/ICAO-only/contradictory codes are omitted', () => {
  assert.deepEqual(prominentRoute(fleet[0]), {
    from: 'LIS',
    to: 'MAN',
    fromName: 'Lisbon',
    toName: 'Manchester',
  });
  for (const origin of [
    null,
    { code: 'EIDW', name: 'Dublin' },
    { code: 'DUB', iata: null, name: 'Dublin' },
    { code: 'DuB', name: 'Dublin' },
  ])
    assert.equal(prominentRoute({ ...fleet[0], origin }), null);
  assert.equal(
    prominentRoute({
      ...fleet[0],
      origin: { code: 'EIDW', iata: 'DUB', name: 'Dublin' },
    })?.from,
    'DUB',
  );
});
test('one aircraft expands and no secondary placeholders reserve space', () => {
  const html = renderToStaticMarkup(<Display scene={scenes[0]} />);
  assert.match(html, /single-aircraft/);
  assert.doesNotMatch(html, /class="nearby"|Also nearby|No other aircraft/);
});
test('approved composition applies to both artwork silhouettes only with a complete multi-aircraft route', () => {
  for (const primary of [a380, { ...fleet[0], typeCode: 'A20N' }]) {
    const multi = { ...scenes[1], primary, secondary: [fleet[3]] };
    const html = renderToStaticMarkup(<Display scene={multi} />);
    assert.match(html, /composed-artwork/);
    assert.match(html, /--regular-art-width:640px/);
    for (const scene of [
      { ...multi, secondary: [] },
      { ...multi, primary: { ...primary, origin: null } },
    ]) {
      const unchanged = renderToStaticMarkup(<Display scene={scene} />);
      assert.doesNotMatch(unchanged, /composed-artwork|--regular-art-width/);
      assert.match(unchanged, /aircraft-layer/);
    }
  }
});
test('new artwork can opt into per-silhouette composition without changing identification or single-aircraft rendering', () => {
  const manifest = structuredClone(artworkManifest);
  delete manifest.aircraft[0].multiAircraft;
  const html = renderToStaticMarkup(
    <Display
      scene={{ ...scenes[1], primary: a380, secondary: [fleet[3]] }}
      manifest={manifest}
    />,
  );
  assert.doesNotMatch(html, /composed-artwork|--regular-art-width/);
  assert.match(html, /aeropane_a380_baseline.webp/);
  for (const asset of artworkManifest.aircraft) {
    for (const p of Object.values(asset.multiAircraft ?? {})) {
      assert.ok(
        Number.isFinite(p.width) &&
          p.width > 0 &&
          p.width <= (asset.frame?.width ?? asset.width),
      );
      assert.ok(Number.isFinite(p.left) && p.left >= 0);
      assert.ok(Number.isFinite(p.top) && p.top >= 0);
    }
  }
});
test('secondary list remains capped, unique and type-focused without missing-operator messages', () => {
  const scene = {
    ...scenes[1],
    secondary: [fleet[0], fleet[1], fleet[1], fleet[2], fleet[3], fleet[4]],
  };
  const html = renderToStaticMarkup(<Display scene={scene} />);
  assert.equal((html.match(/class="nearby-aircraft /g) ?? []).length, 3);
  assert.doesNotMatch(html, /Operator not reported/);
});
test('healthy empty airspace and genuine unavailability remain distinct', () => {
  const empty = renderToStaticMarkup(<Display scene={scenes[5]} live />);
  assert.match(empty, /class="radar"/);
  assert.doesNotMatch(
    empty,
    /aircraft-header|class="primary |class="nearby"|Nothing nearby right now/,
  );
  for (const state of ['unavailable', 'delayed'] as const) {
    const outage = renderToStaticMarkup(
      <Display scene={{ ...scenes[7], state }} live />,
    );
    assert.match(outage, /Aircraft data unavailable/);
    assert.doesNotMatch(outage, /class="radar"/);
  }
});
test('source motion is restrained, keyed by actual identity and has a reduced-motion override', () => {
  const source = readFileSync('src/App.tsx', 'utf8'),
    css = readFileSync('src/style.css', 'utf8');
  assert.match(source, /key=\{scene.primary.id\}/);
  assert.match(css, /aircraft-handover 1s/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(source, /setInterval/);
});

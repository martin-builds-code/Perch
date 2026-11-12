// Local mocked application pipeline; no aviation-provider traffic.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  SCENARIOS,
  traffic,
  REPLAY_START,
} from '../tests/fixtures/r04-trajectories.ts';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const output = 'docs/route-r04/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const T = REPLAY_START + 135000;
const results = [];
const airport = (code) => ({
  code,
  iata: code,
  icao: null,
  name: code === 'AMS' ? 'Amsterdam Schiphol' : 'Manchester',
});
try {
  for (const height of [768, 624]) {
    const page = await browser.newPage({
      viewport: { width: 1024, height },
    });
    await page.clock.install({ time: new Date(T) });
    await page.clock.pauseAt(new Date(T));
    let expired = false,
      positions = 0;
    const attempts = [],
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/session', (r) =>
      r.fulfill({
        status: expired ? 401 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          expired
            ? { error: 'authentication-required' }
            : {
                authenticated: true,
                routeDiagnosticTrial: { expiresAtMs: T + 180000 },
              },
        ),
      }),
    );
    await page.route('**/api/aircraft', async (r) => {
      positions++;
      const now = await page.evaluate(() => Date.now());
      await r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ...traffic(SCENARIOS[0], (now - REPLAY_START) / 1000),
          aircraft: traffic(
            SCENARIOS[0],
            (now - REPLAY_START) / 1000,
          ).aircraft.map((a) => ({
            ...a,
            callsign: 'TEST' + a.id.slice(-1),
          })),
        }),
      });
    });
    await page.route('**/api/enrichment?*', async (r) => {
      const q = new URL(r.request().url()).searchParams;
      const now = await page.evaluate(() => Date.now());
      const hex = q.get('hex'),
        kind = q.get('kind');
      attempts.push({ at: now, kind, hex });
      const found = hex === '000002' || kind === 'aircraft';
      await r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          kind,
          hex,
          callsign: q.get('callsign'),
          source: 'hexdb.io',
          status: found ? 'found' : 'not-found',
          data: !found
            ? {}
            : kind === 'aircraft'
              ? { operator: 'Synthetic airline' }
              : {
                  origin: airport('AMS'),
                  destination: airport('MAN'),
                  associationTimeMs: now - 266 * 86400000,
                },
          fetchedAtMs: now,
          expiresAtMs: now + (kind === 'aircraft' ? 1800000 : 300000),
          diagnostic: {
            origin: 'hexdb',
            serverCache: 'miss',
            upstreamRequestsStarted: 1,
            upstreamResponses: 1,
            outcome: !found
              ? 'negative'
              : kind === 'aircraft'
                ? 'identity'
                : 'complete',
            reason: !found ? 'http-404' : 'validated',
            httpStatus: found ? 200 : 404,
            durationMs: 1,
          },
        }),
      });
    });
    await page.goto('http://127.0.0.1:5173/?mode=live&sky=1');
    await page
      .getByRole('heading', { name: 'R04 observation-cone comparison' })
      .waitFor();
    await page.waitForFunction(
      () => window.aeroPaneSkyDiagnostics?.summary().frames.length > 0,
    );
    for (let i = 0; i < 2; i++) {
      await page.clock.fastForward(15000);
      await page.waitForTimeout(40);
    }
    const summary = await page.evaluate(() =>
      window.aeroPaneSkyDiagnostics.summary(),
    );
    const high = summary.latest.ranked.find((r) => r.typeCode === 'B738');
    const heli = summary.latest.ranked.find((r) => r.typeCode === 'H135');
    assert.equal(summary.latest.primary, high.ref);
    assert.equal(
      summary.latest.baselinePrimary,
      heli.ref,
      'same live snapshots feed the frozen R03 shadow',
    );
    assert.equal(high.observation.predictionQuality, 'supported');
    assert.ok(high.observation.elevationDegrees > 45);
    assert.ok(heli.observation.elevationDegrees < 1);
    assert.ok(high.score > heli.score + 20);
    assert.doesNotMatch(
      JSON.stringify(summary),
      /SYNTHETIC|TEST2|"latitude"|"longitude"|"registration":"[^n]/,
    );
    assert.ok(
      summary.events.some(
        (e) =>
          e.type === 'response' &&
          e.kind === 'route' &&
          e.diagnostic.outcome === 'complete',
      ),
    );
    const screen = await page.evaluate(() => ({
      scrolling:
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
      table: !!document.querySelector('.sky-trial table'),
    }));
    assert.equal(screen.scrolling, false);
    assert.equal(screen.table, true);
    await page.screenshot({ path: `${output}/comparison-${height}.png` });
    const count = attempts.length;
    await page.clock.fastForward(4000);
    await page.waitForTimeout(30);
    assert.equal(
      attempts.length,
      count,
      'diagnostic refresh timer does not initiate lookups',
    );
    // Change only the diagnostic view, keeping the same live component and caches.
    await page.evaluate(() =>
      history.replaceState(null, '', '?mode=live&view=normal'),
    );
    await page.clock.fastForward(11000);
    await page.waitForTimeout(40);
    await page
      .getByText('Historical route', { exact: true })
      .first()
      .waitFor();
    const illustration = () =>
      page.locator('.artwork-stage').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
    const box = await illustration();
    await page.screenshot({
      path: `${output}/normal-historical-${height}.png`,
    });
    assert.ok(
      attempts.every((a, i) => !i || a.at - attempts[i - 1].at >= 30000),
    );
    assert.ok(
      attempts
        .filter((a) => a.hex !== '000002')
        .every((a, i, xs) => !i || a.at - xs[i - 1].at >= 90000),
    );
    expired = true;
    await page.clock.fastForward(135000);
    await page.getByLabel('Eight-digit PIN').waitFor();
    assert.equal(
      await page.evaluate(() => window.aeroPaneSkyDiagnostics),
      undefined,
    );
    const afterPositions = positions,
      afterAttempts = attempts.length;
    await page.clock.fastForward(60000);
    assert.equal(
      positions,
      afterPositions,
      'expired trial stops positional polling',
    );
    assert.equal(
      attempts.length,
      afterAttempts,
      'expired trial stops enrichment',
    );
    assert.deepEqual(errors, []);
    results.push({
      height,
      positions,
      attempts: attempts.map((a) => ({
        atMs: a.at - T,
        kind: a.kind,
        secondary: a.hex !== '000002',
      })),
      baselineCompared: true,
      geometrySupported: true,
      historicalVisible: true,
      illustration: box,
      trialExpiryToPin: true,
      cleanShutdown: true,
      networkProviders: 0,
    });
    await page.close();
  }
  await writeFile(
    output + '/checks.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    'PASS R04 browser: same-snapshot R03 comparison, supported geometry, historical publication, diagnostic privacy, unchanged request limits and expiry cleanup at both iPad sizes.',
  );
} finally {
  await browser.close();
}

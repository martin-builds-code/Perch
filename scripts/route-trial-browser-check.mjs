// Mocked browser lifecycle/measurement test. Never accesses aviation providers.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const T = Date.parse('2026-11-11T10:00:00Z'),
  output = 'docs/stage3-route-investigation';
await mkdir(output, { recursive: true });
const airport = (code) => ({ code, iata: code, icao: null, name: code });
const outcomes = [];
try {
  for (const height of [768, 624]) {
    const page = await browser.newPage({
      viewport: { width: 1024, height },
    });
    await page.clock.install({ time: new Date(T) });
    await page.clock.pauseAt(new Date(T));
    let expired = false,
      positions = 0;
    const attempts = [];
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/session', (r) =>
      r.fulfill({
        status: expired ? 401 : 200,
        contentType: 'application/json',
        body: expired
          ? '{"error":"authentication-required"}'
          : JSON.stringify({
              authenticated: true,
              routeDiagnosticTrial: { expiresAtMs: T + 180000 },
            }),
      }),
    );
    await page.route('**/api/aircraft', async (r) => {
      positions++;
      const now = await page.evaluate(() => Date.now());
      const aircraft = [
        'abcdef',
        '111111',
        '222222',
        '333333',
        '444444',
      ].map((id, i) => ({
        id,
        callsign: 'TEST' + (i + 1),
        registration: 'SYNTHETIC',
        description: 'Airbus A320neo',
        typeCode: 'A20N',
        distanceKm: 1 + i * 3,
        barometricAltitudeFt: 6000,
        onGround: false,
        geometricAltitudeFt: null,
        groundSpeedKnots: 210,
        trackDegrees: 90,
        positionTimeMs: now - 1000,
        source: 'adsb.fi',
        validity: { position: true, timestamp: true, anomalies: [] },
      }));
      await r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          aircraft,
          fetchedAtMs: now,
          providerTimeMs: now,
          pollIntervalMs: 15000,
          rejectedRecords: 0,
          anomalies: [],
        }),
      });
    });
    await page.route('**/api/enrichment?*', async (r) => {
      const q = new URL(r.request().url()).searchParams,
        now = await page.evaluate(() => Date.now()),
        hex = q.get('hex'),
        kind = q.get('kind');
      attempts.push({ at: now, kind, secondary: hex !== 'abcdef' });
      const outcome =
        kind === 'aircraft'
          ? 'identity'
          : hex === 'abcdef'
            ? 'rejected'
            : hex === '111111'
              ? 'negative'
              : 'complete';
      const found = outcome === 'identity' || outcome === 'complete';
      await r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          kind,
          hex,
          callsign: q.get('callsign'),
          source: 'hexdb.io',
          status: found ? 'found' : 'not-found',
          data:
            outcome === 'identity'
              ? { operator: 'Synthetic operator' }
              : outcome === 'complete'
                ? { origin: airport('MAN'), destination: airport('AMS') }
                : {},
          fetchedAtMs: now,
          expiresAtMs: now + (kind === 'aircraft' ? 1800000 : 300000),
          diagnostic: {
            origin: 'hexdb',
            serverCache: 'miss',
            upstreamRequestsStarted: 1,
            upstreamResponses: 1,
            outcome,
            reason:
              outcome === 'rejected'
                ? 'route-too-old'
                : outcome === 'negative'
                  ? 'http-404'
                  : 'validated',
            httpStatus: outcome === 'negative' ? 404 : 200,
            durationMs: 2,
            ...(outcome === 'rejected'
              ? {
                  summary: {
                    callsignMatches: true,
                    origin: true,
                    destination: true,
                    iataPair: true,
                    associationAgeDays: 4000,
                  },
                }
              : {}),
          },
        }),
      });
    });
    await page.goto('http://127.0.0.1:5173/?mode=live');
    await page
      .getByRole('heading', { name: 'Experimental route investigation' })
      .waitFor();
    await page.getByText('Route rejected', { exact: true }).waitFor();
    for (let i = 0; i < 10; i++) {
      await page.clock.fastForward(15000);
      await page.waitForTimeout(25);
    }
    await page.getByText('MAN → AMS', { exact: true }).waitFor();
    const report = await page.evaluate(() =>
      window.aeroPaneRouteDiagnostics.summary(),
    );
    assert.equal(report.distinctAircraft, 5);
    assert.equal(report.distinctDisplayedFlights, 4);
    assert.equal(report.counters.hexdbRequestsStarted, 4);
    assert.equal(report.counters.routeRejectedResponses, 1);
    assert.equal(report.counters.routeNegativeResponses, 1);
    assert.equal(report.counters.routeCompleteResponses, 1);
    assert.equal(attempts.length, 4);
    assert.ok(
      attempts.every((a, i) => !i || a.at - attempts[i - 1].at >= 30000),
    );
    const secondary = attempts.filter((a) => a.secondary);
    assert.ok(secondary[1].at - secondary[0].at >= 90000);
    assert.ok(
      report.current.some((r) => r.state === 'Cached negative result'),
    );
    assert.doesNotMatch(
      JSON.stringify(report),
      /abcdef|TEST1|latitude|longitude|SYNTHETIC/,
    );
    await page.screenshot({
      path: output + '/diagnostics-' + height + '.png',
    });
    expired = true;
    await page.clock.fastForward(30000);
    await page.getByLabel('Eight-digit PIN').waitFor();
    assert.equal(
      await page.evaluate(() => window.aeroPaneRouteDiagnostics),
      undefined,
    );
    const count = positions;
    await page.clock.fastForward(60000);
    assert.equal(positions, count);
    assert.deepEqual(errors, []);
    outcomes.push({
      height,
      counts: report.counters,
      detected: report.distinctAircraft,
      displayed: report.distinctDisplayedFlights,
      expiredToPin: true,
      noExtraPolls: true,
    });
    await page.close();
  }
  await writeFile(
    output + '/browser-tests.json',
    JSON.stringify(outcomes, null, 2) + '\n',
  );
  console.log(
    'PASS route diagnostic states, real pipeline publication, count bounds/privacy, unchanged budgets and automatic trial expiry at both iPad sizes.',
  );
} finally {
  await browser.close();
}

// Mocked local API only. No calls to adsb.fi or HexDB.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const T = Date.parse('2026-11-11T12:00:00Z'),
  output = 'docs/route-r01';
await mkdir(output, { recursive: true });
const results = [];
const airport = (code) => ({ code, iata: code, icao: null, name: code });
try {
  for (const height of [768, 624]) {
    const page = await browser.newPage({
      viewport: { width: 1024, height },
    });
    await page.clock.install({ time: new Date(T) });
    await page.clock.pauseAt(new Date(T));
    const calls = [],
      errors = [];
    let positions = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/session', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          routeDiagnosticTrial: { expiresAtMs: T + 720000 },
        }),
      }),
    );
    await page.route('**/api/aircraft', async (r) => {
      positions++;
      const now = await page.evaluate(() => Date.now());
      const aircraft = ['abcdef', '111111', '222222'].map((id, i) => ({
        id,
        callsign: 'TEST' + i,
        registration: 'SYNTHETIC',
        description: 'Airbus A320neo',
        typeCode: 'A20N',
        distanceKm: 1 + i * 4,
        barometricAltitudeFt: 6000,
        onGround: false,
        geometricAltitudeFt: null,
        groundSpeedKnots: 200,
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
        kind = q.get('kind'),
        hex = q.get('hex');
      calls.push({ at: now, kind, hex });
      const defer =
        calls.length === 1 || calls.length === 3 || calls.length === 5;
      if (defer) {
        const reason = calls.length === 3 ? 'in-flight' : 'global-gate';
        await r.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'Retry-After': '30' },
          body: JSON.stringify({
            error: 'cooldown',
            failure: {
              schemaVersion: 1,
              origin: 'application',
              category: 'local-deferral',
              reason,
              retryAfterMs: 30000,
              issuedAtMs: now,
              upstreamRequestsStarted: 0,
              upstreamResponses: 0,
            },
            diagnostic: {
              origin: 'application',
              serverCache: 'none',
              upstreamRequestsStarted: 0,
              upstreamResponses: 0,
              outcome: 'error',
              reason: 'cooldown',
              httpStatus: null,
              retryAfterMs: 30000,
              durationMs: 0,
            },
          }),
        });
        return;
      }
      await r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          kind,
          hex,
          callsign: q.get('callsign'),
          source: 'hexdb.io',
          status: 'found',
          data:
            kind === 'aircraft'
              ? { operator: 'Native operator' }
              : { origin: airport('MAN'), destination: airport('AMS') },
          fetchedAtMs: now,
          expiresAtMs: now + (kind === 'aircraft' ? 1800000 : 300000),
          diagnostic: {
            origin: 'hexdb',
            serverCache: 'miss',
            upstreamRequestsStarted: 1,
            upstreamResponses: 1,
            outcome: kind === 'aircraft' ? 'identity' : 'complete',
            reason: 'validated',
            httpStatus: 200,
            durationMs: 1,
          },
        }),
      });
    });
    await page.goto('http://127.0.0.1:5173/?mode=live');
    await page
      .getByRole('heading', { name: 'Experimental route investigation' })
      .waitFor();
    await page.waitForFunction(
      () =>
        window.aeroPaneRouteDiagnostics?.summary().counters
          .verifiedLocalDeferrals === 1,
    );
    for (let i = 0; i < 22; i++) {
      await page.clock.fastForward(15000);
      await page.waitForTimeout(30);
    }
    const report = await page.evaluate(() =>
      window.aeroPaneRouteDiagnostics.summary(),
    );
    // R04 spends the earlier opportunity on a route instead of optional identity.
    // Keep the original local-deferral/backoff, interval and cleanup assertions.
    assert.deepEqual(
      calls.map((c) => (c.at - T) / 1000),
      [0, 30, 60, 90, 150, 240, 300, 330],
    );
    assert.equal(report.counters.verifiedLocalDeferrals, 3);
    assert.equal(report.counters.clientCooldownIncidents ?? 0, 0);
    assert.equal(report.counters.localDeferralsAmplified ?? 0, 0);
    assert.deepEqual(
      report.deferrals.map((d) => d.actualDelayMs),
      [30000, 30000, 90000],
    );
    assert.ok(
      report.deferrals[2].observedRestrictions.includes(
        'secondary-interval',
      ),
    );
    assert.equal(report.counters.hexdbRequestsStarted, 5);
    assert.equal(
      calls[6].hex,
      'abcdef',
      'primary refresh retains priority',
    );
    assert.equal(calls[7].hex, '222222');
    assert.deepEqual(errors, []);
    assert.equal(
      report.current.filter((r) => r.displayedRoute === 'MAN → AMS')
        .length,
      3,
    );
    assert.ok(
      calls.every((v, i) => !i || v.at - calls[i - 1].at >= 30000),
    );
    const secondary = calls.filter((c) => c.hex !== 'abcdef');
    assert.ok(
      secondary.every((v, i) => !i || v.at - secondary[i - 1].at >= 90000),
    );
    await page.screenshot({
      path: output + '/mock-local-' + height + '.png',
    });
    const n = calls.length;
    await page.goto('http://127.0.0.1:5173/?mode=simulation');
    await page.clock.fastForward(90000);
    assert.equal(calls.length, n);
    results.push({
      height,
      applicationAttempts: calls.length,
      verifiedDeferrals: 3,
      deferralActualWaitsMs: report.deferrals.map((d) => d.actualDelayMs),
      failureBackoffs: 0,
      extraProviderRequests: 0,
      correctedCadence: true,
      shutdown: true,
      positions,
    });
    await page.close();
  }
  // A real provider limit (represented by the application API) keeps its full wait.
  const p = await browser.newPage({
    viewport: { width: 1024, height: 768 },
  });
  await p.clock.install({ time: new Date(T) });
  await p.clock.pauseAt(new Date(T));
  let requests = 0;
  await p.route('**/api/session', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        routeDiagnosticTrial: { expiresAtMs: T + 720000 },
      }),
    }),
  );
  await p.route('**/api/aircraft', async (r) => {
    const now = await p.evaluate(() => Date.now());
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        aircraft: [
          {
            id: 'abcdef',
            callsign: 'TEST0',
            registration: 'SYNTHETIC',
            description: 'Airbus A320neo',
            typeCode: 'A20N',
            distanceKm: 1,
            barometricAltitudeFt: 6000,
            onGround: false,
            geometricAltitudeFt: null,
            groundSpeedKnots: 200,
            trackDegrees: 90,
            positionTimeMs: now - 1000,
            source: 'adsb.fi',
            validity: { position: true, timestamp: true, anomalies: [] },
          },
        ],
        fetchedAtMs: now,
        providerTimeMs: now,
        pollIntervalMs: 15000,
        rejectedRecords: 0,
        anomalies: [],
      }),
    });
  });
  await p.route('**/api/enrichment?*', (r) => {
    requests++;
    return r.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'Retry-After': '600' },
      body: JSON.stringify({
        error: 'rate-limited',
        failure: {
          schemaVersion: 1,
          origin: 'hexdb',
          category: 'upstream-failure',
          reason: 'rate-limited',
          retryAfterMs: 600000,
          issuedAtMs: T,
          upstreamRequestsStarted: 1,
          upstreamResponses: 1,
        },
        diagnostic: {
          origin: 'hexdb',
          serverCache: 'miss',
          upstreamRequestsStarted: 1,
          upstreamResponses: 1,
          outcome: 'error',
          reason: 'rate-limited',
          httpStatus: 429,
          retryAfterMs: 600000,
          durationMs: 1,
        },
      }),
    });
  });
  await p.goto('http://127.0.0.1:5173/?mode=live');
  await p.waitForFunction(
    () =>
      window.aeroPaneRouteDiagnostics?.summary().counters
        .clientCooldownIncidents === 1,
  );
  for (let i = 0; i < 39; i++) {
    await p.clock.fastForward(15000);
    await p.waitForTimeout(15);
  }
  assert.equal(requests, 1);
  await p.clock.fastForward(15000);
  await p.waitForTimeout(30);
  assert.equal(requests, 2);
  results.push({
    case: 'upstream 429',
    retryAfterMs: 600000,
    noEarlyRetry: true,
  });
  await p.close();
  await writeFile(
    output + '/browser-tests.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    'PASS R01 real-browser mock: 30s deferrals, 90s secondary constraint, primary priority, shutdown and full upstream protection at both iPad viewports.',
  );
} finally {
  await browser.close();
}

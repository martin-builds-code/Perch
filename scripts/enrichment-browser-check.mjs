const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const T = 1_800_000_000_000,
  results = [];
try {
  for (const viewport of [
    { width: 1024, height: 624 },
    { width: 1024, height: 768 },
    { width: 1112, height: 834 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.clock.install({ time: new Date(T) });
    let positions = 0,
      enrichments = 0,
      pending;
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/aircraft', async (route) => {
      positions++;
      const now = await page.evaluate(() => Date.now());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          aircraft: [
            {
              id: 'abcdef',
              callsign: positions >= 4 ? 'RYR999' : 'RYR123',
              registration: null,
              description: 'Boeing 737 MAX 8',
              typeCode: 'B38M',
              distanceKm: 3,
              barometricAltitudeFt: 12000,
              geometricAltitudeFt: null,
              onGround: false,
              groundSpeedKnots: 210,
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
    await page.route('**/api/enrichment?*', async (route) => {
      enrichments++;
      const kind = new URL(route.request().url()).searchParams.get('kind');
      if (kind === 'route') {
        pending = route;
        return;
      }
      const now = await page.evaluate(() => Date.now());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          kind,
          hex: 'abcdef',
          callsign: null,
          source: 'hexdb.io',
          status: 'found',
          data: {
            operator: 'Ryanair',
            registration: 'TEST-REG',
            description: 'Boeing 737-800',
          },
          fetchedAtMs: now,
          expiresAtMs: now + 1800000,
        }),
      });
    });
    await page.goto('http://127.0.0.1:5173/?mode=live&diagnostics=30');
    await page.locator('.model').filter({ hasText: '737 MAX 8' }).waitFor();
    await page.waitForFunction(
      () => window.aeroPaneDiagnostics?.summary().pollingAttempts === 1,
    );
    assert.match(await page.locator('.operator').innerText(), /not reported/);
    assert.equal(
      await page.locator('.airport-name').first().innerText(),
      'Not reported',
    );
    await page.waitForTimeout(50);
    assert.ok(pending);
    const now = await page.evaluate(() => Date.now());
    const longName = 'Dublin International Airport Passenger Terminal';
    await pending.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'route',
        hex: 'abcdef',
        callsign: 'RYR123',
        source: 'hexdb.io',
        status: 'found',
        data: {
          origin: { code: 'DUB', iata: 'DUB', icao: 'EIDW', name: longName },
          destination: {
            code: 'LHR',
            iata: 'LHR',
            icao: 'EGLL',
            name: 'Heathrow Airport',
          },
        },
        fetchedAtMs: now,
        expiresAtMs: now + 300000,
      }),
    });
    await page.locator('.airport-code').filter({ hasText: 'DUB' }).waitFor();
    await page.clock.fastForward(15000);
    await page.waitForFunction(
      () => window.aeroPaneDiagnostics.summary().successfulRequests === 2,
    );
    await page.clock.fastForward(15000);
    await page.locator('.operator').filter({ hasText: 'Ryanair' }).waitFor();
    assert.equal(positions, 3);
    assert.equal(enrichments, 2);
    assert.equal(await page.locator('.model').innerText(), '737 MAX 8');
    assert.ok((await page.locator('footer').innerText()).includes('HexDB'));
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '.content{animation:none}' });
    const layout = await page.evaluate(() => ({
      footerBottom: document.querySelector('footer').getBoundingClientRect()
        .bottom,
      identityBottom: document
        .querySelector('.operator')
        .getBoundingClientRect().bottom,
      routeTop: document.querySelector('.route').getBoundingClientRect().top,
      routeBottom: document.querySelector('.route').getBoundingClientRect()
        .bottom,
      detailsTop: document.querySelector('.details').getBoundingClientRect()
        .top,
      nameTitle: document.querySelector('.airport-name').title,
      nameSingleLine: getComputedStyle(document.querySelector('.airport-name'))
        .whiteSpace,
    }));
    assert.ok(layout.footerBottom <= viewport.height);
    assert.ok(layout.identityBottom <= layout.routeTop);
    assert.ok(layout.routeBottom <= layout.detailsTop);
    assert.equal(layout.nameTitle, longName);
    assert.equal(layout.nameSingleLine, 'nowrap');
    if (viewport.height === 768)
      await page.screenshot({ path: 'docs/stage-2c-enrichment-fixture.png' });
    await page.clock.fastForward(15000);
    await page.locator('.details').filter({ hasText: 'RYR999' }).waitFor();
    assert.equal(
      await page.locator('.airport-name').first().innerText(),
      'Not reported',
      'old callsign route must disappear',
    );
    const diagnostics = await page.evaluate(() =>
      window.aeroPaneDiagnostics.summary(),
    );
    assert.equal(diagnostics.failedRequests, 0);
    assert.equal(diagnostics.delayedEpisodes, 0);
    assert.equal(diagnostics.primaryChanges, 1);
    assert.ok(!JSON.stringify(diagnostics).includes('abcdef'));
    const before = positions;
    await page.goto('http://127.0.0.1:5173/');
    await page.locator('main[data-scene="single"]').waitFor();
    await page.clock.fastForward(45000);
    assert.equal(positions, before);
    assert.equal(
      await page.evaluate(() => window.aeroPaneDiagnostics),
      undefined,
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      positionsBeforeSimulation: positions,
      enrichmentRequests: enrichments,
      layout,
      delayedEpisodes: diagnostics.delayedEpisodes,
      errors,
    });
    await page.close();
  }
  const page = await browser.newPage({
    viewport: { width: 1024, height: 768 },
  });
  await page.clock.install({ time: new Date(T) });
  let calls = 0;
  await page.route('**/api/enrichment?*', () => {});
  await page.route('**/api/aircraft', async (route) => {
    calls++;
    const now = await page.evaluate(() => Date.now());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        aircraft: [
          {
            id: 'abcdef',
            callsign: 'RYR123',
            registration: null,
            description: 'Boeing 737 MAX 8',
            typeCode: 'B38M',
            distanceKm: 3,
            barometricAltitudeFt: 12000,
            geometricAltitudeFt: null,
            onGround: false,
            groundSpeedKnots: 210,
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
  await page.goto('http://127.0.0.1:5173/?mode=live&diagnostics=30');
  await page.locator('.model').waitFor();
  await page.clock.fastForward(15000);
  await page.waitForFunction(
    () => window.aeroPaneDiagnostics.summary().successfulRequests === 2,
  );
  const timeoutSummary = await page.evaluate(() =>
    window.aeroPaneDiagnostics.summary(),
  );
  assert.equal(calls, 2);
  assert.equal(timeoutSummary.failedRequests, 0);
  assert.equal(timeoutSummary.delayedEpisodes, 0);
  results.push({
    case: 'enrichment timeout',
    positionRequests: calls,
    positionalFailures: 0,
    delayedEpisodes: 0,
  });
  await page.close();
  await writeFile(
    'docs/stage-2c-browser-checks.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    'PASS: enrichment, long route slots, native model, callsign switch, timeout isolation, diagnostics and simulation cleanup at three sizes.',
  );
} finally {
  await browser.close();
}

// Optional local browser check. Requires Playwright Core and Chromium, never a hosted Preview.
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const T = 1_800_000_000_000;
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const results = [];
try {
  for (const viewport of [
    { width: 1024, height: 624 },
    { width: 1024, height: 768 },
    { width: 1112, height: 834 },
  ]) {
    const page = await browser.newPage({ viewport });
    let requests = 0;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date(T) });
    await page.route('**/api/aircraft', (route) => {
      const step = requests++,
        now = T + step * 15000;
      const aircraft = [
        ['aa0001', 'FIXTURE-A', 3.3 + step * 0.2],
        ['bb0002', 'FIXTURE-B', 4.5 - step * 0.2],
      ].map(([id, callsign, distanceKm]) => ({
        id,
        callsign,
        distanceKm,
        description: 'Boeing 737 MAX 8',
        registration: null,
        typeCode: 'B38M',
        barometricAltitudeFt: 12000,
        geometricAltitudeFt: null,
        onGround: false,
        groundSpeedKnots: 220,
        trackDegrees: 90,
        positionTimeMs: now - 1000,
        source: 'adsb.fi',
        validity: { position: true, timestamp: true, anomalies: [] },
      }));
      return route.fulfill({
        status: 200,
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
    await page.goto('http://127.0.0.1:5173/?mode=live');
    await page
      .locator('.primary .details')
      .filter({ hasText: 'FIXTURE-A' })
      .waitFor();
    assert.equal(requests, 1);
    await page.clock.fastForward(15000);
    await page.waitForFunction(() =>
      document
        .querySelector('.metric-value.distance')
        ?.textContent?.includes('3.5'),
    );
    assert.equal(requests, 2);
    assert.match(
      await page.locator('.primary .details').innerText(),
      /FIXTURE-A/,
    );
    await page.clock.fastForward(15000);
    await page
      .locator('.primary .details')
      .filter({ hasText: 'FIXTURE-B' })
      .waitFor();
    assert.equal(requests, 3);
    assert.match(await page.locator('.nearby-list').innerText(), /FIXTURE-A/);
    assert.equal(await page.locator('.nearby-aircraft').count(), 1);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '.content{animation:none}' });
    const layout = await page.evaluate(() => {
      const footer = document.querySelector('footer').getBoundingClientRect();
      return {
        footerBottom: footer.bottom,
        viewportHeight: innerHeight,
        nearbyBottom: document.querySelector('.nearby').getBoundingClientRect()
          .bottom,
        footerTop: footer.top,
        identityBottom: document
          .querySelector('.operator')
          .getBoundingClientRect().bottom,
        routeTop: document.querySelector('.route').getBoundingClientRect().top,
      };
    });
    assert.ok(layout.footerBottom <= viewport.height);
    assert.ok(layout.nearbyBottom <= layout.footerTop);
    assert.ok(layout.identityBottom <= layout.routeTop);
    assert.equal(await page.locator('button,input,select').count(), 0);
    if (viewport.height === 768)
      await page.screenshot({ path: 'docs/stage-2b-live-fixture.png' });
    await page.goto('http://127.0.0.1:5173/');
    await page.locator('main[data-scene="single"]').waitFor();
    await page.clock.fastForward(45000);
    assert.equal(requests, 3, 'simulation must not poll aircraft');
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      syntheticRequests: requests,
      primaryAtSeconds: [
        { at: 0, id: 'aa0001' },
        { at: 15, id: 'aa0001' },
        { at: 30, id: 'bb0002' },
      ],
      simulationRequests: 0,
      layout,
      browserErrors: errors,
    });
    await page.close();
  }
  await writeFile(
    'docs/stage-2b-browser-checks.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    'PASS: three landscape viewports; stable acquisition and approaching handover, three synthetic requests each, simulation stops polling, no page errors.',
  );
} finally {
  await browser.close();
}

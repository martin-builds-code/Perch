const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const results = [];
for (const size of [
  { width: 1024, height: 624 },
  { width: 1024, height: 768 },
  { width: 1112, height: 834 },
]) {
  const page = await browser.newPage({ viewport: size });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const scene of [
    'single',
    'multiple',
    'incomplete',
    'standby',
    'delayed',
    'unavailable',
  ]) {
    const shots = [];
    for (const port of [5174, 5173]) {
      await page.goto(`http://127.0.0.1:${port}/?scene=${scene}`);
      await page.locator('main').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await page.addStyleTag({ content: '.content{animation:none}' });
      shots.push(await page.screenshot());
    }
    if (!shots[0].equals(shots[1])) {
      await writeFile('/tmp/perch-before.png', shots[0]);
      await writeFile('/tmp/perch-after.png', shots[1]);
    }
    assert.ok(
      shots[0].equals(shots[1]),
      `simulation pixels changed ${scene} ${size.height}`,
    );
    results.push({ size, scene, pixelIdentical: true });
  }
  const sample = {
    aircraft: Array.from({ length: 4 }, (_, i) => ({
      id: `abcde${i}`,
      callsign: 'TEST123',
      registration: null,
      description: i === 0 ? 'Boeing 737 MAX 8' : 'Airbus A321neo',
      typeCode: 'B38M',
      distanceKm: 1 + i,
      barometricAltitudeFt: 12000,
      geometricAltitudeFt: null,
      onGround: false,
      groundSpeedKnots: 200,
      trackDegrees: 90,
      positionTimeMs: Date.now() - 1000,
      source: 'adsb.fi',
      validity: { position: true, timestamp: true, anomalies: [] },
    })),
    fetchedAtMs: Date.now(),
    providerTimeMs: Date.now(),
    pollIntervalMs: 15000,
    rejectedRecords: 0,
    anomalies: [],
  };
  for (const state of ['available', 'delayed', 'empty', 'unavailable']) {
    await page.route('**/api/aircraft', (route) => {
      const body = structuredClone(sample);
      if (state === 'empty') body.aircraft = [];
      if (state === 'delayed')
        body.aircraft.forEach((a) => (a.positionTimeMs = Date.now() - 45000));
      return route.fulfill({
        status: state === 'unavailable' ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.goto('http://127.0.0.1:5173/?mode=live');
    await page.waitForTimeout(100);
    await page.evaluate(() => document.fonts.ready);
    const footer = await page.locator('footer').innerText();
    assert.ok(footer.includes('Live'));
    if (state === 'available') {
      await page
        .getByRole('heading', { level: 1 })
        .filter({ hasText: '737 MAX 8' })
        .waitFor();
      assert.equal(await page.locator('.nearby-aircraft').count(), 3);
    }
    const layout = await page.evaluate(() => {
      const footer = document.querySelector('footer').getBoundingClientRect();
      const near = document.querySelector('.nearby').getBoundingClientRect();
      return {
        footerBottom: footer.bottom,
        height: innerHeight,
        nearBottom: near.bottom,
        footerTop: footer.top,
        identityBottom:
          document.querySelector('.operator')?.getBoundingClientRect().bottom ??
          0,
        routeTop:
          document.querySelector('.route')?.getBoundingClientRect().top ?? 0,
        nearbyCards: [...document.querySelectorAll('.nearby-aircraft')].map(
          (e) => ({
            identityBottom: e
              .querySelector('.nearby-identity')
              .getBoundingClientRect().bottom,
            valueTop: e.querySelector('.nearby-value').getBoundingClientRect()
              .top,
          }),
        ),
      };
    });
    assert.ok(layout.footerBottom <= size.height);
    assert.ok(layout.nearBottom <= layout.footerTop);
    assert.ok(layout.identityBottom <= layout.routeTop);
    for (const card of layout.nearbyCards)
      assert.ok(card.identityBottom <= card.valueTop + 1);
    results.push({ size, state, footer, layout });
    if (size.height === 768 && state === 'available')
      await page.screenshot({ path: './docs/stage-2a-live-fixture.png' });
    await page.unroute('**/api/aircraft');
  }
  assert.deepEqual(errors, []);
  await page.close();
}
await writeFile(
  './docs/stage-2a-browser-checks.json',
  JSON.stringify(results, null, 2) + '\n',
);
console.log(
  'PASS: 18 pixel-identical simulation comparisons, 12 live-state layout checks, no browser errors.',
);
await browser.close();

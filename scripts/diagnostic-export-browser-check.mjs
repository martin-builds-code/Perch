// Optional local Chromium check; provider endpoints are entirely synthetic.
// :5173 is this branch (all three public flags enabled, server providers disabled).
// :5175 is an unchanged 133682ee Stage 2C checkout with the same flags.
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const T = Date.UTC(2026, 10, 2, 19, 30),
  results = [];
const privatePattern =
  /abcdef|abcd01|abcd02|abcd03|RYR123|TEST-REG|latitude|longitude|callsign|registration|cookies|tokens|Dublin|Heathrow|EIDW|EGLL/i;
async function setup(viewport, state = 'available') {
  const page = await browser.newPage({
    viewport,
    acceptDownloads: true,
    hasTouch: true,
  });
  const requests = [],
    errors = [],
    downloads = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) requests.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('download', (d) => downloads.push(d));
  await page.clock.install({ time: new Date(T) });
  await page.clock.pauseAt(new Date(T));
  await page.route('**/api/aircraft', async (route) => {
    if (state === 'unavailable')
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"cooldown"}',
      });
    const now = await page.evaluate(() => Date.now());
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'x-vercel-cache': 'HIT', age: '1' },
      body: JSON.stringify({
        aircraft: ['abcdef', 'abcd01', 'abcd02', 'abcd03'].map((id, i) => ({
          id,
          callsign: 'RYR123',
          registration: 'TEST-REG',
          description: 'Boeing 737 MAX 8',
          typeCode: 'B38M',
          distanceKm: 3 + i,
          barometricAltitudeFt: 12000,
          geometricAltitudeFt: null,
          onGround: false,
          groundSpeedKnots: 210,
          trackDegrees: 90,
          positionTimeMs: now - (state === 'delayed' ? 35000 : 1000),
          source: 'adsb.fi',
          validity: { position: true, timestamp: true, anomalies: [] },
        })),
        fetchedAtMs: now,
        providerTimeMs: now,
        pollIntervalMs: 15000,
        rejectedRecords: 0,
        anomalies: [],
      }),
    });
  });
  await page.route('**/api/enrichment?*', async (route) => {
    const url = new URL(route.request().url()),
      now = await page.evaluate(() => Date.now());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        kind: url.searchParams.get('kind'),
        hex: url.searchParams.get('hex'),
        callsign: url.searchParams.get('callsign'),
        source: 'hexdb.io',
        status: 'missing',
        data: null,
        fetchedAtMs: now,
        expiresAtMs: now + 300000,
      }),
    });
  });
  async function open(port, search = '?mode=live') {
    await page.goto(`http://127.0.0.1:${port}/${search}`);
    await page
      .locator(state === 'unavailable' ? '.empty-state' : '.model')
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '.content{animation:none}' });
  }
  return { page, requests, errors, downloads, open };
}
async function exported(download) {
  assert.match(
    download.suggestedFilename(),
    /^aero-pane-diagnostics-\d{4}-\d{2}-\d{2}-\d{6}\.json$/,
  );
  const json = await readFile(await download.path(), 'utf8');
  assert.doesNotMatch(json, privatePattern);
  return JSON.parse(json);
}
try {
  for (const viewport of [
    { width: 1024, height: 624 },
    { width: 1024, height: 768 },
    { width: 1112, height: 834 },
  ]) {
    for (const state of ['available', 'delayed', 'unavailable']) {
      const { page, requests, errors, downloads, open } = await setup(
        viewport,
        state,
      );
      await open(5175);
      const baseline = await page.screenshot();
      await open(5173);
      assert.equal(
        await page
          .getByRole('button', { name: 'Export diagnostics', exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(() => window.aeroPaneDiagnostics),
        undefined,
      );
      const ordinary = await page.screenshot();
      assert.ok(
        baseline.equals(ordinary),
        `ordinary live pixels changed: ${state}/${viewport.height}`,
      );
      const geometry = await page.locator('.content').boundingBox();
      const cards = await page.locator('.content').screenshot();
      await open(5173, '?mode=live&diagnostics=30');
      await page.waitForFunction(
        () => window.aeroPaneDiagnostics?.summary().pollingAttempts === 1,
      );
      assert.deepEqual(await page.locator('.content').boundingBox(), geometry);
      assert.ok(
        cards.equals(await page.locator('.content').screenshot()),
        'diagnostic control changed aircraft card pixels',
      );
      const layout = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        };
        const button = document.querySelector('.diagnostic-export-trigger'),
          range = document.createRange();
        range.selectNodeContents(button);
        const r = range.getBoundingClientRect();
        return {
          button: box('.diagnostic-export-trigger'),
          label: { y: r.y, bottom: r.bottom },
          status: box('.status-line'),
          credit: box('footer > .provider-credit'),
          control: box('.diagnostic-export'),
          cards: box('.content'),
          footer: box('footer'),
        };
      });
      assert.ok(layout.button.height >= 44 && layout.button.width >= 44);
      assert.ok(
        layout.button.y >= 0 && layout.button.bottom <= viewport.height,
        'entire touch target must be within viewport',
      );
      assert.ok(
        layout.label.y >= layout.cards.bottom,
        'export text must not cover aircraft',
      );
      assert.ok(
        layout.status.right < layout.control.x &&
          layout.control.right < layout.credit.x,
        'footer items must not overlap',
      );
      const before = await page.evaluate(() =>
        window.aeroPaneDiagnostics.summary(),
      );
      const requestCount = requests.length;
      const downloading = page.waitForEvent('download');
      await page.locator('.diagnostic-export-trigger').evaluate((button) => {
        button.click();
        button.click();
      });
      await page.getByRole('dialog').waitFor();
      await downloading;
      assert.equal(downloads.length, 1, 'a double tap must create one file');
      const report = await exported(downloads[0]);
      const { exportMetadata, ...measurements } = report;
      assert.equal(exportMetadata.sessionStatus, 'incomplete');
      assert.deepEqual(measurements, before);
      assert.equal(
        requests.length,
        requestCount,
        'export must not request API data',
      );
      assert.equal(
        await page.evaluate(
          () => window.aeroPaneDiagnostics.summary().pollingAttempts,
        ),
        before.pollingAttempts,
      );
      if (viewport.height === 768 && state === 'available') {
        await writeFile('docs/aero-pane-diagnostics-example.json', JSON.stringify(report, null, 2) + '\n');
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.screenshot({ path: 'docs/stage-2c-diagnostic-control.png' });
        await page.clock.runFor(1600);
        const downloading = page.waitForEvent('download');
        await page
          .getByRole('button', { name: 'Export diagnostics', exact: true })
          .click();
        await downloading;
        await page.screenshot({ path: 'docs/stage-2c-diagnostic-export.png' });
      }
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.deepEqual(errors, []);
      results.push({
        viewport,
        state,
        ordinaryLivePixelIdentical: true,
        diagnosticCardsPixelIdentical: true,
        layout,
        activeDownload: true,
        doubleTapGuard: true,
        additionalApiRequests: 0,
        errors,
      });
      await page.close();
    }
  }
  // Completed collection, export failure and manual fallback.
  const { page, downloads, errors, open } = await setup({
    width: 1024,
    height: 768,
  });
  await open(5173, '?mode=live&diagnostics=30');
  await page.evaluate(() => window.aeroPaneDiagnostics.summary());
  await page.clock.fastForward(31 * 60000);
  const completeDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export diagnostics', exact: true })
    .click();
  const complete = await exported(await completeDownload);
  assert.equal(complete.exportMetadata.sessionStatus, 'complete');
  assert.equal(complete.enabled, false);
  assert.match(await page.getByRole('dialog').innerText(), /period ended/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.clock.runFor(1600);
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error('Downloads blocked');
    };
  });
  await page
    .getByRole('button', { name: 'Export diagnostics', exact: true })
    .click();
  assert.match(await page.getByRole('status').innerText(), /could not start/);
  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Select JSON', exact: true }).click();
  assert.equal(
    await page
      .locator('textarea')
      .evaluate((e) => e.selectionEnd - e.selectionStart),
    (await page.locator('textarea').inputValue()).length,
  );
  assert.equal(downloads.length, 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(
    await page.evaluate(
      () => window.aeroPaneDiagnostics.summary().pollingAttempts,
    ),
    complete.pollingAttempts,
  );
  await open(5173, '?diagnostics=30');
  assert.equal(
    await page
      .getByRole('button', { name: 'Export diagnostics', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.aeroPaneDiagnostics),
    undefined,
  );
  assert.deepEqual(errors, []);
  results.push({
    case: 'completed period, failure, manual selection, Escape, simulation cleanup',
    passed: true,
    errors,
  });
  await page.close();
  await writeFile(
    'docs/stage-2c-export-browser-checks.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    'PASS: ordinary live and diagnostic card pixels, 44px touch control, private JSON downloads, completion, failure fallback and cleanup at three landscape sizes.',
  );
} finally {
  await browser.close();
}

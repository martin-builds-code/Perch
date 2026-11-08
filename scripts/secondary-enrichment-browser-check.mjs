// Local mocked live API only; never contacts aviation providers.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const output = 'docs/stage3-secondary-enrichment';
await mkdir(output, { recursive: true });
const T = Date.parse('2026-11-08T10:00:00Z');
const results = [];
const airport = (code) => ({ code, iata: code, icao: null, name: code });
async function wire(page, holdSecondary = false) {
  const positions = [],
    lookups = [],
    pending = [];
  await page.route('**/api/session', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: '{"authenticated":true}',
    }),
  );
  await page.route('**/api/aircraft', async (r) => {
    const now = await page.evaluate(() => Date.now());
    positions.push(now);
    const aircraft = ['abcdef', '111111', '222222'].map((id, i) => ({
      id,
      callsign: ['PRIMARY', 'TEST1', 'TEST2'][i],
      registration: 'SYNTHETIC',
      description: ['Airbus A380-800', 'Boeing 737-800', 'ATR 72-600'][i],
      typeCode: ['A388', 'B738', 'AT76'][i],
      distanceKm: [1, 6, 9][i],
      barometricAltitudeFt: 6000,
      geometricAltitudeFt: null,
      onGround: false,
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
  async function reply(r) {
    const q = new URL(r.request().url()).searchParams,
      now = await page.evaluate(() => Date.now());
    const kind = q.get('kind'),
      hex = q.get('hex');
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        kind,
        hex,
        callsign: q.get('callsign'),
        source: 'hexdb.io',
        status: 'found',
        data:
          kind === 'route'
            ? {
                origin: airport(hex === 'abcdef' ? 'DUB' : 'MAN'),
                destination: airport('AMS'),
              }
            : {
                operator: 'Synthetic operator',
                registration: 'SYNTHETIC',
              },
        fetchedAtMs: now,
        expiresAtMs: now + (kind === 'route' ? 300000 : 1800000),
      }),
    });
  }
  await page.route('**/api/enrichment?*', async (r) => {
    const q = new URL(r.request().url()).searchParams;
    lookups.push({
      at: await page.evaluate(() => performance.now()),
      kind: q.get('kind'),
      hex: q.get('hex'),
    });
    if (holdSecondary && q.get('hex') !== 'abcdef') {
      pending.push(r);
      return;
    }
    await reply(r);
  });
  return { positions, lookups, pending, reply };
}
try {
  for (const height of [768, 624]) {
    const page = await browser.newPage({
        viewport: { width: 1024, height },
      }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install({ time: new Date(T) });
    await page.clock.pauseAt(new Date(T));
    const h = await wire(page, true);
    await page.goto('http://127.0.0.1:5173/?mode=live');
    await page.locator('.model').filter({ hasText: 'A380-800' }).waitFor();
    await page
      .locator('.airport-code')
      .filter({ hasText: 'DUB' })
      .waitFor();
    for (let i = 1; i <= 4; i++) {
      await page.clock.fastForward(15000);
      await page.waitForFunction(
        (n) => document.querySelectorAll('.nearby-aircraft').length === n,
        2,
      );
      await page.waitForTimeout(30);
    }
    assert.deepEqual(
      h.lookups.map((r) => [r.kind, r.hex]),
      [
        ['route', 'abcdef'],
        ['aircraft', 'abcdef'],
        ['route', '111111'],
      ],
    );
    assert.equal(h.pending.length, 1);
    const illustration = await page
      .locator('.aircraft-layer')
      .elementHandle();
    const before = await illustration.boundingBox();
    const pollsBefore = h.positions.length;
    await h.reply(h.pending.shift());
    await page
      .locator('.nearby-aircraft')
      .first()
      .locator('.secondary-route')
      .waitFor();
    assert.equal(
      h.positions.length,
      pollsBefore,
      'route publication waits for no extra position poll',
    );
    assert.deepEqual(
      await illustration.boundingBox(),
      before,
      'secondary route moved illustration',
    );
    assert.ok(
      await illustration.evaluate(
        (e) => e === document.querySelector('.aircraft-layer'),
      ),
      'illustration was remounted',
    );
    for (let i = 0; i < 6; i++) {
      await page.clock.fastForward(15000);
      await page.waitForTimeout(30);
    }
    assert.equal(h.pending.length, 1);
    assert.equal(h.lookups.at(-1).hex, '222222');
    const secondary = h.lookups.filter((r) => r.hex !== 'abcdef');
    assert.ok(secondary[1].at - secondary[0].at >= 90000);
    await h.reply(h.pending.shift());
    await page.waitForFunction(
      () => document.querySelectorAll('.secondary-route').length === 2,
    );
    assert.deepEqual(await illustration.boundingBox(), before);
    assert.ok(
      h.positions.every((at, i) => !i || at - h.positions[i - 1] >= 15000),
    );
    assert.equal(h.positions.length, 11);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({
      content:
        '.aircraft-card,.aircraft-layer,.aircraft-header{animation:none!important}',
    });
    await page.screenshot({
      path: `${output}/secondary-routes-1024x${height}.png`,
    });
    assert.deepEqual(errors, []);
    results.push({
      viewport: { width: 1024, height },
      lookups: h.lookups,
      positionPolls: h.positions.length,
      illustrationBefore: before,
      illustrationAfter: await illustration.boundingBox(),
      immediatePublication: true,
      errors,
    });
    await page.goto('http://127.0.0.1:5173/');
    const beforeStop = h.lookups.length;
    await page.clock.fastForward(180000);
    assert.equal(h.lookups.length, beforeStop);
    await page.close();
  }
  const resume = await browser.newPage();
  await resume.clock.install({ time: new Date(T) });
  await resume.clock.pauseAt(new Date(T));
  const hr = await wire(resume);
  await resume.goto('http://127.0.0.1:5173/?mode=live');
  await resume.locator('.primary').waitFor();
  for (let i = 0; i < 4; i++) {
    await resume.clock.fastForward(15000);
    await resume.waitForTimeout(30);
  }
  assert.equal(hr.lookups.length, 3);
  await resume.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await resume.locator('.sleep-screen').waitFor();
  await resume.clock.fastForward(15000);
  await resume.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await resume.locator('.primary').waitFor();
  assert.equal(
    hr.lookups.length,
    3,
    'visibility remount reset global deadline',
  );
  for (let i = 0; i < 5; i++) {
    await resume.clock.fastForward(15000);
    await resume.waitForTimeout(30);
  }
  const resumedSecondary = hr.lookups.filter((r) => r.hex !== 'abcdef');
  assert.equal(resumedSecondary.length, 2);
  assert.ok(resumedSecondary[1].at - resumedSecondary[0].at >= 90000);
  assert.ok(
    hr.lookups.every((r, i) => !i || r.at - hr.lookups[i - 1].at >= 30000),
  );
  results.push({
    case: 'visibility remount',
    lookups: hr.lookups,
    globalAndSecondaryDeadlinesPreserved: true,
  });
  await resume.close();
  const sleep = await browser.newPage();
  await sleep.clock.install({ time: new Date('2026-11-08T02:00Z') });
  await sleep.clock.pauseAt(new Date('2026-11-08T02:00Z'));
  const hs = await wire(sleep);
  await sleep.goto('http://127.0.0.1:5173/?mode=live');
  await sleep.locator('.sleep-screen').waitFor();
  await sleep.clock.fastForward(60000);
  assert.equal(hs.lookups.length, 0);
  assert.equal(hs.positions.length, 0);
  await sleep.clock.fastForward(4 * 3600000);
  await sleep.locator('.primary').waitFor();
  assert.equal(hs.lookups[0].hex, 'abcdef');
  results.push({
    case: 'sleep and wake',
    sleepRequests: 0,
    firstWakeLookup: 'primary',
  });
  await sleep.close();
  const disabled = await browser.newPage();
  await disabled.clock.install({ time: new Date(T) });
  await disabled.clock.pauseAt(new Date(T));
  const hd = await wire(disabled);
  await disabled.goto('http://127.0.0.1:5177/?mode=live');
  await disabled.locator('.primary').waitFor();
  for (let i = 0; i < 8; i++) {
    await disabled.clock.fastForward(15000);
    await disabled.waitForTimeout(20);
  }
  assert.equal(hd.lookups.length, 0);
  assert.ok(hd.positions.length > 1);
  results.push({
    case: 'enrichment disabled',
    positionPolls: hd.positions.length,
    enrichmentRequests: 0,
  });
  await disabled.close();
  await writeFile(
    output + '/browser-checks.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    'PASS: primary priority, prompt secondary publication, 90s shared gate, stationary artwork at both sizes, 15s polling, simulation cleanup, sleep/wake and disabled enrichment.',
  );
} finally {
  await browser.close();
}

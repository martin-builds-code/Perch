// Local synthetic fixtures only. :5173 is Stage 3A; :5175 is unchanged main
// 8031a76 with identical public feature flags and server providers disabled.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const sizes = [
  { width: 1024, height: 624 },
  { width: 1024, height: 768 },
  { width: 1112, height: 834 },
];
const scenarios = [
  'a380',
  'challenger',
  'piper',
  'dreamliner',
  'atr',
  'helicopter',
  'a320',
  'single',
  'missing-route',
  'icao-only',
  'unknown',
  'empty',
  'unavailable',
  'delayed',
  'long-names',
  'long-airports',
  'wide-codes',
];
const results = [];
await mkdir('docs/stage3a', { recursive: true });
async function settled(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(80);
  await page.addStyleTag({
    content:
      '.aircraft-card,.aircraft-header,.aircraft-layer,.radar span{animation:none!important}',
  });
}
async function geometry(page) {
  return page.evaluate(() => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const one = (s) => {
      const e = document.querySelector(s);
      return e ? rect(e) : null;
    };
    return {
      header: one('.aircraft-header h1'),
      brand: one('.brand'),
      primary: one('.primary'),
      card: one('.aircraft-card'),
      route: one('.route'),
      flight: one('.flight-info'),
      art: one('.artwork-stage'),
      details: one('.details'),
      composed: !!document.querySelector('.composed-artwork'),
      near: one('.nearby'),
      footer: one('footer'),
      metrics: [...document.querySelectorAll('.metric')].map((e) => ({
        rect: rect(e),
        value: rect(e.querySelector('.metric-value')),
        size: parseFloat(
          getComputedStyle(e.querySelector('.metric-value')).fontSize,
        ),
        scroll: e.querySelector('.metric-value').scrollWidth,
        client: e.querySelector('.metric-value').clientWidth,
      })),
      secondary: [...document.querySelectorAll('.nearby-aircraft')].map(
        (e) => ({
          rect: rect(e),
          identity: rect(e.querySelector('.nearby-identity')),
          value: rect(e.querySelector('.nearby-value')),
          text: rect(e.querySelector('h3')),
        }),
      ),
      airports: [...document.querySelectorAll('.airport-code')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth})),
      scroll:
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
      titleSize: document.querySelector('header h1')
        ? parseFloat(
            getComputedStyle(document.querySelector('header h1')).fontSize,
          )
        : null,
      artSources: [...document.querySelectorAll('.artwork-stage image')].map(
        (e) => e.getAttribute('href'),
      ),
    };
  });
}
async function wire(page) {
  const attempts = [];
  await page.route('**/api/session', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: '{"authenticated":true}',
    }),
  );
  await page.route('**/api/aircraft', async (r) => {
    const now = await page.evaluate(() => Date.now());
    attempts.push(now);
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        aircraft: [
          {
            id: 'abcdef',
            callsign: 'EIN17A',
            registration: 'TEST-REG',
            description: 'Airbus A320neo',
            typeCode: 'A20N',
            distanceKm: 3,
            barometricAltitudeFt: 12125,
            geometricAltitudeFt: null,
            onGround: false,
            groundSpeedKnots: 200,
            trackDegrees: 90,
            positionTimeMs: now - 1000,
            source: 'adsb.fi',
            validity: { position: true, timestamp: true, anomalies: [] },
          },
        ].flatMap(aircraft => [aircraft, { ...aircraft, id: '123456', callsign: 'SECONDARY', distanceKm: 10, barometricAltitudeFt: 20000 }]),
        fetchedAtMs: now,
        providerTimeMs: now,
        pollIntervalMs: 15000,
        rejectedRecords: 0,
        anomalies: [],
      }),
    });
  });
  return attempts;
}
try {
  for (const viewport of sizes) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const scenario of scenarios) {
      await page.goto(
        'http://127.0.0.1:5173/qa-stage3a.html?scenario=' + scenario,
      );
      await settled(page);
      const g = await geometry(page);
      assert.equal(
        g.scroll,
        false,
        `${scenario} ${viewport.height}: page scroll`,
      );
      assert.ok(g.footer.bottom <= viewport.height);
      if (g.header) {
        assert.ok(await page.locator('.airport-code').evaluateAll(es => es.every(e => e.scrollWidth <= e.clientWidth + 1)), scenario + ': IATA code width');
        assert.ok(
          g.header.right <= g.brand.x && g.header.bottom <= g.primary.y,
          `${scenario}: header overlap`,
        );
        assert.ok(g.titleSize >= 34);
        for (const m of g.metrics) {
          assert.ok(
            m.scroll <= m.client + 1,
            `${scenario} ${viewport.height}: number overflow`,
          );
          assert.ok(m.value.right <= m.rect.right + 1);
          assert.ok(
            m.value.bottom <= m.rect.bottom - 6,
            `${scenario}: number vertical overflow`,
          );
          assert.ok(m.size >= 88);
        }
        // Composed artwork shares transparent canvas space with the route;
        // stage3a-final-composition-check validates its actual alpha silhouette.
        if (g.route && !g.composed)
          assert.ok(
            g.flight.right <= g.art.x + 1 || g.flight.bottom <= g.art.y + 1,
            `${scenario}: protected route area`,
          );
        if (g.details) {
          if (!g.composed) assert.ok(g.art.bottom <= g.details.y + 1);
          if (g.route)
            assert.ok(
              g.route.bottom <= g.details.y,
              'route names must stay above details',
            );
        }
        for (const s of g.secondary) {
          assert.ok(
            s.identity.bottom <= s.value.y + 1,
            `${scenario}: secondary text overlap`,
          );
          assert.ok(s.text.bottom <= s.value.y + 1);
          assert.ok(s.value.bottom <= s.rect.bottom);
        }
        if (g.near) assert.ok(g.near.bottom <= g.footer.y + 1);
        if (['missing-route', 'icao-only'].includes(scenario))
          assert.equal(g.route, null);
        if (['single', 'missing-route'].includes(scenario))
          assert.equal(g.near, null);
        if (scenario === 'a380')
          assert.ok(g.artSources.some((s) => s.includes('a380')));
        if (scenario === 'a320')
          assert.ok(g.artSources.some((s) => s.includes('narrowbody')));
        if (
          ['piper', 'atr', 'helicopter', 'dreamliner', 'challenger'].includes(
            scenario,
          )
        )
          assert.ok(!g.artSources.some((s) => /a380|narrowbody/.test(s)));
      } else {
        assert.equal(g.primary, null);
        assert.equal(g.near, null);
        assert.equal(
          await page.locator('.radar').count(),
          scenario === 'empty' ? 1 : 0,
        );
      }
      if (
        viewport.height === 768 &&
        [
          'a380',
          'a320',
          'single',
          'missing-route',
          'piper',
          'empty',
          'unavailable',
        ].includes(scenario)
      )
        await page.screenshot({ path: `docs/stage3a/${scenario}.png` });
      if (viewport.height === 624 && scenario === 'a380')
        await page.screenshot({ path: 'docs/stage3a/a380-compact.png' });
      results.push({ viewport, scenario, layout: g });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  // A real DOM instance must survive routine updates, but change for a new ICAO
  // identity even with the same A320 model and the same illustration file.
  const page = await browser.newPage({ viewport: sizes[1] });
  await page.goto('http://127.0.0.1:5173/qa-stage3a.html?scenario=a320');
  const old = await page.locator('.primary-presentation').elementHandle();
  await page.evaluate(() => window.stage3aFixture('a320', 'fixture-primary'));
  assert.ok(
    await old.evaluate(
      (e) => e === document.querySelector('.primary-presentation'),
    ),
  );
  await page.evaluate(() => window.stage3aFixture('a320', 'next-aircraft'));
  assert.equal(
    await old.evaluate(
      (e) => e === document.querySelector('.primary-presentation'),
    ),
    false,
  );
  assert.equal(
    await page
      .locator('.aircraft-card')
      .evaluate((e) => getComputedStyle(e).animationDuration),
    '1s',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('.aircraft-card')
      .evaluate((e) => getComputedStyle(e).animationName),
    'none',
  );
  await page.evaluate(() => window.stage3aFixture('empty'));
  assert.equal(
    await page
      .locator('.radar span')
      .evaluate((e) => getComputedStyle(e).animationName),
    'none',
  );
  results.push({
    case: 'same-model identity change, routine update stability, reduced motion',
    passed: true,
  });
  await page.close();

  const fallback = await browser.newPage({ viewport: sizes[1] });
  const pngs = [];
  await fallback.route('**/*.webp', (r) =>
    r.fulfill({ status: 404, body: '' }),
  );
  fallback.on('request', (r) => {
    if (r.url().endsWith('.png')) pngs.push(r.url());
  });
  await fallback.goto('http://127.0.0.1:5173/qa-stage3a.html?scenario=a380');
  await fallback.waitForFunction(() =>
    [...document.querySelectorAll('.artwork-stage image')].every((e) =>
      e.getAttribute('href').endsWith('.png'),
    ),
  );
  assert.equal(pngs.length, 2);
  assert.equal(await fallback.locator('.primary').count(), 1);
  await fallback.close();
  results.push({
    case: 'WebP failure falls back to supplied PNG without affecting aircraft',
    passed: true,
  });

  // Main application path: delayed enrichment, 15s cadence and local export.
  const live = await browser.newPage({
    viewport: sizes[1],
    acceptDownloads: true,
  });
  const errors = [];
  live.on('pageerror', (e) => errors.push(e.message));
  await live.clock.install({ time: new Date('2026-11-04T11:00:00Z') });
  await live.clock.pauseAt(new Date('2026-11-04T11:00:00Z'));
  const attempts = await wire(live);
  let pending;
  await live.route('**/api/enrichment?*', (r) => {
    pending = r;
  });
  await live.goto('http://127.0.0.1:5173/?mode=live&diagnostics=30');
  await live.locator('.model').filter({ hasText: 'A320neo' }).waitFor();
  assert.equal(await live.locator('.route').count(), 0);
  await live.waitForTimeout(80);
  assert.ok(pending);
  const now = await live.evaluate(() => Date.now());
  await pending.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      kind: 'route',
      hex: 'abcdef',
      callsign: 'EIN17A',
      source: 'hexdb.io',
      status: 'found',
      data: {
        origin: {
          code: 'DUB',
          iata: 'DUB',
          icao: 'EIDW',
          name: 'Dublin Airport',
        },
        destination: {
          code: 'MAN',
          iata: 'MAN',
          icao: 'EGCC',
          name: 'Manchester Airport',
        },
      },
      fetchedAtMs: now,
      expiresAtMs: now + 300000,
    }),
  });
  await live.locator('.airport-code').filter({ hasText: 'DUB' }).waitFor();
  await live.locator('.composed-artwork').waitFor();
  assert.equal(await live.locator('.nearby-aircraft').count(), 1);
  for (let i = 0; i < 2; i++) {
    await live.clock.fastForward(15000);
    await live.waitForFunction(
      (n) => window.aeroPaneDiagnostics.summary().successfulRequests === n,
      i + 2,
    );
  }
  assert.equal(attempts.length, 3);
  assert.ok(attempts.every((v, i) => !i || v - attempts[i - 1] >= 15000));
  const download = live.waitForEvent('download');
  await live
    .getByRole('button', { name: 'Export diagnostics', exact: true })
    .click();
  const d = await download;
  const report = JSON.parse(await readFile(await d.path(), 'utf8'));
  assert.equal(report.pollingAttempts, 3);
  assert.equal(report.failedRequests, 0);
  assert.ok(!JSON.stringify(report).includes('abcdef'));
  await live.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(attempts.length, 3);
  assert.deepEqual(errors, []);
  results.push({
    case: 'main application, late route, unchanged cadence and private export',
    polls: 3,
    passed: true,
  });
  await live.close();

  // Preserve the accepted Stage 2D sleeping pixels and transition behaviour.
  for (const viewport of sizes) {
    const p = await browser.newPage({ viewport });
    await p.clock.install({ time: new Date('2026-11-04T02:00:00Z') });
    await p.clock.pauseAt(new Date('2026-11-04T02:00:00Z'));
    const requests = await wire(p);
    await p.route('**/api/session', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"authenticated":false}' }));
    const pinShots = [];
    for (const port of [5175, 5173]) {
      await p.goto(`http://127.0.0.1:${port}/?mode=live`);
      await p.getByLabel('Eight-digit PIN').waitFor();
      await settled(p);
      pinShots.push(await p.screenshot());
    }
    assert.ok(pinShots[0].equals(pinShots[1]), 'PIN screen pixels changed');
    await p.unroute('**/api/session');
    await p.route('**/api/session', r => r.fulfill({contentType:'application/json', body:'{"authenticated":true}'}));
    const shots = [];
    for (const port of [5175, 5173]) {
      await p.goto(`http://127.0.0.1:${port}/?mode=live`);
      await p.locator('.sleep-screen').waitFor();
      await settled(p);
      shots.push(await p.screenshot());
    }
    assert.ok(shots[0].equals(shots[1]), 'sleep pixels changed');
    assert.equal(requests.length, 0);
    if (viewport.height === 768)
      await p.screenshot({ path: 'docs/stage3a/quiet-hours.png' });
    await p.clock.fastForward(4 * 3600000);
    await p.locator('.primary').waitFor();
    assert.equal(requests.length, 1);
    await p.locator('.settings-corner').dispatchEvent('pointerdown');
    await p.clock.runFor(2000);
    await p.getByRole('dialog', { name: 'Quiet hours' }).waitFor();
    await p.getByRole('button', { name: 'Close', exact: true }).click();
    results.push({
      case: 'quiet hours',
      viewport,
      pixelIdentical: true,
      pinPixelIdentical: true,
      noSleepingPositionRequests: true,
      wakeAndSettings: true,
    });
    await p.close();
  }
  await writeFile(
    'docs/stage3a/browser-checks.json',
    '[\n' + results.map(result => '  ' + JSON.stringify(result)).join(',\n') + '\n]\n',
  );
  console.log(
    'PASS Stage 3A: 51 layouts, artwork fallback, identity transitions, reduced motion, live/enrichment/export and unchanged quiet hours.',
  );
} finally {
  await browser.close();
}

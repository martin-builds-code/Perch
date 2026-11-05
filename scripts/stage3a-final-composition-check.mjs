// Current Stage 3A visual corrections; all data is synthetic, no provider calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: process.env.PERCH_CHROMIUM ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const base = 'http://127.0.0.1:5173';
const baseline = 'http://127.0.0.1:5176';
const output = 'docs/stage3a/visual-corrections';
const results = [];
await mkdir(output, { recursive: true });
async function open(page, scenario, origin = base) {
  await page.goto(`${origin}/qa-stage3a.html?scenario=${scenario}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  return page.addStyleTag({
    content:
      '.aircraft-card,.aircraft-header,.aircraft-layer,.radar span{animation:none!important}',
  });
}
async function measure(page) {
  return page.evaluate(async () => {
    const card = document.querySelector('.aircraft-card');
    const bounds = card.getBoundingClientRect();
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const text = [];
    // Test the rendered lines, not empty rectangular space beside/below text.
    // Two-line airport names retain their original font; invisible clamped lines
    // are excluded. Six CSS pixels protect each rendered text rectangle.
    for (const e of card.querySelectorAll(
      '.eyebrow,.airport-code,.airport-name,.route-connection,.operator,.details dt,.details dd',
    )) {
      const range = document.createRange();
      range.selectNodeContents(e);
      const clip = e.getBoundingClientRect();
      for (const r of range.getClientRects()) {
        const top = Math.max(r.top, clip.top);
        const bottom = Math.min(r.bottom, clip.bottom);
        if (bottom > top)
          text.push({
            text: e.textContent,
            left: Math.max(r.left, clip.left) - 6,
            top: top - 6,
            right: Math.min(r.right, clip.right) + 6,
            bottom: bottom + 6,
          });
      }
    }
    const layers = [];
    for (const svg of card.querySelectorAll('.artwork-stage>svg')) {
      const r = svg.getBoundingClientRect();
      const frame = svg.viewBox.baseVal;
      const viewport = svg.querySelector('svg');
      const sourceFrame = viewport.viewBox.baseVal;
      const imageElement = svg.querySelector('image');
      const image = new Image();
      image.src = imageElement.getAttribute('href');
      await image.decode();
      const scale = Math.min(r.width / frame.width, r.height / frame.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(r.width);
      canvas.height = Math.ceil(r.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const offsetX = r.width - frame.width * scale;
      const offsetY =
        (r.height - frame.height * scale) *
        (svg.getAttribute('preserveAspectRatio').includes('YMid') ? 0.5 : 1);
      const target = {
        x: offsetX + viewport.x.baseVal.value * scale,
        y: offsetY + viewport.y.baseVal.value * scale,
        width: viewport.width.baseVal.value * scale,
        height: viewport.height.baseVal.value * scale,
      };
      const imageScale = target.width / sourceFrame.width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(target.x, target.y, target.width, target.height);
      ctx.clip();
      ctx.drawImage(
        image,
        target.x - sourceFrame.x * imageScale,
        target.y - sourceFrame.y * imageScale,
        image.width * imageScale,
        image.height * imageScale,
      );
      ctx.restore();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let collisions = 0;
      let left = canvas.width,
        top = canvas.height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++)
          if (pixels[(y * canvas.width + x) * 4 + 3] > 8) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      const hitText = new Set();
      for (const t of text) {
        for (
          let y = Math.max(0, Math.floor(t.top - r.top));
          y < Math.min(canvas.height, Math.ceil(t.bottom - r.top));
          y++
        ) {
          for (
            let x = Math.max(0, Math.floor(t.left - r.left));
            x < Math.min(canvas.width, Math.ceil(t.right - r.left));
            x++
          ) {
            // >8/255 includes faint edges, ignoring near-transparent source noise.
            if (pixels[(y * canvas.width + x) * 4 + 3] > 8) {
              collisions++;
              hitText.add(t.text);
            }
          }
        }
      }
      layers.push({
        class: svg.getAttribute('class'),
        source: imageElement.getAttribute('href'),
        rect: rect(svg),
        painted:
          right < 0
            ? null
            : {
                left: r.x + left,
                top: r.y + top,
                right: r.x + right + 1,
                bottom: r.y + bottom + 1,
                width: right - left + 1,
              },
        projectedFrame: {
          x: r.x + target.x,
          y: r.y + target.y,
          width: target.width,
          height: target.height,
        },
        imageScale,
        frame: {
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
        },
        collisions,
        hitText: [...hitText],
      });
    }
    return {
      card: rect(card),
      fixed: Object.fromEntries(
        [
          '.aircraft-header',
          '.primary',
          '.details',
          '.measurements',
          '.nearby',
          'footer',
        ].map((s) => [s, rect(document.querySelector(s))]),
      ),
      layers,
      detailsTextTop: Math.min(
        ...[...card.querySelectorAll('.details dt,.details dd')].map((e) => {
          const range = document.createRange();
          range.selectNodeContents(e);
          return range.getBoundingClientRect().top;
        }),
      ),
      codeFonts: [...card.querySelectorAll('.airport-code')].map((e) =>
        parseFloat(getComputedStyle(e).fontSize),
      ),
      airportFonts: [...card.querySelectorAll('.airport-name')].map((e) =>
        parseFloat(getComputedStyle(e).fontSize),
      ),
      codeOverflow: [...card.querySelectorAll('.airport-code')].some(
        (e) => e.scrollWidth > e.clientWidth + 1,
      ),
      metricOverflow: [...document.querySelectorAll('.metric-value')].some(
        (e) => e.scrollWidth > e.clientWidth + 1,
      ),
      metricFonts: [...document.querySelectorAll('.metric-value')].map((e) =>
        parseFloat(getComputedStyle(e).fontSize),
      ),
      scroll:
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
      text,
      bounds: {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      },
    };
  });
}

try {
  const failures = [];
  const scenarios = [
    'a380',
    'a320',
    'b777',
    'pioneer',
    'single',
    'a320-single',
    'a320-no-route',
    'a320-single-no-route',
    'a380-no-route',
    'unknown',
    'demo-incomplete',
    'wide-codes',
    'long-airports',
    'a320-wide-codes',
    'a320-long-airports',
    'long-names',
    'challenger',
    'piper',
    'dreamliner',
    'atr',
    'helicopter',
    'icao-only',
    'missing-route',
  ];
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1024, height: 624 },
    { width: 1112, height: 834 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [],
      forbidden = [];
    await page.addInitScript(() => {
      window.fixtureResizeListeners = 0;
      const add = window.addEventListener.bind(window),
        remove = window.removeEventListener.bind(window);
      window.addEventListener = (type, ...args) => {
        if (type === 'resize') window.fixtureResizeListeners++;
        return add(type, ...args);
      };
      window.removeEventListener = (type, ...args) => {
        if (type === 'resize') window.fixtureResizeListeners--;
        return remove(type, ...args);
      };
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (
        ![base, baseline].includes(url.origin) ||
        url.pathname.startsWith('/api/')
      ) {
        forbidden.push(url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    for (const scenario of scenarios) {
      await open(page, scenario, baseline);
      const fixed = new Map();
      for (const selector of [
        '.aircraft-header',
        '.measurements',
        '.nearby',
        'footer',
      ])
        if (await page.locator(selector).count())
          fixed.set(selector, await page.locator(selector).screenshot());
      await open(page, scenario);
      const g = await measure(page);
      const label = `${scenario} ${viewport.width}x${viewport.height}`;
      assert.equal(g.scroll, false, `${label}: scrolling`);
      assert.equal(g.codeOverflow, false, `${label}: code overflow`);
      assert.equal(g.metricOverflow, false, `${label}: metric overflow`);
      assert.equal(
        g.layers.length,
        2,
        `${label}: separate aircraft and cloud images`,
      );
      for (const layer of g.layers) {
        if (layer.collisions)
          failures.push(
            `${label}: ${layer.class} near ${layer.hitText.join(', ')}`,
          );
        assert.ok(layer.painted, `${label}: missing painted layer`);
        assert.ok(
          layer.painted.left >= g.bounds.left &&
            layer.painted.top >= g.bounds.top,
          `${label}: top/left clipping`,
        );
        assert.ok(
          layer.painted.right <= g.bounds.right &&
            layer.painted.bottom <= g.bounds.bottom,
          `${label}: bottom/right clipping`,
        );
      }
      const plane = g.layers.find((l) => l.class === 'aircraft-layer'),
        cloud = g.layers.find((l) => l.class === 'cloud-layer');
      assert.deepEqual(
        plane.frame,
        cloud.frame,
        `${label}: independent scaling canvas`,
      );
      assert.deepEqual(plane.rect, cloud.rect, `${label}: shared transform`);
      assert.equal(
        plane.projectedFrame.width,
        cloud.projectedFrame.width,
        `${label}: shared framed width`,
      );
      assert.ok(
        cloud.painted.top <= plane.painted.bottom + 12,
        `${label}: aircraft/cloud gap`,
      );
      const clearance =
        g.detailsTextTop - Math.max(plane.painted.bottom, cloud.painted.bottom);
      if (clearance < 12)
        failures.push(
          `${label}: information-row clearance ${clearance.toFixed(1)}px`,
        );
      if (
        [
          'a380',
          'a320',
          'b777',
          'pioneer',
          'unknown',
          'demo-incomplete',
          'a320-no-route',
          'a380-no-route',
        ].includes(scenario)
      ) {
        const minimum = scenario.startsWith('a380')
          ? viewport.height === 624
            ? 475
            : 595
          : viewport.height === 624
            ? 585
            : 635;
        assert.ok(
          plane.projectedFrame.width >= minimum,
          `${label}: illustration shrunk unnecessarily`,
        );
      }
      if (scenario === 'a320-single' || scenario === 'a320-single-no-route') {
        assert.ok(
          plane.projectedFrame.width >= 650,
          `${label}: single illustration lost prominence`,
        );
        assert.ok(
          clearance >= 40,
          `${label}: single illustration too close to information row`,
        );
      }
      for (const [selector, pixels] of fixed)
        assert.ok(
          pixels.equals(await page.locator(selector).screenshot()),
          `${label}: ${selector} pixels changed`,
        );
      const expected =
        /^(a380(?:-no-route)?|single|missing-route|icao-only|wide-codes|long-airports)$/.test(
          scenario,
        )
          ? 'aeropane_a380_baseline'
          : 'aeropane_generic_narrowbody';
      assert.ok(
        plane.source.includes(expected),
        `${label}: illustration mapping`,
      );
      assert.equal(
        await page
          .getByText('Illustration unavailable', { exact: true })
          .count(),
        0,
      );
      if (
        viewport.width === 1024 &&
        [
          'a380',
          'a320',
          'a320-single',
          'single',
          'b777',
          'pioneer',
          'a320-no-route',
          'a320-single-no-route',
          'demo-incomplete',
        ].includes(scenario)
      )
        await page.screenshot({
          path: `${output}/${scenario}-${viewport.width}x${viewport.height}.png`,
        });
      results.push({ scenario, viewport, clearancePx: clearance, layout: g });
    }
    // Healthy monitoring remains distinct from a genuine outage.
    const testStyle = await open(page, 'empty');
    const radar = await page.locator('.radar').evaluate((e) => {
      const r = e.getBoundingClientRect(),
        c = document.querySelector('.content').getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        centreX: r.x + r.width / 2,
        centreY: r.y + r.height / 2,
        contentCentreX: c.x + c.width / 2,
        contentCentreY: c.y + c.height / 2,
        top: r.top,
        bottom: r.bottom,
      };
    });
    assert.equal(radar.width, 220);
    assert.equal(radar.height, 220);
    assert.ok(
      Math.abs(radar.centreX - radar.contentCentreX) < 1 &&
        Math.abs(radar.centreY - radar.contentCentreY) < 1,
    );
    assert.ok(radar.top >= 0 && radar.bottom < viewport.height);
    await testStyle.evaluate((e) => e.remove());
    assert.equal(
      await page
        .locator('.radar span')
        .evaluate((e) => getComputedStyle(e).animationDuration),
      '16s',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page
        .locator('.radar span')
        .evaluate((e) => getComputedStyle(e).animationName),
      'none',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addStyleTag({
      content: '.radar span{animation:none!important;transform:rotate(30deg)}',
    });
    if (viewport.width === 1024)
      await page.screenshot({
        path: `${output}/empty-${viewport.width}x${viewport.height}.png`,
      });
    await open(page, 'unavailable');
    assert.equal(await page.locator('.radar').count(), 0);
    await page
      .getByText('Aircraft data unavailable', { exact: true })
      .waitFor();
    results.push({ scenario: 'radar and unavailable', viewport, radar });
    await open(page, 'a320-wide-codes');
    await page.setViewportSize({
      width: 1024,
      height: viewport.height === 624 ? 768 : 624,
    });
    await page.waitForTimeout(100);
    assert.equal((await measure(page)).codeOverflow, false);
    const route = await page.locator('.route').elementHandle();
    for (let i = 0; i < 60; i++)
      await page.evaluate(() => window.stage3aFixture('a320'));
    assert.ok(
      await route.evaluate((e) => e === document.querySelector('.route')),
    );
    assert.equal(await page.evaluate(() => window.fixtureResizeListeners), 1);
    await page.evaluate(() => window.stage3aFixture('a320-single'));
    await page.waitForFunction(() => window.fixtureResizeListeners === 0);
    await page.evaluate(() => window.stage3aFixture('a320'));
    await page.waitForFunction(() => window.fixtureResizeListeners === 1);
    await page.evaluate(() => window.stage3aFixture('empty'));
    await page.waitForFunction(() => window.fixtureResizeListeners === 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(forbidden, []);
    await page.close();
  }
  await writeFile(
    `${output}/checks.json`,
    JSON.stringify(
      {
        baseline: '8669b10be0dc3679d589bb1e5d7946a9c294c949',
        alphaThreshold: 8,
        textGuardPx: 6,
        failures,
        results,
      },
      null,
      2,
    ) + '\n',
  );
  assert.deepEqual(failures, [], 'artwork/text and information-row clearance');
  console.log(
    'PASS Stage 3A visual corrections: 69 artwork layouts, 3 radar/outage checks, shared image transforms, visible text clearance, unchanged surrounding pixels and lifecycle; no API requests.',
  );
} finally {
  await browser.close();
}

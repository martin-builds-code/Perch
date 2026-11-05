// Final application composition: synthetic fixtures and immutable B references.
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
const output = 'docs/stage3a/final-composition';
const results = [];
await mkdir(output, { recursive: true });
async function open(page, scenario, origin = base) {
  await page.goto(`${origin}/qa-stage3a.html?scenario=${scenario}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  await page.addStyleTag({
    content:
      '.aircraft-card,.aircraft-header,.aircraft-layer,.radar span{animation:none!important}',
  });
}
async function measure(page) {
  return page.evaluate(async () => {
    const card = document.querySelector('.aircraft-card');
    const bounds = card.getBoundingClientRect();
    const rect = (e) => {
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
            left: r.left - 6,
            top: top - 6,
            right: r.right + 6,
            bottom: bottom + 6,
          });
      }
    }
    const layers = [];
    for (const svg of card.querySelectorAll('svg')) {
      const r = svg.getBoundingClientRect();
      const frame = svg.viewBox.baseVal;
      const imageElement = svg.querySelector('image');
      const image = new Image();
      image.src = imageElement.getAttribute('href');
      await image.decode();
      const scale = Math.min(r.width / frame.width, r.height / frame.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(r.width);
      canvas.height = Math.ceil(r.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(
        image,
        r.width - frame.width * scale - frame.x * scale,
        r.height - frame.height * scale - frame.y * scale,
        image.width * scale,
        image.height * scale,
      );
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let collisions = 0;
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
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1024, height: 624 },
    { width: 1112, height: 834 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const forbidden = [];
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
    const scen = [
      'a380',
      'a320',
      'wide-codes',
      'long-airports',
      'a320-wide-codes',
      'a320-long-airports',
    ];
    for (const scenario of scen) {
      await open(page, scenario, baseline);
      const previous = await measure(page);
      const fixed = new Map();
      for (const s of [
        '.aircraft-header',
        '.measurements',
        '.nearby',
        'footer',
      ])
        fixed.set(s, await page.locator(s).screenshot());
      await open(page, scenario);
      const g = await measure(page);
      const label = `${scenario} ${viewport.width}x${viewport.height}`;
      assert.deepEqual(g.card, previous.card, `${label}: card dimensions`);
      assert.deepEqual(g.fixed, previous.fixed, `${label}: fixed geometry`);
      assert.equal(g.scroll, false, `${label}: scrolling`);
      assert.equal(g.codeOverflow, false, `${label}: IATA code clipping`);
      assert.equal(g.metricOverflow, false, `${label}: measurement clipping`);
      assert.deepEqual(g.metricFonts, previous.metricFonts);
      assert.deepEqual(g.airportFonts, previous.airportFonts);
      assert.ok(
        g.codeFonts.every((v) => v >= 64),
        `${label}: small airport code`,
      );
      assert.equal(g.layers.length, 2);
      for (const layer of g.layers) {
        assert.equal(
          layer.collisions,
          0,
          `${label}: ${layer.class} overlaps ${layer.hitText.join(', ')}`,
        );
        assert.ok(
          layer.rect.x >= g.bounds.left && layer.rect.y >= g.bounds.top,
          `${label}: left/top cropping`,
        );
        assert.ok(
          layer.rect.x + layer.rect.width <= g.bounds.right &&
            layer.rect.y + layer.rect.height <= g.bounds.bottom,
          `${label}: right/bottom cropping`,
        );
      }
      const plane = g.layers.find((l) => l.class === 'aircraft-layer');
      assert.ok(
        Math.abs(
          plane.rect.width / plane.rect.height -
            plane.frame.width / plane.frame.height,
        ) < 0.001,
        `${label}: proportions`,
      );
      for (const [selector, pixels] of fixed)
        assert.ok(
          pixels.equals(await page.locator(selector).screenshot()),
          `${label}: surrounding pixels changed`,
        );
      if (viewport.width === 1024 && ['a380', 'a320'].includes(scenario)) {
        const image = await page.screenshot({
          path: `${output}/${scenario}-${viewport.width}x${viewport.height}.png`,
        });
        if (scenario === 'a380')
          assert.ok(
            image.equals(
              await readFile(
                `docs/stage3a/composition-review/B-${viewport.width}x${viewport.height}.png`,
              ),
            ),
            `${label}: approved B pixels changed`,
          );
      }
      results.push({
        scenario,
        viewport,
        passed: true,
        approvedBPixelIdentical: scenario === 'a380' && viewport.width === 1024,
        layout: g,
      });
    }
    for (const scenario of [
      'single',
      'a320-single',
      'missing-route',
      'icao-only',
      'empty',
      'unavailable',
      'challenger',
      'piper',
      'dreamliner',
      'atr',
      'helicopter',
      'long-names',
      'unknown',
    ]) {
      await open(page, scenario, baseline);
      const pixels = await page.screenshot();
      await open(page, scenario);
      const current = await page.screenshot();
      assert.ok(
        pixels.equals(current),
        `${scenario} ${viewport.height}: accepted state pixels changed`,
      );
      assert.equal(await page.locator('.composed-artwork').count(), 0);
      if (
        viewport.width === 1024 &&
        ['single', 'a320-single'].includes(scenario)
      )
        await page.screenshot({
          path: `${output}/${scenario}-${viewport.width}x${viewport.height}.png`,
        });
      results.push({ scenario, viewport, pixelIdenticalToBaseline: true });
    }
    // A retired review query must have no effect on the actual finished interface.
    await open(page, 'a380');
    const approved = await page.screenshot();
    for (const variant of ['A', 'B', 'C']) {
      await page.goto(
        `${base}/qa-stage3a.html?scenario=a380&composition=${variant}`,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(100);
      await page.addStyleTag({
        content:
          '.aircraft-card,.aircraft-header,.aircraft-layer{animation:none!important}',
      });
      assert.ok(
        approved.equals(await page.screenshot()),
        'retired composition switch still active',
      );
    }
    await open(page, 'a320-wide-codes');
    await page.setViewportSize({
      width: 1024,
      height: viewport.height === 624 ? 768 : 624,
    });
    await page.waitForTimeout(100);
    assert.equal((await measure(page)).codeOverflow, false, 'resize refit');
    const route = await page.locator('.route').elementHandle();
    for (let i = 0; i < 60; i++)
      await page.evaluate(() => window.stage3aFixture('a320'));
    assert.ok(
      await route.evaluate((e) => e === document.querySelector('.route')),
      'routine updates replaced route DOM',
    );
    assert.equal(
      await page.evaluate(() => window.fixtureResizeListeners),
      1,
      'routine updates accumulated resize listeners',
    );
    // Mode changes with the same primary ID must clean up font fitting correctly.
    await page.evaluate(() => window.stage3aFixture('a320-single'));
    assert.equal(await page.locator('.composed-artwork').count(), 0);
    assert.equal(
      await page
        .locator('.route')
        .evaluate((e) => e.style.getPropertyValue('--route-fitted-size')),
      '',
    );
    assert.equal(
      await page.evaluate(() => window.fixtureResizeListeners),
      0,
      'single-aircraft cleanup',
    );
    await page.evaluate(() => window.stage3aFixture('a320'));
    await page.waitForFunction(() =>
      document
        .querySelector('.route')
        ?.style.getPropertyValue('--route-fitted-size'),
    );
    assert.equal(
      await page.evaluate(() => window.fixtureResizeListeners),
      1,
      'multiple-aircraft reinitialisation',
    );
    await page.evaluate(() => window.stage3aFixture('empty'));
    await page.waitForFunction(() => window.fixtureResizeListeners === 0);
    assert.equal(
      await page.evaluate(() => window.fixtureResizeListeners),
      0,
      'unmount cleanup',
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(forbidden, []);
    await page.close();
  }
  await writeFile(
    `${output}/checks.json`,
    JSON.stringify(
      {
        baseline: '19c2518f42f5151aee30b0b06de6337759f97a00',
        alphaThreshold: 8,
        textGuardPx: 6,
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS final composition: 18 silhouette layouts, 39 pixel-identical unchanged states, exact B screenshots, resize and single/multiple lifecycle; no API calls.',
  );
} finally {
  await browser.close();
}

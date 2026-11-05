// Development fixtures only; no live API calls. See composition-review/README.md.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: process.env.PERCH_CHROMIUM ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const base = 'http://127.0.0.1:5173';
const output = 'docs/stage3a/composition-review';
const results = [];
const collisionFailures = [];
await mkdir(output, { recursive: true });

async function open(page, scenario, variant = '') {
  await page.goto(
    `${base}/qa-stage3a.html?scenario=${scenario}&composition=${variant}`,
  );
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
  for (const height of [768, 624]) {
    const page = await browser.newPage({ viewport: { width: 1024, height } });
    const errors = [];
    const forbidden = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base || url.pathname.startsWith('/api/')) {
        forbidden.push(url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    await open(page, 'a380');
    const baseline = await measure(page);
    const fixedPixels = new Map();
    for (const s of ['.aircraft-header', '.measurements', '.nearby', 'footer'])
      fixedPixels.set(s, await page.locator(s).screenshot());
    await page.screenshot({ path: `${output}/baseline-1024x${height}.png` });
    for (const variant of ['A', 'B', 'C']) {
      for (const scenario of ['a380', 'wide-codes', 'long-airports']) {
        await open(page, scenario, variant);
        const g = await measure(page);
        const label = `${variant} ${scenario} 1024x${height}`;
        assert.deepEqual(g.card, baseline.card, `${label}: card dimensions`);
        assert.deepEqual(g.fixed, baseline.fixed, `${label}: fixed layout`);
        assert.equal(g.scroll, false, `${label}: scrolling`);
        assert.equal(g.codeOverflow, false, `${label}: code clipping`);
        assert.equal(g.metricOverflow, false, `${label}: measurement clipping`);
        assert.deepEqual(g.metricFonts, baseline.metricFonts);
        assert.deepEqual(
          g.airportFonts,
          baseline.airportFonts,
          `${label}: name font unchanged`,
        );
        assert.ok(
          g.codeFonts.every((n) => n >= (height === 624 ? 60 : 65)),
          `${label}: readable wide codes`,
        );
        assert.equal(g.layers.length, 2);
        for (const layer of g.layers) {
          if (layer.collisions)
            collisionFailures.push(
              `${label}: ${layer.class} overlaps ${layer.hitText.join(', ')} (${layer.collisions} pixels)`,
            );
          assert.ok(
            layer.rect.x >= g.bounds.left && layer.rect.y >= g.bounds.top,
            `${label}: left/top clipping`,
          );
          assert.ok(
            layer.rect.x + layer.rect.width <= g.bounds.right &&
              layer.rect.y + layer.rect.height <= g.bounds.bottom,
            `${label}: right/bottom clipping`,
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
        for (const [s, pixels] of fixedPixels)
          assert.ok(
            pixels.equals(await page.locator(s).screenshot()),
            `${label}: ${s} pixels changed`,
          );
        const filename =
          scenario === 'a380'
            ? `${variant}-1024x${height}.png`
            : `${variant}-${scenario}-1024x${height}.png`;
        await page.screenshot({ path: `${output}/${filename}` });
        results.push({
          variant,
          scenario,
          viewport: { width: 1024, height },
          passed: g.layers.every((layer) => layer.collisions === 0),
          layout: g,
        });
      }
    }
    // A review parameter must never redesign any already-accepted other state.
    for (const scenario of [
      'single',
      'empty',
      'unavailable',
      'missing-route',
      'icao-only',
      'a320',
      'challenger',
    ]) {
      await open(page, scenario);
      const before = await page.screenshot();
      for (const variant of ['A', 'B', 'C']) {
        await open(page, scenario, variant);
        assert.ok(
          before.equals(await page.screenshot()),
          `${variant} ${scenario} ${height}: unaffected state pixels changed`,
        );
        results.push({
          variant,
          scenario,
          viewport: { width: 1024, height },
          pixelIdentical: true,
        });
      }
    }
    // Refit only on review viewport/fixture changes; no recurring timer/state loop.
    await open(page, 'wide-codes', 'B');
    await page.setViewportSize({
      width: 1024,
      height: height === 768 ? 624 : 768,
    });
    await page.waitForTimeout(100);
    assert.equal((await measure(page)).codeOverflow, false, 'resize font fit');
    assert.deepEqual(errors, []);
    assert.deepEqual(
      forbidden,
      [],
      'review fixtures made network/API requests',
    );
    await page.close();
  }
  assert.deepEqual(collisionFailures, [], 'visible silhouette/text separation');
  const comparison = await browser.newPage({
    viewport: { width: 3136, height: 1000 },
  });
  await comparison.goto(`${base}/${output}/index.html`);
  await comparison.evaluate(() =>
    Promise.all([...document.images].map((image) => image.decode())),
  );
  for (const [id, height] of [
    ['native', 768],
    ['compact', 624],
  ])
    await comparison.locator(`#${id}`).screenshot({
      path: `${output}/comparison-1024x${height}.png`,
    });
  await comparison.close();
  await writeFile(
    `${output}/checks.json`,
    JSON.stringify(
      {
        baseline: '451fec765bb1dd92bf9ae0d8ae254de5badedef1',
        alphaThreshold: 8,
        textGuardPx: 6,
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: 18 composition layouts, 42 pixel-identical unaffected states, fixed surrounding pixels, alpha-silhouette separation, resize, no API calls.',
  );
} finally {
  await browser.close();
}

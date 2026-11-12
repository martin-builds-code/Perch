// Readability and stationary illustration checks; synthetic data only.
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
const baseline = 'http://127.0.0.1:5176';
const output = 'docs/stage3-readability';
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
      if (clip.width <= 1 && clip.height <= 1) continue;
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
      const sourceFrame = viewport ? viewport.viewBox.baseVal : frame;
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
        x: offsetX + (viewport?.x.baseVal.value ?? 0) * scale,
        y: offsetY + (viewport?.y.baseVal.value ?? 0) * scale,
        width: (viewport?.width.baseVal.value ?? frame.width) * scale,
        height: (viewport?.height.baseVal.value ?? frame.height) * scale,
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

const transitions = [];
const scenarios = [
  'readability-multiple',
  'readability-single',
  'readability-partial',
  'readability-two',
  'readability-one-secondary',
  'readability-wide',
  'readability-sparse',
  'a380',
  'a320',
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
  'piper',
  'b777',
  'pioneer',
];
try {
  const failures = [];
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1024, height: 624 },
    { width: 1112, height: 834 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [],
      requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    await page.route('**/*', (r) => {
      const u = new URL(r.request().url());
      return ![base, baseline].includes(u.origin) ||
        u.pathname.startsWith('/api/')
        ? r.abort()
        : r.continue();
    });
    for (const scenario of scenarios) {
      const label = `${scenario} ${viewport.width}x${viewport.height}`;
      await open(page, scenario, baseline);
      const header = await page.locator('.aircraft-header').screenshot(),
        footer = await page.locator('footer').screenshot();
      if (
        viewport.width === 1024 &&
        ['readability-multiple', 'readability-single'].includes(scenario)
      )
        await page.screenshot({
          path: `${output}/before-${scenario}-${viewport.width}x${viewport.height}.png`,
        });
      const previous = ['readability-multiple', 'a380'].includes(scenario)
        ? await measure(page)
        : null;
      await open(page, scenario);
      const g = await measure(page);
      const plane = g.layers.find((l) => l.class === 'aircraft-layer');
      assert.equal(g.layers.length, 1, `${label}: cloud or missing artwork`);
      assert.equal(g.scroll, false, `${label}: scrolling`);
      assert.equal(g.codeOverflow, false, `${label}: main route overflow`);
      assert.equal(g.metricOverflow, false, `${label}: metrics overflow`);
      if (plane.collisions)
        failures.push(
          `${label}: illustration near ${plane.hitText.join(', ')}`,
        );
      assert.ok(
        plane.painted.left >= g.bounds.left &&
          plane.painted.right <= g.bounds.right &&
          plane.painted.top >= g.bounds.top &&
          plane.painted.bottom <= g.bounds.bottom,
        `${label}: aircraft clipping`,
      );
      assert.ok(
        header.equals(await page.locator('.aircraft-header').screenshot()),
        `${label}: header changed`,
      );
      assert.ok(
        footer.equals(await page.locator('footer').screenshot()),
        `${label}: footer changed`,
      );
      if (previous && viewport.width === 1024) {
        const before = previous.layers.find(
          (l) => l.class === 'aircraft-layer',
        ).projectedFrame;
        for (const key of ['x', 'y', 'width', 'height'])
          assert.ok(
            Math.abs(before[key] - plane.projectedFrame[key]) < 1,
            `${label}: established placement changed (${key})`,
          );
      }
      const cards = await page.locator('.nearby-aircraft').evaluateAll((es) =>
        es.map((e) => {
          const box = (x) => {
            if (!x) return null;
            const r = x.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          };
          const h = e.querySelector('h3'),
            route = e.querySelector('.secondary-route'),
            metrics = e.querySelector('.secondary-metrics');
          return {
            card: box(e),
            title: box(h),
            route: box(route),
            metrics: box(metrics),
            titleFont: parseFloat(getComputedStyle(h).fontSize),
            routeFont: route
              ? parseFloat(getComputedStyle(route).fontSize)
              : null,
            codeOverflow: route
              ? [...route.querySelectorAll('span:not(.secondary-arrow)')].some(
                  (x) => x.scrollWidth > x.clientWidth + 1,
                )
              : false,
            metricOverflow: [...metrics.querySelectorAll('.nearby-value')].some(
              (x) => x.scrollWidth > x.clientWidth + 1,
            ),
            text: e.textContent,
          };
        }),
      );
      for (const c of cards) {
        if (c.title.bottom > (c.route?.y ?? c.metrics.y) + 1)
          failures.push(`${label}: title overlaps route/metrics`);
        if (c.route && c.route.bottom > c.metrics.y + 1)
          failures.push(`${label}: route overlaps metrics`);
        if (c.metrics.bottom > c.card.bottom - 1)
          failures.push(`${label}: secondary metrics clipped`);
        if (c.codeOverflow || c.metricOverflow)
          failures.push(`${label}: secondary field overflow`);
        assert.ok(
          c.titleFont >= (viewport.height === 624 ? 26 : 28),
          `${label}: title shrunk excessively`,
        );
        if (c.route)
          assert.ok(c.routeFont >= (viewport.height === 624 ? 64 : 66));
        assert.ok(
          !c.text.includes('FIXTURE 01'),
          `${label}: secondary callsign shown`,
        );
      }
      if (scenario === 'readability-partial')
        assert.equal(cards.filter((c) => c.route).length, 1);
      if (scenario === 'readability-sparse')
        assert.equal(cards.filter((c) => c.route).length, 0);
      if (
        viewport.width === 1024 &&
        [
          'readability-multiple',
          'readability-single',
          'readability-partial',
          'readability-two',
          'readability-wide',
          'a380',
          'long-names',
          'long-airports',
        ].includes(scenario)
      )
        await page.screenshot({
          path: `${output}/${scenario}-${viewport.width}x${viewport.height}.png`,
        });
      results.push({ scenario, viewport, artwork: plane, secondary: cards });
    }
    console.log('Checked layout set', viewport, 'current issues', failures);
    for (const [multi, single, subject] of [
      ['readability-multiple', 'readability-single', 'generic'],
      ['a380', 'single', 'a380'],
    ]) {
      await open(page, multi);
      const before = await measure(page);
      const node = await page.locator('.aircraft-layer').elementHandle();
      const a = before.layers[0].projectedFrame;
      await page.evaluate((kind) => window.stage3aFixture(kind), single);
      await page.waitForTimeout(100);
      const alone = await measure(page);
      assert.deepEqual(
        alone.layers[0].projectedFrame,
        a,
        `${subject}: jumped into single mode`,
      );
      assert.ok(
        await node.evaluate(
          (e) => e === document.querySelector('.aircraft-layer'),
        ),
        'artwork remounted',
      );
      if (viewport.width === 1024)
        await page.screenshot({
          path: `${output}/${subject}-multiple-to-single-${viewport.width}x${viewport.height}.png`,
        });
      await page.evaluate((kind) => window.stage3aFixture(kind), multi);
      await page.waitForTimeout(100);
      const back = await measure(page);
      assert.deepEqual(
        back.layers[0].projectedFrame,
        a,
        `${subject}: jumped into multiple mode`,
      );
      assert.ok(
        await node.evaluate(
          (e) => e === document.querySelector('.aircraft-layer'),
        ),
      );
      if (viewport.width === 1024)
        await page.screenshot({
          path: `${output}/${subject}-single-to-multiple-${viewport.width}x${viewport.height}.png`,
        });
      transitions.push({
        subject,
        viewport,
        multiple: a,
        single: alone.layers[0].projectedFrame,
        returned: back.layers[0].projectedFrame,
        pixelCoordinateDelta: 0,
      });
    }
    await open(page, 'readability-partial');
    const partialArt = (await measure(page)).layers[0].projectedFrame;
    await page.evaluate(() => window.stage3aFixture('readability-multiple'));
    await page.waitForFunction(
      () => document.querySelectorAll('.secondary-route').length === 3,
    );
    assert.deepEqual(
      (await measure(page)).layers[0].projectedFrame,
      partialArt,
      'late secondary route moved the illustration',
    );
    await open(page, 'empty');
    await page
      .locator('style')
      .evaluateAll((es) =>
        es
          .filter((e) => !e.hasAttribute('data-vite-dev-id'))
          .forEach((e) => e.remove()),
      );
    const radar = await page.locator('.radar').evaluate((e) => {
      const r = e.getBoundingClientRect(),
        s = getComputedStyle(e),
        a = getComputedStyle(e.querySelector('span'));
      return {
        width: r.width,
        height: r.height,
        x: r.x,
        y: r.y,
        opacity: s.opacity,
        border: s.borderColor,
        sweep: a.backgroundImage,
        duration: a.animationDuration,
      };
    });
    assert.equal(radar.width, 220);
    assert.equal(radar.height, 220);
    assert.equal(radar.duration, '16s');
    assert.ok(Number(radar.opacity) >= 0.9);
    assert.ok(Math.abs(radar.x + 110 - viewport.width / 2) < 1);
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
    if (viewport.width === 1024)
      await page.screenshot({
        path: `${output}/unavailable-${viewport.width}x${viewport.height}.png`,
      });
    assert.deepEqual(errors, []);
    assert.equal(
      requests.filter(
        (u) => u.startsWith(base + '/') && u.includes('cloud_strip'),
      ).length,
      0,
      'cloud fetched',
    );
    assert.equal(
      requests.filter((u) => u.includes('/api/')).length,
      0,
      'fixture API traffic',
    );
    await page.close();
  }
  const meta = {
    baseline: 'b22a5c2ecefcf9c903aa91ee4dfe52b15eecdcdf',
    textGuardPx: 6,
    alphaThreshold: 8,
    failures,
    transitions,
  };
  await writeFile(
    `${output}/checks.json`,
    JSON.stringify(meta).slice(0, -1) +
      ',"layouts":[\n' +
      results.map((r) => JSON.stringify(r)).join(',\n') +
      '\n]}\n',
  );
  assert.deepEqual(failures, [], 'readability layout collisions');
  console.log(
    'PASS readability: 72 layouts, 6 bidirectional stationary-artwork transitions, three radar/outage checks, no cloud/API requests.',
  );
} finally {
  await browser.close();
}

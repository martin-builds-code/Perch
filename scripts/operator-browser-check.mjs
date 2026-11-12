// Synthetic local display checks; before is the accepted 7b446435 baseline.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const output = 'docs/stage3-operator';
await mkdir(output, { recursive: true });
const results = [],
  transitions = [],
  failures = [];
async function open(page, port, query) {
  await page.goto(`http://127.0.0.1:${port}/qa-operator.html?${query}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  await page.addStyleTag({
    content:
      '.aircraft-header,.aircraft-card,.aircraft-layer{animation:none!important}',
  });
}
async function measure(page) {
  return page.evaluate(async () => {
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const entries = [...document.querySelectorAll('.details dd')].map(
      (e) => ({
        label: e.previousElementSibling.textContent,
        value: e.textContent,
        font: parseFloat(getComputedStyle(e).fontSize),
        weight: getComputedStyle(e).fontWeight,
        color: getComputedStyle(e).color,
        rect: rect(e),
        overflow: e.scrollWidth > e.clientWidth + 1,
      }),
    );
    const svg = document.querySelector('.aircraft-layer'),
      r = svg.getBoundingClientRect(),
      frame = svg.viewBox.baseVal;
    const image = new Image();
    image.src = svg.querySelector('image').getAttribute('href');
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(r.width);
    canvas.height = Math.ceil(r.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }),
      scale = Math.min(r.width / frame.width, r.height / frame.height);
    ctx.drawImage(
      image,
      r.width - frame.width * scale - frame.x * scale,
      r.height - frame.height * scale - frame.y * scale,
      image.width * scale,
      image.height * scale,
    );
    const pixels = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    ).data;
    const collisions = [];
    for (const e of document.querySelectorAll('.details dt,.details dd')) {
      const clip = e.getBoundingClientRect();
      if (clip.width <= 1 && clip.height <= 1) continue;
      const range = document.createRange();
      range.selectNodeContents(e);
      for (const t of range.getClientRects()) {
        const top = Math.max(t.top, clip.top),
          bottom = Math.min(t.bottom, clip.bottom);
        if (bottom <= top) continue;
        let hit = false;
        for (
          let y = Math.max(0, Math.floor(top - r.top - 6));
          y < Math.min(canvas.height, Math.ceil(bottom - r.top + 6));
          y++
        )
          for (
            let x = Math.max(
              0,
              Math.floor(Math.max(t.left, clip.left) - r.left - 6),
            );
            x <
            Math.min(
              canvas.width,
              Math.ceil(Math.min(t.right, clip.right) - r.left + 6),
            );
            x++
          )
            if (pixels[(y * canvas.width + x) * 4 + 3] > 8) hit = true;
        if (hit) collisions.push(e.textContent);
      }
    }
    return {
      entries,
      art: rect(svg),
      card: rect(document.querySelector('.aircraft-card')),
      header: rect(document.querySelector('.aircraft-header')),
      route: rect(document.querySelector('.route')),
      metrics: rect(document.querySelector('.measurements')),
      secondary: [...document.querySelectorAll('.nearby-aircraft')].map(
        rect,
      ),
      scroll:
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
      collisions,
    };
  });
}
try {
  for (const height of [768, 624]) {
    const page = await browser.newPage({
        viewport: { width: 1024, height },
      }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const generic of [false, true])
      for (const single of [false, true])
        for (const operator of [
          null,
          'easyJet',
          'Ryanair',
          'British Airways',
          'KLM Royal Dutch Airlines',
          'Northern Isles Regional Air Services Demonstration Operator',
        ]) {
          const query = new URLSearchParams();
          if (operator) query.set('operator', operator);
          if (generic) query.set('generic', '');
          if (single) query.set('single', '');
          const id = `${generic ? 'generic' : 'a380'}-${single ? 'single' : 'multiple'}-${operator ?? 'missing'}-${height}`;
          await open(page, 5178, query);
          const before = await measure(page);
          const unaffected = await Promise.all(
            [
              '.aircraft-header',
              '.route',
              '.measurements',
              ...(!single ? ['.nearby'] : []),
            ].map((s) => page.locator(s).screenshot()),
          );
          if (!generic && operator === 'British Airways')
            await page.screenshot({
              path: `${output}/before-${single ? 'single' : 'multiple'}-1024x${height}.png`,
            });
          await open(page, 5173, query);
          const after = await measure(page);
          for (const key of [
            'art',
            'card',
            'header',
            'route',
            'metrics',
            'secondary',
          ])
            assert.deepEqual(
              after[key],
              before[key],
              `${id}: ${key} moved`,
            );
          const current = await Promise.all(
            [
              '.aircraft-header',
              '.route',
              '.measurements',
              ...(!single ? ['.nearby'] : []),
            ].map((s) => page.locator(s).screenshot()),
          );
          assert.ok(
            unaffected.every((b, i) => b.equals(current[i])),
            `${id}: unchanged panel pixels differ`,
          );
          if (after.collisions.length)
            failures.push(`${id}: artwork collision ${after.collisions}`);
          assert.equal(after.scroll, false, id);
          const op = after.entries.find((e) => e.label === 'Operator');
          assert.equal(!!op, !!operator, id);
          if (op) {
            assert.equal(op.value, operator);
            assert.equal(op.overflow, false, `${id}: operator clipped`);
            assert.ok(
              op.font >= (single ? (height === 624 ? 38 : 42) : 30),
            );
            assert.equal(op.color, 'rgb(255, 248, 237)');
            const call = after.entries.find((e) => e.label === 'Callsign');
            if (call?.rect.width) assert.ok(op.font > call.font);
          }
          for (const e of after.entries)
            if (e.rect.width > 1)
              assert.equal(e.overflow, false, `${id}: ${e.label} clipped`);
          if (!generic && operator === 'British Airways')
            await page.screenshot({
              path: `${output}/after-${single ? 'single' : 'multiple'}-1024x${height}.png`,
            });
          if (!generic && operator?.startsWith('Northern'))
            await page.screenshot({
              path: `${output}/long-${single ? 'single' : 'multiple'}-1024x${height}.png`,
            });
          if (!generic && operator === null)
            await page.screenshot({
              path: `${output}/missing-${single ? 'single' : 'multiple'}-1024x${height}.png`,
            });
          results.push({ id, before: before.entries, after });
        }
    for (const single of [false, true]) {
      const query = new URLSearchParams({
        operator: 'British Airways',
        'long-model': '',
      });
      if (single) query.set('single', '');
      await open(page, 5173, query);
      const g = await measure(page);
      if (g.collisions.length)
        failures.push(`long model ${height} ${single}: ${g.collisions}`);
      assert.equal(g.scroll, false);
      await page.screenshot({
        path: `${output}/long-model-${single ? 'single' : 'multiple'}-1024x${height}.png`,
      });
      results.push({ id: `long-model-${single}-${height}`, after: g });
    }
    for (const generic of [false, true]) {
      const query = new URLSearchParams({ operator: 'British Airways' });
      if (generic) query.set('generic', '');
      await open(page, 5173, query);
      const node = await page.locator('.aircraft-layer').elementHandle(),
        before = await node.boundingBox();
      for (const single of [true, false]) {
        await page.evaluate(
          (value) => window.operatorFixture(value),
          single,
        );
        await page.waitForTimeout(25);
        assert.deepEqual(await node.boundingBox(), before);
        assert.ok(
          await node.evaluate(
            (e) => e === document.querySelector('.aircraft-layer'),
          ),
        );
      }
      transitions.push({
        height,
        generic,
        coordinateDeltaPx: 0,
        nodeRetained: true,
      });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(
    output + '/checks.json',
    JSON.stringify(
      {
        baseline: '7b446435a8eff825c11e21ab109429db33a52658',
        failures,
        transitions,
        layouts: results,
      },
      null,
      2,
    ) + '\n',
  );
  assert.deepEqual(failures, []);
  console.log(
    `PASS: ${results.length} operator layouts, ${transitions.length} bidirectional stationary transitions, unchanged surrounding panels and artwork/text clearance.`,
  );
} finally {
  await browser.close();
}

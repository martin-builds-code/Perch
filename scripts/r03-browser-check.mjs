import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PERCH_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const results = [];
try {
  for (const height of [768, 624])
    for (const scenario of ['a380', 'single', 'a320']) {
      const p = await browser.newPage({
        viewport: { width: 1024, height },
      });
      await p.goto(
        'http://127.0.0.1:5173/qa-stage3a.html?scenario=' + scenario,
      );
      await p.evaluate(() => document.fonts.ready);
      const box = () => p.locator('.artwork-stage').boundingBox();
      const before = await box();
      assert.equal(
        await p.getByText('Historical route', { exact: true }).count(),
        0,
      );
      await p.evaluate(() => window.r03Historical(true));
      await p
        .getByText('Historical route', { exact: true })
        .first()
        .waitFor();
      assert.deepEqual(await box(), before);
      const checks = await p.evaluate(() => {
        const box = (e) => {
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
        return [...document.querySelectorAll('.historical-route')].map(
          (e) => ({
            label: box(e),
            card: box(e.closest('article') || e.closest('.aircraft-card')),
            font: parseFloat(getComputedStyle(e).fontSize),
            metrics: box(
              (
                e.closest('article') || e.closest('.aircraft-card')
              ).querySelector('.secondary-metrics') || e,
            ),
          }),
        );
      });
      for (const c of checks) {
        assert.ok(c.font >= 17);
        assert.ok(c.label.right <= c.card.right + 1);
        assert.ok(c.label.bottom <= c.card.bottom + 1);
      assert.ok(c.metrics.bottom <= c.card.bottom + 1);
        if (c.label.y !== c.metrics.y)
          assert.ok(c.label.bottom <= c.metrics.y + 1);
      }
      assert.ok(
        await p.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight,
        ),
      );
      await p.screenshot({
        path: `docs/route-r03/${scenario}-1024x${height}.png`,
      });
      await p.evaluate(() => window.r03Historical(false));
      assert.equal(
        await p.getByText('Historical route', { exact: true }).count(),
        0,
      );
      assert.deepEqual(await box(), before);
      results.push({
        scenario,
        height,
        labelCount: checks.length,
        checks,
        stationaryArtwork: true,
        recentUnqualified: true,
      });
      await p.close();
    }
  await writeFile(
    'docs/route-r03/browser.json',
    JSON.stringify(results, null, 2),
  );
  console.log(
    'PASS R03 historical labels, recent omission, stationary artwork and no overflow at both sizes',
  );
} finally {
  await browser.close();
}

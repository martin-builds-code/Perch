// Bounded read-only Preview checks. Verdicts below are browser-test actions,
// never aviation findings; nothing is submitted and browser storage is discarded.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import {
  canonical,
  importReview,
  parseReviewDataset,
} from '../../src/routeReviewModel.ts';
const { chromium } = await import(process.env.PERCH_PLAYWRIGHT_MODULE);
const base = process.env.PERCH_R02_PREVIEW_URL;
assert.ok(
  base &&
    /^https:\/\/perch-aero-pane-stage3a(?:-[a-z0-9]+-mml3)?\.vercel\.app$/.test(
      base,
    ),
);
const expected = JSON.parse(
  await readFile(new URL('./cases.json', import.meta.url), 'utf8'),
);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY }
    : undefined,
  args: ['--no-sandbox', '--disable-http2', '--disable-quic'],
});
const checks = [];
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 1024, height: 768 },
    { width: 1024, height: 624 },
  ]) {
    const context = await browser.newContext({
      viewport,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    const response = await context.request.get(base + '/api/route-review');
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['cache-control'], 'private, no-store');
    assert.equal(response.headers()['set-cookie'], undefined);
    const dataset = await response.json();
    assert.ok(parseReviewDataset(dataset));
    assert.equal(canonical(dataset), canonical(expected));
    const navigation = await page.goto(base + '/route-review', {
      waitUntil: 'networkidle',
    });
    assert.equal(navigation.status(), 200);
    for (let i = 0; i < expected.cases.length; i++) {
      const c = expected.cases[i];
      await page
        .getByRole('heading', { name: c.callsign, exact: true })
        .waitFor();
      assert.match(
        await page.locator('.review-observation').innerText(),
        new RegExp(
          new Date(c.observedAtMs)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' '),
        ),
      );
      assert.match(
        await page.locator('.review-progress').innerText(),
        new RegExp('Case ' + (i + 1) + ' of 16'),
      );
      if (c.registration)
        assert.equal(
          await page
            .getByRole('link', {
              name: 'Open aircraft history in FR24',
              exact: true,
            })
            .getAttribute('href'),
          'https://www.flightradar24.com/data/aircraft/' +
            c.registration.toLowerCase(),
        );
      if (i === 0) {
        await page.evaluate(() => document.fonts.ready);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path:
            'docs/route-r02/hosted-' +
            viewport.width +
            'x' +
            viewport.height +
            '.png',
          fullPage: true,
        });
      }
      if (i < expected.cases.length - 1)
        await page
          .getByRole('button', { name: 'Next →', exact: true })
          .click();
    }
    await page
      .getByRole('button', { name: 'Unable to verify', exact: true })
      .click();
    await page
      .getByRole('button', { name: '← Previous', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Next →', exact: true })
      .click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Unable to verify', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .getByRole('heading', {
        name: expected.cases[15].callsign,
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Unable to verify', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    const promised = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export results', exact: true })
      .click();
    const file = await promised;
    const result = JSON.parse(await readFile(await file.path(), 'utf8'));
    assert.ok(importReview(result, dataset));
    assert.equal(result.summary.reviewed, 1);
    assert.equal(result.complete, false);
    assert.equal(
      result.cases[15].case.callsign,
      expected.cases[15].callsign,
    );
    assert.equal(
      requests.filter((p) =>
        /^\/api\/(aircraft|session|enrichment)$/.test(p),
      ).length,
      0,
    );
    const http = [];
    for (const path of [
      '/api/session',
      '/api/aircraft',
      '/api/enrichment',
      '/api/route-research',
    ]) {
      const r = await context.request.get(base + path);
      assert.equal(
        r.status(),
        path.endsWith('route-research') ? 404 : 401,
      );
      assert.equal(r.headers()['set-cookie'], undefined);
      http.push({ path, status: r.status() });
    }
    assert.equal(
      (
        await context.request.post(base + '/api/route-review', {
          data: { verdict: 'same-route' },
        })
      ).status(),
      405,
    );
    if (viewport.width === 1024) {
      await page.goto(base + '/?mode=live', { waitUntil: 'networkidle' });
      await page
        .getByRole('heading', { name: 'Enter your PIN', exact: true })
        .waitFor();
      assert.equal(await page.locator('.primary-card').count(), 0);
      await page.screenshot({
        path: 'docs/route-r02/hosted-pin-' + viewport.height + '.png',
      });
    }
    assert.deepEqual(errors, []);
    checks.push({
      viewport,
      frozenCaseCount: 16,
      exactDataset: true,
      allCallsDatesAndRegistrationLinks: true,
      localResume: true,
      validPartialExport: true,
      exportVerdictsAreSyntheticTestActions: true,
      reviewPageTrackingRequests: 0,
      reviewPageProviderRequests: 0,
      horizontalOverflow: false,
      mainPinProtected: true,
      http,
    });
    await context.close();
  }
  await writeFile(
    'docs/route-r02/hosted-checks.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        base,
        checks,
        physicalDeviceTest: false,
        actualOwnerVerdicts: 0,
        notes: [
          'The hosted page uses real frozen research cases; no mocked API responses.',
          'No FR24 flight page or aviation provider was requested by these tests.',
          'Main protected live content was not unlocked; PIN screen and unauthorized HTTP guards were checked.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS hosted R02 Preview: 16 real frozen cases at four phone/iPad sizes, exact identities/dates/links, local resume/export, no provider calls, main PIN and closed sampler.',
  );
} finally {
  await browser.close();
}

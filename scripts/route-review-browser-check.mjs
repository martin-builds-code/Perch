// Local mocked review tests only; no real tracking/provider/FR24 calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { reviewFixture } from '../tests/fixtures/route-review.ts';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const base = process.env.PERCH_REVIEW_LOCAL_URL ?? 'http://127.0.0.1:5173';
const fixture = reviewFixture(),
  out = 'docs/route-r02';
await mkdir(out, { recursive: true });
const results = [];
async function setup(viewport, init) {
  const context = await browser.newContext({
    viewport,
    acceptDownloads: true,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const state = {
    datasetGets: 0,
    forbidden: 0,
    errors: [],
    downloads: [],
  };
  page.on('pageerror', (e) => state.errors.push(e.message));
  page.on('download', (d) => state.downloads.push(d));
  page.on('request', (r) => {
    if (
      /\/api\/(aircraft|enrichment|session)(\?|$)/.test(
        new URL(r.url()).pathname,
      )
    )
      state.forbidden++;
  });
  await page.route('**/api/route-review', async (route) => {
    state.datasetGets++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
  return { context, page, state };
}
async function opened(page) {
  await page.goto(base + '/route-review?mode=live');
  await page.getByRole('heading', { name: 'TST1', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function noOverflow(page) {
  const x = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    root: getComputedStyle(document.documentElement).overflowY,
  }));
  assert.ok(x.scroll <= x.width + 1, JSON.stringify(x));
}
try {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 1024, height: 624 },
  ]) {
    const { context, page, state } = await setup(viewport);
    await opened(page);
    assert.equal(state.datasetGets, 1);
    assert.equal(state.forbidden, 0);
    assert.match(
      await page.locator('.review-observation').innerText(),
      /2026-11-11 19:00:00 UTC/,
    );
    assert.equal(
      await page
        .getByRole('link', { name: 'Open aircraft history in FR24' })
        .getAttribute('href'),
      'https://www.flightradar24.com/data/aircraft/g-test0',
    );
    await noOverflow(page);
    await page.screenshot({
      path: `${out}/review-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Same route', exact: true })
      .click();
    await page
      .getByLabel('Same aircraft, flight and date', { exact: true })
      .check();
    await page
      .getByText('Add a note or flight link (optional)', { exact: true })
      .click();
    await page
      .getByLabel('Notes (optional)', { exact: true })
      .fill('Exact dated flight; <script> is just a note.');
    await page
      .getByRole('button', { name: 'Next →', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'TST2', exact: true })
      .waitFor();
    await page
      .getByRole('button', { name: 'Different route', exact: true })
      .click();
    await page
      .getByLabel('Same flight and observed date', { exact: true })
      .check();
    await page.getByLabel('FR24 origin', { exact: true }).fill('LHR');
    await page.getByLabel('FR24 destination', { exact: true }).fill('CDG');
    await noOverflow(page);
    await page.screenshot({
      path: `${out}/different-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: '← Previous', exact: true })
      .click();
    assert.equal(
      await page
        .getByRole('button', { name: 'Same route', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.reload();
    await page
      .getByRole('heading', { name: 'TST1', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Same route', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page
        .getByLabel('Same aircraft, flight and date', { exact: true })
        .isChecked(),
      true,
    );
    await page
      .getByRole('button', { name: 'Next →', exact: true })
      .click();
    assert.equal(
      await page.getByLabel('FR24 origin', { exact: true }).inputValue(),
      'LHR',
    );
    await page
      .getByRole('button', { name: 'Next →', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Same route', exact: true })
      .click();
    await page
      .getByLabel('Another date / only a general association', {
        exact: true,
      })
      .check();
    await page
      .getByRole('button', { name: 'Next →', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'TST4', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Same route', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Next →', exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole('button', { name: 'Unable to verify', exact: true })
      .click();
    const promised = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export results', exact: true })
      .click();
    const download = await promised;
    const path = await download.path();
    const exported = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(exported.complete, true);
    assert.equal(exported.summary.reviewed, 4);
    assert.equal(exported.summary.exactDateMatches, 2);
    assert.equal(exported.datasetFingerprint, fixture.fingerprint);
    assert.equal(exported.cases[0].case.callsign, 'TST1');
    assert.equal(exported.cases[1].answer.originCode, 'LHR');
    assert.equal(exported.cases[2].answer.matchScope, 'different-date');
    await page
      .getByRole('button', { name: 'Export results', exact: true })
      .evaluate((b) => {
        b.click();
        b.click();
      });
    await page.waitForTimeout(100);
    assert.equal(state.downloads.length, 1);
    await page.locator('input[type=file]').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    await page
      .getByRole('status')
      .filter({ hasText: 'could not be loaded' })
      .waitFor();
    assert.match(
      await page.locator('.review-progress').innerText(),
      /4 reviewed/,
    );
    await page.locator('input[type=file]').setInputFiles(path);
    await page
      .getByRole('status')
      .filter({ hasText: 'Saved answers loaded' })
      .waitFor();
    assert.equal(state.forbidden, 0);
    assert.deepEqual(state.errors, []);
    assert.equal(state.datasetGets, 2);
    results.push({
      viewport,
      validExport: true,
      completeCases: 4,
      exactDateMatches: 2,
      localResume: true,
      repeatedExportSafe: true,
      badImportPreservesAnswers: true,
      providerRequests: 0,
      horizontalOverflow: false,
    });
    await context.close();
  }
  {
    const { context, page, state } = await setup(
      { width: 390, height: 844 },
      () => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('Unavailable', 'SecurityError');
          },
        });
      },
    );
    await opened(page);
    await page
      .getByText('This browser cannot save the draft.', { exact: false })
      .waitFor();
    await page
      .getByRole('button', { name: 'Unable to verify', exact: true })
      .click();
    const promise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export results', exact: true })
      .click();
    const file = await promise;
    const json = JSON.parse(await readFile(await file.path(), 'utf8'));
    assert.equal(json.complete, false);
    assert.equal(json.summary.reviewed, 1);
    assert.equal(state.forbidden, 0);
    assert.deepEqual(state.errors, []);
    results.push({
      case: 'storage unavailable',
      memoryReviewAndPartialExport: true,
    });
    await context.close();
  }
  {
    const { context, page, state } = await setup(
      { width: 390, height: 844 },
      () => {
        Object.defineProperty(navigator, 'canShare', {
          value: () => true,
        });
        Object.defineProperty(navigator, 'share', {
          value: async () => {
            throw new DOMException('Cancelled', 'AbortError');
          },
        });
      },
    );
    await opened(page);
    await page
      .getByRole('button', { name: 'Unable to verify', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Export results', exact: true })
      .click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Sharing cancelled' })
      .waitFor();
    assert.match(
      await page.locator('.review-progress').innerText(),
      /1 reviewed/,
    );
    assert.equal(state.downloads.length, 0);
    assert.deepEqual(state.errors, []);
    results.push({
      case: 'native share cancelled',
      draftUnchanged: true,
      noAutomaticDownload: true,
    });
    await context.close();
  }
  {
    const { context, page, state } = await setup(
      { width: 390, height: 844 },
      () => {
        URL.createObjectURL = () => {
          throw Error('Denied');
        };
        Object.defineProperty(navigator, 'canShare', {
          value: () => false,
        });
      },
    );
    await opened(page);
    await page
      .getByRole('button', { name: 'Unable to verify', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Export results', exact: true })
      .click();
    await page
      .getByRole('status')
      .filter({ hasText: 'export could not start' })
      .waitFor();
    assert.match(
      await page.locator('.review-progress').innerText(),
      /1 reviewed/,
    );
    assert.equal(state.downloads.length, 0);
    assert.deepEqual(state.errors, []);
    results.push({
      case: 'download failure',
      draftUnchanged: true,
      retryAvailable: await page
        .getByRole('button', {
          name: 'Download file instead',
          exact: true,
        })
        .isVisible(),
    });
    await context.close();
  }
  {
    const { context, page, state } = await setup({
      width: 390,
      height: 844,
    });
    await page.unroute('**/api/route-review');
    let gets = 0;
    await page.route('**/api/route-review', async (r) => {
      gets++;
      await r.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      });
    });
    await page.goto(base + '/route-review');
    await page
      .getByRole('button', { name: 'Try again', exact: true })
      .waitFor();
    await page.waitForTimeout(400);
    assert.equal(gets, 1);
    assert.equal(state.forbidden, 0);
    assert.deepEqual(state.errors, []);
    results.push({
      case: 'unavailable review',
      noPollingOrTracking: true,
    });
    await context.close();
  }
  {
    const { context, page, state } = await setup({
      width: 390,
      height: 844,
    });
    await page.clock.setFixedTime(new Date('2027-11-20T12:00:00Z'));
    await opened(page);
    await page
      .getByText('This observation is older than seven days.', {
        exact: false,
      })
      .waitFor();
    assert.match(
      await page.locator('.review-proposal').innerText(),
      /20.0 days/,
    );
    assert.equal(state.forbidden, 0);
    results.push({
      case: 'old observation',
      historyLimitExplained: true,
      originalAssociationAgePreserved: true,
    });
    await context.close();
  }
  await writeFile(
    out + '/browser-tests.json',
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    'PASS R02 mobile/iPad review: 4 viewports, navigation, revisions, resume, JSON identity, imports, duplicate taps, unavailable storage, share cancellation, download failure, stale cases and zero provider requests.',
  );
} finally {
  await browser.close();
}

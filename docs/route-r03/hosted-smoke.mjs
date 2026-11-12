// Real hosted PIN checks plus clearly synthetic, browser-only API fixtures.
// Never creates an auth session or reaches an aviation provider.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PERCH_PLAYWRIGHT_MODULE);
const base = process.env.PERCH_R03_URL;
assert.ok(
  /^https:\/\/perch-aero-pane-stage3a(?:-[a-z0-9]+-mml3)?\.vercel\.app$/.test(
    base,
  ),
);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY }
    : undefined,
  args: ['--no-sandbox', '--disable-http2', '--disable-quic'],
});
const out = [];
try {
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const p = await ctx.newPage();
  for (const path of [
    '/api/session',
    '/api/aircraft',
    '/api/enrichment',
    '/api/route-research',
  ]) {
    const r = await ctx.request.get(base + path);
    assert.equal(r.status(), path.endsWith('route-research') ? 404 : 401);
    assert.equal(r.headers()['set-cookie'], undefined);
  }
  const review = await ctx.request.get(base + '/api/route-review');
  assert.equal(review.status(), 200);
  assert.equal((await review.json()).cases.length, 16);
  await p.goto(base + '/?mode=live', { waitUntil: 'domcontentloaded' });
  await p
    .getByRole('heading', { name: 'Enter your PIN', exact: true })
    .waitFor();
  await p.screenshot({ path: 'docs/route-r03/hosted-pin.png' });
  await ctx.close();
  for (const height of [768, 624])
    for (const count of [1, 3]) {
      const c = await browser.newContext({
        viewport: { width: 1024, height },
      });
      const page = await c.newPage();
      await page.clock.install({ time: new Date('2026-11-11T12:00:00Z') });
      let mockCalls = 0;
      await page.route('**/api/**', async (r) => {
        const u = new URL(r.request().url()),
          now = await page.evaluate(() => Date.now());
        let data;
        if (u.pathname === '/api/session') data = { authenticated: true };
        else if (u.pathname === '/api/aircraft')
          data = {
            fetchedAtMs: now,
            providerTimeMs: now,
            pollIntervalMs: 15000,
            rejectedRecords: 0,
            anomalies: [],
            aircraft: ['abcdef', '111111', '222222']
              .slice(0, count)
              .map((id, i) => ({
                id,
                callsign: 'TEST' + (i + 1),
                registration: 'SYNTHETIC',
                description: i ? 'Airbus A320neo' : 'Airbus A380-800',
                typeCode: i ? 'A20N' : 'A388',
                distanceKm: 1 + i * 3,
                barometricAltitudeFt: 6000,
                onGround: false,
                geometricAltitudeFt: null,
                groundSpeedKnots: 210,
                trackDegrees: 90,
                positionTimeMs: now - 1000,
                source: 'adsb.fi',
                validity: {
                  position: true,
                  timestamp: true,
                  anomalies: [],
                },
              })),
          };
        else if (u.pathname === '/api/enrichment') {
          mockCalls++;
          const kind = u.searchParams.get('kind');
          const airport = (code, icao) => ({
            code,
            iata: code,
            icao,
            name: code === 'AMS' ? 'Amsterdam' : 'Manchester',
          });
          data = {
            kind,
            hex: u.searchParams.get('hex'),
            callsign: u.searchParams.get('callsign'),
            source: 'hexdb.io',
            status: 'found',
            data:
              kind === 'aircraft'
                ? { operator: 'Synthetic operator' }
                : {
                    origin: airport('AMS', 'EHAM'),
                    destination: airport('MAN', 'EGCC'),
                    associationTimeMs: now - 542 * 86400000,
                  },
            fetchedAtMs: now,
            expiresAtMs: now + (kind === 'aircraft' ? 1800000 : 300000),
          };
        } else {
          await r.abort();
          return;
        }
        await r.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(data),
        });
      });
      await page.goto(base + '/?mode=live', {
        waitUntil: 'domcontentloaded',
      });
      await page.locator('.aircraft-card').waitFor();
      await page.waitForTimeout(100);
      const before = await page.locator('.artwork-stage').boundingBox();
      for (let i = 0; i < 13; i++) {
        await page.clock.fastForward(15000);
        await page.waitForTimeout(60);
      }
      assert.equal(
        await page.getByText('Historical route', { exact: true }).count(),
        count,
      );
      assert.deepEqual(
        await page.locator('.artwork-stage').boundingBox(),
        before,
      );
      assert.ok(
        await page.evaluate(
          () =>
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: `docs/route-r03/hosted-fixture-${count}-1024x${height}.png`,
      });
      out.push({
        height,
        syntheticAircraft: count,
        historicalLabels: count,
        stationaryArtwork: true,
        fixtureApiCalls: mockCalls,
        actualProviderCalls: 0,
      });
      await c.close();
    }
  await writeFile(
    'docs/route-r03/hosted.json',
    JSON.stringify(
      {
        base,
        checkedAt: new Date().toISOString(),
        realUnauthenticatedApiStatuses: [401, 401, 401, 404],
        realPinScreen: true,
        realFrozenReviewCases: 16,
        fixtureChecks: out,
        liveAuthenticatedObservation: false,
        serverBypassEnabled: false,
        warning:
          'Hosted rendering uses intercepted synthetic API responses, not live aircraft. Backend PIN protection is unchanged.',
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS hosted PIN and API guards; synthetic historical routes in primary/secondary at both sizes; zero provider requests.',
  );
} finally {
  await browser.close();
}

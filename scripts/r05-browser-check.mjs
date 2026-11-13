// Actual adaptive browser client + shared service; mocked stores/providers only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  createAdaptiveEnrichmentService,
  AdaptiveDeferral,
} from '../server/adaptiveEnrichmentService.ts';
import { initialAdaptiveState } from '../src/adaptiveBudget.ts';
import {
  traffic,
  SCENARIOS,
  REPLAY_START,
} from '../tests/fixtures/r04-trajectories.ts';
const { chromium } = await import(process.env.PERCH_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const output = 'docs/route-r05/browser';
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const height of [768, 624]) {
    const p = await browser.newPage({ viewport: { width: 1024, height } }),
      errors = [],
      attempts = [],
      positions = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const T = REPLAY_START + 45000;
    await p.clock.install({ time: new Date(T) });
    await p.clock.pauseAt(new Date(T));
    let revision = 0,
      state = initialAdaptiveState(T),
      snapshotTime = T,
      now = T;
    const cache = new Map();
    const store = {
      key: (v) => createHash('sha256').update(v).digest('hex'),
      read: async (key) => ({
        revision,
        state: structuredClone(state),
        nowMs: now,
        cache: cache.has(key)
          ? {
              payload: JSON.stringify(cache.get(key)),
              expiresAtMs: cache.get(key).expiresAtMs,
            }
          : null,
      }),
      swap: async (key, b, next, result) => {
        if (b.revision !== revision) return false;
        state = structuredClone(next);
        revision++;
        if (result) cache.set(key, result);
        return true;
      },
      cacheValue: (r) => (r.cache ? JSON.parse(r.cache.payload) : null),
    };
    const airport = (code) => ({
      code,
      iata: code,
      icao: null,
      name: code === 'MAN' ? 'Manchester' : 'Amsterdam Schiphol',
    });
    const service = createAdaptiveEnrichmentService(
      () => store,
      async (kind, hex, callsign, observe) => {
        attempts.push({ atMs: now, kind, hex, callsign });
        observe({
          requestStarted: true,
          requestStartedAtMs: now,
          httpStatus: 200,
          outcome: kind === 'route' ? 'complete' : 'identity',
          reason: 'validated',
          endpoint:
            kind === 'route' ? 'v2/routes/:callsign' : 'v2/aircraft/:hex',
        });
        return kind === 'route'
          ? {
              origin: airport('MAN'),
              destination: airport('AMS'),
              associationTimeMs: now - 542 * 86400000,
            }
          : { operator: 'Synthetic airline', registration: 'SYNTHETIC' };
      },
      () => now,
      () => now,
    );
    await p.route('**/api/session', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: '{"authenticated":true}',
      }),
    );
    await p.route('**/api/aircraft', async (r) => {
      now = await p.evaluate(() => Date.now());
      snapshotTime = now;
      positions.push(now);
      await r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(
          traffic(SCENARIOS[7], (now - REPLAY_START) / 1000),
        ),
      });
    });
    await p.route('**/api/enrichment?*', async (r) => {
      now = await p.evaluate(() => Date.now());
      const q = new URL(r.request().url()).searchParams;
      try {
        const x = await service.get(
          q.get('kind'),
          q.get('hex'),
          q.get('callsign'),
          q.get('priority') === 'normal',
        );
        const { providerTrace: trace, ...payload } = x.result;
        await r.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ...payload,
            adaptiveBudget: x.budget,
            diagnostic: {
              origin: 'hexdb',
              serverCache: x.cache,
              upstreamRequestsStarted:
                x.cache === 'miss' && trace?.requestStarted ? 1 : 0,
              upstreamResponses:
                x.cache === 'miss' && trace?.httpStatus ? 1 : 0,
              outcome: trace?.outcome,
              reason: trace?.reason,
              httpStatus: trace?.httpStatus,
              durationMs: 1,
              ...(x.cache === 'miss'
                ? { upstreamStartedAtMs: trace?.requestStartedAtMs }
                : {}),
            },
          }),
        });
      } catch (e) {
        if (!(e instanceof AdaptiveDeferral)) throw e;
        await r.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: {
            'Retry-After': String(Math.ceil(e.retryAfterMs / 1000)),
          },
          body: JSON.stringify({
            error: 'cooldown',
            failure: {
              schemaVersion: 2,
              origin: 'application',
              category: 'local-deferral',
              reason: e.reason,
              retryAfterMs: e.retryAfterMs,
              issuedAtMs: now,
              upstreamRequestsStarted: 0,
              upstreamResponses: 0,
            },
            adaptiveBudget: e.budget,
          }),
        });
      }
    });
    await p.goto('http://127.0.0.1:5179/?mode=live&observe=2&view=normal');
    await p.locator('.aircraft-card').waitFor();
    await p.waitForFunction(
      () => document.querySelectorAll('.historical-route').length > 0,
    );
    const initialArt = await p.locator('.artwork-stage').boundingBox();
    // Advance in small steps, allowing each real asynchronous response to finish.
    for (let i = 0; i < 4; i++) {
      await p.clock.fastForward(10000);
      await p.waitForTimeout(100);
    }
    assert.ok(
      attempts.length >= 3,
      'stored capacity serves primary and predictive secondary work',
    );
    assert.ok(
      attempts[1].atMs - attempts[0].atMs < 30000,
      'no rigid 30s global wait',
    );
    assert.ok(
      attempts.filter((a) => a.kind === 'route').length >= 2,
      'secondary routes are independently looked up',
    );
    assert.ok(
      attempts
        .slice(1)
        .every((a, i) => a.atMs - attempts[i].atMs >= 10000),
    );
    assert.ok(
      positions.slice(1).every((a, i) => a - positions[i] >= 15000),
    );
    const routeTimes = attempts
      .filter((a) => a.kind === 'route')
      .map((a) => a.atMs);
    assert.ok(
      routeTimes[1] - routeTimes[0] < 90000,
      'fixed secondary 90s gate removed',
    );
    const summary = await p.evaluate(() =>
      window.aeroPaneRouteDiagnostics.summary(),
    );
    assert.ok(summary.adaptiveBudget);
    assert.equal(state.pending, null);
    await p.screenshot({
      path: `${output}/adaptive-live-mocked-${height}.png`,
    });
    const noScroll = await p.evaluate(
      () =>
        document.documentElement.scrollHeight <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth,
    );
    assert.ok(noScroll);
    assert.deepEqual(errors, []);
    await p.evaluate(() =>
      history.replaceState(null, '', '?mode=live&observe=2&sky=1'),
    );
    await p.clock.fastForward(15000);
    await p
      .getByText('Protected R05 diagnostics.', { exact: false })
      .waitFor();
    assert.equal(
      await p.getByText('secondary ≥90 s', { exact: false }).count(),
      0,
    );
    await p.screenshot({
      path: `${output}/adaptive-geometry-diagnostics-${height}.png`,
    });
    await p.evaluate(() =>
      history.replaceState(null, '', '?mode=live&observe=2'),
    );
    await p.clock.fastForward(15000);
    await p
      .getByRole('heading', { name: 'Experimental route investigation' })
      .waitFor();
    await p.getByText('start gap ≥10 s', { exact: false }).waitFor();
    await p.getByLabel('Shared adaptive budget').waitFor();
    await p.screenshot({
      path: `${output}/adaptive-budget-diagnostics-${height}.png`,
    });
    const before = attempts.length;
    await p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await p.clock.fastForward(120000);
    await p.waitForTimeout(50);
    assert.equal(
      attempts.length,
      before,
      'hidden browser does not enrich',
    );
    results.push({
      height,
      initialArt,
      snapshotTime,
      providerStarts: attempts,
      positions,
      noScroll,
      hiddenStops: true,
      errors,
    });
    await p.close();
  }
  await writeFile(
    `${output}/adaptive-client.json`,
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    'PASS R05 actual browser scheduler: adaptive bursts, secondary routes, historical labels, 10s spacing, 15s positions, hidden stop, both landscape sizes; mocked providers only.',
  );
} finally {
  await browser.close();
}

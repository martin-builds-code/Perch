// R05: one bounded ordinary live session. The deployed scheduler owns all timing.
// A separate expiring machine credential authenticates only the exact trial gateway.
// Normal PIN endpoints, credentials, R04 and Production remain untouched.
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { parseEnrichmentDiagnostic } from '../src/routeTraceTypes.ts';
import { parseEnrichmentFailure } from '../src/enrichmentFailure.ts';
import { parseAdaptiveView } from '../src/adaptiveBudget.ts';
import { verifiedAdaptiveDeferral } from '../src/adaptiveFailure.ts';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const url = new URL(
  process.env.PERCH_TRIAL_URL ?? 'https://invalid.local',
);
if (
  url.protocol !== 'https:' ||
  !/^perch-aero-pane-stage3a-[a-z0-9]+-mml3\.vercel\.app$/.test(
    url.hostname,
  )
)
  throw Error('Only the authorised isolated Preview is allowed');
url.searchParams.set('mode', 'live');
url.searchParams.set('sky', '1');
const minutes = Number(process.env.PERCH_TRIAL_MINUTES ?? 60);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 90)
  throw Error('Explicit bounded 1–90 minute session required');
url.searchParams.set('observe', String(minutes));
const output = process.env.PERCH_TRIAL_OUTPUT ?? '/tmp/perch-r05-live';
const trial = JSON.parse(
  await readFile('/tmp/perch-r05-trial.json', 'utf8'),
);
if (trial.url !== url.origin || !/^[a-f0-9]{64}$/.test(trial.key))
  throw Error('Pinned trial identity required');
await mkdir(output, { recursive: true });
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-http2', '--disable-quic'],
  ...(proxy ? { proxy: { server: proxy } } : {}),
});
const page = await browser.newPage({
  viewport: { width: 1024, height: 768 },
});
const startedAtMs = Date.now(),
  requestedFinish = startedAtMs + minutes * 60000;
const absoluteFinish = Math.min(requestedFinish, trial.expiresAtMs - 1000);
if (absoluteFinish - Date.now() < minutes * 60000 - 1000)
  throw Error('Trial credential window too short');
let stopped = false;
const watchdog = setTimeout(
  () => {
    stopped = true;
    void browser.close();
  },
  Math.max(1, absoluteFinish - Date.now() + 1000),
);
await page.route(url.origin + '/api/**', async (route) => {
  const request = route.request(),
    original = new URL(request.url());
  const resource = {
    '/api/session': 'session',
    '/api/aircraft': 'aircraft',
    '/api/enrichment': 'enrichment',
  }[original.pathname];
  if (
    stopped ||
    Date.now() >= absoluteFinish ||
    request.method() !== 'GET' ||
    !resource
  )
    return route.abort('blockedbyclient');
  const gateway = new URL('/api/r05-observe', url.origin);
  gateway.search = original.search;
  gateway.searchParams.set('resource', resource);
  try {
    const response = await route.fetch({
      url: gateway.href,
      headers: { ...request.headers(), 'x-aero-r05-test': trial.key },
      maxRedirects: 0,
      timeout: 20000,
    });
    await route.fulfill({ response });
  } catch {
    await route.abort('failed').catch(() => {});
  }
});
const network = {
  positionRequests: 0,
  enrichmentRequests: 0,
  sessionDenials: 0,
  networkFailures: 0,
  positionSources: {
    provider: 0,
    cache: 0,
    coalesced: 0,
    blocked: 0,
    unknown: 0,
  },
  positionStatuses: {},
};
const apiSamples = [],
  errors = [],
  pending = new Set();
let report = null,
  sky = null,
  stopReason = 'duration-limit',
  lastPrint = 0,
  normalCaptured = false;
function bounded(xs, v, max) {
  if (xs.length >= max) xs.shift();
  xs.push(v);
}
async function save() {
  const now = Date.now();
  await writeFile(
    output + '/observation.tmp',
    JSON.stringify(
      {
        schemaVersion: 1,
        startedAtMs,
        observedUntilMs: now,
        actualElapsedMs: now - startedAtMs,
        requestedMinutes: minutes,
        stopReason,
        network,
        pageErrorCount: errors.length,
        report,
        sky,
        apiSamples,
      },
      null,
      2,
    ) + '\n',
  );
  await rename(output + '/observation.tmp', output + '/observation.json');
}
page.on('pageerror', (e) =>
  bounded(errors, { atMs: Date.now(), name: e.name }, 32),
);
page.on('request', (r) => {
  const p = new URL(r.url()).pathname;
  if (p === '/api/aircraft') network.positionRequests++;
  if (p === '/api/enrichment') network.enrichmentRequests++;
});
page.on('requestfailed', () => network.networkFailures++);
page.on('response', (r) => {
  const u = new URL(r.url()),
    p = u.pathname;
  if (p === '/api/session' && r.status() === 401) network.sessionDenials++;
  if (p === '/api/aircraft') {
    const source = r.headers()['x-aero-position-source'];
    network.positionSources[
      source in network.positionSources ? source : 'unknown'
    ]++;
    network.positionStatuses[r.status()] =
      (network.positionStatuses[r.status()] ?? 0) + 1;
    return;
  }
  if (p !== '/api/enrichment') return;
  const task = (async () => {
    try {
      const body = await r.json(),
        q = u.searchParams;
      const references = await page.evaluate(
        ({ hex, callsign }) => ({
          sky: window.aeroPaneSkyDiagnostics?.reference(hex) ?? null,
          flight:
            window.aeroPaneRouteDiagnostics?.reference(hex, callsign) ??
            null,
        }),
        { hex: q.get('hex'), callsign: q.get('callsign') },
      );
      const safeAirport = (a) =>
        a && typeof a.code === 'string' && /^[A-Z]{3,4}$/.test(a.code)
          ? {
              code: a.code,
              iata: /^[A-Z]{3}$/.test(a.iata ?? '') ? a.iata : null,
              icao: /^[A-Z]{4}$/.test(a.icao ?? '') ? a.icao : null,
              name: '',
            }
          : undefined;
      const origin = safeAirport(body.data?.origin),
        destination = safeAirport(body.data?.destination);
      const associationTimeMs = Number.isFinite(
        body.data?.associationTimeMs,
      )
        ? body.data.associationTimeMs
        : null;
      if (
        body.diagnostic?.httpStatus === 429 ||
        body.diagnostic?.httpStatus === 403
      )
        stopReason = 'provider-throttling-or-denial';
      bounded(
        apiSamples,
        {
          atMs: Date.now(),
          ref: references.sky,
          flightRef: references.flight,
          kind: q.get('kind'),
          apiStatus: r.status(),
          status: ['found', 'not-found'].includes(body.status)
            ? body.status
            : null,
          diagnostic: parseEnrichmentDiagnostic(body.diagnostic) ?? null,
          failure: parseEnrichmentFailure(body.failure) ?? null,
          adaptiveFailure:
            verifiedAdaptiveDeferral(
              new Response(null, {
                status: r.status(),
                headers: r.headers(),
              }),
              body,
            )?.failure ?? null,
          adaptiveBudget: parseAdaptiveView(body.adaptiveBudget) ?? null,
          ...(typeof body.error === 'string' &&
          /^[a-z0-9-]{1,64}$/.test(body.error)
            ? { error: body.error }
            : {}),
          data: {
            ...(origin ? { origin } : {}),
            ...(destination ? { destination } : {}),
            ...(associationTimeMs !== null ? { associationTimeMs } : {}),
          },
          fetchedAtMs: Number.isFinite(body.fetchedAtMs)
            ? body.fetchedAtMs
            : null,
          expiresAtMs: Number.isFinite(body.expiresAtMs)
            ? body.expiresAtMs
            : null,
        },
        256,
      );
    } catch {
      bounded(
        apiSamples,
        {
          atMs: Date.now(),
          apiStatus: r.status(),
          reason: 'non-json-or-lifecycle-response',
        },
        256,
      );
    }
  })();
  pending.add(task);
  void task.finally(() => pending.delete(task));
});
try {
  await page.goto(url.href, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page
    .getByRole('heading', { name: 'R04 observation-cone comparison' })
    .waitFor({ timeout: 20000 });
  await page.waitForFunction(
    () => window.aeroPaneSkyDiagnostics?.summary().frames.length > 0,
    null,
    { timeout: 45000 },
  );
  const until = await page.evaluate(
    () => window.aeroPaneSkyDiagnostics.summary().untilMs,
  );
  const finish = Math.min(absoluteFinish, until - 1000);
  if (finish - Date.now() < 60000)
    throw Error('Insufficient remaining authorised lease');
  while (!stopped && Date.now() < finish) {
    const state = await page.evaluate(() => ({
      report: window.aeroPaneRouteDiagnostics?.summary() ?? null,
      sky: window.aeroPaneSkyDiagnostics?.summary() ?? null,
    }));
    if (!state.report || !state.sky) {
      stopReason = 'collector-or-auth-lifecycle-ended';
      break;
    }
    report = state.report;
    sky = state.sky;
    await save();
    if (Date.now() - lastPrint >= 60000) {
      lastPrint = Date.now();
      console.log(
        JSON.stringify({
          elapsedSeconds: Math.round((Date.now() - startedAtMs) / 1000),
          aircraft: report.distinctAircraft,
          primary: report.aircraftBecomingPrimary,
          hexdbRequests: report.counters.hexdbRequestsStarted ?? 0,
          routeComplete: report.counters.routeCompleteResponses ?? 0,
          primaryRouteTimePercent: report.primaryCompleteRoutePercent,
          frames: sky.frames.length,
          dropped: sky.dropped,
          positionProviderLoads: network.positionSources.provider,
        }),
      );
    }
    if (
      !normalCaptured &&
      Date.now() - startedAtMs > 180000 &&
      report.current.some((r) => r.role === 'primary')
    ) {
      await page.screenshot({ path: output + '/live-diagnostic-768.png' });
      await page.evaluate(() =>
        history.replaceState(
          null,
          '',
          '?mode=live&observe=60&view=normal',
        ),
      );
      await page.waitForFunction(
        () => !!document.querySelector('.aircraft-card'),
        null,
        { timeout: 25000 },
      );
      await page.screenshot({ path: output + '/live-normal-768.png' });
      await page.setViewportSize({ width: 1024, height: 624 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: output + '/live-normal-624.png' });
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.evaluate(() =>
        history.replaceState(null, '', '?mode=live&observe=60&sky=1'),
      );
      await page
        .getByRole('heading', { name: 'R04 observation-cone comparison' })
        .waitFor({ timeout: 25000 });
      normalCaptured = true;
    }
    if (stopReason === 'provider-throttling-or-denial') break;
    if (network.sessionDenials > 0) {
      stopReason = 'authentication-ended';
      break;
    }
    if (report.finished) {
      stopReason = 'collector-or-lease-limit';
      break;
    }
    await new Promise((r) =>
      setTimeout(r, Math.min(15000, Math.max(0, finish - Date.now()))),
    );
  }
  const end = await page.evaluate(() => ({
    report: window.aeroPaneRouteDiagnostics?.summary() ?? null,
    sky: window.aeroPaneSkyDiagnostics?.summary() ?? null,
  }));
  report = end.report ?? report;
  sky = end.sky ?? sky;
  await Promise.allSettled([...pending]);
  await save();
  console.log(
    JSON.stringify({
      finished: true,
      actualElapsedSeconds: Math.round((Date.now() - startedAtMs) / 1000),
      stopReason,
      aircraft: report?.distinctAircraft,
      output,
    }),
  );
} finally {
  stopped = true;
  clearTimeout(watchdog);
  await browser.close();
}

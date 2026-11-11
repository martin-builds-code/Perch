// Explicit, bounded observation of the authorised diagnostic Preview. No direct
// provider lookups, request scheduling, geolocation or raw response/URL logging.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { parseEnrichmentDiagnostic } from '../src/routeTraceTypes.ts';
import { parseEnrichmentFailure } from '../src/enrichmentFailure.ts';
const { chromium } = await import(
  process.env.PERCH_PLAYWRIGHT_MODULE ?? 'playwright-core'
);
const url =
  process.env.PERCH_TRIAL_URL ??
  'https://perch-aero-pane-stage3a.vercel.app/?mode=live';
const parsed = new URL(url);
if (
  parsed.protocol !== 'https:' ||
  !(
    parsed.hostname === 'perch-aero-pane-stage3a.vercel.app' ||
    /^perch-aero-pane-stage3a-[a-z0-9]+-mml3\.vercel\.app$/.test(
      parsed.hostname,
    )
  )
)
  throw Error('Only the authorised isolated Preview is allowed');
const minutes = Number(process.env.PERCH_TRIAL_MINUTES ?? 30);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1080)
  throw Error('Bounded 1–1080 minute duration required');
const output =
  process.env.PERCH_TRIAL_OUTPUT ?? '/workspace/Perch/route-trial-local';
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
  samples = [],
  errors = [];
let report,
  stoppedReason = 'duration-limit',
  positions = 0,
  enrichments = 0,
  sessionDenials = 0,
  networkFailures = 0,
  lastPrint = 0;
const screenshots = new Set();
const deferralScreenshots = new Set();
const pending = new Set();
function boundedPush(xs, value, max) {
  if (xs.length >= max) xs.shift();
  xs.push(value);
}
async function save() {
  const now = Date.now();
  const value = {
    schemaVersion: 1,
    startedAtMs,
    observedUntilMs: now,
    actualElapsedMs: now - startedAtMs,
    requestedMinutes: minutes,
    stoppedReason,
    network: {
      positionRequests: positions,
      enrichmentRequests: enrichments,
      sessionDenials,
      networkFailures,
    },
    pageErrorCount: errors.length,
    lastReport: report,
    apiSamples: samples,
  };
  await writeFile(
    output + '/observation.tmp',
    JSON.stringify(value, null, 2) + '\n',
  );
  await rename(output + '/observation.tmp', output + '/observation.json');
}
page.on('pageerror', (e) =>
  boundedPush(errors, { atMs: Date.now(), name: e.name }, 32),
);
page.on('request', (r) => {
  const path = new URL(r.url()).pathname;
  if (path === '/api/aircraft') positions++;
  if (path === '/api/enrichment') enrichments++;
});
page.on('requestfailed', () => {
  networkFailures++;
});
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  if (path === '/api/session' && r.status() === 401) sessionDenials++;
  if (path !== '/api/enrichment') return;
  const task = (async () => {
    try {
      const body = await r.json(),
        q = new URL(r.url()).searchParams;
      const diagnostic = parseEnrichmentDiagnostic(body.diagnostic);
      const ref = await page.evaluate(
        ({ hex, callsign }) =>
          window.aeroPaneRouteDiagnostics?.reference(hex, callsign) ??
          null,
        { hex: q.get('hex'), callsign: q.get('callsign') },
      );
      const code = (a) =>
        a && typeof a.code === 'string' && /^[A-Z]{3,4}$/.test(a.code)
          ? a.code
          : null;
      const sample = {
        atMs: Date.now(),
        ref: ref ?? 'identity-or-unattributed',
        kind: q.get('kind'),
        apiStatus: r.status(),
        diagnostic: diagnostic ?? null,
        failure: parseEnrichmentFailure(body.failure) ?? null,
        ...(typeof body.error === 'string' &&
        /^[a-z0-9-]{1,64}$/.test(body.error)
          ? { error: body.error }
          : {}),
        returnedOrigin: code(body.data?.origin),
        returnedDestination: code(body.data?.destination),
      };
      boundedPush(samples, sample, 512);
    } catch {
      boundedPush(
        samples,
        {
          atMs: Date.now(),
          apiStatus: r.status(),
          diagnostic: null,
          reason: 'non-json-or-lifecycle-response',
        },
        512,
      );
    }
  })();
  pending.add(task);
  void task.finally(() => pending.delete(task));
});
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page
    .getByRole('heading', {
      name: 'Experimental route investigation',
      exact: true,
    })
    .waitFor({ timeout: 15000 });
  await page.waitForFunction(
    () =>
      window.aeroPaneRouteDiagnostics?.summary().counters
        .positionalSnapshots > 0,
    { timeout: 30000 },
  );
  const finish = startedAtMs + minutes * 60000;
  while (Date.now() < finish) {
    const current = await page.evaluate(
      () => window.aeroPaneRouteDiagnostics?.summary() ?? null,
    );
    if (!current) {
      stoppedReason = 'diagnostic-lifecycle-ended';
      break;
    }
    report = current;
    for (const row of report.current) {
      const signature =
        row.state + ':' + (row.response?.diagnostic?.reason ?? row.reason);
      if (!screenshots.has(signature) && screenshots.size < 12) {
        screenshots.add(signature);
        await page.screenshot({
          path: output + '/state-' + screenshots.size + '.png',
        });
      }
    }
    for (const d of (report.deferrals ?? []).slice(0, 3)) {
      const state = d.nextAttemptAtMs === null ? 'pending' : 'resumed';
      const key = String(d.atMs) + ':' + state;
      if (!deferralScreenshots.has(key)) {
        deferralScreenshots.add(key);
        await page.screenshot({
          path:
            output +
            '/deferral-' +
            deferralScreenshots.size +
            '-' +
            state +
            '.png',
        });
      }
    }
    await save();
    if (Date.now() - lastPrint >= 60000) {
      lastPrint = Date.now();
      console.log(
        JSON.stringify({
          elapsedSeconds: Math.round((Date.now() - startedAtMs) / 1000),
          aircraft: report.distinctAircraft,
          primary: report.aircraftBecomingPrimary,
          counters: report.counters,
          primaryCompleteRoutePercent:
            report.primaryAircraftCompleteRoutePercent,
          current: report.current.map((r) => ({
            ref: r.ref,
            role: r.role,
            state: r.state,
            reason: r.reason,
          })),
        }),
      );
    }
    if (report.finished) {
      stoppedReason = 'collector-or-lease-limit';
      break;
    }
    await new Promise((r) =>
      setTimeout(r, Math.min(15000, Math.max(0, finish - Date.now()))),
    );
  }
  if (stoppedReason === 'duration-limit')
    report =
      (await page.evaluate(
        () => window.aeroPaneRouteDiagnostics?.summary() ?? null,
      )) ?? report;
  await Promise.allSettled([...pending]);
  await save();
  console.log(
    JSON.stringify({
      finished: true,
      stoppedReason,
      actualElapsedSeconds: Math.round((Date.now() - startedAtMs) / 1000),
      aircraft: report?.distinctAircraft,
      output,
    }),
  );
} finally {
  await browser.close();
}

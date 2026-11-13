// Compiled plain-Node HTTP verification. Synthetic configuration and providers;
// never connects to Supabase, adsb.fi or HexDB.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
const root = resolve(import.meta.dirname, '..');
const output = mkdtempSync(join(tmpdir(), 'perch-r05-runtime-'));
const savedEnv = { ...process.env },
  nativeFetch = globalThis.fetch;
let server,
  calls = 0,
  exchanges = 0;
try {
  for (const key of Object.keys(process.env))
    if (key.startsWith('AERO_') || key.startsWith('VITE_AERO_'))
      delete process.env[key];
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '-p',
      join(root, 'tsconfig.server.json'),
      '--noEmit',
      'false',
      '--rootDir',
      root,
      '--outDir',
      output,
    ],
    { cwd: root, stdio: 'inherit', timeout: 30000 },
  );
  writeFileSync(join(output, 'package.json'), '{"type":"module"}\n');
  const load = (file) => import(pathToFileURL(join(output, file)).href);
  const { initialAdaptiveState } = await load('src/adaptiveBudget.js');
  const { signSession } = await load('server/auth.js');
  const { default: normal } = await load('api/enrichment.js');
  const { default: machine } = await load('api/r05-observe.js');
  const now = Date.now();
  Object.assign(process.env, {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_TARGET_ENV: 'preview',
    VERCEL_PROJECT_ID: 'prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW',
    VERCEL_GIT_COMMIT_REF: 'r05-adaptive-enrichment',
    AERO_R05_ENABLED: 'true',
    AERO_LIVE_ENABLED: 'true',
    AERO_ENRICHMENT_ENABLED: 'true',
    AERO_R05_COORDINATOR_URL: 'https://jjtkwqscfukioutgnxgc.supabase.co',
    AERO_R05_COORDINATOR_API_KEY: 'synthetic',
    AERO_R05_COORDINATOR_SECRET: 'a'.repeat(64),
    AERO_SESSION_SECRET: 's'.repeat(64),
    AERO_PIN_PEPPER: 'p'.repeat(64),
    AERO_PIN_VERIFIER: 's1:' + 'a'.repeat(32) + ':' + 'b'.repeat(64),
    AERO_R05_TEST_KEY: 'b'.repeat(64),
    AERO_R05_TEST_WINDOW: JSON.stringify({
      startedAtMs: now - 1000,
      expiresAtMs: now + 60000,
    }),
  });
  const row = {
      revision: 0,
      state: initialAdaptiveState(now),
      nowMs: now,
      cache: null,
    },
    cache = new Map();
  globalThis.fetch = async (url, init) => {
    if (
      String(url) ===
      process.env.AERO_R05_COORDINATOR_URL +
        '/rest/v1/rpc/perch_r05_exchange'
    ) {
      exchanges++;
      const b = JSON.parse(init.body);
      assert.equal(b.p_secret, 'a'.repeat(64));
      assert.equal(b.p_scope, 'live');
      row.nowMs = Date.now();
      if (b.p_state) {
        if (b.p_expected !== row.revision)
          return Response.json({ ok: false, conflict: true });
        row.state = b.p_state;
        row.revision++;
        if (b.p_payload)
          cache.set(b.p_key, {
            payload: b.p_payload,
            expiresAtMs: b.p_expires,
          });
      }
      return Response.json({
        ok: true,
        ...row,
        cache: cache.get(b.p_key) ?? null,
      });
    }
    assert.equal(String(url), 'https://hexdb.io/api/v2/routes/EIN17A');
    calls++;
    return Response.json({
      callsign: 'EIN17A',
      origin: { icao: 'EIDW', iata: 'DUB', name: 'Dublin' },
      destination: { icao: 'EGLL', iata: 'LHR', name: 'Heathrow' },
      updated_at: new Date(now - 266 * 86400000).toISOString(),
    });
  };
  server = createServer(
    (req, res) =>
      void (req.url.startsWith('/api/r05-observe') ? machine : normal)(
        req,
        res,
      ),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const cookie = '__Host-aero=' + signSession();
  const headers = { 'x-aero-r05-test': 'b'.repeat(64) };
  const route =
    '?kind=route&hex=abcdef&callsign=EIN17A&priority=protected';
  let checks = 0;
  assert.equal(
    (await nativeFetch(base + '/api/enrichment' + route, { headers }))
      .status,
    401,
  );
  assert.equal(
    (await nativeFetch(base + '/api/r05-observe?resource=session')).status,
    401,
  );
  checks++;
  const session = await nativeFetch(
    base + '/api/r05-observe?resource=session',
    { headers },
  );
  assert.equal(session.status, 200);
  assert.equal(session.headers.get('set-cookie'), null);
  checks++;
  for (const query of [
    'resource=other',
    'resource=session&extra=1',
    'resource=session&resource=aircraft',
  ])
    assert.equal(
      (await nativeFetch(base + '/api/r05-observe?' + query, { headers }))
        .status,
      400,
    );
  assert.equal(
    (
      await nativeFetch(base + '/api/r05-observe?resource=session', {
        headers,
        method: 'POST',
      })
    ).status,
    401,
  );
  checks++;
  const first = await nativeFetch(base + '/api/enrichment' + route, {
      headers: { Cookie: cookie },
    }),
    body = await first.json();
  assert.equal(first.status, 200);
  assert.equal(body.data.origin.code, 'DUB');
  assert.ok(body.data.associationTimeMs < now - 180 * 86400000);
  assert.equal(body.diagnostic.upstreamRequestsStarted, 1);
  assert.ok(body.diagnostic.upstreamStartedAtMs >= now);
  assert.equal(body.adaptiveBudget.counters.confirmedStarts, 1);
  assert.equal(body.adaptiveBudget.counters.historical, 1);
  assert.equal(calls, 1);
  assert.equal(row.state.pending, null);
  checks++;
  const cached = await nativeFetch(
      base + '/api/r05-observe?resource=enrichment&' + route.slice(1),
      { headers },
    ),
    cb = await cached.json();
  assert.equal(cached.status, 200);
  assert.equal(cb.diagnostic.upstreamRequestsStarted, 0);
  assert.equal(cb.upstreamStartedAtMs, undefined);
  assert.equal(cb.diagnostic.upstreamStartedAtMs, undefined);
  assert.equal(calls, 1);
  checks++;
  const blocked = await nativeFetch(
      base +
        '/api/enrichment?kind=route&hex=123456&callsign=BAW12&priority=protected',
      { headers: { Cookie: cookie } },
    ),
    bb = await blocked.json();
  assert.equal(blocked.status, 503);
  assert.equal(bb.failure.schemaVersion, 2);
  assert.equal(bb.failure.origin, 'application');
  assert.equal(bb.failure.upstreamRequestsStarted, 0);
  const wait = Number(blocked.headers.get('retry-after')) * 1000;
  assert.ok(wait >= 9000 && wait <= 10000);
  assert.equal(calls, 1);
  checks++;
  const before = exchanges;
  delete process.env.AERO_R05_COORDINATOR_SECRET;
  const unavailable = await nativeFetch(
      base + '/api/enrichment?kind=route&hex=123456&callsign=BAW12',
      { headers: { Cookie: cookie } },
    ),
    ub = await unavailable.json();
  assert.equal(ub.failure.reason, 'coordination-unavailable');
  assert.equal(exchanges, before);
  assert.equal(calls, 1);
  checks++;
  for (const [key, value] of [
    ['VERCEL_ENV', 'production'],
    ['VERCEL_PROJECT_ID', 'household-project'],
    ['VERCEL_GIT_COMMIT_REF', 'stage-3a-display-redesign'],
  ]) {
    const prior = process.env[key];
    process.env[key] = value;
    assert.equal(
      (
        await nativeFetch(base + '/api/r05-observe?resource=session', {
          headers,
        })
      ).status,
      401,
    );
    process.env[key] = prior;
    checks++;
  }
  process.env.AERO_R05_TEST_WINDOW = JSON.stringify({
    startedAtMs: now - 60000,
    expiresAtMs: now - 1,
  });
  assert.equal(
    (
      await nativeFetch(base + '/api/r05-observe?resource=session', {
        headers,
      })
    ).status,
    401,
  );
  checks++;
  assert.doesNotMatch(
    JSON.stringify(body),
    /latitude|longitude|credential|secret|p_secret/,
  );
  console.log(
    `PASS R05 compiled Node ESM HTTP: ${checks} scenarios; shared adapter, historical cache, local deferral, fail-closed coordination, normal PIN and expiring machine principal. One mocked HexDB call; zero external requests.`,
  );
} finally {
  globalThis.fetch = nativeFetch;
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(output, { recursive: true, force: true });
}

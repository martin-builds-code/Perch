// Compile R02 as ordinary Node ESM and exercise its real HTTP handlers.
// No tsx/Vite loader, credentials, provider calls or external network required.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const output = mkdtempSync(join(tmpdir(), 'perch-review-runtime-'));
const savedEnv = { ...process.env };
const nativeFetch = globalThis.fetch;
let server;
let providerCalls = 0;
try {
  const env = { ...process.env, NODE_OPTIONS: '' };
  for (const key of Object.keys(env))
    if (key.startsWith('AERO_') || key.startsWith('VITE_AERO_'))
      delete env[key];
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
    { cwd: root, env, stdio: 'inherit', timeout: 30000 },
  );
  writeFileSync(join(output, 'package.json'), '{"type":"module"}\n');
  globalThis.fetch = async () => {
    providerCalls++;
    throw Error('R02 must not call a provider');
  };
  const entry = pathToFileURL(join(output, 'api/route-review.js')).href;
  const { default: review } = await import(entry);
  const { default: closed } = await import(
    pathToFileURL(join(output, 'api/route-research.js')).href
  );
  const { routeReviewCases } = await import(
    pathToFileURL(join(output, 'server/routeReviewCases.js')).href
  );
  const { parseReviewDataset } = await import(
    pathToFileURL(join(output, 'src/routeReviewModel.js')).href
  );
  server = createServer((req, res) =>
    (req.url === '/api/route-review' ? review : closed)(req, res),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  Object.assign(process.env, {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_PROJECT_ID: 'prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW',
  });
  delete process.env.VERCEL_TARGET_ENV;
  let checks = 0;
  const r = await nativeFetch(base + '/api/route-review');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('set-cookie'), null);
  const data = await r.json();
  assert.ok(parseReviewDataset(data));
  assert.equal(data.cases.length, 16);
  assert.deepEqual(data, routeReviewCases);
  assert.doesNotMatch(
    JSON.stringify(data),
    /"(?:latitude|longitude|lat|lon|cookie|token|password|secret|pinVerifier)"\s*:/i,
  );
  checks++;
  const post = await nativeFetch(base + '/api/route-review', {
    method: 'POST',
    body: '{}',
  });
  assert.equal(post.status, 405);
  checks++;
  for (const patch of [
    { VERCEL_ENV: 'production' },
    { VERCEL_PROJECT_ID: 'prj_Esh3e64v7aYtnf0vP7i5gzcipDnO' },
    { VERCEL_TARGET_ENV: 'production' },
    { VERCEL: '0' },
  ]) {
    const saved = Object.fromEntries(
      Object.keys(patch).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, patch);
    const denied = await nativeFetch(base + '/api/route-review');
    assert.equal(denied.status, 404);
    assert.equal(denied.headers.get('set-cookie'), null);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    checks++;
  }
  const fingerprint = routeReviewCases.fingerprint;
  routeReviewCases.fingerprint = '0'.repeat(64);
  assert.equal(
    (await nativeFetch(base + '/api/route-review')).status,
    503,
  );
  routeReviewCases.fingerprint = fingerprint;
  checks++;
  // The final acquisition endpoint is a tombstone, even with an enabled flag.
  process.env.AERO_ROUTE_RESEARCH = JSON.stringify({
    enabled: true,
    startedAtMs: Date.now(),
    expiresAtMs: Date.now() + 3600000,
    digest: 'a'.repeat(64),
  });
  for (const method of ['GET', 'POST']) {
    const dead = await nativeFetch(base + '/api/route-research', {
      method,
      headers: { Authorization: 'Bearer ' + 'x'.repeat(43) },
    });
    assert.equal(dead.status, 404);
    assert.equal(dead.headers.get('set-cookie'), null);
    checks++;
  }
  assert.equal(providerCalls, 0);
  console.log(
    'PASS R02 compiled Node ESM HTTP: ' +
      checks +
      ' scenarios; frozen schema/privacy, exact Preview guard, tamper rejection, closed acquisition, zero provider calls.',
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

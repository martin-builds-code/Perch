// Authorised shared-store verification ONLY. No aviation-provider calls.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createCoordinator } from '../server/adaptiveCoordinator.ts';
import {
  initialAdaptiveState,
  advanceAdaptiveState,
  reserveAdaptive,
  finishAdaptive,
} from '../src/adaptiveBudget.ts';
const api = JSON.parse(await readFile('/tmp/perch-r05-api.json', 'utf8'));
const privateConfig = JSON.parse(
  await readFile('/tmp/perch-r05-private.json', 'utf8'),
);
const env = {
  AERO_R05_COORDINATOR_URL: api.url,
  AERO_R05_COORDINATOR_API_KEY: api.apiKey,
  AERO_R05_COORDINATOR_SECRET: privateConfig.secret,
};
const nativeFetch = globalThis.fetch,
  latencies = [];
const onlyVerification = async (url, init) => {
  if (String(url) !== api.url + '/rest/v1/rpc/perch_r05_exchange')
    throw Error('Only the dedicated coordinator is allowed');
  const body = JSON.parse(init.body);
  body.p_scope = 'verification';
  const start = performance.now();
  try {
    return await nativeFetch(url, { ...init, body: JSON.stringify(body) });
  } finally {
    latencies.push(performance.now() - start);
  }
};
const stores = Array.from({ length: 12 }, () =>
  createCoordinator(env, onlyVerification),
);
const live = createCoordinator(env);
const key = stores[0].key('r05-verification-only:' + randomUUID());
const liveBefore = await live.read(key),
  before = await stores[0].read(key);
if (before.state.pending)
  throw Error('Existing verification owner; do not overwrite');
const clean = initialAdaptiveState(before.nowMs);
if (!(await stores[0].swap(key, before, clean)))
  throw Error('Verification reset conflict');
const shared = await stores[0].read(key);
const owners = stores.map(() => randomUUID());
const attempts = await Promise.allSettled(
  stores.map((store, i) =>
    store.swap(
      key,
      shared,
      reserveAdaptive(
        advanceAdaptiveState(shared.state, shared.nowMs),
        owners[i],
        key,
      ),
    ),
  ),
);
const winners = attempts.filter(
  (x) => x.status === 'fulfilled' && x.value === true,
).length;
assert.equal(winners, 1, 'exactly one atomic reservation across clients');
const held = await stores[1].read(key);
assert.ok(owners.includes(held.state.pending?.id));
assert.equal(held.state.counters.reserved, 1);
const completed = finishAdaptive(
  advanceAdaptiveState(held.state, held.nowMs),
  held.state.pending.id,
  undefined,
  { started: false, responded: false, outcome: 'synthetic-no-provider' },
);
const fixture = {
  kind: 'route',
  hex: 'abcdef',
  callsign: 'SYNTH1',
  source: 'hexdb.io',
  status: 'found',
  data: {
    origin: {
      code: 'AAA',
      name: 'Synthetic origin',
      iata: 'AAA',
      icao: null,
    },
    destination: {
      code: 'BBB',
      name: 'Synthetic destination',
      iata: 'BBB',
      icao: null,
    },
  },
  fetchedAtMs: held.nowMs,
  expiresAtMs: held.nowMs + 300000,
};
assert.equal(await stores[1].swap(key, held, completed, fixture), true);
const cached = await stores[2].read(key);
assert.deepEqual(stores[2].cacheValue(cached), fixture);
assert.equal(cached.state.counters.confirmedStarts, 0);
assert.equal(
  await stores[3].swap(key, shared, clean),
  false,
  'old revision cannot release/replace an owner',
);
const denied = await nativeFetch(
  api.url + '/rest/v1/rpc/perch_r05_exchange',
  {
    method: 'POST',
    headers: { apikey: api.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_secret: '0'.repeat(64),
      p_scope: 'verification',
      p_key: key,
    }),
  },
);
assert.ok(
  [401, 403].includes(denied.status),
  'a publishable key alone cannot use the coordinator',
);
const privateRead = await nativeFetch(
  api.url + '/rest/v1/control?select=*',
  {
    headers: { apikey: api.apiKey, 'accept-profile': 'perch_r05' },
  },
);
assert.ok(
  [401, 403, 404, 406].includes(privateRead.status),
  'private tables are inaccessible',
);
const last = await stores[0].read(key);
assert.equal(
  await stores[0].swap(key, last, initialAdaptiveState(last.nowMs)),
  true,
);
const liveAfter = await live.read(key);
assert.equal(
  liveAfter.revision,
  liveBefore.revision,
  'live budget never changed',
);
assert.deepEqual(liveAfter.state, liveBefore.state);
const sorted = latencies.sort((a, b) => a - b);
const output = {
  testedAt: new Date().toISOString(),
  projectId: 'jjtkwqscfukioutgnxgc',
  scope: 'verification',
  simultaneousClients: stores.length,
  winners,
  failedRpcCalls: attempts.filter((r) => r.status === 'rejected').length,
  sharedEncryptedCache: true,
  staleRevisionRejected: true,
  missingServerSecretDenied: true,
  privateTablesDenied: true,
  liveBudgetUnchanged: true,
  aviationProviderRequests: 0,
  rpcLatencyMs: {
    count: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted.at(-1),
  },
  limitation:
    'Exercises real shared PostgreSQL CAS and cache operations; does not load-test HexDB or prove provider failover guarantees.',
};
await mkdir('docs/route-r05', { recursive: true });
await writeFile(
  'docs/route-r05/shared-store-verification.json',
  JSON.stringify(output, null, 2) + '\n',
);
console.log(JSON.stringify(output, null, 2));

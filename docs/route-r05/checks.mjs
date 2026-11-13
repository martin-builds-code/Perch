// Offline research assertions, including adversarial offered demand. Not live tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import {
  Budget,
  CAPS,
  policies,
  windowMetrics,
  dataset,
  simulate,
} from './model.mjs';
globalThis.fetch = () => {
  throw Error('No network permitted');
};
const urgent = { kind: 'route', essential: true, secondary: false };
const base = (cap) => ({
  ...policies().find((p) => !p.fixed && p.cap === cap),
});
function offered(p, count = 1000, deadline = 1200000, release = 0) {
  const b = new Budget(p, 0),
    starts = [];
  let t = release;
  while (starts.length < count && t < deadline) {
    const at = b.permitAt(t, urgent);
    if (at >= deadline) break;
    b.admit(at, urgent);
    starts.push(at);
    t = at + 1000; // one assumed 1s serial completion
  }
  return {
    starts,
    peak1: windowMetrics(starts, 60000, 0, deadline).peak,
    peak5: windowMetrics(starts, 300000, 0, deadline).peak,
    completedByDeadline: starts.filter((t) => t + 1000 <= deadline).length,
  };
}
for (const cap of CAPS) {
  test(
    'C' + cap + ' hard rolling ceiling under sustained offered demand',
    () => {
      const p = base(cap),
        v = offered(p);
      assert.ok(v.peak5 <= cap);
      for (let i = 1; i < v.starts.length; i++)
        assert.ok(v.starts[i] - v.starts[i - 1] >= p.spacing - 1e-5);
      assert.equal(v.peak5, cap, 'test actually reaches the cap');
    },
  );
  test(
    'C' + cap + ' quiet accumulation is bounded and burst recovers',
    () => {
      const b = new Budget(base(cap), 0);
      b.refill(10000000);
      assert.equal(b.tokens, 3);
      for (let i = 0; i < 3; i++) b.admit(10000000 + i * 5000, urgent);
      assert.ok(b.tokens < 3);
      b.refill(10000000 + cap * 100000);
      assert.equal(b.tokens, 3);
    },
  );
  test('C' + cap + ' reserve is retained for an urgent job', () => {
    const b = new Budget(base(cap), 0),
      marginal = { ...urgent, essential: false };
    let t = 0,
      blocked = false;
    for (let i = 0; i < 30; i++) {
      const at = b.permitAt(t, urgent);
      if (b.permitAt(t, marginal) > at) {
        blocked = true;
        break;
      }
      b.admit(at, urgent);
      t = at + 5000;
    }
    assert.equal(
      blocked,
      true,
      'after reserve is drawn down, marginal work waits longer',
    );
  });
}
test('half-open rolling window handles exact five-minute boundary', () => {
  const p = { ...base(10), burst: 10, spacing: 0, reserve: 0 },
    b = new Budget(p, 0);
  for (let i = 0; i < 10; i++) b.admit(0, urgent);
  assert.equal(b.permitAt(299999, urgent), 300000);
  b.admit(300000, urgent);
  assert.equal(windowMetrics(b.starts, 300000, 0, 300001).peak, 10);
});
test('token bucket alone would exceed a rolling ceiling: hard log still blocks', () => {
  const b = new Budget(base(10), 0);
  let t = 0;
  for (let i = 0; i < 10; i++) {
    t = b.permitAt(t, urgent);
    b.admit(t, urgent);
    t += 1000;
  }
  assert.ok(
    b.tokens + ((299000 - b.updated) * 10) / 300000 >= 1,
    'refill alone could permit another',
  );
  assert.equal(b.permitAt(299000, urgent), 300000);
});
test('provider backoff and longer Retry-After override stored tokens', () => {
  const b = new Budget(base(50), 0);
  b.admit(0, urgent);
  b.backoff(300000);
  b.backoff(600000);
  assert.equal(b.permitAt(10000, urgent), 600000);
  b.refill(600000);
  assert.equal(b.tokens, 3);
});
test('invalid/backwards clock never reopens budget', () => {
  const b = new Budget(base(10), 1000);
  b.admit(1000, urgent);
  for (const t of [NaN, Infinity, 999])
    assert.throws(() => b.permitAt(t, urgent));
});
test('only secondary route requests consume the legacy90s allowance', () => {
  const p = policies()[0],
    b = new Budget(p, 0);
  b.admit(0, { ...urgent, secondary: true });
  assert.equal(b.permitAt(30000, { ...urgent, secondary: true }), 90000);
  assert.equal(
    b.permitAt(30000, { ...urgent, kind: 'aircraft', secondary: true }),
    30000,
  );
});
test('independent browser buckets cannot establish a global hard ceiling', () => {
  const starts = Array.from(
    { length: 4 },
    () => offered(base(10), 10, 300000).starts,
  ).flat();
  assert.equal(windowMetrics(starts, 300000, 0, 300000).peak, 40);
});
test('atomic shared model denies concurrent clients and unavailable state', async () => {
  const b = new Budget(base(10), 0);
  let pending = false,
    available = true,
    started = 0;
  function reserve(t) {
    if (!available || pending || b.permitAt(t, urgent) > t) return false;
    b.admit(t, urgent);
    pending = true;
    started++;
    return true;
  }
  assert.equal(
    (
      await Promise.all(Array.from({ length: 20 }, async () => reserve(0)))
    ).filter(Boolean).length,
    1,
  );
  assert.equal(
    reserve(10000),
    false,
    'in-flight guard still applies beyond minimum spacing',
  );
  pending = false;
  available = false;
  assert.equal(reserve(300000), false);
  assert.equal(started, 1);
  available = true;
  assert.equal(reserve(300000), true);
});
test('unknown outcomes are not represented as known HexDB misses or successes', async () => {
  const ds = await dataset(
    new URL('../route-r04/live/observation.json', import.meta.url),
  );
  const r = simulate(ds, base(20));
  assert.ok(r.unknownOutcomeRequests > 0);
  assert.ok(
    r.completions
      .filter((e) => !e.known)
      .every((e) => e.outcome === 'unknown-evidence'),
  );
  assert.equal(r.uniqueKnownCompleteRoutes, 14);
});
test('cache timing, flight keys and fixed reference agree on aggregate evidence', async () => {
  const ds = await dataset(
      new URL('../route-r04/live/observation.json', import.meta.url),
    ),
    r = simulate(ds, policies()[0]);
  assert.equal(r.requests, 34);
  assert.equal(r.identityRequests, 6);
  assert.equal(r.knownRoutesReadyAtFirstPrimary, 3);
  assert.equal(r.peakFiveMinutes, 7);
  assert.equal(r.unknownOutcomeRequests, 0);
  for (const key of new Set(
    r.attempts.filter((a) => a.kind === 'route').map((a) => a.key),
  )) {
    const xs = r.attempts.filter((a) => a.key === key);
    for (let i = 1; i < xs.length; i++)
      assert.ok(xs[i].atMs - xs[i - 1].atMs >= 270000);
  }
});
test('live result file has no invented known outcomes', async () => {
  const r = JSON.parse(
    await readFile(new URL('results.json', import.meta.url), 'utf8'),
  );
  for (const x of r.comparisons) {
    assert.ok(x.peakFiveMinutes <= x.policy.cap);
    assert.ok(x.uniqueKnownCompleteRoutes <= 14);
  }
});
// Stress workload contains abstract request jobs, not invented aircraft or routes.
const stress = CAPS.map((cap) => {
  const p = base(cap),
    sustained = offered(p, 10000, 1200000),
    wave = offered(p, 12, 390000, 300000);
  const curve = windowMetrics(sustained.starts, 300000, 0, 1200000).curve;
  let saturatedMs = 0;
  for (let i = 0; i < curve.length - 1; i++)
    if (curve[i].count >= cap)
      saturatedMs += curve[i + 1].atMs - curve[i].atMs;
  return {
    cap,
    burst: p.burst,
    minimumSpacingMs: p.spacing,
    idleFullRefillMs: (3 * 300000) / cap,
    sustainedRequests20min: sustained.starts.length,
    sustainedPeak1min: sustained.peak1,
    sustainedPeak5min: sustained.peak5,
    sustainedAtCeilingPercent: (100 * saturatedMs) / 1200000,
    urgentWave12JobsCompletedWithin90s: wave.completedByDeadline,
    waveStartsMsAfterRelease: wave.starts.map((t) => t - 300000),
    basis:
      'Synthetic offered request jobs;1s assumed completion, no provider responses or coverage assigned.',
  };
});
await writeFile(
  new URL('stress.json', import.meta.url),
  JSON.stringify(stress, null, 2) + '\n',
);

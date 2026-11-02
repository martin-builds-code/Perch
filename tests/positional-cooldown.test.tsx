import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../server/service';
import { fetchAircraft, ProviderError } from '../server/provider';
import { createDataDiagnostics } from '../src/dataDiagnostics';
import { createPoller } from '../src/live';
import { diagnosticFile } from '../src/diagnosticExport';
import type { Snapshot } from '../src/liveTypes';

const T = 1_800_000_000_000;
const snapshot = (at: number): Snapshot => ({
  aircraft: [
    {
      id: 'abcdef',
      callsign: null,
      registration: null,
      description: 'Boeing 737 MAX 8',
      typeCode: 'B38M',
      distanceKm: 3,
      barometricAltitudeFt: 12000,
      geometricAltitudeFt: null,
      onGround: false,
      groundSpeedKnots: 210,
      trackDegrees: 90,
      positionTimeMs: at - 1000,
      source: 'adsb.fi',
      validity: { position: true, timestamp: true, anomalies: [] },
    },
  ],
  fetchedAtMs: at,
  providerTimeMs: at - 500,
  pollIntervalMs: 15000,
  rejectedRecords: 0,
  anomalies: [],
});

test('regression: a normal arrival at 14,999 ms reuses the original snapshot instead of cooldown', async () => {
  let time = T,
    calls = 0;
  const get = createService(
    async () => {
      calls++;
      return snapshot(time);
    },
    () => time,
  );
  const first = await get();
  time = T + 14999;
  const result = await get();
  assert.strictEqual(result, first);
  assert.equal(calls, 1);
  assert.equal(result.fetchedAtMs, T);
  assert.equal(result.providerTimeMs, T - 500);
  assert.equal(result.aircraft[0].positionTimeMs, T - 1000);
});

for (const elapsed of [0, 9999, 10000, 10001, 14900, 15000, 15001]) {
  test(`cache/gate boundary at ${elapsed} ms preserves timestamps and the 15-second upstream gate`, async () => {
    let time = T;
    const starts: number[] = [];
    const get = createService(
      async () => {
        starts.push(time);
        return snapshot(time);
      },
      () => time,
    );
    const first = await get();
    time = T + elapsed;
    const next = await get();
    const refresh = elapsed >= 15000;
    assert.equal(starts.length, refresh ? 2 : 1);
    assert.equal(next === first, !refresh);
    assert.equal(next.fetchedAtMs, refresh ? time : T);
    assert.equal(next.providerTimeMs, next.fetchedAtMs - 500);
    assert.equal(next.aircraft[0].positionTimeMs, next.fetchedAtMs - 1000);
  });
}

test('a four-second provider fetch does not extend the gate bridge to 15 seconds after completion', async () => {
  let time = T,
    calls = 0;
  const get = createService(
    async () => {
      calls++;
      time += 4000;
      return snapshot(time);
    },
    () => time,
  );
  const first = await get();
  for (const elapsed of [13999, 14000, 14999]) {
    time = T + elapsed;
    assert.strictEqual(await get(), first);
    assert.equal(calls, 1);
  }
  time = T + 15000;
  const next = await get();
  assert.equal(calls, 2);
  assert.equal(first.fetchedAtMs, T + 4000);
  assert.equal(next.fetchedAtMs, T + 19000);
});

test('180 normal polls with varying arrival latency have no artificial rejections or upstream rate increase', async () => {
  let time = T;
  const starts: number[] = [];
  const get = createService(
    async () => {
      starts.push(time);
      return snapshot(time);
    },
    () => time,
  );
  const latencies = [250, 150, 220, 180, 260, 160];
  for (let i = 0; i < 180; i++) {
    time = T + i * 15000 + latencies[i % latencies.length];
    const result = await get();
    assert.ok(
      time - result.fetchedAtMs >= 0 && time - result.fetchedAtMs < 15000,
    );
  }
  assert.ok(starts.length <= 180);
  assert.ok(starts.every((t, i) => i === 0 || t - starts[i - 1] >= 15000));
});

test('two clients and a burst of cache hits share one provider start per gate', async () => {
  let time = T;
  const starts: number[] = [];
  const get = createService(
    async () => {
      starts.push(time);
      return snapshot(time);
    },
    () => time,
  );
  for (const delta of [
    0, 1, 2000, 9999, 10000, 14900, 14999, 15000, 15001, 20000, 29999, 30000,
  ]) {
    time = T + delta;
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => get()),
    );
    assert.ok(responses.every((r) => r === responses[0]));
  }
  assert.deepEqual(starts, [T, T + 15000, T + 30000]);
});

test('requests during an initial or refresh provider fetch coalesce into that same in-flight promise', async () => {
  let time = T,
    calls = 0;
  let resolve!: (value: Snapshot) => void;
  const get = createService(
    () => {
      calls++;
      return new Promise<Snapshot>((r) => {
        resolve = r;
      });
    },
    () => time,
  );
  const first = get();
  time = T + 500;
  for (let i = 0; i < 20; i++) assert.strictEqual(get(), first);
  time = T + 1000;
  resolve(snapshot(time));
  await first;
  time = T + 14999;
  await get();
  assert.equal(calls, 1);
  time = T + 15000;
  const refresh = get();
  time = T + 15100;
  for (let i = 0; i < 20; i++) assert.strictEqual(get(), refresh);
  assert.equal(calls, 2);
  time = T + 16000;
  resolve(snapshot(time));
  assert.equal((await refresh).fetchedAtMs, T + 16000);
});

for (const [code, status, cooldown] of [
  ['http-error', 500, 15000],
  ['rate-limited', 429, 90000],
  ['access-denied', 403, 300000],
] as const) {
  test(`${code} remains a genuine failure, honours cooldown and recovers without retries`, async () => {
    let time = T,
      calls = 0;
    const get = createService(
      () =>
        fetchAircraft(
          { latitude: 60, longitude: 25 },
          15000,
          async () => {
            calls++;
            return calls === 1
              ? new Response('{}', { status, headers: { 'Retry-After': '90' } })
              : new Response(
                  JSON.stringify({ msg: 'No error', now: time, ac: [] }),
                );
          },
          () => time,
        ),
      () => time,
    );
    await assert.rejects(
      get(),
      (e: unknown) => e instanceof ProviderError && e.code === code,
    );
    time = T + cooldown - 1;
    for (let i = 0; i < 20; i++)
      await assert.rejects(
        get(),
        (e: unknown) => e instanceof ProviderError && e.code === code,
      );
    assert.equal(calls, 1);
    time = T + cooldown;
    const result = await get();
    assert.equal(calls, 2);
    assert.equal(result.fetchedAtMs, time);
    assert.deepEqual(result.aircraft, []);
  });
}

test('provider timeout is not replaced by cached success; the next permitted request recovers', async () => {
  let time = T,
    calls = 0;
  const get = createService(
    () =>
      fetchAircraft(
        { latitude: 60, longitude: 25 },
        15000,
        async (_url, options) => {
          calls++;
          if (calls === 1)
            return new Promise<Response>((_resolve, reject) => {
              options?.signal?.addEventListener(
                'abort',
                () => reject(Error('aborted')),
                { once: true },
              );
            });
          return new Response(
            JSON.stringify({ msg: 'No error', now: time, ac: [] }),
          );
        },
        () => time,
        5,
      ),
    () => time,
  );
  await assert.rejects(get(), /timeout/);
  time = T + 14999;
  await assert.rejects(get(), /timeout/);
  assert.equal(calls, 1);
  time = T + 15000;
  await get();
  assert.equal(calls, 2);
});

test('a failed refresh prevents all reuse of an older success, including after a backward clock adjustment', async () => {
  let time = T,
    calls = 0;
  const get = createService(
    async () => {
      if (++calls === 1) return snapshot(time);
      throw new ProviderError('rate-limited', 90000);
    },
    () => time,
  );
  await get();
  time = T + 15000;
  await assert.rejects(get(), /rate-limited/);
  time = T + 15001;
  await assert.rejects(get(), /rate-limited/);
  time = T + 5000;
  await assert.rejects(get(), /rate-limited/);
  assert.equal(calls, 2);
});

test('without a safe recent success, the gate still rejects cooldown and does not hammer the provider', async () => {
  let time = T,
    calls = 0;
  // The process clock moves behind the previous receipt time: reusing it would
  // manufacture a future/negative-age cached response.
  const get = createService(
    async () => {
      calls++;
      return snapshot(time);
    },
    () => time,
  );
  const first = await get();
  time = T - 1;
  for (let i = 0; i < 50; i++)
    await assert.rejects(
      get(),
      (e: unknown) =>
        e instanceof ProviderError &&
        e.code === 'cooldown' &&
        e.retryAfterMs === 15001,
    );
  assert.equal(calls, 1);
  assert.equal(first.fetchedAtMs, T);
  time = T + 15000;
  await get();
  assert.equal(calls, 2);
});

test('a success older than the bounded bridge cannot be reused during the gate', async () => {
  let time = T,
    calls = 0;
  const get = createService(
    async () => {
      calls++;
      return snapshot(T - 15000);
    },
    () => time,
  );
  await get();
  time = T + 1000;
  await assert.rejects(get(), /cooldown/);
  assert.equal(calls, 1);
});

test('independent function instances retain independent gates, not a claimed global provider lock', async () => {
  let time = T,
    calls = 0;
  const load = async () => {
    calls++;
    return snapshot(time);
  };
  const instanceA = createService(load, () => time),
    instanceB = createService(load, () => time);
  await Promise.all([instanceA(), instanceB()]);
  assert.equal(calls, 2);
  time = T + 14999;
  await Promise.all([instanceA(), instanceB()]);
  assert.equal(calls, 2);
  time = T + 15000;
  await Promise.all([instanceA(), instanceB()]);
  assert.equal(calls, 4);
});

test('unchanged browser poller and diagnostic export record successful jittered cache reuse without extra timers', async () => {
  let time = T,
    key = 0,
    attempts = 0;
  const starts: number[] = [];
  const get = createService(
    async () => {
      starts.push(time);
      return snapshot(time);
    },
    () => time,
  );
  const timers = new Map<number, { at: number; fn: () => void }>();
  const observer = createDataDiagnostics(T, 30 * 60000);
  const poller = createPoller(() => {}, {
    observer,
    now: () => time,
    active: () => true,
    context: () => ({ active: true, visible: true, online: true }),
    fetch: async () => {
      time += attempts++ % 2 === 0 ? 150 : 50;
      const value = await get();
      time += 50;
      return new Response(JSON.stringify(value), { status: 200 });
    },
    setTimer: (fn, ms) => {
      timers.set(++key, { at: time + ms, fn });
      return key as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id) => {
      timers.delete(id as unknown as number);
    },
  });
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  poller.start();
  await flush();
  for (;;) {
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next || next[1].at > T + 60000) break;
    assert.ok(timers.size <= 2, 'only existing polling and expiry timers');
    time = Math.max(time, next[1].at);
    timers.delete(next[0]);
    next[1].fn();
    await flush();
  }
  const report = JSON.parse(diagnosticFile(observer, time).json);
  assert.equal(attempts, 5);
  assert.equal(report.pollingAttempts, 5);
  assert.equal(report.successfulRequests, 5);
  assert.equal(report.failedRequests, 0);
  assert.ok(
    report.polls.every(
      (p: { status: number; error: string | null }) =>
        p.status === 200 && p.error === null,
    ),
  );
  assert.ok(
    report.polls.some(
      (p: { context: { snapshotAgeMs: number } }) =>
        p.context.snapshotAgeMs > 10000,
    ),
  );
  assert.equal(starts.length, 3);
  assert.ok(starts.every((at, i) => !i || at - starts[i - 1] >= 15000));
  assert.equal(report.exportMetadata.sessionStatus, 'incomplete');
  assert.doesNotMatch(
    JSON.stringify(report),
    /abcdef|latitude|longitude|callsign|registration/,
  );
  poller.stop();
  assert.equal(timers.size, 0);
});

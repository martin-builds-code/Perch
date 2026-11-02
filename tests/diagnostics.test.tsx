import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataDiagnostics } from '../src/dataDiagnostics';
import type { DiagnosticState } from '../src/dataDiagnostics';
import { createPoller, liveScene } from '../src/live';
import { createAircraftSelector } from '../src/selection';
import { createService } from '../server/service';
import type { LiveAircraft, Snapshot } from '../src/liveTypes';
const T = 1_800_000_000_000;
const aircraft = (id = 'abcdef', age = 0): LiveAircraft => ({
  id,
  callsign: 'EIN17A',
  registration: null,
  description: 'Boeing 737 MAX 8',
  typeCode: 'B38M',
  distanceKm: 3,
  barometricAltitudeFt: 6000,
  geometricAltitudeFt: null,
  onGround: false,
  groundSpeedKnots: 210,
  trackDegrees: 90,
  positionTimeMs: T - age,
  source: 'adsb.fi',
  validity: { position: true, timestamp: true, anomalies: [] },
});
const snap = (records = [aircraft()], at = T): Snapshot => ({
  aircraft: records,
  fetchedAtMs: at,
  providerTimeMs: at,
  pollIntervalMs: 15000,
  rejectedRecords: 0,
  anomalies: [],
});
const state = (extra: Partial<DiagnosticState> = {}): DiagnosticState => ({
  active: true,
  visible: true,
  online: true,
  state: 'available',
  requestFailed: false,
  primaryAgeMs: 1000,
  secondaryAgeMs: null,
  snapshotAgeMs: 1000,
  providerAgeMs: 1000,
  lastObservedAgeMs: 1000,
  primaryChanged: false,
  retainedMissing: false,
  clockAnomaly: false,
  ...extra,
});

test('fresh and threshold-crossing states retain Stage 2A 30/120 second policy', () => {
  assert.equal(liveScene(snap(), T + 29999, false).state, 'available');
  assert.equal(liveScene(snap(), T + 30000, false).state, 'delayed');
  assert.equal(liveScene(snap(), T + 120000, false).state, 'unavailable');
  const d = createDataDiagnostics(T);
  d.observe(state(), T);
  d.observe(state({ state: 'delayed', primaryAgeMs: 30000 }), T + 30000);
  d.observe(state(), T + 45000);
  const summary = d.summary(T + 60000);
  assert.equal(summary.delayedEpisodes, 1);
  assert.equal(summary.medianDelayedDurationMs, 15000);
  assert.equal(summary.longestDelayedDurationMs, 15000);
  assert.equal(summary.proportionDelayed, 0.25);
  assert.equal(summary.associations['aged-primary'], 1);
});
test('fresh primary with ageing secondary sets group delayed; diagnostics identifies secondary rather than assumes primary ageing', () => {
  const s = snap([aircraft(), { ...aircraft('123456', 45000), distanceKm: 6 }]);
  const scene = liveScene(s, T, false);
  assert.equal(scene.state, 'delayed');
  assert.equal(scene.primary?.id, 'abcdef');
  const d = createDataDiagnostics(T);
  d.observe(
    state({ state: scene.state, primaryAgeMs: 0, secondaryAgeMs: 45000 }),
    T,
  );
  d.observe(state(), T + 15000);
  assert.equal(d.summary(T + 15000).associations['aged-secondary'], 1);
  assert.equal(d.summary(T + 15000).associations['aged-primary'], undefined);
});
test('newly selected primary can be old despite a fresh successful provider snapshot', () => {
  const s = snap([aircraft('abcdef', 45000)]);
  const selector = createAircraftSelector();
  const selected = selector.select(s, T);
  assert.equal(selected.primary?.id, 'abcdef');
  assert.equal(liveScene(s, T, false, selected).state, 'delayed');
  const d = createDataDiagnostics(T);
  d.observe(
    state({
      state: 'delayed',
      primaryAgeMs: 45000,
      providerAgeMs: 0,
      snapshotAgeMs: 0,
      primaryChanged: true,
    }),
    T,
  );
  const summary = d.summary(T + 15000);
  assert.equal(summary.associations['newly-selected-aged-primary'], 1);
  assert.equal(summary.associations['aged-snapshot'], undefined);
});
test('retained missing primary is distinguishable without storing identifiers or movement history', () => {
  const selector = createAircraftSelector();
  selector.select(snap(), T);
  const selected = selector.select(
    snap(
      [{ ...aircraft('123456'), positionTimeMs: T + 15000, distanceKm: 6 }],
      T + 15000,
    ),
    T + 15000,
  );
  assert.equal(selected.decision.retainedMissing, true);
  const d = createDataDiagnostics(T);
  d.observe(
    state({
      state: 'delayed',
      primaryAgeMs: 30000,
      retainedMissing: true,
      lastObservedAgeMs: 29000,
    }),
    T + 29000,
  );
  assert.equal(
    d.summary(T + 30000).associations['retained-missing-primary'],
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(d.summary(T + 30000)),
    /abcdef|123456|latitude|longitude|callsign|positionTimeMs/,
  );
});
test('failed requests at entry/during episodes and undetermined episodes are counted honestly', () => {
  const d = createDataDiagnostics(T);
  d.observe(state(), T);
  d.pollStart(T);
  d.pollComplete({
    atMs: T + 100,
    durationMs: 100,
    ok: false,
    status: 503,
    error: 'cooldown',
    cache: null,
    cacheAgeSeconds: null,
  });
  d.observe(state({ state: 'delayed', requestFailed: true }), T + 100);
  d.observe(state(), T + 15100);
  d.observe(state({ state: 'delayed' }), T + 20000);
  d.observe(state(), T + 25000);
  const summary = d.summary(T + 30000);
  assert.equal(summary.pollingAttempts, 1);
  assert.equal(summary.failedRequests, 1);
  assert.equal(summary.episodesWithFailedRequests, 1);
  assert.equal(summary.associations.undetermined, 1);
  assert.equal(summary.medianDelayedDurationMs, 10000);
});
test('suspension/offline segments are excluded from observed time, resume is recorded and collection is bounded', () => {
  const d = createDataDiagnostics(T, 60000);
  d.observe(state(), T);
  d.observe(state({ state: 'delayed', primaryAgeMs: 30000 }), T + 10000);
  d.observe(
    state({ active: false, visible: false, online: true, state: 'delayed' }),
    T + 20000,
  );
  d.observe(
    state({ active: true, visible: true, online: false, state: 'unavailable' }),
    T + 40000,
  );
  d.observe(state({ state: 'available' }), T + 45000);
  const summary = d.summary(T + 70000);
  assert.equal(summary.enabled, false);
  assert.equal(summary.observedMs, 35000);
  assert.equal(summary.delayedMs, 10000);
  const attempts = summary.pollingAttempts;
  d.pollStart(T + 71000);
  assert.equal(d.summary(T + 72000).pollingAttempts, attempts);
});
test('clock anomalies never create negative episode/request durations', () => {
  const d = createDataDiagnostics(T);
  d.observe(
    state({ state: 'delayed', clockAnomaly: true, primaryAgeMs: -1 }),
    T + 1000,
  );
  d.pollComplete({
    atMs: T + 500,
    durationMs: null,
    ok: false,
    status: null,
    error: 'network-error',
    cache: null,
    cacheAgeSeconds: null,
  });
  d.observe(state(), T + 2000);
  const summary = d.summary(T + 3000);
  assert.ok(summary.clockAnomalies >= 1);
  assert.equal(summary.associations['clock-anomaly'], 1);
  assert.ok(summary.episodes.every((e) => e.observedDurationMs >= 0));
});
test('stale cache and provider ages are separate from HTTP latency and response success', () => {
  const d = createDataDiagnostics(T);
  d.pollStart(T);
  d.pollComplete({
    atMs: T + 50,
    durationMs: 50,
    ok: true,
    status: 200,
    error: null,
    cache: 'HIT',
    cacheAgeSeconds: 35,
  });
  d.observe(
    state({
      state: 'delayed',
      snapshotAgeMs: 35000,
      providerAgeMs: 36000,
      primaryAgeMs: 37000,
    }),
    T + 50,
  );
  const summary = d.summary(T + 15050);
  assert.equal(summary.successfulRequests, 1);
  assert.equal(summary.failedRequests, 0);
  assert.equal(summary.polls[0].durationMs, 50);
  assert.equal(summary.polls[0].cacheAgeSeconds, 35);
  assert.equal(summary.associations['aged-snapshot'], 1);
});
test('diagnostic rings/counters saturate, summaries are copies, stop prevents more collection', () => {
  const d = createDataDiagnostics(T, 60000);
  for (let i = 0; i < 11000; i++) d.pollStart(T);
  for (let i = 0; i < 400; i++) {
    d.pollComplete({
      atMs: T + i * 2,
      durationMs: 1,
      ok: true,
      status: 200,
      error: null,
      cache: null,
      cacheAgeSeconds: null,
    });
    d.observe(state({ state: 'delayed', primaryAgeMs: 40000 }), T + i * 2);
    d.observe(state(), T + i * 2 + 1);
  }
  const summary = d.summary(T + 1000);
  assert.equal(summary.pollingAttempts, 10000);
  assert.ok(summary.polls.length <= 256);
  assert.ok(summary.episodes.length <= 256);
  assert.equal(summary.delayedEpisodes, 400);
  assert.equal(summary.episodeWindowTruncated, true);
  summary.polls.length = 0;
  assert.ok(d.summary(T + 1000).polls.length > 0);
  d.stop(T + 1000);
  const before = d.summary(T + 1000).successfulRequests;
  d.pollComplete({
    atMs: T + 1500,
    durationMs: 1,
    ok: true,
    status: 200,
    error: null,
    cache: null,
    cacheAgeSeconds: null,
  });
  assert.equal(d.summary(T + 2000).successfulRequests, before);
});
test('server gate can produce one-cycle cooldown for a request arriving just before its 15-second gate', async () => {
  let now = T,
    calls = 0;
  const service = createService(
    async () => {
      calls++;
      return snap();
    },
    () => now,
  );
  await service();
  now = T + 14999;
  await assert.rejects(service(), /cooldown/);
  now = T + 30000;
  await service();
  assert.equal(calls, 2);
  // Reproduces a possible timing mechanism; does not establish the user's actual incident rate.
});

test('poller diagnostics record successes, failures, lifecycle, cache, recovery and stop without changing selection', async () => {
  let now = T,
    id = 0,
    calls = 0,
    active = true;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const observer = createDataDiagnostics(T),
    states: string[] = [];
  const poller = createPoller((s) => states.push(s.state), {
    observer,
    now: () => now,
    active: () => active,
    context: () => ({ active, visible: active, online: true }),
    fetch: async () => {
      calls++;
      if (calls === 2)
        return new Response('{"error":"cooldown"}', { status: 503 });
      return new Response(
        JSON.stringify(
          snap([{ ...aircraft(), positionTimeMs: now - 1000 }], now),
        ),
        { headers: { 'x-vercel-cache': 'HIT', age: '1' } },
      );
    },
    setTimer: (fn, ms) => {
      const key = ++id;
      timers.set(key, { fn, at: now + ms });
      return key as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (key) => {
      timers.delete(key as unknown as number);
    },
  });
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  const advance = async (t: number) => {
    now = t;
    for (const [key, v] of [...timers])
      if (v.at <= now) {
        timers.delete(key);
        v.fn();
      }
    await flush();
  };
  poller.start();
  await flush();
  await advance(T + 15000);
  assert.equal(states[states.length - 1], 'delayed');
  await advance(T + 30000);
  assert.equal(states[states.length - 1], 'available');
  let report = observer.summary(now);
  assert.equal(report.pollingAttempts, 3);
  assert.equal(report.successfulRequests, 2);
  assert.equal(report.failedRequests, 1);
  assert.equal(report.polls[1].error, 'cooldown');
  assert.equal(report.delayedEpisodes, 1);
  assert.equal(report.medianDelayedDurationMs, 15000);
  active = false;
  poller.resume();
  assert.equal(timers.size, 0);
  now += 100000;
  active = true;
  poller.resume();
  await flush();
  assert.equal(states[states.length - 1], 'available');
  assert.equal(poller.diagnostics().history.primaryId, 'abcdef');
  poller.stop();
  report = observer.summary(now);
  assert.equal(report.enabled, false);
  assert.equal(timers.size, 0);
});

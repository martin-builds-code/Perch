import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createEnricher } from '../src/enrichment';
import type { EnrichmentEnvironment } from '../src/enrichment';
import {
  createAdaptiveEnrichmentService,
  AdaptiveDeferral,
} from '../server/adaptiveEnrichmentService';
import type { Coordinator } from '../server/adaptiveCoordinator';
import { initialAdaptiveState } from '../src/adaptiveBudget';
import type { EnrichmentResult, Supplement } from '../src/enrichmentTypes';
import type { Aircraft, Scene } from '../src/simulation';
import { fleet } from '../src/simulation';
import { observation } from '../src/observation';
import { aircraft } from './fixtures/observation-r04';
const T = 1_800_000_000_000;
const settle = () => new Promise<void>((r) => setImmediate(r));
const airport = (code: string) => ({
  code,
  name: code,
  iata: code,
  icao: null,
});
const pair = {
  origin: airport('MAN'),
  destination: airport('AMS'),
  associationTimeMs: T - 542 * 86400000,
};
const plane = (id = 'abcdef', callsign = 'PRIMARY'): Aircraft => ({
  ...fleet[0],
  id,
  callsign,
  registration: 'SYNTHETIC',
  operator: 'Known',
  origin: null,
  destination: null,
  observation: observation(
    aircraft(id, 3, 6500, { trackDegrees: null }),
    T,
    3,
  ),
});
const scene = (primary: Aircraft, secondary: Aircraft[] = []): Scene => ({
  id: 'live',
  label: 'Live',
  duration: 0,
  state: 'available',
  primary,
  secondary,
});
function harness(
  t: { after: (fn: () => void) => void },
  options: {
    negative?: boolean;
    delay?: number;
    unavailable?: boolean;
  } = {},
) {
  let now = T,
    revision = 0,
    state = initialAdaptiveState(T),
    active = true,
    nextTimer = 0;
  const timers = new Map<number, { at: number; fn: () => void }>(),
    cache = new Map<string, EnrichmentResult>();
  const providerCalls: {
      at: number;
      kind: string;
      hex: string;
      callsign: string | null;
    }[] = [],
    apiCalls: number[] = [],
    published: Scene[] = [];
  const store: Coordinator = {
    key: (v) => createHash('sha256').update(v).digest('hex'),
    read: async (key) => {
      if (options.unavailable) throw Error('offline');
      return {
        revision,
        state: structuredClone(state),
        nowMs: now,
        cache: cache.has(key)
          ? {
              payload: JSON.stringify(cache.get(key)),
              expiresAtMs: cache.get(key)!.expiresAtMs,
            }
          : null,
      };
    },
    swap: async (key, before, next, result) => {
      if (before.revision !== revision) return false;
      state = structuredClone(next);
      revision++;
      if (result) cache.set(key, result);
      return true;
    },
    cacheValue: (r) =>
      r.cache ? (JSON.parse(r.cache.payload) as EnrichmentResult) : null,
  };
  const setTimer = (fn: () => void, ms: number) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + ms, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  const clearTimer = (id: ReturnType<typeof setTimeout>) => {
    timers.delete(id as unknown as number);
  };
  const service = createAdaptiveEnrichmentService(
    () => store,
    async (kind, hex, callsign, observe) => {
      providerCalls.push({ at: now, kind, hex, callsign });
      await new Promise<void>((r) => setTimer(r, options.delay ?? 100));
      observe({
        requestStarted: true,
        httpStatus: options.negative ? 404 : 200,
        outcome: options.negative
          ? 'negative'
          : kind === 'route'
            ? 'complete'
            : 'identity',
        reason: options.negative ? 'http-404' : 'validated',
        endpoint:
          kind === 'route' ? 'v2/routes/:callsign' : 'v2/aircraft/:hex',
      });
      return options.negative
        ? null
        : kind === 'route'
          ? pair
          : ({
              operator: 'Enriched',
              registration: 'SYNTHETIC',
            } as Supplement);
    },
    () => now,
    () => now,
  );
  const env: EnrichmentEnvironment = {
    adaptive: true,
    now: () => now,
    monotonicNow: () => now,
    active: () => active,
    setTimer,
    clearTimer,
    fetch: async (url, init) => {
      assert.ok(
        String(url).startsWith('/api/enrichment?'),
        'no positional or external request added',
      );
      apiCalls.push(now);
      const q = new URL(String(url), 'https://fixture.invalid')
        .searchParams;
      try {
        const r = await service.get(
          q.get('kind') as 'route' | 'aircraft',
          q.get('hex')!,
          q.get('callsign'),
          q.get('priority') === 'normal',
        );
        if (init?.signal?.aborted)
          throw new DOMException('Aborted', 'AbortError');
        return new Response(
          JSON.stringify({ ...r.result, adaptiveBudget: r.budget }),
          { headers: { 'content-type': 'application/json' } },
        );
      } catch (e) {
        if (e instanceof AdaptiveDeferral)
          return new Response(
            JSON.stringify({
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
              ...(e.budget ? { adaptiveBudget: e.budget } : {}),
            }),
            {
              status: 503,
              headers: {
                'content-type': 'application/json',
                'retry-after': String(Math.ceil(e.retryAfterMs / 1000)),
              },
            },
          );
        throw e;
      }
    },
  };
  const client = createEnricher((s) => published.push(s), env);
  t.after(client.stop);
  async function at(delta: number) {
    const target = T + delta;
    await settle();
    let iterations = 0;
    for (;;) {
      const next = [...timers]
        .filter(([, v]) => v.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++iterations > 1000) throw Error('timer storm');
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await settle();
    }
    now = target;
    await settle();
  }
  return {
    client,
    providerCalls,
    apiCalls,
    published,
    at,
    state: () => state,
    timers,
    active: (v: boolean) => {
      active = v;
      client.contextChanged();
    },
  };
}
test('R05 drains primary and secondary work without a 90s bottleneck or new position refresh', async (t) => {
  const h = harness(t),
    p = { ...plane(), ...pair };
  h.client.update(
    scene(p, [
      plane('111111', 'JET1'),
      plane('222222', 'JET2'),
      plane('333333', 'JET3'),
    ]),
  );
  await h.at(31000);
  assert.equal(h.providerCalls.length, 3);
  assert.ok(h.providerCalls[1].at - h.providerCalls[0].at < 30000);
  assert.ok(h.providerCalls[2].at - h.providerCalls[0].at < 90000);
  assert.ok(h.providerCalls.every((c) => c.kind === 'route'));
  assert.equal(
    h.published[h.published.length - 1]!.secondary.filter(
      (a) => a.origin && a.destination,
    ).length,
    3,
  );
  assert.ok(h.published.every((s) => s.primary?.id === p.id));
  assert.ok(
    h.published[h.published.length - 1]!.secondary.every(
      (a) => a.routeHistorical === true,
    ),
  );
});
test('R05 retains R04 urgent-secondary priority and essential primary identification protection', async (t) => {
  const h = harness(t),
    p = {
      ...plane(),
      operator: null,
      observation: observation(
        aircraft('abcdef', 3, 2500, {
          groundSpeedKnots: 80,
          trackDegrees: null,
        }),
        T,
        3,
      ),
    },
    jet = {
      ...plane('111111', 'JET1'),
      observation: observation(
        aircraft('111111', 10, 35000, { groundSpeedKnots: 450 }),
        T,
        3,
      ),
    };
  h.client.update(scene(p, [jet]));
  await h.at(100);
  assert.equal(h.providerCalls[0].hex, jet.id);
  h.client.stop();
  const h2 = harness(t);
  h2.client.update(scene({ ...p, model: 'Aircraft' }, [jet]));
  await h2.at(100);
  assert.equal(h2.providerCalls[0].kind, 'aircraft');
  assert.equal(h2.providerCalls[0].hex, p.id);
});
test('a departing/disappearing queued aircraft is not queried and role changes use cached historical routes', async (t) => {
  const h = harness(t),
    p = plane(),
    other = plane('111111', 'JET1');
  h.client.update(scene(p, [other]));
  await h.at(100);
  h.client.update(scene(p, []));
  await h.at(15000);
  assert.equal(h.providerCalls.length, 1);
  h.client.update(scene(other, [p]));
  await h.at(15100);
  assert.equal(h.providerCalls.length, 2);
  h.client.update(scene(p, [other]));
  await h.at(16000);
  assert.equal(h.providerCalls.length, 2);
  assert.equal(
    h.published[h.published.length - 1]!.primary!.routeHistorical,
    true,
  );
  assert.ok(h.published[h.published.length - 1]!.secondary[0].origin);
});
test('callsign changes invalidate route reuse while a native valid route prevents work', async (t) => {
  const h = harness(t),
    p = plane();
  h.client.update(scene(p));
  await h.at(100);
  h.client.update(scene({ ...p, callsign: 'CHANGED1' }));
  await h.at(10200);
  assert.equal(h.providerCalls.length, 2);
  assert.equal(h.providerCalls[1].callsign, 'CHANGED1');
  h.client.update(scene({ ...p, ...pair }));
  await h.at(20000);
  assert.equal(h.providerCalls.length, 2);
});
test('genuine negative results stay cached and do not loop on completion', async (t) => {
  const h = harness(t, { negative: true });
  h.client.update(scene(plane()));
  await h.at(120000);
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.apiCalls.length, 1);
});
test('hidden/offline/sleep lifecycle cancellation prevents new work and cleans the single wake timer', async (t) => {
  const h = harness(t);
  h.client.update(scene(plane(), [plane('111111', 'JET1')]));
  await h.at(100);
  h.active(false);
  await h.at(20000);
  assert.equal(h.providerCalls.length, 1);
  assert.equal(h.timers.size, 0);
  h.active(true);
  await h.at(20100);
  assert.equal(h.providerCalls.length, 2);
  h.client.stop();
  await h.at(100000);
  assert.equal(h.timers.size, 0);
  assert.equal(h.providerCalls.length, 2);
});
test('paused/expired scene observations cannot be fetched by a later wake', async (t) => {
  const h = harness(t),
    p = plane();
  h.client.update(scene(p));
  await h.at(100);
  h.active(false);
  await h.at(130000);
  h.active(true);
  await h.at(131000);
  assert.equal(h.providerCalls.length, 1);
});
test('coordinator unavailability produces bounded 30s local waits, not five-minute provider backoff', async (t) => {
  const h = harness(t, { unavailable: true });
  h.client.update(scene(plane()));
  await h.at(90001);
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.apiCalls.length, 4);
  h.client.stop();
  assert.equal(h.timers.size, 0);
});

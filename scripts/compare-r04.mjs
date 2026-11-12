// Identical synthetic trajectories/outcomes, two policy implementations, no external traffic.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import {
  SCENARIOS,
  traffic,
  REPLAY_START,
} from '../tests/fixtures/r04-trajectories.ts';
import { createAircraftSelector as oldSelector } from '../tests/baseline/selection-r03.ts';
import { createEnricher as oldEnricher } from '../tests/baseline/enrichment-r03.ts';
import { createAircraftSelector } from '../src/selection.ts';
import { createEnricher } from '../src/enrichment.ts';
import { liveScene } from '../src/live.ts';
import { ENRICHMENT_POLICY as P } from '../src/enrichmentTypes.ts';
import { prominentRoute } from '../src/artwork.ts';
const settle = () => new Promise((r) => setImmediate(r));
export async function compareScenario(
  scenario,
  selectorFactory,
  enricherFactory,
) {
  const selector = selectorFactory();
  let now = REPLAY_START,
    rendered = null,
    pending = null,
    latest = null;
  const attempts = [],
    acquisitions = [],
    selections = [],
    firstDetected = new Map(),
    firstLookup = new Map(),
    firstRoute = new Map(),
    everPrimary = new Set(),
    everRelevant = new Set(),
    relevantSelected = new Set();
  let withRoute = 0,
    primaryTime = 0,
    transitions = 0,
    lastPrimary = null,
    secondaryRequests = 0,
    negative = 0,
    routeRequests = 0,
    cachePublications = 0;
  const env = {
    now: () => now,
    active: () => true,
    setTimer: () => 0,
    clearTimer: () => {},
    fetch: (url) => {
      assert.equal(pending, null, 'no overlapping provider requests');
      const q = new URL(url, 'https://fixture.invalid').searchParams,
        kind = q.get('kind'),
        hex = q.get('hex'),
        callsign = q.get('callsign');
      const track = scenario.tracks.find((t) => t.id === hex),
        secondary = latest.primary?.id !== hex;
      attempts.push({ atMs: now, kind, hex, secondary });
      if (secondary) secondaryRequests++;
      if (kind === 'route') {
        routeRequests++;
        if (!firstLookup.has(hex)) firstLookup.set(hex, now);
      }
      return new Promise((resolve) => {
        pending = { at: now + 1000, resolve, kind, hex, callsign, track };
      });
    },
  };
  const e = enricherFactory((s) => {
    if (s.primary?.origin && !firstRoute.has(s.primary.id))
      firstRoute.set(s.primary.id, now);
    for (const a of s.secondary)
      if (a.origin && !firstRoute.has(a.id)) firstRoute.set(a.id, now);
    if (
      s.primary &&
      rendered?.primary?.id === s.primary.id &&
      s.primary.origin
    )
      cachePublications++;
    rendered = s;
  }, env);
  for (let seconds = 0; seconds <= scenario.seconds; seconds++) {
    now = REPLAY_START + seconds * 1000;
    if (pending && now >= pending.at) {
      const p = pending;
      pending = null;
      const missing = p.kind === 'route' && p.track?.route === 'missing';
      if (missing) negative++;
      const airport = (code) => ({
        code,
        iata: code,
        icao: null,
        name: code,
      });
      p.resolve(
        new Response(
          JSON.stringify({
            kind: p.kind,
            hex: p.hex,
            callsign: p.callsign,
            source: 'hexdb.io',
            status: missing ? 'not-found' : 'found',
            data: missing
              ? {}
              : p.kind === 'aircraft'
                ? { operator: 'Synthetic provider operator' }
                : {
                    origin: airport('AMS'),
                    destination: airport('MAN'),
                    associationTimeMs:
                      now -
                      (p.track?.route === 'historical' ? 542 : 10) *
                        86400000,
                  },
            fetchedAtMs: now,
            expiresAtMs:
              now +
              (p.kind === 'aircraft' ? P.identityTtlMs : P.routeTtlMs),
          }),
        ),
      );
      await settle();
    }
    if (seconds % 15 === 0) {
      const snapshot = traffic(scenario, seconds);
      for (const a of snapshot.aircraft)
        if (!firstDetected.has(a.id)) firstDetected.set(a.id, now);
      const result = selector.select(snapshot, now);
      latest = liveScene(snapshot, now, false, result);
      e.update(latest);
      await settle();
      selections.push({
        atMs: now,
        primary: result.primary?.id ?? null,
        reason: result.decision.reason,
      });
      for (const a of snapshot.aircraft) {
        const elevation =
          (Math.atan2(
            Math.max(0, a.heightAboveObserverKm ?? 0),
            a.distanceKm,
          ) *
            180) /
          Math.PI;
        if (elevation >= 45 || a.distanceKm < 1) everRelevant.add(a.id);
        if (
          result.primary?.id === a.id &&
          (elevation >= 45 || a.distanceKm < 1)
        )
          relevantSelected.add(a.id);
      }
      const id = result.primary?.id ?? null;
      if (id !== lastPrimary) {
        if (lastPrimary && id) transitions++;
        if (id) {
          const t = scenario.tracks.find((t) => t.id === id);
          acquisitions.push({
            id,
            seconds,
            secondsBeforeCpa: t ? t.cpaAt - seconds : null,
            routeReady:
              !!rendered?.primary && !!prominentRoute(rendered.primary),
          });
          everPrimary.add(id);
        }
        lastPrimary = id;
      }
    }
    if (seconds < scenario.seconds && rendered?.primary) {
      primaryTime++;
      if (prominentRoute(rendered.primary)) withRoute++;
    }
  }
  e.stop();
  selector.clear();
  for (let i = 1; i < attempts.length; i++)
    assert.ok(attempts[i].atMs - attempts[i - 1].atMs >= 30000);
  const secondary = attempts.filter((a) => a.secondary);
  for (let i = 1; i < secondary.length; i++)
    assert.ok(secondary[i].atMs - secondary[i - 1].atMs >= 90000);
  const requestsByFlight = scenario.tracks.map((t) => ({
    id: t.id,
    kind: t.type,
    detectedAtMs: firstDetected.get(t.id) ?? null,
    lookupAfterDetectionMs: firstLookup.has(t.id)
      ? firstLookup.get(t.id) - firstDetected.get(t.id)
      : null,
    firstUsableAfterDetectionMs: firstRoute.has(t.id)
      ? firstRoute.get(t.id) - firstDetected.get(t.id)
      : null,
    routeOutcome: t.route,
    routeAttempts: attempts.filter(
      (a) => a.hex === t.id && a.kind === 'route',
    ).length,
  }));
  const dwell = [];
  for (const s of selections) {
    const previous = dwell[dwell.length - 1];
    if (previous?.id === s.primary)
      previous.endMs = Math.min(
        REPLAY_START + scenario.seconds * 1000,
        s.atMs + 15000,
      );
    else
      dwell.push({
        id: s.primary,
        startMs: s.atMs,
        endMs: Math.min(
          REPLAY_START + scenario.seconds * 1000,
          s.atMs + 15000,
        ),
      });
  }
  return {
    primaryTransitions: transitions,
    primaryIntervals: dwell,
    modelServerRequests: attempts.length,
    modelUpstreamRequests: attempts.length,
    cacheAssumption:
      'No server-side cache; one model upstream start per application request. Client cache is real policy code.',
    primarySeconds: primaryTime,
    secondsWithRoute: withRoute,
    primaryTimeWithRoutePercent: primaryTime
      ? (100 * withRoute) / primaryTime
      : null,
    firstPrimaryAcquisitions: acquisitions.filter(
      (a, i, all) => all.findIndex((x) => x.id === a.id) === i,
    ),
    routeReadyAtFirstPrimary: acquisitions.filter(
      (a, i, all) =>
        all.findIndex((x) => x.id === a.id) === i && a.routeReady,
    ).length,
    primaryAircraft: everPrimary.size,
    transparentGeometricRelevantPasses: everRelevant.size,
    missedDefinedRelevantPasses: [...everRelevant].filter(
      (id) => !relevantSelected.has(id),
    ),
    requests: attempts.length,
    routeRequests,
    secondaryRequests,
    successfulRouteRequests: routeRequests - negative,
    negativeRouteRequests: negative,
    detectedWithoutRouteAttempt: requestsByFlight.filter(
      (x) => x.detectedAtMs !== null && x.lookupAfterDetectionMs === null,
    ).length,
    cachePublications,
    requestsPerHour: (3600 * attempts.length) / scenario.seconds,
    requestsByFlight,
    attempts,
    selections,
  };
}
if (process.argv[1]?.endsWith('compare-r04.mjs')) {
  const results = [];
  for (const scenario of SCENARIOS) {
    const r03 = await compareScenario(scenario, oldSelector, oldEnricher),
      r04 = await compareScenario(
        scenario,
        createAircraftSelector,
        createEnricher,
      );
    results.push({
      name: scenario.name,
      seconds: scenario.seconds,
      r03,
      r04,
    });
    console.log(
      JSON.stringify({
        name: scenario.name,
        R03: {
          requests: r03.requests,
          routeReady: r03.routeReadyAtFirstPrimary,
          primary: r03.primaryAircraft,
          routeTime: r03.primaryTimeWithRoutePercent,
          missed: r03.missedDefinedRelevantPasses,
        },
        R04: {
          requests: r04.requests,
          routeReady: r04.routeReadyAtFirstPrimary,
          primary: r04.primaryAircraft,
          routeTime: r04.primaryTimeWithRoutePercent,
          missed: r04.missedDefinedRelevantPasses,
        },
      }),
    );
  }
  for (const r of results)
    assert.ok(
      r.r04.requests <= r.r03.requests,
      'No modeled request increase: ' + r.name,
    );
  const slow = results.find(
    (r) => r.name === 'slow-primary-fast-approach',
  ).r04;
  const jet = slow.requestsByFlight.find((r) => r.id === '000002'),
    acquisition = slow.firstPrimaryAcquisitions.find(
      (a) => a.id === '000002',
    );
  assert.ok(
    jet.firstUsableAfterDetectionMs + jet.detectedAtMs <
      REPLAY_START + acquisition.seconds * 1000,
    'A useful secondary route is available before primary acquisition',
  );
  await writeFile(
    'docs/route-r04/synthetic-comparison.json',
    JSON.stringify(
      {
        basis:
          'Synthetic constant-motion/orbit trajectories; known fixture outcomes and assumed 1 second provider latency. Not real coverage, human accuracy or measured provider performance.',
        geometricCriterion:
          'Elevation >=45 degrees OR horizontal distance <1km while observed. A transparent evaluation convention, not ground truth.',
        results,
      },
      null,
      2,
    ) + '\n',
  );
}

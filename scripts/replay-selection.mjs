// Offline synthetic comparison; no aircraft provider, observation location or database.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createAircraftSelector } from '../src/selection.ts';
const fixture = JSON.parse(
  readFileSync(
    new URL('../tests/fixtures/selection-replay.json', import.meta.url),
    'utf8',
  ),
);
const T = 1_800_000_000_000;
const scenarios = fixture.scenarios.map((scenario) => {
  const selector = createAircraftSelector();
  const frames = scenario.frames.map((frame) => {
    const now = T + frame.offsetMs;
    const aircraft = frame.aircraft.map((a) => ({
      ...a,
      callsign: null,
      registration: null,
      description: 'Synthetic replay aircraft',
      typeCode: null,
      geometricAltitudeFt: null,
      groundSpeedKnots: 220,
      trackDegrees: 90,
      positionTimeMs: now,
      source: 'adsb.fi',
      validity: { position: true, timestamp: true, anomalies: [] },
    }));
    const result = selector.select(
      {
        aircraft,
        fetchedAtMs: now,
        providerTimeMs: now,
        pollIntervalMs: 15000,
        rejectedRecords: 0,
        anomalies: [],
      },
      now,
    );
    // Exact original Stage 2A nearest-first policy on these valid fixtures, including ground records.
    const nearest =
      [...aircraft].sort(
        (a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id),
      )[0]?.id ?? null;
    assert.equal(
      result.primary?.id ?? null,
      frame.expectedPrimary,
      scenario.name + ' at ' + frame.offsetMs,
    );
    return {
      offsetMs: frame.offsetMs,
      nearestFirst: nearest,
      relevancePrimary: result.primary?.id ?? null,
      reason: result.decision.reason,
      ranked: result.ranked.map((a) => ({
        id: a.aircraft.id,
        score: Number(a.score.toFixed(3)),
        movement: a.motion.state,
        factors: a.factors,
      })),
    };
  });
  const countSwitches = (key) =>
    frames.slice(1).filter((f, i) => f[key] !== frames[i][key]).length;
  return {
    name: scenario.name,
    nearestSwitches: countSwitches('nearestFirst'),
    relevanceSwitches: countSwitches('relevancePrimary'),
    frames,
  };
});
const report = {
  evidence: fixture.evidence,
  archiveReplayPerformed: false,
  scenarios,
};
writeFileSync(
  new URL('../docs/stage-2b-synthetic-replay.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    scenarios.map((s) => ({
      scenario: s.name,
      nearestSwitches: s.nearestSwitches,
      relevanceSwitches: s.relevanceSwitches,
      nearestFinal: s.frames[s.frames.length - 1].nearestFirst,
      relevanceFinal: s.frames[s.frames.length - 1].relevancePrimary,
    })),
    null,
    2,
  ),
);

// Captured, pseudonymous geometry replay. No inferred provider outcomes or calls.
import { readFile, writeFile } from 'node:fs/promises';
import { createAircraftSelector as baseline } from '../tests/baseline/selection-r03.ts';
import { createAircraftSelector as initial } from '../tests/baseline/selection-r04-initial.ts';
import { createAircraftSelector as corrected } from '../src/selection.ts';
const input = process.argv[2] ?? '/tmp/perch-r04-live/observation.json';
const output = process.argv[3] ?? '/tmp/r04-live-replay.json';
const evidence = JSON.parse(await readFile(input, 'utf8'));
const frames = evidence.sky.frames;
const snapshots = new Map(
  frames.map((f) => [f.snapshot.fetchedAtMs, f.snapshot]),
);
const recorded = new Map(frames.map((f) => [f.atMs, f.result]));
const evaluations = evidence.sky.evaluations?.length
  ? evidence.sky.evaluations
      .filter(
        (e) =>
          e.snapshotTimeMs === null || snapshots.has(e.snapshotTimeMs),
      )
      .map((e) => ({
        atMs: e.atMs,
        failed: e.failed,
        snapshot:
          e.snapshotTimeMs === null
            ? null
            : snapshots.get(e.snapshotTimeMs),
        result: recorded.get(e.atMs),
      }))
  : frames;
const results = {};
for (const [name, factory] of [
  ['R03', baseline],
  ['R04-live', initial],
  ['R04-final', corrected],
]) {
  const selector = factory(),
    changes = [],
    decisions = [];
  let previous = null,
    capturedAgreement = 0;
  for (const f of evaluations) {
    const r = selector.select(f.snapshot, f.atMs, f.failed),
      id = r.primary?.id ?? null;
    if (f.result) {
      const captured =
        name === 'R03' ? f.result.baselinePrimary : f.result.primary;
      if (id === captured) capturedAgreement++;
    }
    if (id !== previous) {
      changes.push({
        atMs: f.atMs,
        ref: id,
        reason: r.decision.reason,
        margin: r.decision.margin,
        heldMs: r.decision.heldMs,
      });
      previous = id;
    }
    decisions.push({ atMs: f.atMs, ref: id, reason: r.decision.reason });
  }
  const intervals = changes.flatMap((c, i) =>
    c.ref
      ? [
          {
            ...c,
            durationMs:
              (changes[i + 1]?.atMs ?? evidence.observedUntilMs) - c.atMs,
          },
        ]
      : [],
  );
  const completed = intervals.slice(0, -1);
  results[name] = {
    frames: frames.length,
    evaluations: evaluations.length,
    capturedAgreementFrames: capturedAgreement,
    transitions: changes.filter(
      (c, i) => i > 0 && c.ref && changes[i - 1].ref,
    ).length,
    changes,
    intervals,
    completedSelectionsUnder1s: completed.filter(
      (i) => i.durationMs < 1000,
    ),
    completedSelectionsUnder15s: completed.filter(
      (i) => i.durationMs < 15000,
    ),
    minimumCompletedSelectionMs: completed.length
      ? Math.min(...completed.map((i) => i.durationMs))
      : null,
    decisions,
  };
  selector.clear();
}
const result = {
  basis:
    'Offline replay of the same captured live snapshots/times. R04-final includes the meaningful freshness-gap and cached-discontinuity safeguards. Route scheduler/provider outcomes were not replayed or invented.',
  input,
  results,
  limitations: [
    'Capture is bounded to32 aircraft per frame and240 frames; check evidence truncation.',
    'Initial diagnostic capture may omit timer-only R03 changes; replay/captured agreement is reported.',
    'Pseudonymous identifiers can alter exact score-tie ordering; no visibility/audibility ground truth.',
    'Live route availability measures apply to the observed976210d app; final corrections have unit/browser and recorded-geometry replay evidence.',
  ],
};
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        {
          frames: v.frames,
          capturedAgreement: v.capturedAgreementFrames,
          transitions: v.transitions,
          subSecondSelections: v.completedSelectionsUnder1s.length,
          minimumCompletedSelectionMs: v.minimumCompletedSelectionMs,
        },
      ]),
    ),
  ),
);

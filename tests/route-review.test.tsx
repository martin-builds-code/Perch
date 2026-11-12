import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import {
  canonical,
  draftKey,
  emptyDraft,
  exactMatch,
  fr24AircraftLink,
  importReview,
  mergeReviewExports,
  parseDraft,
  parseReviewDataset,
  reviewExport,
  safeEvidenceUrl,
} from '../src/routeReviewModel';
import type { ReviewAnswer } from '../src/routeReviewModel';
import { reviewFixture, reviewTime } from './fixtures/route-review';
import {
  isolatedStage3Preview,
  ISOLATED_STAGE3_PROJECT,
} from '../server/previewIdentity';
import reviewHandler from '../api/route-review';
import { routeReviewCases } from '../server/routeReviewCases';
import { analyseReview } from '../src/routeReviewAnalysis';
const answer: ReviewAnswer = {
  verdict: 'same-route',
  matchScope: 'same-aircraft-date',
  originCode: '',
  destinationCode: '',
  notes: 'Matched the dated aircraft history.',
  evidenceUrl: '',
  revision: 1,
  updatedAtMs: reviewTime,
};
test('R02 hosted page has a narrow SPA route without rewriting live APIs or normal display', () => {
  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(config.rewrites, [
    { source: '/route-review', destination: '/index.html' },
  ]);
});
test('R02 frozen cases retain identities, UTC instants, exact provider timestamps and research groups', () => {
  const d = reviewFixture();
  assert.ok(parseReviewDataset(d));
  assert.deepEqual(
    d.cases.map((c) => c.ageCategory),
    [
      'recent-0-180',
      'historical-180-365',
      'historical-over-365',
      'missing-unusable',
    ],
  );
  assert.equal(d.cases[2].operationalReason, 'route-too-old');
  assert.equal(d.cases[2].associationAgeDays, 542);
  assert.equal(d.cases[0].observedAtMs, reviewTime);
  assert.equal(draftKey(d).includes(d.fingerprint), true);
  assert.equal(
    fr24AircraftLink(d.cases[0]),
    'https://www.flightradar24.com/data/aircraft/g-test0',
  );
  assert.equal(fr24AircraftLink(d.cases[3]), null);
});
for (const field of [
  'latitude',
  'longitude',
  'cookie',
  'credentials',
  'secret',
])
  test('R02 dataset rejects unexpected private field ' + field, () => {
    const d = reviewFixture();
    Object.assign(d.cases[0], { [field]: 'PRIVATE' });
    assert.equal(parseReviewDataset(d), null);
  });
test('R02 invalid cases, duplicate identities and unsupported schemas are rejected', () => {
  const d = reviewFixture();
  assert.equal(parseReviewDataset({ ...d, policyDays: 365 }), null);
  assert.equal(
    parseReviewDataset({ ...d, cases: [d.cases[0], d.cases[0]] }),
    null,
  );
  const differentId = { ...d.cases[0], id: d.cases[1].id };
  assert.equal(
    parseReviewDataset({ ...d, cases: [d.cases[0], differentId] }),
    null,
  );
  assert.equal(
    parseReviewDataset({
      ...d,
      observationWindow: { fromMs: reviewTime, toMs: 0 },
    }),
    null,
  );
  assert.equal(
    fr24AircraftLink({
      ...d.cases[0],
      registration: '../bad?token=secret',
    }),
    null,
  );
});
test('R02 verdicts export/import as valid JSON without resetting drafts, preserving flight identities', () => {
  const d = reviewFixture(),
    draft = emptyDraft(d);
  draft.answers[d.cases[0].id] = { ...answer };
  draft.index = 2;
  assert.ok(parseDraft(JSON.parse(JSON.stringify(draft)), d));
  const before = JSON.stringify(draft),
    out = reviewExport(d, draft, reviewTime + 1000);
  assert.equal(out.complete, false);
  assert.equal(out.summary.reviewed, 1);
  assert.equal(out.cases[0].case.hex, d.cases[0].hex);
  assert.deepEqual(out.cases[0].answer, answer);
  assert.equal(JSON.stringify(draft), before);
  assert.deepEqual(
    importReview(JSON.parse(JSON.stringify(out)), d)?.answers,
    draft.answers,
  );
  for (const c of d.cases)
    draft.answers[c.id] = {
      ...answer,
      verdict: 'unable-to-verify',
      matchScope: 'not-matched',
    };
  const all = reviewExport(d, draft);
  assert.equal(all.complete, true);
  assert.equal(all.summary.exactDateMatches, 0);
});
test('R02 missing/other-date evidence never becomes a corroborated exact match', () => {
  assert.equal(
    exactMatch({ ...answer, matchScope: 'not-matched' }),
    false,
  );
  assert.equal(
    exactMatch({ ...answer, matchScope: 'different-date' }),
    false,
  );
  assert.equal(
    exactMatch({ ...answer, matchScope: 'same-flight-date' }),
    true,
  );
  const d = reviewFixture(),
    draft = emptyDraft(d);
  draft.answers[d.cases[0].id] = {
    ...answer,
    matchScope: 'different-date',
  };
  assert.equal(reviewExport(d, draft).summary.exactDateMatches, 0);
});
test('R02 duplicates are idempotent; revised/conflicting exports are flagged instead of silently replacing findings', () => {
  const d = reviewFixture(),
    draft = emptyDraft(d);
  draft.answers[d.cases[0].id] = { ...answer };
  const first = reviewExport(d, draft);
  assert.deepEqual(mergeReviewExports([first, first], d), {
    answers: draft.answers,
    conflicts: [],
  });
  draft.answers[d.cases[0].id] = {
    ...answer,
    verdict: 'different-route',
    originCode: 'LHR',
    destinationCode: 'AMS',
    revision: 2,
  };
  const conflicts = mergeReviewExports([first, reviewExport(d, draft)], d);
  assert.deepEqual(conflicts.conflicts, [d.cases[0].id]);
  assert.equal(conflicts.answers[d.cases[0].id].verdict, 'same-route');
});
test('R02 imports reject changed samples, edited case identities, duplicate case rows and unbounded notes', () => {
  const d = reviewFixture(),
    draft = emptyDraft(d);
  draft.answers[d.cases[0].id] = { ...answer };
  const out = reviewExport(d, draft);
  assert.equal(
    importReview({ ...out, datasetFingerprint: 'b'.repeat(64) }, d),
    null,
  );
  const changed = structuredClone(out);
  changed.cases[0].case.callsign = 'OTHER';
  assert.equal(importReview(changed, d), null);
  const duplicate = structuredClone(out);
  duplicate.cases[1] = duplicate.cases[0];
  assert.equal(importReview(duplicate, d), null);
  const long = structuredClone(out);
  long.cases[0].answer!.notes = 'x'.repeat(1001);
  assert.equal(importReview(long, d), null);
  assert.equal(
    parseDraft({ ...draft, answers: { unknown: answer } }, d),
    null,
  );
  assert.equal(parseDraft({ ...draft, index: 100 }, d), null);
});
test('R02 partially typed optional links survive draft reload; unsafe links are never used as navigation', () => {
  const d = reviewFixture(),
    draft = emptyDraft(d);
  draft.answers[d.cases[0].id] = { ...answer, evidenceUrl: 'https://' };
  assert.ok(parseDraft(draft, d));
  assert.equal(
    safeEvidenceUrl('https://www.flightradar24.com/data/aircraft/g-test'),
    true,
  );
  assert.equal(safeEvidenceUrl('javascript:alert(1)'), false);
  assert.equal(
    safeEvidenceUrl('https://user:password@example.com/'),
    false,
  );
});
test('R02 analysis reports raw counts per age group and never assumes unchecked cases are accurate', () => {
  const d = reviewFixture(),
    initial = analyseReview(d);
  assert.equal(initial.historicalCandidates, 2);
  assert.equal(initial.historicalCorroborated, 0);
  assert.equal(initial.historicalUnresolved, 2);
  for (const g of Object.values(initial.groups)) {
    assert.equal(g.unverified, 1);
    assert.equal(g.accuracyPercent, null);
  }
  const draft = emptyDraft(d);
  draft.answers[d.cases[0].id] = { ...answer };
  draft.answers[d.cases[1].id] = {
    ...answer,
    verdict: 'different-route',
    originCode: 'LHR',
    destinationCode: 'CDG',
  };
  draft.answers[d.cases[2].id] = {
    ...answer,
    matchScope: 'different-date',
  };
  draft.answers[d.cases[3].id] = {
    ...answer,
    verdict: 'different-route',
    originCode: 'LHR',
    destinationCode: 'AMS',
  };
  const out = reviewExport(d, draft),
    r = analyseReview(d, [out, out]);
  assert.equal(r.groups['recent-0-180'].corroboratedMatches, 1);
  assert.equal(r.groups['recent-0-180'].accuracyPercent, 100);
  assert.equal(r.groups['historical-180-365'].confirmedMismatches, 1);
  assert.equal(r.groups['historical-over-365'].unverified, 1);
  assert.equal(r.groups['missing-unusable'].recoveredMissingRoutes, 1);
  assert.equal(r.groups['missing-unusable'].confirmedMismatches, 0);
  assert.equal(r.historicalMismatches, 1);
});
test('R02 conflicting or contradictory verdicts are excluded; absence of FR24 route is not a mismatch', () => {
  const d = reviewFixture(),
    draft = emptyDraft(d);
  draft.answers[d.cases[0].id] = {
    ...answer,
    verdict: 'no-route-available',
  };
  draft.answers[d.cases[1].id] = {
    ...answer,
    verdict: 'different-route',
    originCode: 'EHAM',
    destinationCode: 'EGCC',
  };
  const r = analyseReview(d, [reviewExport(d, draft)]);
  assert.equal(r.groups['recent-0-180'].noIndependentRoute, 1);
  assert.equal(r.groups['recent-0-180'].accuracyPercent, null);
  assert.equal(r.groups['historical-180-365'].unverified, 1);
  const first = reviewExport(d, draft);
  draft.answers[d.cases[0].id] = { ...answer };
  const conflict = analyseReview(d, [first, reviewExport(d, draft)]);
  assert.deepEqual(conflict.conflicts, [d.cases[0].id]);
  assert.equal(conflict.groups['recent-0-180'].unverified, 1);
});
test('R02 review access checks the exact server Preview identity', () => {
  const env = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_PROJECT_ID: ISOLATED_STAGE3_PROJECT,
  };
  assert.equal(isolatedStage3Preview(env), true);
  for (const patch of [
    { VERCEL_ENV: 'production' },
    { VERCEL_PROJECT_ID: 'other' },
    { VERCEL_TARGET_ENV: 'production' },
    { VERCEL: '0' },
  ])
    assert.equal(isolatedStage3Preview({ ...env, ...patch }), false);
});
test('R02 real HTTP review endpoint returns only frozen cases in isolated Preview; cannot accept submissions or serve Production', async () => {
  const saved = { ...routeReviewCases },
    d = reviewFixture();
  Object.assign(routeReviewCases, d);
  const env = { ...process.env };
  Object.assign(process.env, {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_PROJECT_ID: ISOLATED_STAGE3_PROJECT,
  });
  delete process.env.VERCEL_TARGET_ENV;
  const server = createServer(reviewHandler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const url = 'http://127.0.0.1:' + address.port + '/api/route-review';
    const r = await fetch(url);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(canonical(await r.json()), canonical(d));
    const post = await fetch(url, { method: 'POST' });
    assert.equal(post.status, 405);
    process.env.VERCEL_ENV = 'production';
    const p = await fetch(url);
    assert.equal(p.status, 404);
    assert.deepEqual(await p.json(), { error: 'review-unavailable' });
  } finally {
    Object.assign(routeReviewCases, saved);
    for (const key of Object.keys(process.env))
      if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

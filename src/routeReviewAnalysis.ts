import {
  AGE_CATEGORIES,
  exactMatch,
  mergeReviewExports,
} from './routeReviewModel';
import type {
  ReviewAnswer,
  ReviewAirport,
  ReviewDataset,
} from './routeReviewModel';
const pair = (a: ReviewAnswer) =>
  /^[A-Z]{3,4}$/.test(a.originCode) &&
  /^[A-Z]{3,4}$/.test(a.destinationCode) &&
  a.originCode !== a.destinationCode;
const sameAirport = (code: string, a: ReviewAirport | null) =>
  !!a && [a.code, a.iata, a.icao].includes(code);
export function analyseReview(data: ReviewDataset, files: unknown[] = []) {
  const merged = mergeReviewExports(files, data),
    conflicts = new Set(merged.conflicts);
  const groups = Object.fromEntries(
    AGE_CATEGORIES.map((category) => [
      category,
      {
        sampleSize: 0,
        corroboratedMatches: 0,
        confirmedMismatches: 0,
        noIndependentRoute: 0,
        unverified: 0,
        recoveredMissingRoutes: 0,
        accuracyPercent: null as number | null,
      },
    ]),
  );
  const cases = data.cases.map((c) => {
    const group = groups[c.ageCategory];
    group.sampleSize++;
    let a = merged.answers[c.id],
      method: 'owner' | 'independent' | 'none' = a ? 'owner' : 'none';
    const i = c.independent;
    if (
      !a &&
      i.confidence === 'corroborated' &&
      i.evidence.length &&
      (i.scope === 'same-aircraft-date' ||
        i.scope === 'same-flight-date') &&
      i.verdict !== 'unverified'
    ) {
      a = {
        verdict: i.verdict,
        matchScope: i.scope,
        originCode: '',
        destinationCode: '',
        notes: i.note,
        evidenceUrl: i.evidence[0].url,
        revision: 1,
        updatedAtMs: i.evidence[0].accessedAtMs,
      };
      method = 'independent';
    }
    if (
      a &&
      method === 'owner' &&
      exactMatch(a) &&
      i.confidence === 'corroborated' &&
      i.evidence.length &&
      (i.scope === 'same-aircraft-date' ||
        i.scope === 'same-flight-date') &&
      i.verdict !== 'unverified' &&
      i.verdict !== a.verdict
    )
      conflicts.add(c.id);
    let result:
      | 'corroborated-match'
      | 'confirmed-mismatch'
      | 'no-independent-route'
      | 'recovered-missing-route'
      | 'unverified' = 'unverified';
    let reason = 'No exact-flight/date verification';
    if (conflicts.has(c.id)) {
      reason =
        'Conflicting submissions or evidence; excluded pending review';
    } else if (a && a.verdict !== 'unable-to-verify' && exactMatch(a)) {
      if (a.verdict === 'no-route-available') {
        result = 'no-independent-route';
        reason = 'Flight matched, but no independent route supplied';
      } else if (c.completeIataPair && a.verdict === 'same-route') {
        result = 'corroborated-match';
        reason =
          'Complete proposed route corroborated for observed flight';
      } else if (c.completeIataPair && a.verdict === 'different-route') {
        if (
          pair(a) &&
          sameAirport(a.originCode, c.origin) &&
          sameAirport(a.destinationCode, c.destination)
        ) {
          reason =
            'Different-route verdict contradicts the entered matching airports';
        } else {
          result = 'confirmed-mismatch';
          reason =
            'Owner/independent evidence reports a different route for this flight';
        }
      } else if (
        !c.completeIataPair &&
        a.verdict === 'different-route' &&
        pair(a)
      ) {
        result = 'recovered-missing-route';
        reason =
          'Independent route found where provider lacked a complete pair; not a provider mismatch';
      } else
        reason = 'No complete comparable route or corrected airport pair';
    }
    const key = {
      'corroborated-match': 'corroboratedMatches',
      'confirmed-mismatch': 'confirmedMismatches',
      'no-independent-route': 'noIndependentRoute',
      'recovered-missing-route': 'recoveredMissingRoutes',
      unverified: 'unverified',
    } as const;
    group[key[result]]++;
    return {
      id: c.id,
      category: c.ageCategory,
      result,
      method,
      reason,
      historicalCandidate:
        c.operationalReason === 'route-too-old' &&
        c.completeIataPair &&
        c.structuralReason === 'complete-pair' &&
        c.callsignMatches === true &&
        c.timestampValid,
    };
  });
  for (const g of Object.values(groups)) {
    const verified = g.corroboratedMatches + g.confirmedMismatches;
    g.accuracyPercent = verified
      ? (g.corroboratedMatches / verified) * 100
      : null;
  }
  const historical = cases.filter((c) => c.historicalCandidate);
  return {
    datasetId: data.id,
    fingerprint: data.fingerprint,
    groups,
    cases,
    conflicts: [...conflicts],
    historicalCandidates: historical.length,
    historicalCorroborated: historical.filter(
      (c) => c.result === 'corroborated-match',
    ).length,
    historicalMismatches: historical.filter(
      (c) => c.result === 'confirmed-mismatch',
    ).length,
    historicalUnresolved: historical.filter(
      (c) =>
        !['corroborated-match', 'confirmed-mismatch'].includes(c.result),
    ).length,
    automaticallyCorroborated: cases.filter(
      (c) =>
        c.method === 'independent' && c.result === 'corroborated-match',
    ).length,
    notes: [
      'Unverified cases are not counted as accurate. Accuracy denominator contains only corroborated matches and confirmed mismatches.',
      'A missing independent route is not a mismatch. Missing-source recoveries are separate from route-association accuracy.',
      'The sample is opportunistic, not random or a household-wide success-rate estimate. No route-age policy is changed.',
    ],
  };
}

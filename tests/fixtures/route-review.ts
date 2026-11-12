import { createHash } from 'node:crypto';
import { inspectAssociation } from '../../server/routeResearchCapture';
import { canonical } from '../../src/routeReviewModel';
import type {
  ReviewCase,
  ReviewDataset,
  AgeCategory,
} from '../../src/routeReviewModel';
export const reviewTime = Date.parse('2026-11-11T19:00:00Z');
export function reviewFixture(): ReviewDataset {
  const cases: ReviewCase[] = [20, 240, 542, null].map((age, index) => {
    const hex = (index + 1).toString(16).padStart(6, '0'),
      callsign = 'TST' + (index + 1);
    const inspected = inspectAssociation(
      hex,
      callsign,
      age === null
        ? null
        : {
            callsign,
            origin: {
              iata: 'AMS',
              icao: 'EHAM',
              name: 'Amsterdam Airport Schiphol',
            },
            destination: {
              iata: 'MAN',
              icao: 'EGCC',
              name: 'Manchester Airport',
            },
            updated_at: new Date(
              reviewTime - age * 86400000,
            ).toISOString(),
          },
      {
        outcome:
          age === null ? 'negative' : age > 180 ? 'rejected' : 'complete',
        reason:
          age === null
            ? 'http-404'
            : age > 180
              ? 'route-too-old'
              : 'validated',
        httpStatus: age === null ? 404 : 200,
        requestStarted: true,
        endpoint: 'v2/routes/:callsign',
      },
      reviewTime,
    );
    return {
      ...inspected,
      ageCategory: inspected.ageCategory as AgeCategory,
      source: 'hexdb.io',
      id: 'r02-' + (index + 1).toString(16).padStart(12, '0'),
      registration: index === 3 ? null : 'G-TEST' + index,
      model:
        index === 1
          ? 'Bombardier BD-100 Challenger 350'
          : 'Airbus A320neo',
      typeCode: 'A20N',
      observedAtMs: reviewTime,
      providerObservedAtMs: reviewTime - 10,
      aircraftPositionAtMs: reviewTime - 1000,
      providerRequestStarted: true,
      independent: {
        scope: 'unverified',
        verdict: 'unverified',
        confidence: 'unverified',
        evidence: [],
        note: 'Synthetic fixture only; not a real observed flight.',
      },
    };
  });
  return {
    schemaVersion: 1,
    id: 'r02-fixture',
    revision: 1,
    fingerprint: createHash('sha256')
      .update(canonical(cases))
      .digest('hex'),
    createdAtMs: reviewTime,
    observationWindow: { fromMs: reviewTime, toMs: reviewTime },
    sourceBaseline: '465eb5cb483d681d2bbfb9c2d1cf6c40f4df6527',
    policyDays: 180,
    cases,
  };
}

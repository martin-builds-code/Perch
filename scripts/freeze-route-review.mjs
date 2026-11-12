// Offline assembly of the authorised, bounded R02 study; never queries a provider.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, parseReviewDataset } from '../src/routeReviewModel.ts';
import { analyseReview } from '../src/routeReviewAnalysis.ts';
const collection = JSON.parse(await readFile(process.argv[2], 'utf8'));
const stop = JSON.parse(await readFile(process.argv[3], 'utf8'));
const dir = 'docs/route-r02';
await mkdir(dir, { recursive: true });
const now = Date.now(),
  sources = {
    LOG31AW: {
      pair: ['ABZ', 'MAN'],
      url: 'https://wwnbg.flightera.net/en/airport/Aberdeen/EGPD/departure',
      title: 'Dated Aberdeen departure board',
      fact: '11 November 2026: LM27 / LOG31AW scheduled ABZ–MAN at 18:15 GMT.',
    },
    LOG17ZA: {
      pair: ['INV', 'MAN'],
      url: 'https://wwnbg.flightera.net/en/airport/Inverness/EGPE/departure',
      title: 'Dated Inverness departure board',
      fact: '11 November 2026: LM597 / LOG17ZA scheduled INV–MAN at 17:55 GMT.',
    },
    EZY64RF: {
      pair: ['BFS', 'STN'],
      url: 'https://useast.flightera.net/en/airport/Belfast/EGAA/departure',
      title: 'Dated Belfast departure board',
      fact: '11 November 2026: U245 / EZY64RF scheduled BFS–STN at 18:55 GMT.',
    },
    EAI19MS: {
      pair: ['MAN', 'DUB'],
      url: 'https://useast.flightera.net/en/airport/Manchester/EGCC/departure',
      title: 'Dated Manchester departure board',
      fact: '11 November 2026: EI3327 / EAI19MS scheduled MAN–DUB at 19:15 GMT.',
    },
    EZY387T: {
      pair: ['LGW', 'BFS'],
      url: 'https://useast.flightera.net/fr/airport/Belfast/EGAA/arrival',
      title: 'Dated Belfast arrival board',
      fact: '11 November 2026: U2831 / EZY387T listed from LGW to BFS, scheduled arrival 20:10 GMT.',
    },
    RYR1AC: {
      pair: ['FCO', 'DUB'],
      url: 'https://wwnbg.flightera.net/en/airport/Dublin/EIDW/arrival',
      title: 'Dated Dublin arrival board',
      fact: '11 November 2026: FR9612 / RYR1AC listed from FCO to DUB, scheduled arrival 19:50 GMT.',
    },
    EZY86NE: {
      pair: ['MAD', 'EDI'],
      url: 'https://useast.flightera.net/en/airport/Madrid/LEMD/departure',
      title: 'Dated Madrid departure board',
      fact: '11 November 2026: U23210 / EZY86NE listed MAD–EDI. These are schedule fields, not proof of the flown route.',
    },
    EZY208N: {
      pair: ['BRS', 'GLA'],
      url: 'https://useast.flightera.net/en/airport/Bristol/EGGD/departure',
      title: 'Dated Bristol departure board',
      fact: '11 November 2026: U2203 / EZY208N scheduled BRS–GLA at 19:15 GMT.',
    },
    EZY465Y: {
      pair: ['MAN', 'BFS'],
      url: 'https://useast.flightera.net/en/airport/Manchester/EGCC/departure',
      title: 'Dated Manchester departure board',
      fact: '11 November 2026: U2707 / EZY465Y scheduled MAN–BFS at 19:25 GMT.',
    },
    RYR82JD: {
      pair: ['MAN', 'ORK'],
      url: 'https://useast.flightera.net/en/airport/Manchester/EGCC/departure',
      title: 'Dated Manchester departure board',
      fact: '11 November 2026: FR1863 / RYR82JD scheduled MAN–ORK at 19:05 GMT.',
    },
    SHT7P: {
      pair: ['GLA', 'LHR'],
      url: 'https://wwnbg.flightera.net/en/airport/Glasgow/EGPF/departure',
      title: 'Dated Glasgow departure board',
      fact: '11 November 2026: BA1489 / SHT7P scheduled GLA–LHR at 19:15 GMT.',
    },
    SHT19B: {
      pair: ['ABZ', 'LHR'],
      url: 'https://planefinder.net/data/flight/BA1315/history/5-2605748',
      title: 'Plane Finder BA1315 dated upcoming table',
      fact: 'The 11 November 2026 upcoming row lists ABZ–LHR, 19:10–20:40 GMT, G-EUYH, under flight BA1315 / SHT19B. The page header describes another flight in January 2025; that header is NOT evidence for this case.',
      airframe: 'G-EUYH',
    },
    EAG18C: {
      pair: ['BHD', 'MAN'],
      url: 'https://wwnbg.flightera.net/en/airport/Manchester/EGCC/arrival',
      title: 'Dated Manchester arrival board',
      fact: '11 November 2026: EI3618 / EAG18C listed BHD–MAN, scheduled arrival 19:25 GMT, marked delayed.',
    },
  };
const cases = collection.cases.map((c) => {
  const s = sources[c.callsign];
  const independent = {
    scope: 'unverified',
    verdict: 'unverified',
    confidence: 'unverified',
    evidence: [],
    note: 'No reliable independent match to this observed flight was established. Please check its aircraft, date and time in FR24.',
  };
  if (s) {
    const matches =
      c.origin?.iata === s.pair[0] && c.destination?.iata === s.pair[1];
    independent.scope =
      s.airframe === c.registration
        ? 'same-aircraft-date'
        : 'same-flight-date';
    independent.verdict = matches ? 'same-route' : 'different-route';
    independent.confidence = 'limited';
    independent.evidence = [
      { url: s.url, title: s.title, accessedAtMs: now },
    ];
    independent.note =
      s.fact +
      ' Limited schedule support only: completion/current flown route and data independence from HexDB are not established. This is excluded from accuracy counts until a stronger flight-specific check.';
  } else if (c.callsign === 'SHT9Q') {
    independent.scope = 'general-association';
    independent.evidence = [
      {
        url: 'https://yaft.live/regnr/G-EUYU',
        title: 'Different-date / different-airframe association',
        accessedAtMs: now,
      },
    ];
    independent.note =
      'Public results associate SHT9Q with EDI–LHR on 28 October 2026 using G-EUYU. This case was G-TTSJ on 11 November; the other flight is not corroboration.';
  }
  return { ...c, independent };
});
if (cases.length < 1 || cases.length > 20)
  throw Error('Bounded real cases required');
// Interleave research groups, without adding/repeating any aircraft/flight.
const order = [
  'historical-180-365',
  'historical-over-365',
  'recent-0-180',
  'missing-unusable',
];
const queues = order.map((g) => cases.filter((c) => c.ageCategory === g));
const interleaved = [];
while (queues.some((q) => q.length))
  for (const q of queues) if (q.length) interleaved.push(q.shift());
const data = {
  schemaVersion: 1,
  id: 'r02-2026-11-11',
  revision: 1,
  fingerprint: createHash('sha256')
    .update(canonical(interleaved))
    .digest('hex'),
  createdAtMs: now,
  observationWindow: {
    fromMs: collection.startedAtMs,
    toMs: stop.stopRequestedAtMs,
  },
  sourceBaseline: '465eb5cb483d681d2bbfb9c2d1cf6c40f4df6527',
  policyDays: 180,
  cases: interleaved,
};
if (!parseReviewDataset(data))
  throw Error('Frozen case schema/privacy validation failed');
await writeFile(dir + '/cases.json', JSON.stringify(data, null, 2) + '\n');
await writeFile(
  'server/routeReviewCases.ts',
  "import type { ReviewDataset } from '../src/routeReviewModel.js';\n// Frozen R02 study only. No live observations or configuration are read here.\nexport const routeReviewCases: ReviewDataset = " +
    JSON.stringify(data, null, 2) +
    ';\n',
);
await writeFile(
  dir + '/raw-collection.json',
  JSON.stringify(collection, null, 2) + '\n',
);
await writeFile(
  dir + '/collection-status.json',
  JSON.stringify(
    {
      ...stop,
      observerStopped: true,
      observerExitCode: 130,
      intentionalStop: true,
      collectorDefaultStopReason: collection.stopReason,
      note: 'The sampler was deliberately interrupted between requests after sufficient cases. This status supersedes its default time-limit label; no measurements were changed.',
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  dir + '/initial-analysis.json',
  JSON.stringify(analyseReview(data), null, 2) + '\n',
);
await writeFile(
  dir + '/independent-checks.json',
  JSON.stringify(
    {
      checkedOn: '2026-11-11 UTC',
      method:
        'Permitted public web/document searches. No automated FR24 scraping or authenticated-account circumvention.',
      queries: cases.map(
        (c) =>
          '"' + c.callsign + '" "11 Nov 2026" -site:flightradar24.com',
      ),
      sourceFacts: sources,
      blocked: [
        {
          url: 'https://www.flightaware.com/live/flight/LOG31AW/history/20261111',
          result:
            'Not accessible through web tool; no bypass/retry via another account or mirror.',
        },
        {
          url: 'https://www.flightaware.com/live/flight/LOG17ZA/history/20261111',
          result:
            'Not accessible through web tool; no bypass/retry via another account or mirror.',
        },
      ],
      limitedScheduleSupports: cases.filter(
        (c) => c.independent.confidence === 'limited',
      ).length,
      confirmedActualFlightRouteMatches: 0,
      confirmedActualFlightRouteMismatches: 0,
      note: 'Sources list schedules or other dates. Source independence from HexDB is not established. Do not count these as accurate observed-flight routes.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    cases: data.cases.length,
    groups: Object.fromEntries(
      order.map((g) => [
        g,
        data.cases.filter((c) => c.ageCategory === g).length,
      ]),
    ),
    fingerprint: data.fingerprint,
    limitedScheduleSupports: cases.filter(
      (c) => c.independent.confidence === 'limited',
    ).length,
    historicalCandidates: analyseReview(data).historicalCandidates,
  }),
);

// Frozen research cases and local human verdicts. No tracking/enrichment imports.
export const AGE_CATEGORIES = [
  'recent-0-180',
  'historical-180-365',
  'historical-over-365',
  'missing-unusable',
] as const;
export type AgeCategory = (typeof AGE_CATEGORIES)[number];
export const VERDICTS = [
  'same-route',
  'different-route',
  'no-route-available',
  'unable-to-verify',
] as const;
export type Verdict = (typeof VERDICTS)[number];
export const MATCH_SCOPES = [
  'not-matched',
  'same-aircraft-date',
  'same-flight-date',
  'different-date',
] as const;
export type MatchScope = (typeof MATCH_SCOPES)[number];
export interface ReviewAirport {
  code: string;
  iata: string | null;
  icao: string | null;
  name: string;
}
export interface IndependentFinding {
  scope:
    | 'unverified'
    | 'same-aircraft-date'
    | 'same-flight-date'
    | 'different-date'
    | 'general-association';
  verdict:
    | 'unverified'
    | 'same-route'
    | 'different-route'
    | 'no-route-available';
  confidence: 'unverified' | 'corroborated' | 'limited';
  evidence: Array<{ url: string; title: string; accessedAtMs: number }>;
  note: string;
}
export interface ReviewCase {
  id: string;
  hex: string;
  callsign: string;
  registration: string | null;
  model: string | null;
  typeCode: string | null;
  observedAtMs: number;
  providerObservedAtMs: number;
  aircraftPositionAtMs: number | null;
  lookedUpAtMs: number;
  endpoint: string;
  httpStatus: number | null;
  source: 'hexdb.io';
  providerRequestStarted: boolean;
  updatedAtRaw: string | null;
  associationTimeMs: number | null;
  associationAgeDays: number | null;
  ageCategory: AgeCategory;
  origin: ReviewAirport | null;
  destination: ReviewAirport | null;
  operationalOutcome: string;
  operationalReason: string;
  structuralReason: string;
  callsignMatches: boolean | null;
  timestampValid: boolean;
  completeIataPair: boolean;
  independent: IndependentFinding;
}
export interface ReviewDataset {
  schemaVersion: 1;
  id: string;
  revision: number;
  fingerprint: string;
  createdAtMs: number;
  observationWindow: { fromMs: number; toMs: number };
  sourceBaseline: string;
  policyDays: 180;
  cases: ReviewCase[];
}
export interface ReviewAnswer {
  verdict: Verdict;
  matchScope: MatchScope;
  originCode: string;
  destinationCode: string;
  notes: string;
  evidenceUrl: string;
  revision: number;
  updatedAtMs: number;
}
export interface ReviewDraft {
  schemaVersion: 1;
  datasetId: string;
  fingerprint: string;
  index: number;
  answers: Record<string, ReviewAnswer>;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const str = (v: unknown, max: number) =>
  typeof v === 'string' && v.length <= max;
const stamp = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullableString = (v: unknown, max: number) =>
  v === null || str(v, max);
const nullableStamp = (v: unknown) => v === null || stamp(v);
export function safeEvidenceUrl(value: string) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      value.length <= 800
    );
  } catch {
    return false;
  }
}
function airport(v: unknown) {
  if (v === null) return true;
  return (
    object(v) &&
    keys(v, ['code', 'iata', 'icao', 'name']) &&
    str(v.name, 160) &&
    typeof v.code === 'string' &&
    /^[A-Z]{3,4}$/.test(v.code) &&
    (v.iata === null ||
      (typeof v.iata === 'string' && /^[A-Z]{3}$/.test(v.iata))) &&
    (v.icao === null ||
      (typeof v.icao === 'string' && /^[A-Z]{4}$/.test(v.icao))) &&
    (v.code === v.iata || v.code === v.icao)
  );
}
export function validReviewCase(v: unknown): v is ReviewCase {
  if (
    !object(v) ||
    !keys(v, [
      'id',
      'hex',
      'callsign',
      'registration',
      'model',
      'typeCode',
      'observedAtMs',
      'providerObservedAtMs',
      'aircraftPositionAtMs',
      'lookedUpAtMs',
      'endpoint',
      'httpStatus',
      'source',
      'providerRequestStarted',
      'updatedAtRaw',
      'associationTimeMs',
      'associationAgeDays',
      'ageCategory',
      'origin',
      'destination',
      'operationalOutcome',
      'operationalReason',
      'structuralReason',
      'callsignMatches',
      'timestampValid',
      'completeIataPair',
      'independent',
    ])
  )
    return false;
  const i = v.independent;
  return (
    typeof v.id === 'string' &&
    /^r02-[a-f0-9]{12}$/.test(v.id) &&
    typeof v.hex === 'string' &&
    /^[a-f0-9]{6}$/.test(v.hex) &&
    typeof v.callsign === 'string' &&
    /^[A-Z0-9]{2,8}$/.test(v.callsign) &&
    nullableString(v.registration, 24) &&
    nullableString(v.model, 160) &&
    nullableString(v.typeCode, 12) &&
    stamp(v.observedAtMs) &&
    stamp(v.providerObservedAtMs) &&
    nullableStamp(v.aircraftPositionAtMs) &&
    stamp(v.lookedUpAtMs) &&
    v.endpoint === 'https://hexdb.io/api/v2/routes/{callsign}' &&
    (v.httpStatus === null ||
      (typeof v.httpStatus === 'number' &&
        Number.isInteger(v.httpStatus) &&
        v.httpStatus >= 100 &&
        v.httpStatus <= 599)) &&
    v.source === 'hexdb.io' &&
    typeof v.providerRequestStarted === 'boolean' &&
    nullableString(v.updatedAtRaw, 120) &&
    nullableStamp(v.associationTimeMs) &&
    (v.associationAgeDays === null ||
      (typeof v.associationAgeDays === 'number' &&
        Number.isFinite(v.associationAgeDays))) &&
    AGE_CATEGORIES.includes(v.ageCategory as AgeCategory) &&
    airport(v.origin) &&
    airport(v.destination) &&
    str(v.operationalOutcome, 40) &&
    str(v.operationalReason, 80) &&
    str(v.structuralReason, 80) &&
    (v.callsignMatches === null ||
      typeof v.callsignMatches === 'boolean') &&
    typeof v.timestampValid === 'boolean' &&
    typeof v.completeIataPair === 'boolean' &&
    object(i) &&
    keys(i, ['scope', 'verdict', 'confidence', 'evidence', 'note']) &&
    [
      'unverified',
      'same-aircraft-date',
      'same-flight-date',
      'different-date',
      'general-association',
    ].includes(String(i.scope)) &&
    [
      'unverified',
      'same-route',
      'different-route',
      'no-route-available',
    ].includes(String(i.verdict)) &&
    ['unverified', 'corroborated', 'limited'].includes(
      String(i.confidence),
    ) &&
    str(i.note, 1800) &&
    Array.isArray(i.evidence) &&
    i.evidence.length <= 4 &&
    i.evidence.every(
      (e) =>
        object(e) &&
        keys(e, ['url', 'title', 'accessedAtMs']) &&
        typeof e.url === 'string' &&
        !!e.url &&
        safeEvidenceUrl(e.url) &&
        str(e.title, 180) &&
        stamp(e.accessedAtMs),
    )
  );
}
export function parseReviewDataset(v: unknown): ReviewDataset | null {
  if (
    !object(v) ||
    !keys(v, [
      'schemaVersion',
      'id',
      'revision',
      'fingerprint',
      'createdAtMs',
      'observationWindow',
      'sourceBaseline',
      'policyDays',
      'cases',
    ]) ||
    v.schemaVersion !== 1 ||
    typeof v.id !== 'string' ||
    !/^r02-[a-z0-9-]{1,50}$/.test(v.id) ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 1 ||
    typeof v.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.fingerprint) ||
    !stamp(v.createdAtMs) ||
    !object(v.observationWindow) ||
    !keys(v.observationWindow, ['fromMs', 'toMs']) ||
    !stamp(v.observationWindow.fromMs) ||
    !stamp(v.observationWindow.toMs) ||
    v.observationWindow.toMs < v.observationWindow.fromMs ||
    typeof v.sourceBaseline !== 'string' ||
    !/^[a-f0-9]{40}$/.test(v.sourceBaseline) ||
    v.policyDays !== 180 ||
    !Array.isArray(v.cases) ||
    v.cases.length > 20 ||
    !v.cases.every(validReviewCase)
  )
    return null;
  const ids = new Set(v.cases.map((c) => c.id)),
    flights = new Set(v.cases.map((c) => c.hex + ':' + c.callsign));
  return ids.size === v.cases.length && flights.size === v.cases.length
    ? (v as unknown as ReviewDataset)
    : null;
}
export function validAnswer(v: unknown): v is ReviewAnswer {
  return (
    object(v) &&
    keys(v, [
      'verdict',
      'matchScope',
      'originCode',
      'destinationCode',
      'notes',
      'evidenceUrl',
      'revision',
      'updatedAtMs',
    ]) &&
    VERDICTS.includes(v.verdict as Verdict) &&
    MATCH_SCOPES.includes(v.matchScope as MatchScope) &&
    typeof v.originCode === 'string' &&
    /^[A-Z]{0,4}$/.test(v.originCode) &&
    typeof v.destinationCode === 'string' &&
    /^[A-Z]{0,4}$/.test(v.destinationCode) &&
    str(v.notes, 1000) &&
    str(v.evidenceUrl, 800) &&
    Number.isSafeInteger(v.revision) &&
    (v.revision as number) >= 1 &&
    stamp(v.updatedAtMs)
  );
}
export const exactMatch = (a: ReviewAnswer) =>
  a.matchScope === 'same-aircraft-date' ||
  a.matchScope === 'same-flight-date';
export const draftKey = (d: ReviewDataset) =>
  'aero-pane.route-review.' + d.id + '.' + d.fingerprint;
export function emptyDraft(d: ReviewDataset): ReviewDraft {
  return {
    schemaVersion: 1,
    datasetId: d.id,
    fingerprint: d.fingerprint,
    index: 0,
    answers: {},
  };
}
export function parseDraft(
  v: unknown,
  d: ReviewDataset,
): ReviewDraft | null {
  if (
    !object(v) ||
    !keys(v, [
      'schemaVersion',
      'datasetId',
      'fingerprint',
      'index',
      'answers',
    ]) ||
    v.schemaVersion !== 1 ||
    v.datasetId !== d.id ||
    v.fingerprint !== d.fingerprint ||
    !Number.isInteger(v.index) ||
    (v.index as number) < 0 ||
    (v.index as number) >= Math.max(1, d.cases.length) ||
    !object(v.answers) ||
    Object.keys(v.answers).length > d.cases.length
  )
    return null;
  const ids = new Set(d.cases.map((c) => c.id));
  if (
    Object.entries(v.answers).some(
      ([k, a]) => !ids.has(k) || !validAnswer(a),
    )
  )
    return null;
  return v as unknown as ReviewDraft;
}
export function fr24AircraftLink(c: ReviewCase) {
  const r = c.registration?.trim();
  return r && /^[A-Z0-9][A-Z0-9-]{1,20}$/i.test(r)
    ? 'https://www.flightradar24.com/data/aircraft/' + r.toLowerCase()
    : null;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value))
    return '[' + value.map(canonical).join(',') + ']';
  if (object(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function reviewExport(
  d: ReviewDataset,
  draft: ReviewDraft,
  now = Date.now(),
) {
  const reviewed = Object.keys(draft.answers).length;
  return {
    schemaVersion: 1,
    kind: 'aero-pane-route-review',
    datasetId: d.id,
    datasetRevision: d.revision,
    datasetFingerprint: d.fingerprint,
    exportedAtMs: now,
    complete: reviewed === d.cases.length && d.cases.length > 0,
    cases: d.cases.map((c) => ({
      case: c,
      answer: draft.answers[c.id] ?? null,
    })),
    summary: {
      cases: d.cases.length,
      reviewed,
      exactDateMatches: Object.values(draft.answers).filter(
        (a) => a.verdict !== 'unable-to-verify' && exactMatch(a),
      ).length,
    },
  };
}
export function importReview(
  v: unknown,
  d: ReviewDataset,
): ReviewDraft | null {
  if (
    !object(v) ||
    !keys(v, [
      'schemaVersion',
      'kind',
      'datasetId',
      'datasetRevision',
      'datasetFingerprint',
      'exportedAtMs',
      'complete',
      'cases',
      'summary',
    ]) ||
    v.schemaVersion !== 1 ||
    v.kind !== 'aero-pane-route-review' ||
    v.datasetId !== d.id ||
    v.datasetRevision !== d.revision ||
    v.datasetFingerprint !== d.fingerprint ||
    !stamp(v.exportedAtMs) ||
    typeof v.complete !== 'boolean' ||
    !Array.isArray(v.cases) ||
    v.cases.length !== d.cases.length
  )
    return null;
  const draft = emptyDraft(d),
    seen = new Set<string>();
  for (const row of v.cases) {
    if (
      !object(row) ||
      !keys(row, ['case', 'answer']) ||
      !validReviewCase(row.case) ||
      seen.has(row.case.id)
    )
      return null;
    const item = row.case;
    const original = d.cases.find((c) => c.id === item.id);
    if (
      !original ||
      canonical(original) !== canonical(item) ||
      (row.answer !== null && !validAnswer(row.answer))
    )
      return null;
    seen.add(item.id);
    if (row.answer) draft.answers[item.id] = row.answer as ReviewAnswer;
  }
  return draft;
}
export function mergeReviewExports(values: unknown[], d: ReviewDataset) {
  const answers: Record<string, ReviewAnswer> = {},
    conflicts = new Set<string>();
  for (const value of values) {
    const incoming = importReview(value, d);
    if (!incoming) throw Error('Invalid file or different case set');
    for (const [id, a] of Object.entries(incoming.answers)) {
      const old = answers[id];
      // Ignore export timestamps/revisions when a verdict is genuinely identical.
      const content = (x: ReviewAnswer) => ({
        verdict: x.verdict,
        matchScope: x.matchScope,
        originCode: x.originCode,
        destinationCode: x.destinationCode,
        notes: x.notes,
        evidenceUrl: x.evidenceUrl,
      });
      if (old && canonical(content(old)) !== canonical(content(a)))
        conflicts.add(id);
      else if (!old || a.revision > old.revision) answers[id] = a;
    }
  }
  return { answers, conflicts: [...conflicts] };
}

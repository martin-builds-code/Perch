// Inert R02 acquisition audit helpers. The final endpoint is a 404 tombstone.
// Never grants an application/PIN session or calls a provider.
import { createHash, timingSafeEqual } from 'node:crypto';
import { normaliseHexdb } from './hexdb.js';
import type { ProviderTrace } from '../src/routeTraceTypes.js';
import type { EnrichedAirport } from '../src/enrichmentTypes.js';
export const RESEARCH_PROJECT = 'prj_QU4OICxi2QPrRtK0JS83ZTaLP9bW';
export function isolatedPreview(env = process.env) {
  return (
    env.VERCEL === '1' &&
    env.VERCEL_ENV === 'preview' &&
    (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === 'preview') &&
    env.VERCEL_PROJECT_ID === RESEARCH_PROJECT
  );
}
export function capturePolicy(env = process.env, now = Date.now()) {
  if (!isolatedPreview(env)) return null;
  try {
    const p = JSON.parse(env.AERO_ROUTE_RESEARCH ?? 'null');
    if (
      !p ||
      p.enabled !== true ||
      !/^[a-f0-9]{64}$/.test(p.digest) ||
      !Number.isSafeInteger(p.startedAtMs) ||
      !Number.isSafeInteger(p.expiresAtMs) ||
      p.expiresAtMs <= p.startedAtMs ||
      p.expiresAtMs - p.startedAtMs > 3600000 ||
      !Number.isFinite(now) ||
      now < p.startedAtMs ||
      now >= p.expiresAtMs
    )
      return null;
    return {
      digest: p.digest as string,
      expiresAtMs: p.expiresAtMs as number,
    };
  } catch {
    return null;
  }
}
export function researchAuthorised(
  header: string | undefined,
  env = process.env,
  now = Date.now(),
) {
  const p = capturePolicy(env, now);
  if (!p || !header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header))
    return false;
  const actual = createHash('sha256').update(header.slice(7)).digest();
  return timingSafeEqual(actual, Buffer.from(p.digest, 'hex'));
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const endpoint = 'https://hexdb.io/api/v2/routes/{callsign}';
export function inspectAssociation(
  hex: string,
  callsign: string,
  raw: unknown,
  trace: ProviderTrace,
  atMs: number,
) {
  const updatedAtRaw = obj(raw) ? string(raw.updated_at, 120) : null;
  const parsed = updatedAtRaw === null ? NaN : Date.parse(updatedAtRaw);
  const associationTimeMs = Number.isFinite(parsed) ? parsed : null;
  const associationAgeDays =
    associationTimeMs === null
      ? null
      : (atMs - associationTimeMs) / 86400000;
  let candidate: {
    origin?: EnrichedAirport;
    destination?: EnrichedAirport;
  } | null = null;
  let structuralReason = 'no-provider-route';
  if (obj(raw)) {
    try {
      // Offline structural inspection. Operational normaliseHexdb still enforces
      // 180 days. This value NEVER enters the enrichment cache.
      candidate = normaliseHexdb(
        'route',
        hex,
        callsign,
        { ...raw, updated_at: null },
        atMs,
      );
      structuralReason =
        candidate?.origin && candidate.destination
          ? 'complete-pair'
          : 'incomplete-pair';
    } catch (e) {
      structuralReason =
        e instanceof Error ? e.message : 'invalid-structure';
    }
  }
  const safeAirport = (v: EnrichedAirport | undefined) =>
    v ? { code: v.code, iata: v.iata, icao: v.icao, name: v.name } : null;
  const complete =
    !!candidate?.origin?.iata && !!candidate.destination?.iata;
  const ageCategory =
    !complete || associationAgeDays === null || associationAgeDays < 0
      ? 'missing-unusable'
      : associationAgeDays <= 180
        ? 'recent-0-180'
        : associationAgeDays <= 365
          ? 'historical-180-365'
          : 'historical-over-365';
  return {
    hex,
    callsign,
    lookedUpAtMs: atMs,
    endpoint,
    httpStatus: trace.httpStatus,
    updatedAtRaw,
    associationTimeMs,
    associationAgeDays,
    ageCategory,
    origin: safeAirport(candidate?.origin),
    destination: safeAirport(candidate?.destination),
    operationalOutcome: trace.outcome,
    operationalReason: trace.reason,
    structuralReason,
    callsignMatches: obj(raw) ? raw.callsign === callsign : null,
    timestampValid:
      associationTimeMs !== null && associationTimeMs <= atMs,
    source: 'hexdb.io',
    completeIataPair: complete,
  };
}
export type CapturedAssociation = ReturnType<typeof inspectAssociation>;

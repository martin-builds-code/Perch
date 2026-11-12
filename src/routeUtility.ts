import type { Aircraft } from './simulation';
export type AircraftCategory =
  | 'commercial-jet'
  | 'regional'
  | 'general-aviation'
  | 'helicopter'
  | 'unknown';
// Small, explicit presentation-data hints; not an operator or route database.
export function aircraftCategory(
  a: Pick<Aircraft, 'typeCode' | 'manufacturer' | 'model'>,
): AircraftCategory {
  const t = a.typeCode?.toUpperCase() ?? '',
    text = ((a.manufacturer ?? '') + ' ' + (a.model ?? '')).toUpperCase();
  if (
    /^(H[0-9]|EC[0-9]|AS[0-9]|R22|R44|R66|B06|B407|B429|AW[0-9]|A109|A139|A169|S76)/.test(
      t,
    ) ||
    /HELICOPTER/.test(text)
  )
    return 'helicopter';
  if (
    /^(A3[0-9A-Z]{2}|B7[0-9A-Z]{2}|B38M|B39M|B3XM|B3X1)/.test(t) ||
    /^(AIRBUS A3|BOEING 7)/.test(text)
  )
    return 'commercial-jet';
  if (
    /^(AT[0-9A-Z]{2}|DH8[A-D]|E1[0-9]{2}|E29[0-9]|CRJ[0-9]|SF34)/.test(
      t,
    ) ||
    /^(ATR |EMBRAER ERJ|DE HAVILLAND)/.test(text)
  )
    return 'regional';
  if (
    /^(C1[0-9]{2}|C2[0-9]{2}|PA[0-9A-Z]{2}|P28A|SR2[02]|DA[0-9A-Z]{2}|CL[0-9A-Z]{2}|GL[0-9A-Z]{2}|PC12|LJ[0-9A-Z]{2})/.test(
      t,
    ) ||
    /^(CESSNA|PIPER|BOMBARDIER|CIRRUS)/.test(text)
  )
    return 'general-aviation';
  return 'unknown';
}
export const ROUTE_UTILITY_HINT = {
  'commercial-jet': 1.1,
  regional: 1.05,
  'general-aviation': 0.9,
  helicopter: 0.85,
  unknown: 1,
} as const;
export function routeUtilityHint(a: Aircraft) {
  // No probability/success-rate claim. Small modifiers cannot exclude a category.
  const sameAsRegistration=a.registration && a.callsign && a.registration.replace(/[^A-Z0-9]/gi,'').toUpperCase()===a.callsign.replace(/[^A-Z0-9]/gi,'').toUpperCase();
  return Math.max(.85, ROUTE_UTILITY_HINT[aircraftCategory(a)]*(sameAsRegistration?.9:1));
}

import suppliedManifest from './artwork/manifest.json';
import type { Aircraft } from './simulation';

export interface ArtworkAsset {
  id: string;
  label: string;
  approval: string;
  src: string | null;
  webp?: string;
  width: number;
  height: number;
  typeCodes?: string[];
  families?: string[];
  frame?: { x: number; y: number; width: number; height: number };
}
export interface ArtworkManifest {
  version: number;
  aircraft: ArtworkAsset[];
  clouds: ArtworkAsset;
}
export const artworkManifest: ArtworkManifest = suppliedManifest;

export function aircraftName(a: Aircraft) {
  return (
    [a.manufacturer, a.model].filter(Boolean).join(' ') ||
    'Unidentified aircraft'
  );
}

// Exact known model families only. These are presentation fallbacks, never new
// identification/enrichment, and never inferred from a registration or callsign.
export function aircraftFamily(a: Aircraft) {
  if (
    /^(A318|A319|A320|A321|A19N|A20N|A21N|B73[0-9M]|B37M|B38M|B39M|B3XM)$/.test(
      a.typeCode ?? '',
    ) ||
    /^(Airbus A(?:318|319|320|321)|Boeing 737)(?:\b|neo)/i.test(aircraftName(a))
  )
    return 'narrow-body';
  return 'unknown';
}

export function approvedAsset(
  asset: ArtworkAsset | undefined,
): asset is ArtworkAsset {
  const frame = asset?.frame;
  return (
    !!asset &&
    asset.approval === 'approved' &&
    Number.isInteger(asset.width) &&
    Number.isInteger(asset.height) &&
    asset.width > 0 &&
    asset.height > 0 &&
    /^\/aircraft\/[a-z0-9][a-z0-9/_-]*\.(png|webp)$/.test(asset.src ?? '') &&
    (!asset.webp ||
      /^\/aircraft\/[a-z0-9][a-z0-9/_-]*\.webp$/.test(asset.webp)) &&
    (!frame ||
      ([frame.x, frame.y, frame.width, frame.height].every(Number.isInteger) &&
        frame.x >= 0 &&
        frame.y >= 0 &&
        frame.width > 0 &&
        frame.height > 0 &&
        frame.x + frame.width <= asset.width &&
        frame.y + frame.height <= asset.height))
  );
}

export function artworkFor(a: Aircraft, manifest = artworkManifest) {
  const approved = manifest.aircraft.filter(approvedAsset);
  const exact = approved.find(
    (asset) => !!a.typeCode && asset.typeCodes?.includes(a.typeCode),
  );
  // The current presentation already supplies readable manufacturer/model names.
  // Permit the known A380 description when no ICAO type has been carried through.
  const described = /^Airbus A380-800$/i.test(aircraftName(a))
    ? approved.find((asset) => asset.typeCodes?.includes('A388'))
    : undefined;
  return (
    exact ??
    described ??
    approved.find((asset) => asset.families?.includes(aircraftFamily(a)))
  );
}

export function prominentRoute(a: Aircraft) {
  const code = (airport: Aircraft['origin']) => {
    if (!airport) return null;
    // Explicit IATA metadata wins; a four-letter ICAO code is never shortened.
    const value = airport.iata === undefined ? airport.code : airport.iata;
    return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
  };
  const from = code(a.origin),
    to = code(a.destination);
  return from && to
    ? { from, to, fromName: a.origin?.name, toName: a.destination?.name }
    : null;
}

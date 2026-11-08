import suppliedManifest from './artwork/manifest.json';
import type { Aircraft } from './simulation';

export interface ArtworkPlacement {
  width: number;
  left: number;
  top: number;
}

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
  // One presentation-only placement per viewport, shared by every layout mode.
  placement?: { regular: ArtworkPlacement; compact: ArtworkPlacement };
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

// Remove only known redundant technical/category wording. The actual model is
// retained in the primary header and the secondary title; no type is guessed.
export function secondaryName(a: Aircraft) {
  const full = aircraftName(a);
  if (/^Bombardier BD-100 Challenger 350$/i.test(full))
    return 'Bombardier Challenger 350';
  if (
    /^Bombardier BD-700-2A12 Global 7500(?: Ultra Long Range Business Jet)?$/i.test(
      full,
    )
  )
    return 'Bombardier Global 7500';
  return full;
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
  const a380 =
    a.typeCode === 'A388' || /^Airbus A380(?:[-\s]|$)/i.test(aircraftName(a));
  // The generic jet is an intentionally universal visual placeholder. It never
  // changes the real manufacturer/model or infers an aircraft type/operator.
  return (
    (a380
      ? approved.find((asset) => asset.typeCodes?.includes('A388'))
      : undefined) ??
    approved.find((asset) => asset.id === 'generic-narrow-body')
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

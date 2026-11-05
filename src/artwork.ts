import suppliedManifest from './artwork/manifest.json';
import type { Aircraft } from './simulation';

export interface ArtworkPlacement {
  width: number;
  left: number;
  top: number;
  bottom: number;
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
  // How far the separate cloud strip overlaps the aircraft frame, as a fraction
  // of framed width. Both layers then share one uniform composition transform.
  cloudOverlap?: number;
  // Presentation only, relative to the card in CSS pixels. Top/bottom bound the
  // available viewport; both image layers scale together inside it.
  multiAircraft?: { regular: ArtworkPlacement; compact: ArtworkPlacement };
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

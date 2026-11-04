import { useState } from 'react';
import type { ArtworkAsset } from './artwork';
import { approvedAsset } from './artwork';

function Layer({
  asset,
  className,
}: {
  asset: ArtworkAsset;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const [png, setPng] = useState(false);
  const frame = asset.frame ?? {
    x: 0,
    y: 0,
    width: asset.width,
    height: asset.height,
  };
  // Only the raster's verified transparent padding is framed away. The source
  // artwork remains byte-identical; SVG meet scaling preserves its proportions.
  return failed ? null : (
    <svg
      className={className}
      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      preserveAspectRatio="xMaxYMax meet"
      aria-hidden="true"
      focusable="false"
    >
      <image
        href={!png && asset.webp ? asset.webp : asset.src!}
        width={asset.width}
        height={asset.height}
        onError={() => {
          if (!png && asset.webp) setPng(true);
          else setFailed(true);
        }}
      />
    </svg>
  );
}
export function AircraftArtwork({
  asset,
  clouds,
}: {
  asset?: ArtworkAsset;
  clouds?: ArtworkAsset;
}) {
  return (
    <div
      className={
        'artwork-stage ' + (asset ? 'has-artwork' : 'awaiting-artwork')
      }
      aria-hidden="true"
    >
      {approvedAsset(clouds) ? (
        <Layer key={clouds.src} asset={clouds} className="cloud-layer" />
      ) : null}
      {asset ? (
        <Layer key={asset.src} asset={asset} className="aircraft-layer" />
      ) : (
        <span className="artwork-placeholder">Illustration unavailable</span>
      )}
    </div>
  );
}

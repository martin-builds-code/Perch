import { useState } from 'react';
import type { ArtworkAsset } from './artwork';

type Rectangle = { x: number; y: number; width: number; height: number };
const frameFor = (asset: ArtworkAsset): Rectangle =>
  asset.frame ?? {
    x: 0,
    y: 0,
    width: asset.width,
    height: asset.height,
  };

function Layer({
  asset,
  className,
}: {
  asset: ArtworkAsset;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const [png, setPng] = useState(false);
  const frame = frameFor(asset);
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
export function AircraftArtwork({ asset }: { asset?: ArtworkAsset }) {
  return (
    <div
      className={
        'artwork-stage ' + (asset ? 'has-artwork' : 'awaiting-artwork')
      }
      aria-hidden="true"
    >
      {asset ? (
        <Layer key={asset.src} asset={asset} className="aircraft-layer" />
      ) : (
        <span className="artwork-placeholder">Illustration unavailable</span>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { ArtworkAsset } from './artwork';
import { approvedAsset } from './artwork';

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
  canvas,
  placement,
  multiple,
}: {
  asset: ArtworkAsset;
  className: string;
  canvas: { width: number; height: number };
  placement: Rectangle;
  multiple: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [png, setPng] = useState(false);
  const frame = frameFor(asset);
  // Only the raster's verified transparent padding is framed away. The source
  // artwork remains byte-identical; SVG meet scaling preserves its proportions.
  return failed ? null : (
    <svg
      className={className}
      viewBox={`0 0 ${canvas.width} ${canvas.height}`}
      preserveAspectRatio={multiple ? 'xMaxYMax meet' : 'xMaxYMid meet'}
      aria-hidden="true"
      focusable="false"
    >
      <svg
        x={placement.x}
        y={placement.y}
        width={placement.width}
        height={placement.height}
        viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
        preserveAspectRatio="xMaxYMax meet"
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
    </svg>
  );
}
export function AircraftArtwork({
  asset,
  clouds,
  multiple = false,
}: {
  asset?: ArtworkAsset;
  clouds?: ArtworkAsset;
  multiple?: boolean;
}) {
  const frame = asset ? frameFor(asset) : undefined;
  const cloudFrame = approvedAsset(clouds) ? frameFor(clouds) : undefined;
  const overlap =
    typeof asset?.cloudOverlap === 'number' &&
    Number.isFinite(asset.cloudOverlap) &&
    asset.cloudOverlap >= 0 &&
    asset.cloudOverlap <= 0.5
      ? asset.cloudOverlap
      : 0.09;
  const width = frame?.width ?? 1;
  const cloudPlacement =
    cloudFrame && frame
      ? {
          x: 0,
          y: Math.max(0, frame.height - width * overlap),
          width,
          height: (width * cloudFrame.height) / cloudFrame.width,
        }
      : undefined;
  // Each independent SVG uses this same composition canvas. A constrained
  // viewport therefore scales/aligns both layers together, never separately.
  const canvas = {
    width,
    height: Math.max(
      frame?.height ?? 1,
      cloudPlacement ? cloudPlacement.y + cloudPlacement.height : 0,
    ),
  };
  return (
    <div
      className={
        'artwork-stage ' + (asset ? 'has-artwork' : 'awaiting-artwork')
      }
      aria-hidden="true"
    >
      {approvedAsset(clouds) && cloudPlacement ? (
        <Layer
          key={clouds.src}
          asset={clouds}
          className="cloud-layer"
          canvas={canvas}
          placement={cloudPlacement}
          multiple={multiple}
        />
      ) : null}
      {asset ? (
        <Layer
          key={asset.src}
          asset={asset}
          className="aircraft-layer"
          canvas={canvas}
          placement={{ x: 0, y: 0, width: frame!.width, height: frame!.height }}
          multiple={multiple}
        />
      ) : (
        <span className="artwork-placeholder">Illustration unavailable</span>
      )}
    </div>
  );
}

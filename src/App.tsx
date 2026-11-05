import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Aircraft, Scene } from './simulation';
import { altitude, distance, offsetFor, sceneAt, scenes } from './simulation';
import {
  aircraftName,
  artworkFor,
  artworkManifest,
  prominentRoute,
} from './artwork';
import type { ArtworkManifest } from './artwork';
import { AircraftArtwork } from './AircraftArtwork';

const stateLabels = {
  available: 'Demo data available',
  delayed: 'Data delayed · last sample',
  unavailable: 'Data unavailable',
  standby: 'No aircraft reported',
};
function Brand() {
  return (
    <div className="brand" aria-label="Aero Pane">
      <span className="brand-symbol" aria-hidden="true">
        A<span>·</span>P
      </span>
      <span>Aero Pane</span>
    </div>
  );
}
function Route({
  aircraft,
  composed,
}: {
  aircraft: Aircraft;
  composed: boolean;
}) {
  const route = prominentRoute(aircraft);
  const element = useRef<HTMLDivElement>(null);
  const from = route?.from,
    to = route?.to;
  useEffect(() => {
    const root = element.current;
    if (!composed || !root || !document.fonts) return;
    let disposed = false;
    // Fit only genuinely wide three-letter combinations, using the loaded font.
    // No polling/render loop; route changes, font readiness and resize suffice.
    const fitCodes = () => {
      if (disposed) return;
      const wanted = parseFloat(
        getComputedStyle(root).getPropertyValue('--route-code-size'),
      );
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx || !Number.isFinite(wanted)) return;
      ctx.font = `600 ${wanted}px "Barlow Condensed"`;
      let size = wanted;
      for (const code of root.querySelectorAll<HTMLElement>('.airport-code')) {
        if (code.clientWidth <= 2) return; // Hidden/portrait: refit on resize.
        const width = ctx.measureText(code.textContent || '').width + 3;
        size = Math.min(size, (wanted * (code.clientWidth - 2)) / width);
      }
      root.style.setProperty('--route-fitted-size', `${Math.floor(size)}px`);
    };
    void document.fonts.ready.then(fitCodes);
    window.addEventListener('resize', fitCodes);
    return () => {
      disposed = true;
      window.removeEventListener('resize', fitCodes);
      root.style.removeProperty('--route-fitted-size');
    };
  }, [composed, from, to]);
  return route ? (
    <div ref={element} className="route" aria-label="Reported route">
      <div className="airport">
        <span className="eyebrow">From</span>
        <div className="airport-code">{route.from}</div>
        <div className="airport-name" title={route.fromName}>
          {route.fromName || ''}
        </div>
      </div>
      <span className="route-connection" aria-hidden="true">
        →
      </span>
      <div className="airport">
        <span className="eyebrow">To</span>
        <div className="airport-code">{route.to}</div>
        <div className="airport-name" title={route.toName}>
          {route.toName || ''}
        </div>
      </div>
    </div>
  ) : null;
}
function Details({ aircraft }: { aircraft: Aircraft }) {
  const entries = [
    ['Callsign', aircraft.callsign],
    ['Registration', aircraft.registration],
    ['Direction', aircraft.direction],
  ].filter(([, value]) => value);
  return entries.length ? (
    <dl className="details">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  ) : null;
}
function Measurements({ aircraft }: { aircraft: Aircraft }) {
  return (
    <aside className="measurements" aria-label="Aircraft measurements">
      <div className="metric altitude">
        <span className="eyebrow">Barometric altitude</span>
        <div
          className={
            'metric-value ' +
            (aircraft.altitudeFt === null ? 'missing-value' : '')
          }
        >
          {aircraft.altitudeFt === null ? '—' : altitude(aircraft.altitudeFt)}
          {aircraft.altitudeFt !== null ? (
            <span className="unit">ft</span>
          ) : null}
        </div>
        {aircraft.altitudeFt === null ? (
          <span className="measurement-note">Not reported</span>
        ) : null}
      </div>
      <div className="metric">
        <span className="eyebrow">Horizontal distance</span>
        <div
          className={
            'metric-value distance ' +
            (aircraft.distanceKm === null ? 'missing-value' : '')
          }
        >
          {aircraft.distanceKm === null ? '—' : distance(aircraft.distanceKm)}
          {aircraft.distanceKm !== null ? (
            <span className="unit">km</span>
          ) : null}
        </div>
        {aircraft.distanceKm === null ? (
          <span className="measurement-note">Not reported</span>
        ) : null}
      </div>
    </aside>
  );
}
function Primary({
  aircraft,
  delayed,
  manifest,
  multiple,
}: {
  aircraft: Aircraft;
  delayed: boolean;
  manifest: ArtworkManifest;
  multiple: boolean;
}) {
  const name = aircraftName(aircraft);
  const asset = artworkFor(aircraft, manifest);
  const frame = asset?.frame ?? asset;
  // Panoramic silhouettes use the existing full-width lower region, rather
  // than becoming small in the side-by-side region used by taller artwork.
  const wideArtwork = frame ? frame.width / frame.height > 2.8 : false;
  const composition =
    multiple && prominentRoute(aircraft) ? asset?.multiAircraft : undefined;
  const placement =
    composition && frame
      ? ({
          '--regular-art-width': `${composition.regular.width}px`,
          '--regular-art-left': `${composition.regular.left}px`,
          '--regular-art-top': `${composition.regular.top}px`,
          '--compact-art-width': `${composition.compact.width}px`,
          '--compact-art-left': `${composition.compact.left}px`,
          '--compact-art-top': `${composition.compact.top}px`,
          '--art-ratio': frame.height / frame.width,
        } as CSSProperties)
      : undefined;
  return (
    <section
      className="primary-presentation"
      key={aircraft.id}
      data-aircraft-id={aircraft.id}
    >
      <header className="aircraft-header">
        <h1
          className={
            name.length > 34
              ? 'extended-name'
              : name.length > 24
                ? 'long-name'
                : ''
          }
          title={name}
        >
          <span className="manufacturer">
            {aircraft.manufacturer ? aircraft.manufacturer + ' ' : ''}
          </span>
          <span className="model">
            {aircraft.model ||
              (aircraft.manufacturer ? 'Aircraft' : 'Unidentified aircraft')}
          </span>
        </h1>
        <Brand />
      </header>
      <article
        className={'primary ' + (delayed ? 'is-delayed' : '')}
        aria-label="Primary aircraft"
      >
        <div
          className={
            'aircraft-card ' +
            (prominentRoute(aircraft) ? 'has-route' : 'no-route') +
            (wideArtwork ? ' wide-artwork' : '') +
            (composition ? ' composed-artwork' : '')
          }
          style={placement}
        >
          <div className="flight-info">
            <Route aircraft={aircraft} composed={!!composition} />
            {aircraft.operator ? (
              <p className="operator" title={aircraft.operator}>
                {aircraft.operator}
              </p>
            ) : null}
          </div>
          <AircraftArtwork asset={asset} clouds={manifest.clouds} />
          <Details aircraft={aircraft} />
        </div>
        <Measurements aircraft={aircraft} />
      </article>
    </section>
  );
}
function Secondary({ aircraft }: { aircraft: Aircraft }) {
  const name = aircraftName(aircraft);
  return (
    <article
      className={
        'nearby-aircraft ' + (name.length > 32 ? 'long-secondary' : '')
      }
    >
      <div className="nearby-identity">
        <h3 title={name}>{name}</h3>
        {aircraft.callsign || aircraft.registration ? (
          <p className="secondary-id">
            {aircraft.callsign || aircraft.registration}
          </p>
        ) : null}
      </div>
      <div
        className={
          'nearby-value ' +
          (aircraft.altitudeFt === null ? 'missing-value' : '')
        }
      >
        <span>
          {aircraft.altitudeFt === null ? '—' : altitude(aircraft.altitudeFt)}
          <small>{aircraft.altitudeFt === null ? '' : ' ft'}</small>
        </span>
        <small>Barometric</small>
      </div>
      <div
        className={
          'nearby-value nearby-distance ' +
          (aircraft.distanceKm === null ? 'missing-value' : '')
        }
      >
        <span>
          {aircraft.distanceKm === null ? '—' : distance(aircraft.distanceKm)}
          <small>{aircraft.distanceKm === null ? '' : ' km'}</small>
        </span>
        <small>Horizontal</small>
      </div>
    </article>
  );
}
function Empty({ unavailable }: { unavailable: boolean }) {
  return unavailable ? (
    <section className="empty-state unavailable-airspace" role="status">
      <span className="outage-mark" aria-hidden="true">
        —
      </span>
      <h1>Aircraft data unavailable</h1>
      <p>The display will retry automatically.</p>
    </section>
  ) : (
    <section
      className="empty-state healthy-airspace"
      role="status"
      aria-label="No aircraft nearby"
    >
      <div className="radar" aria-hidden="true">
        <span />
      </div>
      <span className="visually-hidden">
        No aircraft nearby. Tracking remains active.
      </span>
    </section>
  );
}
export function Display({
  scene,
  index = 0,
  live = false,
  enrichmentCredit = false,
  diagnosticControl,
  manifest = artworkManifest,
}: {
  scene: Scene;
  index?: number;
  live?: boolean;
  enrichmentCredit?: boolean;
  diagnosticControl?: ReactNode;
  manifest?: ArtworkManifest;
}) {
  const secondaries = scene.primary
    ? scene.secondary
        .filter(
          (a, i, all) =>
            a.id !== scene.primary!.id &&
            all.findIndex((x) => x.id === a.id) === i,
        )
        .slice(0, 3)
    : [];
  return (
    <>
      <div className="portrait-note">
        Aero Pane<span>Please turn your iPad to landscape.</span>
        <small>{live ? 'Live · adsb.fi' : 'DEMO — SIMULATED DATA'}</small>
      </div>
      <main
        className={
          'display ' +
          (secondaries.length
            ? 'has-nearby'
            : scene.primary
              ? 'single-aircraft'
              : 'empty-airspace')
        }
        data-scene={scene.id}
      >
        <div className="content">
          {scene.primary ? (
            <Primary
              key={scene.primary.id}
              aircraft={scene.primary}
              delayed={scene.state === 'delayed'}
              manifest={manifest}
              multiple={secondaries.length > 0}
            />
          ) : (
            <Empty
              unavailable={
                scene.state === 'unavailable' || scene.state === 'delayed'
              }
            />
          )}
          {secondaries.length ? (
            <section className="nearby" aria-label="Other nearby aircraft">
              <div className="section-heading">
                <h2>Also nearby</h2>
                <span>{secondaries.length} other aircraft</span>
              </div>
              <div className="nearby-list">
                {secondaries.map((aircraft) => (
                  <Secondary key={aircraft.id} aircraft={aircraft} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <footer>
          <div className={'status-line status-' + scene.state}>
            <span className="status-dot" />
            <span>
              {live
                ? `Live · ${scene.state === 'available' ? 'Current aircraft information' : stateLabels[scene.state]}`
                : scene.state === 'available'
                  ? stateLabels[scene.state]
                  : `Demo · ${stateLabels[scene.state]}`}
            </span>
          </div>
          {live ? diagnosticControl : null}
          {live ? (
            <span className="provider-credit">
              <a className="provider-credit" href="https://adsb.fi/">
                Aircraft data: adsb.fi
              </a>
              {enrichmentCredit ? (
                <>
                  {' '}
                  ·{' '}
                  <a className="provider-credit" href="https://hexdb.io/">
                    HexDB
                  </a>
                </>
              ) : null}
            </span>
          ) : (
            <div
              className="scene-track"
              aria-label={'Demo scenario: ' + scene.label}
            >
              {scenes.map((s, i) => (
                <span key={s.id} className={i === index ? 'selected' : ''} />
              ))}
              <span className="scene-label">{scene.label}</span>
            </div>
          )}
        </footer>
      </main>
    </>
  );
}

export default function App() {
  const [offset] = useState(() =>
    offsetFor(new URLSearchParams(window.location.search).get('scene')),
  );
  const [active, setActive] = useState(() => sceneAt(offset));
  useEffect(() => {
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    function update() {
      if (disposed) return;
      if (timer !== undefined) clearTimeout(timer);
      const next = sceneAt(offset + performance.now() - start);
      setActive(next);
      timer = setTimeout(update, Math.max(20, next.remaining));
    }
    function resize() {
      document.documentElement.style.setProperty(
        '--app-height',
        `${window.visualViewport?.height ?? window.innerHeight}px`,
      );
    }
    update();
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', update);
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', update);
    };
  }, [offset]);
  return <Display scene={active.scene} index={active.index} />;
}

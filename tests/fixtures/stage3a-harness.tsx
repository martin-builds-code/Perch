// Development-only fixture entry; not imported by index.html or the product.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Display } from '../../src/App';
import type { Aircraft, Scene } from '../../src/simulation';
import { fleet } from '../../src/simulation';
import '../../src/style.css';
import './composition-review.css';
const names = {
  a380: ['Airbus', 'A380-800', 'A388'],
  challenger: ['Bombardier', 'BD-100 Challenger 350', 'CL35'],
  piper: ['Piper', 'PA-28-140/150/160/180', 'P28A'],
  dreamliner: ['Boeing', '787-9 Dreamliner', 'B789'],
  atr: ['ATR', '72-600', 'AT76'],
  helicopter: ['Airbus', 'H135', 'EC35'],
  a320: ['Airbus', 'A320neo', 'A20N'],
};
const a = (kind: keyof typeof names, id = 'fixture-primary'): Aircraft => ({
  ...fleet[0],
  id,
  manufacturer: names[kind][0],
  model: names[kind][1],
  typeCode: names[kind][2],
  altitudeFt: 36025,
  distanceKm: 14.2,
  callsign: 'FIXTURE 01',
  registration: 'DEMO-ART',
  origin: {
    code: 'AMS',
    iata: 'AMS',
    icao: 'EHAM',
    name: 'Amsterdam Schiphol',
  },
  destination: { code: 'MAN', iata: 'MAN', icao: 'EGCC', name: 'Manchester' },
});
function scene(kind: string): Scene {
  const primary = a(kind in names ? (kind as keyof typeof names) : 'a380');
  const secondary = [
    a('challenger', 'fixture-2'),
    a('piper', 'fixture-3'),
    a('a320', 'fixture-4'),
  ];
  secondary[0].altitudeFt = 12125;
  secondary[0].distanceKm = 9.6;
  secondary[1].altitudeFt = 1100;
  secondary[1].distanceKm = 1.1;
  secondary.forEach((x) => {
    x.operator = null;
  });
  if (kind === 'missing-route') {
    primary.origin = null;
    primary.destination = null;
    primary.operator = null;
  }
  if (kind === 'icao-only') {
    primary.origin = { code: 'EHAM', iata: null, name: 'Amsterdam' };
  }
  if (kind === 'unknown') {
    primary.altitudeFt = null;
    primary.distanceKm = null;
    primary.manufacturer = null;
    primary.model = null;
    primary.typeCode = null;
  }
  if (kind === 'long-names') {
    primary.manufacturer = 'Bombardier';
    primary.model = 'BD-700-2A12 Global 7500 Ultra Long Range Business Jet';
    primary.typeCode = 'GLEX';
    secondary[0] = { ...primary, id: 'fixture-long-secondary' };
  }
  if (kind === 'long-airports') {
    primary.origin = {
      code: 'DUB',
      name: 'Dublin International Airport Passenger Terminal and Regional Hub',
    };
    primary.destination = {
      code: 'MAN',
      name: 'Manchester International Airport Passenger Terminal and Airfield',
    };
  }
  if (kind === 'wide-codes') {
    primary.origin = { code: 'MMW', name: 'Wide-code origin fixture' };
    primary.destination = {
      code: 'WWK',
      name: 'Wide-code destination fixture',
    };
  }
  return {
    id: 'stage3a-fixture',
    label: 'Synthetic display',
    duration: 60000,
    state:
      kind === 'empty'
        ? 'standby'
        : kind === 'unavailable'
          ? 'unavailable'
          : kind === 'delayed'
            ? 'delayed'
            : 'available',
    primary: ['empty', 'unavailable'].includes(kind) ? null : primary,
    secondary: ['single', 'missing-route', 'empty', 'unavailable'].includes(
      kind,
    )
      ? []
      : secondary,
  };
}
declare global {
  interface Window {
    stage3aFixture: (kind: string, id?: string) => void;
  }
}
function Harness() {
  const composition = new URLSearchParams(location.search).get('composition');
  const validComposition =
    composition && ['A', 'B', 'C'].includes(composition)
      ? composition
      : undefined;
  const [value, setValue] = useState(() =>
    scene(new URLSearchParams(location.search).get('scenario') || 'a380'),
  );
  window.stage3aFixture = (kind, id) => {
    const next = scene(kind);
    if (id && next.primary) next.primary.id = id;
    setValue(next);
  };
  useEffect(() => {
    if (!validComposition || value.primary?.typeCode !== 'A388') return;
    document.documentElement.dataset.composition = validComposition;
    let disposed = false;
    // Wide three-letter combinations keep the intended font until they actually
    // exceed the protected column. Font loading is complete before measuring.
    const fitCodes = () => {
      if (disposed) return;
      const codes = [
        ...document.querySelectorAll<HTMLElement>('.airport-code'),
      ];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx || !codes.length) return;
      const wanted = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--review-code',
        ),
      );
      let size = wanted;
      for (const code of codes) {
        ctx.font = `600 ${wanted}px "Barlow Condensed"`;
        const width = ctx.measureText(code.textContent || '').width + 3;
        size = Math.min(size, (wanted * (code.clientWidth - 2)) / width);
      }
      document.documentElement.style.setProperty(
        '--review-fitted-code',
        `${Math.floor(size)}px`,
      );
    };
    void document.fonts.ready.then(fitCodes);
    window.addEventListener('resize', fitCodes);
    return () => {
      disposed = true;
      window.removeEventListener('resize', fitCodes);
      delete document.documentElement.dataset.composition;
      document.documentElement.style.removeProperty('--review-fitted-code');
    };
  }, [validComposition, value]);
  return <Display scene={value} />;
}
createRoot(document.getElementById('root')!).render(<Harness />);

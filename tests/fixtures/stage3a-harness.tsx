// Development-only fixture entry; not imported by index.html or the product.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Display } from '../../src/App';
import type { Aircraft, Scene } from '../../src/simulation';
import { fleet } from '../../src/simulation';
import '../../src/style.css';
const names = {
  a380: ['Airbus', 'A380-800', 'A388'],
  challenger: ['Bombardier', 'BD-100 Challenger 350', 'CL35'],
  piper: ['Piper', 'PA-28-140/150/160/180', 'P28A'],
  dreamliner: ['Boeing', '787-9 Dreamliner', 'B789'],
  atr: ['ATR', '72-600', 'AT76'],
  helicopter: ['Airbus', 'H135', 'EC35'],
  a320: ['Airbus', 'A320neo', 'A20N'],
  b777: ['Boeing', '777-300ER', 'B77W'],
  pioneer: ['ALPI', 'Pioneer 330', ''],
  boeing: ['Boeing', '737-800', 'B738'],
  embraer: ['Embraer', '190', 'E190'],
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
  if (kind.startsWith('readability-')) {
    const primary: Aircraft = {
      ...a('a320'),
      callsign: 'NLA 204',
      direction: 'East',
      altitudeFt: 6025,
      distanceKm: 13,
      origin: { code: 'MAN', iata: 'MAN', name: 'Manchester' },
      destination: { code: 'AMS', iata: 'AMS', name: 'Amsterdam Schiphol' },
    };
    const secondary = [
      a('atr', 'fixture-2'),
      a('boeing', 'fixture-3'),
      a('embraer', 'fixture-4'),
    ];
    const routes = [
      ['DUB', 'MAN'],
      ['AGP', 'GLA'],
      ['LCY', 'AMS'],
    ];
    secondary.forEach((aircraft, i) => {
      aircraft.origin = { code: routes[i][0], name: '' };
      aircraft.destination = { code: routes[i][1], name: '' };
      aircraft.operator = null;
    });
    secondary[0].altitudeFt = 7725;
    secondary[0].distanceKm = 14.5;
    secondary[1].altitudeFt = 38000;
    secondary[1].distanceKm = 8.4;
    secondary[2].altitudeFt = 12300;
    secondary[2].distanceKm = 10.1;
    if (kind === 'readability-partial') {
      secondary[1].origin = null;
      secondary[2].destination = null;
    }
    if (kind === 'readability-wide')
      secondary.forEach((a) => {
        a.origin = { code: 'MMW', name: '' };
        a.destination = { code: 'WWK', name: '' };
      });
    if (kind === 'readability-sparse') {
      primary.callsign = null;
      primary.direction = null;
      primary.operator = null;
      secondary.forEach((a) => {
        a.origin = null;
        a.destination = null;
      });
      secondary[1].altitudeFt = null;
      secondary[2].distanceKm = null;
    }
    return {
      id: 'stage3a-fixture',
      label: 'Synthetic display',
      duration: 60000,
      state: 'available',
      primary,
      secondary:
        kind === 'readability-single'
          ? []
          : kind === 'readability-two'
            ? secondary.slice(0, 2)
            : kind === 'readability-one-secondary'
              ? secondary.slice(0, 1)
              : secondary,
    };
  }
  const primary = a(
    kind.startsWith('a320-')
      ? 'a320'
      : kind in names
        ? (kind as keyof typeof names)
        : 'a380',
  );
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
  if (kind === 'a320-no-route' || kind === 'a320-single-no-route') {
    primary.origin = null;
    primary.destination = null;
  }
  if (kind === 'a380-no-route') {
    primary.origin = null;
    primary.destination = null;
  }
  if (kind === 'demo-incomplete') {
    Object.assign(primary, fleet[5], { id: 'fixture-primary', typeCode: null });
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
  if (kind === 'long-airports' || kind === 'a320-long-airports') {
    primary.origin = {
      code: 'DUB',
      name: 'Dublin International Airport Passenger Terminal and Regional Hub',
    };
    primary.destination = {
      code: 'MAN',
      name: 'Manchester International Airport Passenger Terminal and Airfield',
    };
  }
  if (kind === 'wide-codes' || kind === 'a320-wide-codes') {
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
    secondary: [
      'single',
      'a320-single',
      'a320-single-no-route',
      'missing-route',
      'empty',
      'unavailable',
    ].includes(kind)
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
  const [value, setValue] = useState(() =>
    scene(new URLSearchParams(location.search).get('scenario') || 'a380'),
  );
  window.stage3aFixture = (kind, id) => {
    const next = scene(kind);
    if (id && next.primary) next.primary.id = id;
    setValue(next);
  };
  return <Display scene={value} />;
}
createRoot(document.getElementById('root')!).render(<Harness />);

// Local synthetic presentation fixture; excluded from the production entry.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Display } from '../../src/App';
import { fleet } from '../../src/simulation';
import type { Aircraft, Scene } from '../../src/simulation';
import '../../src/style.css';
const params = new URLSearchParams(location.search);
const primary: Aircraft = {
  ...fleet[0],
  id: 'fixture-primary',
  manufacturer: params.has('long-model') ? 'Bombardier' : 'Airbus',
  model: params.has('long-model')
    ? 'BD-100 Challenger 350'
    : params.has('generic')
      ? 'A320neo'
      : 'A380-800',
  typeCode: params.has('long-model')
    ? 'CL35'
    : params.has('generic')
      ? 'A20N'
      : 'A388',
  operator: params.get('operator') || null,
  origin: { code: 'MAN', iata: 'MAN', name: 'Manchester' },
  destination: { code: 'AMS', iata: 'AMS', name: 'Amsterdam Schiphol' },
  callsign: 'EZY49YH',
  direction: params.get('direction') || 'North-west',
};
const secondary = fleet.slice(1, 4);
declare global {
  interface Window {
    operatorFixture: (single: boolean) => void;
  }
}
function Harness() {
  const [single, setSingle] = useState(params.has('single'));
  window.operatorFixture = setSingle;
  const scene: Scene = {
    id: 'operator-fixture',
    label: 'Synthetic operator review',
    duration: 0,
    state: 'available',
    primary,
    secondary: single ? [] : secondary,
  };
  return <Display scene={scene} />;
}
createRoot(document.getElementById('root')!).render(<Harness />);

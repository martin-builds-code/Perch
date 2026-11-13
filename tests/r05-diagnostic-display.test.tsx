import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import SkyTrialDisplay from '../src/SkyTrialDisplay';
import RouteTrialDisplay from '../src/RouteTrialDisplay';
import { createSkyDiagnostics } from '../src/skyDiagnostics';
import { createRouteDiagnostics } from '../src/routeDiagnostics';
const now = Date.now(),
  until = now + 60000;
test('R05 diagnostic captions describe the shared adaptive policy and protected access', () => {
  const sky = renderToStaticMarkup(
    <SkyTrialDisplay
      diagnostics={createSkyDiagnostics(until)}
      until={until}
      adaptive
    />,
  );
  const routes = renderToStaticMarkup(
    <RouteTrialDisplay
      diagnostics={createRouteDiagnostics(now, until)}
      expiresAtMs={until}
      adaptive
    />,
  );
  assert.match(sky, /shared deadline/);
  assert.match(sky, /no separate secondary interval/);
  assert.match(routes, /start gap ≥10 s/);
  assert.match(routes, /rolling five minutes/);
  assert.doesNotMatch(
    sky + routes,
    /unsecured|secondary ≥90|enrichment ≥30 s globally/,
  );
});
test('legacy R04 diagnostic captions remain unchanged outside adaptive mode', () => {
  const routes = renderToStaticMarkup(
    <RouteTrialDisplay
      diagnostics={createRouteDiagnostics(now, until)}
      expiresAtMs={until}
    />,
  );
  assert.match(routes, /enrichment ≥30 s globally/);
  assert.match(routes, /≥90 s secondaries/);
  assert.doesNotMatch(routes, /three tokens/);
});

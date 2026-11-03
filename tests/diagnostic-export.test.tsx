import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Display } from '../src/App';
import { scenes } from '../src/simulation';
import { DiagnosticExport } from '../src/DiagnosticExport';
import { diagnosticDuration, diagnosticFile } from '../src/diagnosticExport';
import { createDataDiagnostics } from '../src/dataDiagnostics';
import type { DiagnosticState } from '../src/dataDiagnostics';

const T = Date.UTC(2026, 10, 2, 19, 30);
const state = (extra: Partial<DiagnosticState> = {}): DiagnosticState => ({
  active: true,
  visible: true,
  online: true,
  state: 'available',
  requestFailed: false,
  primaryAgeMs: 1000,
  secondaryAgeMs: 2000,
  snapshotAgeMs: 1000,
  providerAgeMs: 1000,
  lastObservedAgeMs: 1000,
  primaryChanged: false,
  retainedMissing: false,
  clockAnomaly: false,
  ...extra,
});
const record = (
  d: ReturnType<typeof createDataDiagnostics>,
  at: number,
  ok = true,
) => {
  d.pollStart(at);
  d.pollComplete({
    atMs: at + 50,
    durationMs: 50,
    ok,
    status: ok ? 200 : 503,
    error: ok ? null : 'cooldown',
    cache: ok ? 'HIT' : null,
    cacheAgeSeconds: ok ? 1 : null,
  });
};

test('diagnostic export is gated by the build flag and explicit 30–60 minute duration', () => {
  for (const query of [
    '',
    '?diagnostics=0',
    '?diagnostics=29',
    '?diagnostics=61',
    '?diagnostics=invalid',
  ]) {
    assert.equal(diagnosticDuration(query, true), undefined);
  }
  assert.equal(diagnosticDuration('?diagnostics=45', false), undefined);
  assert.equal(diagnosticDuration('?diagnostics=30', true), 1800000);
  assert.equal(diagnosticDuration('?diagnostics=60', true), 3600000);
  const control = <DiagnosticExport source={() => createDataDiagnostics(T)} />;
  assert.doesNotMatch(
    renderToStaticMarkup(
      <Display scene={scenes[0]} diagnosticControl={control} />,
    ),
    /Export diagnostics/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(<Display scene={scenes[0]} live />),
    /Export diagnostics/,
  );
  assert.match(
    renderToStaticMarkup(
      <Display scene={scenes[0]} live diagnosticControl={control} />,
    ),
    /Export diagnostics/,
  );
});

test('active JSON retains every collector field, adds explicit incomplete metadata and a dynamic UTC filename', () => {
  const d = createDataDiagnostics(T);
  d.observe(state(), T);
  record(d, T);
  const before = d.summary(T + 1000);
  const file = diagnosticFile(d, T + 1000);
  const { exportMetadata, ...summary } = JSON.parse(file.json);
  assert.deepEqual(summary, before);
  assert.deepEqual(exportMetadata, {
    exportedAtMs: T + 1000,
    sessionStatus: 'incomplete',
  });
  assert.equal(file.filename, 'aero-pane-diagnostics-2026-11-02-193001.json');
  assert.equal(file.complete, false);
  assert.deepEqual(d.summary(T + 1000), before);
  record(d, T + 15000);
  assert.equal(d.summary(T + 16000).pollingAttempts, 2);
});

test('finished observation exports remain available; zero delays and incomplete coverage remain honest', () => {
  const d = createDataDiagnostics(T, 30 * 60000);
  d.observe(state(), T);
  record(d, T);
  d.observe(state({ active: false, visible: false }), T + 10000);
  const file = diagnosticFile(d, T + 31 * 60000);
  const report = JSON.parse(file.json);
  assert.equal(file.complete, true);
  assert.equal(report.exportMetadata.sessionStatus, 'complete');
  assert.equal(report.enabled, false);
  assert.equal(report.observedMs, 10000);
  assert.equal(report.inactiveMs, 1790000);
  assert.equal(report.delayedEpisodes, 0);
  assert.equal(report.medianDelayedDurationMs, null);
  assert.equal(report.proportionDelayed, 0);
  assert.equal(
    JSON.parse(diagnosticFile(d, T + 35 * 60000).json).pollingAttempts,
    1,
  );
});

test('early stopped collector is incomplete even if exported after its original deadline', () => {
  const d = createDataDiagnostics(T);
  d.observe(state(), T);
  d.stop(T + 10000);
  assert.equal(diagnosticFile(d, T + 60 * 60000).complete, false);
});

test('multiple delay episodes, provider failure, lifecycle and scalar age/cache evidence survive export', () => {
  const d = createDataDiagnostics(T, 30 * 60000);
  d.observe(state(), T);
  record(d, T);
  d.observe(
    state({ state: 'delayed', primaryAgeMs: 31000, retainedMissing: true }),
    T + 1000,
  );
  d.observe(state(), T + 16000);
  d.observe(
    state({ state: 'delayed', secondaryAgeMs: 40000, primaryChanged: true }),
    T + 20000,
  );
  record(d, T + 20000, false);
  d.observe(state(), T + 35000);
  d.observe(state({ active: false, online: false }), T + 40000);
  const report = JSON.parse(diagnosticFile(d, T + 60000).json);
  assert.equal(report.delayedEpisodes, 2);
  assert.equal(report.medianDelayedDurationMs, 15000);
  assert.equal(report.longestDelayedDurationMs, 15000);
  assert.equal(report.failedRequests, 1);
  assert.equal(report.associations['retained-missing-primary'], 1);
  assert.equal(report.associations['aged-secondary'], 1);
  assert.equal(report.polls[0].cache, 'HIT');
  assert.equal(report.polls[1].error, 'cooldown');
  assert.equal(report.latest.secondaryAgeMs, 2000);
  assert.equal(report.inactiveMs, 20000);
  assert.doesNotMatch(
    JSON.stringify(report),
    /latitude|longitude|callsign|registration|cookie|token|route|aircraftId|abcdef/i,
  );
});

async function mounted(
  run: (env: {
    d: ReturnType<typeof createDataDiagnostics>;
    click: (selector: string, twice?: boolean) => Promise<void>;
    files: { filename: string; blob: Blob }[];
    revoked: string[];
    advance: (ms: number) => void;
    fail: (kind: 'url' | 'click') => void;
  }) => Promise<void>,
) {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM('<div id="root"></div>', {
    virtualConsole,
    url: 'https://display.example/?mode=live&diagnostics=30',
  });
  const originalWindow = globalThis.window,
    originalDocument = globalThis.document;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  // React must detect DOM input support after the DOM is installed, rather
  // than choosing its legacy non-browser input polyfill during module load.
  const { createRoot } = await import('react-dom/client');
  const originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL;
  const originalDateNow = Date.now,
    originalPerformance = Object.getOwnPropertyDescriptor(performance, 'now');
  const originalFetch = globalThis.fetch;
  let now = T + 1000,
    monotonic = 0,
    requests = 0,
    failure = '';
  const blobs = new Map<string, Blob>(),
    files: { filename: string; blob: Blob }[] = [],
    revoked: string[] = [];
  Date.now = () => now;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => monotonic,
  });
  URL.createObjectURL = (blob) => {
    if (failure === 'url') throw new Error('Disabled');
    const url = `blob:diagnostic-${blobs.size}`;
    blobs.set(url, blob as Blob);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
  };
  dom.window.HTMLAnchorElement.prototype.click = function () {
    if (failure === 'click') throw new Error('Download blocked');
    files.push({ filename: this.download, blob: blobs.get(this.href)! });
  };
  globalThis.fetch = async () => {
    requests++;
    throw new Error('Export must be local');
  };
  const d = createDataDiagnostics(T, 30 * 60000);
  d.observe(state(), T);
  record(d, T);
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(<DiagnosticExport source={() => d} />);
    });
    await run({
      d,
      files,
      revoked,
      advance: (ms) => {
        now += ms;
        monotonic += ms;
      },
      fail: (kind) => {
        failure = kind;
      },
      click: async (selector, twice) => {
        await act(async () => {
          const target = document.querySelector<HTMLElement>(selector)!;
          assert.ok(target, selector);
          target.click();
          if (twice) target.click();
        });
      },
    });
    assert.equal(requests, 0, 'export must never perform a network request');
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => {
      root.unmount();
    });
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    if (originalPerformance)
      Object.defineProperty(performance, 'now', originalPerformance);
    else delete (performance as unknown as Record<string, unknown>).now;
    Object.assign(globalThis, {
      window: originalWindow,
      document: originalDocument,
    });
    dom.window.close();
  }
  return revoked;
}

test('one tap downloads valid JSON, repeated taps create one file and closing preserves the collector', async () => {
  const revoked = await mounted(async ({ d, click, files, advance }) => {
    const before = d.summary(T + 1000);
    await click('.diagnostic-export-trigger', true);
    assert.equal(files.length, 1);
    assert.equal(files[0].blob.type, 'application/json');
    const json = JSON.parse(await files[0].blob.text());
    assert.equal(json.pollingAttempts, 1);
    assert.equal(json.exportMetadata.sessionStatus, 'incomplete');
    assert.match(
      document.querySelector('[role="dialog"]')!.textContent!,
      /Observation incomplete/,
    );
    assert.deepEqual(d.summary(T + 1000), before);
    await click('.diagnostic-export-actions button:last-child');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(
      document.activeElement?.textContent?.trim(),
      'Export diagnostics',
    );
    await click('.diagnostic-export-trigger');
    assert.equal(files.length, 1, 'rapid close/reopen is guarded');
    advance(16000);
    record(d, T + 16000);
    await click('.diagnostic-export-trigger');
    assert.equal(files.length, 2);
    assert.equal(JSON.parse(await files[1].blob.text()).pollingAttempts, 2);
  });
  assert.deepEqual(revoked, ['blob:diagnostic-0', 'blob:diagnostic-1']);
});

test('control exports after time limit and remains available for further deliberate exports', async () => {
  await mounted(async ({ click, files, advance, d }) => {
    advance(31 * 60000);
    await click('.diagnostic-export-trigger');
    const json = JSON.parse(await files[0].blob.text());
    assert.equal(json.exportMetadata.sessionStatus, 'complete');
    assert.match(
      document.querySelector('[role="dialog"]')!.textContent!,
      /Observation period ended/,
    );
    assert.equal(d.summary(T + 32 * 60000).enabled, false);
    await click('.diagnostic-export-actions button:last-child');
    advance(2000);
    await click('.diagnostic-export-trigger');
    assert.equal(files.length, 2);
  });
});

for (const failure of ['url', 'click'] as const) {
  test(`${failure} failure preserves data and exposes selectable JSON without another provider call`, async () => {
    await mounted(async ({ d, fail, click, files, advance }) => {
      fail(failure);
      await click('.diagnostic-export-trigger');
      assert.equal(files.length, 0);
      assert.match(
        document.querySelector('[role="status"]')!.textContent!,
        /could not start/,
      );
      assert.equal(d.summary(T + 1000).pollingAttempts, 1);
      await click('summary');
      await click('details button');
      const textarea = document.querySelector('textarea')!;
      assert.equal(textarea.selectionStart, 0);
      assert.equal(textarea.selectionEnd, textarea.value.length);
      assert.equal(JSON.parse(textarea.value).successfulRequests, 1);
      advance(2000);
      await click('.diagnostic-export-actions button:first-child');
      assert.equal(files.length, 0);
      assert.equal(d.summary(T + 3000).pollingAttempts, 1);
      await click('.diagnostic-export-actions button:last-child');
    });
  });
}

test('provider-unavailable observation exports without inventing delayed episodes or clearing evidence', async () => {
  await mounted(async ({ d, click, files }) => {
    d.observe(
      state({ state: 'unavailable', primaryAgeMs: null, requestFailed: true }),
      T + 100,
    );
    record(d, T + 100, false);
    await click('.diagnostic-export-trigger');
    const json = JSON.parse(await files[0].blob.text());
    assert.equal(json.failedRequests, 1);
    assert.equal(json.delayedEpisodes, 0);
    assert.equal(json.latest.state, 'unavailable');
    assert.equal(d.summary(T + 1000).failedRequests, 1);
  });
});

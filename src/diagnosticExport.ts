import type { DataDiagnostics } from './dataDiagnostics';

export function diagnosticDuration(search: string, enabled: boolean) {
  const minutes = Number(new URLSearchParams(search).get('diagnostics'));
  return enabled && minutes >= 30 && minutes <= 60
    ? minutes * 60000
    : undefined;
}

export function diagnosticFile(source: DataDiagnostics, now: number) {
  const summary = source.summary(now);
  // A finished time window is distinct from continuous observation coverage.
  // A collector stopped early must still be labelled incomplete.
  const complete =
    !summary.enabled &&
    summary.observedMs + summary.inactiveMs >=
      summary.endsAtMs - summary.startedAtMs;
  const stamp = new Date(now).toISOString();
  return {
    complete,
    filename: `aero-pane-diagnostics-${stamp.slice(0, 10)}-${stamp.slice(11, 19).replace(/:/g, '')}.json`,
    json: JSON.stringify(
      {
        ...summary,
        exportMetadata: {
          exportedAtMs: now,
          sessionStatus: complete ? 'complete' : 'incomplete',
        },
      },
      null,
      2,
    ),
  };
}

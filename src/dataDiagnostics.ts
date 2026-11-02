import { CURRENT_AGE_MS, EXPIRE_AGE_MS } from './liveTypes';
export interface DiagnosticContext {
  active: boolean;
  visible: boolean | null;
  online: boolean | null;
}
export interface DiagnosticState extends DiagnosticContext {
  state: string;
  requestFailed: boolean;
  primaryAgeMs: number | null;
  secondaryAgeMs: number | null;
  snapshotAgeMs: number | null;
  providerAgeMs: number | null;
  lastObservedAgeMs: number | null;
  primaryChanged: boolean;
  retainedMissing: boolean;
  clockAnomaly: boolean;
}
export interface PollRecord {
  context?: DiagnosticState;
  startedAtMs?: number | null;
  atMs: number;
  durationMs: number | null;
  ok: boolean;
  status: number | null;
  error: string | null;
  cache: string | null;
  cacheAgeSeconds: number | null;
}
export interface DelayEpisode {
  startMs: number;
  endMs: number | null;
  observedDurationMs: number;
  associations: string[];
  apiFailure: boolean;
}
const LIMIT = 256,
  MAX_COUNT = 10000;
const median = (a: number[]) => {
  if (!a.length) return null;
  const sorted = [...a].sort((x, y) => x - y),
    m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};
export function createDataDiagnostics(
  startMs: number,
  durationMs = 45 * 60000,
) {
  const endMs = startMs + Math.max(1, Math.min(durationMs, 60 * 60000));
  let last = startMs,
    stopped = false,
    active = false,
    state = 'unavailable';
  let pendingAttemptAtMs: number | null = null;
  let unavailableMs = 0;
  const lifecycle: {
    atMs: number;
    active: boolean;
    visible: boolean | null;
    online: boolean | null;
  }[] = [];
  let attempts = 0,
    successes = 0,
    failures = 0,
    clockAnomalies = 0,
    observedMs = 0,
    delayedMs = 0,
    primaryChanges = 0,
    episodeCount = 0;
  let episode: DelayEpisode | null = null;
  const episodes: DelayEpisode[] = [],
    polls: PollRecord[] = [];
  let latest: DiagnosticState | null = null;
  function tick(now: number) {
    if (now < last) clockAnomalies = Math.min(MAX_COUNT, clockAnomalies + 1);
    const time = Math.max(last, Math.min(now, endMs));
    const delta = time - last;
    if (active) {
      observedMs += delta;
      if (state === 'unavailable') unavailableMs += delta;
      if (state === 'delayed') {
        delayedMs += delta;
        if (episode) episode.observedDurationMs += delta;
      }
    }
    last = time;
    return time;
  }
  function close(time: number) {
    if (episode) {
      episode.endMs = time;
      episodes.push(episode);
      if (episodes.length > LIMIT) episodes.shift();
      episode = null;
    }
  }
  function ready(now: number) {
    if (stopped) return false;
    tick(now);
    if (now >= endMs) {
      close(endMs);
      stopped = true;
      return false;
    }
    return true;
  }
  function associate(reason: string) {
    if (episode && !episode.associations.includes(reason))
      episode.associations.push(reason);
  }
  function observe(value: DiagnosticState, now: number) {
    if (!ready(now)) return;
    if (value.clockAnomaly && !latest?.clockAnomaly)
      clockAnomalies = Math.min(MAX_COUNT, clockAnomalies + 1);
    active = value.active && value.visible !== false && value.online !== false;
    if (
      !latest ||
      latest.active !== active ||
      latest.visible !== value.visible ||
      latest.online !== value.online
    ) {
      lifecycle.push({
        atMs: last,
        active,
        visible: value.visible,
        online: value.online,
      });
      if (lifecycle.length > 64) lifecycle.shift();
    }
    latest = { ...value, active };
    state = value.state;
    if (value.primaryChanged)
      primaryChanges = Math.min(MAX_COUNT, primaryChanges + 1);
    if (active && state === 'delayed') {
      if (!episode) {
        episode = {
          startMs: last,
          endMs: null,
          observedDurationMs: 0,
          associations: [],
          apiFailure: false,
        };
        episodeCount = Math.min(MAX_COUNT, episodeCount + 1);
      }
      if (value.requestFailed) {
        episode.apiFailure = true;
        associate('failed-request');
      }
      if (value.primaryAgeMs !== null && value.primaryAgeMs >= CURRENT_AGE_MS) {
        associate('aged-primary');
        if (value.primaryChanged) associate('newly-selected-aged-primary');
      }
      if (
        value.secondaryAgeMs !== null &&
        value.secondaryAgeMs >= CURRENT_AGE_MS
      )
        associate('aged-secondary');
      if (value.snapshotAgeMs !== null && value.snapshotAgeMs >= CURRENT_AGE_MS)
        associate('aged-snapshot');
      if (value.retainedMissing) associate('retained-missing-primary');
      if (value.clockAnomaly) associate('clock-anomaly');
      if (!episode.associations.length) associate('undetermined');
    } else close(last);
  }
  function pollStart(now: number) {
    if (ready(now)) {
      attempts = Math.min(MAX_COUNT, attempts + 1);
      pendingAttemptAtMs = now;
    }
  }
  function pollComplete(record: PollRecord) {
    if (!ready(record.atMs)) return;
    if (record.ok) successes = Math.min(MAX_COUNT, successes + 1);
    else failures = Math.min(MAX_COUNT, failures + 1);
    polls.push({
      ...record,
      startedAtMs: record.startedAtMs ?? pendingAttemptAtMs,
      ...(record.context ? { context: { ...record.context } } : {}),
    });
    pendingAttemptAtMs = null;
    if (polls.length > LIMIT) polls.shift();
    if (!record.ok && episode) {
      episode.apiFailure = true;
      associate('failed-request');
    }
    if (record.durationMs === null)
      clockAnomalies = Math.min(MAX_COUNT, clockAnomalies + 1);
  }
  function summary(now: number) {
    if (!stopped) ready(now);
    const all = [...episodes, ...(episode ? [episode] : [])];
    const durations = all.map((e) => e.observedDurationMs);
    const associations: Record<string, number> = {};
    for (const e of all)
      for (const a of e.associations)
        associations[a] = (associations[a] ?? 0) + 1;
    return {
      enabled: !stopped,
      startedAtMs: startMs,
      endsAtMs: endMs,
      observedMs,
      inactiveMs: Math.max(0, last - startMs - observedMs),
      unavailableMs,
      lifecycle: lifecycle.map((v) => ({ ...v })),
      delayedMs,
      proportionDelayed: observedMs ? delayedMs / observedMs : null,
      pollingAttempts: attempts,
      pendingAttemptAtMs,
      successfulRequests: successes,
      failedRequests: failures,
      delayedEpisodes: episodeCount,
      episodeWindowTruncated: episodeCount > all.length,
      medianDelayedDurationMs: median(durations),
      longestDelayedDurationMs: durations.length
        ? Math.max(...durations)
        : null,
      episodesWithFailedRequests: all.filter((e) => e.apiFailure).length,
      associations,
      primaryChanges,
      clockAnomalies,
      latest: latest ? { ...latest } : null,
      polls: polls.map((p) => ({
        ...p,
        ...(p.context ? { context: { ...p.context } } : {}),
      })),
      episodes: all.map((e) => ({ ...e, associations: [...e.associations] })),
      limits: {
        polls: LIMIT,
        episodes: LIMIT,
        counters: MAX_COUNT,
        expiryMs: EXPIRE_AGE_MS,
      },
    };
  }
  return {
    observe,
    pollStart,
    pollComplete,
    summary,
    stop: (now: number) => {
      if (!stopped) {
        tick(now);
        close(last);
        pendingAttemptAtMs = null;
        stopped = true;
      }
    },
  };
}
export type DataDiagnostics = ReturnType<typeof createDataDiagnostics>;

import { useEffect, useState } from 'react';
import type { RouteDiagnostics } from './routeDiagnostics';
export default function RouteTrialDisplay({
  diagnostics,
  expiresAtMs,
}: {
  diagnostics: RouteDiagnostics;
  expiresAtMs: number;
}) {
  const [report, setReport] = useState(() =>
    diagnostics.summary(Date.now(), false),
  );
  useEffect(() => {
    const notify = () => setReport(diagnostics.summary(Date.now(), false));
    const unsubscribe = diagnostics.subscribe(notify);
    const timer = setInterval(notify, 1000); // UI ages only; never schedules requests.
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [diagnostics]);
  return (
    <main className="route-trial-dashboard">
      <h1>Experimental route investigation</h1>
      <p className="route-trial-warning">
        Temporarily unsecured Preview — server access expires{' '}
        {new Date(expiresAtMs).toISOString()}.
      </p>
      <p>
        15 km · positions every 15 s · enrichment ≥30 s globally / ≥90 s
        secondaries · one request at a time
      </p>
      <p>
        Detected in nearby feed: {report.distinctAircraft} aircraft ·
        Primary: {report.aircraftBecomingPrimary} · Callsign available:{' '}
        {report.aircraftWithValidCallsigns}
      </p>
      <p>
        Application attempts: {report.counters.applicationAttempts ?? 0} ·
        HexDB HTTP started: {report.counters.hexdbRequestsStarted ?? 0} ·
        Responses: {report.counters.hexdbResponsesReceived ?? 0} · Server
        cache hits: {report.counters.serverCacheHits ?? 0}
      </p>
      <p>
        Global wait: {Math.ceil(report.globalWaitMs / 1000)} s · Secondary
        wait: {Math.ceil(report.secondaryWaitMs / 1000)} s · Server
        cooldowns: {report.counters.serverCooldownIncidents ?? 0} · Client
        pauses: {report.counters.clientCooldownIncidents ?? 0}
      </p>
      <div className="route-trial-cards">
        {report.current.map((row) => (
          <article
            key={row.ref}
            data-route-ref={row.ref}
            data-route-role={row.role}
          >
            <h2>
              {row.role === 'primary' ? 'Primary' : 'Secondary'} ·{' '}
              {row.ref} · {row.model}
            </h2>
            <strong className="route-trial-status">{row.state}</strong>
            <p data-diagnostic-route>
              {row.displayedRoute ?? 'No complete IATA route displayed'}
            </p>
            <p>
              Reason: {row.reason} · Callsign:{' '}
              {row.validCallsign ? 'valid' : 'absent/invalid'}
            </p>
            <p>
              Internal airports: {row.internalRoute ?? 'none'} · Cache:{' '}
              {row.cache} (
              {Math.ceil(Math.max(0, row.cacheRemainingMs) / 1000)} s)
            </p>
            <p>
              First lookup:{' '}
              {row.firstLookupMs === null
                ? 'not attempted'
                : Math.round(
                    (row.firstLookupMs - row.firstSeenMs) / 1000,
                  ) + ' s after detection'}{' '}
              · Last request:{' '}
              {row.lastRequestAtMs === null
                ? 'none'
                : Math.round(
                    (report.endedAtMs - row.lastRequestAtMs) / 1000,
                  ) + ' s ago'}
            </p>
            {row.response ? (
              <p>
                API: {row.response.apiStatus ?? 'network failure'} ·
                Origin: {row.response.diagnostic?.origin ?? 'undetermined'}{' '}
                · Upstream:{' '}
                {row.response.diagnostic?.httpStatus ??
                  'no confirmed response'}{' '}
                · Outcome:{' '}
                {row.response.diagnostic?.outcome ??
                  row.response.error ??
                  'undetermined'}{' '}
                · {row.response.diagnostic?.reason}
              </p>
            ) : null}
            {row.response?.diagnostic?.summary ? (
              <p>
                Provider fields: origin{' '}
                {String(row.response.diagnostic.summary.origin)},
                destination{' '}
                {String(row.response.diagnostic.summary.destination)}, IATA
                pair {String(row.response.diagnostic.summary.iataPair)},
                callsign match{' '}
                {String(row.response.diagnostic.summary.callsignMatches)},
                association age{' '}
                {row.response.diagnostic.summary.associationAgeDays ??
                  'unknown'}{' '}
                days.
              </p>
            ) : null}
          </article>
        ))}
      </div>
      {!report.current.length ? (
        <p>
          No eligible displayed aircraft at this moment. This does not
          imply a provider failure.
        </p>
      ) : null}
      <p>
        Bounded local evidence only; no positions, credentials or permanent
        telemetry. Collection stops on page close, expiry or 18 hours.
      </p>
    </main>
  );
}

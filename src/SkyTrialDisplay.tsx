import { useEffect, useState } from 'react';
import type { SkyDiagnostics } from './skyDiagnostics';
export default function SkyTrialDisplay({
  diagnostics,
  until,
}: {
  diagnostics: SkyDiagnostics;
  until: number;
}) {
  const [data, setData] = useState(() => ({
    ...diagnostics.latest(),
    renderAt: Date.now(),
  }));
  useEffect(() => {
    const timer = setInterval(
      () => setData({ ...diagnostics.latest(), renderAt: Date.now() }),
      1000,
    );
    return () => clearInterval(timer);
  }, [diagnostics]);
  const l = data.latest;
  const n = (v: number | null | undefined) =>
    v == null ? 'unavailable' : v.toFixed(1);
  return (
    <main className="sky-trial">
      <h1>R04 observation-cone comparison</h1>
      <p>
        Experimental, temporarily unsecured Preview. Access expires{' '}
        {new Date(until).toISOString()}.
      </p>
      <p>
        Estimated geometry, not a probability of seeing or hearing an
        aircraft. Constant track/speed prediction, horizon 180 s.
      </p>
      <p>
        R04 primary: {l?.primary ?? 'none'} · R03 would choose:{' '}
        {l?.baselinePrimary ?? 'none'} · Decision:{' '}
        {l?.decision.reason ?? 'waiting'} · Challenger:{' '}
        {l?.decision.challengerId ?? 'none'}
      </p>
      <p>
        <a href="?mode=live&view=normal">Normal aircraft display</a> ·{' '}
        <a href="?mode=live">Route diagnostics</a>
      </p>
      <table>
        <thead>
          <tr>
            <th>Ref / type</th>
            <th>Distance / altitude</th>
            <th>Estimated elevation</th>
            <th>Movement</th>
            <th>CPA / ETA</th>
            <th>Display score</th>
            <th>Route urgency</th>
          </tr>
        </thead>
        <tbody>
          {l?.ranked.map((r) => (
            <tr key={r.ref}>
              <td>
                {r.ref} {r.model}
              </td>
              <td>
                {n(r.distanceKm)} km / {n(r.altitudeFt)} ft
              </td>
              <td>
                {n(r.observation.elevationDegrees)}° ·{' '}
                {r.observation.heightBasis}
              </td>
              <td>{r.motion}</td>
              <td>
                {n(r.observation.cpaDistanceKm)} km /{' '}
                {n(r.observation.secondsToCpa)} s ·{' '}
                {r.observation.predictionQuality} · cone entry{' '}
                {n(r.observation.secondsToCone)} s
              </td>
              <td>{n(r.score)}</td>
              <td>{n(r.observation.urgency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Global wait:{' '}
        {Math.ceil(
          Math.max(
            0,
            (data.scheduling?.globalWaitMs ?? 0) -
              (data.renderAt - (data.scheduling?.atMs ?? data.renderAt)),
          ) / 1000,
        )}{' '}
        s · Secondary wait:{' '}
        {Math.ceil(
          Math.max(
            0,
            (data.scheduling?.secondaryWaitMs ?? 0) -
              (data.renderAt - (data.scheduling?.atMs ?? data.renderAt)),
          ) / 1000,
        )}{' '}
        s · Pending: {data.scheduling?.pending ?? 'none'} · Last result:{' '}
        {data.lastLookup ? JSON.stringify(data.lastLookup) : 'none'}
      </p>
      <h2>Next candidate order (global wait still applies)</h2>
      <ol>
        {(
          data.queue as {
            ref: string;
            kind: string;
            utility: number;
            reason: string;
            secondary: boolean;
          }[]
        ).map((r, i) => (
          <li key={i}>
            {r.ref} {r.kind} ·{' '}
            {r.secondary ? 'secondary ≥90 s' : 'primary'} · utility{' '}
            {n(r.utility)} · {r.reason}
          </li>
        ))}
      </ol>
      <p>
        Empty queue may mean a cache hit, no usable callsign, or a closed
        secondary gate. No extra lookup timer.
      </p>
    </main>
  );
}

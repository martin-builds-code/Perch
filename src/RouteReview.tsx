import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  canonical,
  draftKey,
  emptyDraft,
  exactMatch,
  fr24AircraftLink,
  importReview,
  parseDraft,
  parseReviewDataset,
  reviewExport,
  safeEvidenceUrl,
} from './routeReviewModel';
import type {
  ReviewAnswer,
  ReviewDataset,
  ReviewDraft,
  Verdict,
} from './routeReviewModel';
import './routeReview.css';
const verdictLabels: Record<Verdict, string> = {
  'same-route': 'Same route',
  'different-route': 'Different route',
  'no-route-available': 'No route available',
  'unable-to-verify': 'Unable to verify',
};
const verdictHelp: Record<Verdict, string> = {
  'same-route': 'Both airports match',
  'different-route': 'FR24 shows other airports',
  'no-route-available': 'Flight found; FR24 route blank',
  'unable-to-verify': 'Flight or date cannot be matched',
};
const bands = {
  'recent-0-180': 'Recent association · up to 180 days',
  'historical-180-365': 'Historical association · 180 days to one year',
  'historical-over-365': 'Historical association · over one year',
  'missing-unusable': 'Missing or unusable route information',
};
const utc = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
function loadDraft(data: ReviewDataset) {
  try {
    const saved = localStorage.getItem(draftKey(data));
    if (!saved) return { draft: emptyDraft(data), storage: 'ok' };
    const parsed = parseDraft(JSON.parse(saved), data);
    return parsed
      ? { draft: parsed, storage: 'ok' }
      : { draft: emptyDraft(data), storage: 'invalid' };
  } catch {
    return { draft: emptyDraft(data), storage: 'unavailable' };
  }
}
function Reviewer({ data }: { data: ReviewDataset }) {
  const [initial] = useState(() => loadDraft(data));
  const [draft, setDraft] = useState(initial.draft),
    [storage, setStorage] = useState(initial.storage);
  const [message, setMessage] = useState(''),
    [exporting, setExporting] = useState(false);
  const [imported, setImported] = useState<ReviewDraft | null>(null);
  const [downloadReady, setDownloadReady] = useState(false);
  const exportBusy = useRef(false),
    lastTap = useRef(-Infinity),
    download = useRef<{ url: string; filename: string } | null>(null);
  const callsignInput = useRef<HTMLInputElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const c = data.cases[draft.index],
    answer = c ? draft.answers[c.id] : undefined;
  const reviewed = Object.keys(draft.answers).length;
  useEffect(() => {
    if (storage !== 'ok') return;
    try {
      localStorage.setItem(draftKey(data), JSON.stringify(draft));
    } catch {
      setStorage('unavailable');
    }
  }, [data, draft, storage]);
  useEffect(
    () => () => {
      if (download.current) URL.revokeObjectURL(download.current.url);
    },
    [],
  );
  function update(patch: Partial<ReviewAnswer>) {
    if (!c) return;
    setDraft((old) => {
      const previous = old.answers[c.id];
      const base: ReviewAnswer = previous ?? {
        verdict: 'unable-to-verify',
        matchScope: 'not-matched',
        originCode: '',
        destinationCode: '',
        notes: '',
        evidenceUrl: '',
        revision: 0,
        updatedAtMs: 0,
      };
      const next: ReviewAnswer = {
        ...base,
        ...patch,
        revision: base.revision + 1,
        updatedAtMs: Date.now(),
      };
      return { ...old, answers: { ...old.answers, [c.id]: next } };
    });
  }
  function move(delta: number) {
    setDraft((d) => ({
      ...d,
      index: Math.max(0, Math.min(data.cases.length - 1, d.index + delta)),
    }));
    heading.current?.focus();
    setMessage('');
  }
  async function copyCallsign() {
    try {
      if (!c) return;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(c.callsign);
        setMessage('Callsign copied.');
        return;
      }
    } catch {
      /* Fall back to selectable text. */
    }
    callsignInput.current?.focus();
    callsignInput.current?.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      /* Safari can refuse copying. */
    }
    setMessage(
      copied
        ? 'Callsign copied.'
        : 'The callsign is selected. Touch and hold to copy it.',
    );
  }
  function doDownload() {
    if (!download.current) throw Error('No file');
    const link = document.createElement('a');
    if (!('download' in link)) throw Error('Unsupported download');
    link.href = download.current.url;
    link.download = download.current.filename;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
  }
  async function exportNow(forceDownload = false) {
    if (
      Object.values(draft.answers).some(
        (a) => !safeEvidenceUrl(a.evidenceUrl),
      )
    ) {
      setMessage(
        'An optional flight link is not a public https link. Correct it or leave it blank; your answers are still saved.',
      );
      return;
    }
    const now = performance.now();
    if (exportBusy.current || now - lastTap.current < 1500) return;
    exportBusy.current = true;
    lastTap.current = now;
    setExporting(true);
    const result = reviewExport(data, draft),
      stamp = new Date().toISOString();
    const filename =
      'aero-pane-route-review-' +
      stamp.slice(0, 10) +
      '-' +
      stamp.slice(11, 19).replace(/:/g, '') +
      '.json';
    const json = JSON.stringify(result, null, 2);
    try {
      setDownloadReady(true);
      const file =
        typeof File === 'function'
          ? new File([json], filename, { type: 'application/json' })
          : null;
      if (
        !forceDownload &&
        file &&
        navigator.share &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: 'Aero Pane route review',
        });
        setMessage('Share completed. Your saved review is unchanged.');
      } else {
        if (download.current) URL.revokeObjectURL(download.current.url);
        download.current = null;
        download.current = {
          url: URL.createObjectURL(
            new Blob([json], { type: 'application/json' }),
          ),
          filename,
        };
        doDownload();
        setMessage(
          'Download requested. Open Safari Downloads or Files → Downloads, then attach this file in ChatGPT.',
        );
      }
    } catch (e) {
      setMessage(
        e instanceof Error && e.name === 'AbortError'
          ? 'Sharing cancelled. Your review is still saved here.'
          : 'The export could not start. Your review is unchanged. Try Download file below.',
      );
    } finally {
      exportBusy.current = false;
      setExporting(false);
    }
  }
  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      if (file.size > 524288) throw Error('File too large');
      const saved = importReview(JSON.parse(await file.text()), data);
      if (!saved) throw Error('Different sample or invalid file');
      const differs = Object.keys(draft.answers).some(
        (id) =>
          saved.answers[id] &&
          canonical(saved.answers[id]) !== canonical(draft.answers[id]),
      );
      if (differs) {
        setImported(saved);
        setMessage(
          'This file changes existing answers. Choose whether to use it below.',
        );
      } else {
        setDraft((d) => ({
          ...d,
          answers: { ...d.answers, ...saved.answers },
        }));
        setMessage('Saved answers loaded.');
      }
    } catch {
      setMessage(
        'That file could not be loaded, or belongs to another sample. Your existing answers are unchanged.',
      );
    }
  }
  if (!c)
    return (
      <main className="route-review">
        <h1>Route review</h1>
        <p>
          No cases are available in this build. The aircraft display is
          unchanged.
        </p>
      </main>
    );
  const fr24 = fr24AircraftLink(c),
    complete = !!c.origin?.iata && !!c.destination?.iata;
  return (
    <main className="route-review">
      <header className="review-header">
        <p className="review-kicker">Aero Pane · R02 research</p>
        <h1>Check a flight’s route</h1>
        <p>Match each observed flight in FR24, then record its route.</p>
        <p className="review-progress" aria-live="polite">
          Case {draft.index + 1} of {data.cases.length} · {reviewed}{' '}
          reviewed ·{' '}
          {
            Object.values(draft.answers).filter(
              (a) => a.verdict !== 'unable-to-verify' && exactMatch(a),
            ).length
          }{' '}
          date-matched
        </p>
        <p className="review-save">
          {storage === 'ok'
            ? 'Progress saves automatically on this device.'
            : storage === 'invalid'
              ? 'A saved draft could not be read. It has not been overwritten. Export your current answers before leaving.'
              : 'This browser cannot save the draft. Keep this page open and export before leaving.'}
        </p>
        <details>
          <summary>How to check and save</summary>
          <p>
            These are frozen cases, not live tracking. The time is when
            Aero Pane observed the aircraft, not its departure time. Find
            the flight airborne around that UTC time. The same callsign on
            another date is not enough.
          </p>
          <p>
            FR24 history depends on your plan; free history is usually
            limited to seven days. No purchase is needed. Unable to verify
            is a useful result.
          </p>
          <p>
            Your draft saves on this device. Export the results to Files,
            then attach the file in this conversation. No results are sent
            automatically.
          </p>
        </details>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void exportNow()}
        >
          Export results
        </button>
        <p className="review-status" role="status">
          {message}
        </p>
      </header>
      <article className="review-case" aria-labelledby="review-callsign">
        <p className="review-band">{bands[c.ageCategory]}</p>
        <h2 id="review-callsign" ref={heading} tabIndex={-1}>
          {c.callsign}
        </h2>
        <p className="review-aircraft">
          {c.model || 'Aircraft type not supplied'}
        </p>
        <p
          className="review-registration"
          aria-label="Registration and ICAO hex"
        >
          {c.registration ? c.registration + ' · ' : ''}hex{' '}
          {c.hex.toUpperCase()}
        </p>
        <dl className="review-observation">
          <dt>Observed flight</dt>
          <dd>
            <time dateTime={new Date(c.observedAtMs).toISOString()}>
              {utc(c.observedAtMs)}
            </time>
          </dd>
        </dl>
        <div className="review-proposal">
          <p>HexDB proposed route</p>
          {c.origin || c.destination ? (
            <>
              <div className="review-route">
                {c.origin?.code || '?'} <span>→</span>{' '}
                {c.destination?.code || '?'}
              </div>
            </>
          ) : (
            <p className="review-missing">
              HexDB supplied no usable route for this lookup.
            </p>
          )}
          <p>
            Age when observed:{' '}
            <strong>
              {c.associationAgeDays === null
                ? 'unknown'
                : c.associationAgeDays.toFixed(1) + ' days'}
            </strong>
          </p>
          <p className="review-save">
            This is the association’s age, not the flight’s age. Check the
            observed flight date above.
          </p>
          <p>
            Application:{' '}
            <strong>
              {c.operationalReason === 'route-too-old'
                ? 'rejected by the 180-day rule'
                : c.operationalOutcome === 'complete'
                  ? 'accepted complete route'
                  : c.operationalReason}
            </strong>
          </p>
          <details>
            <summary>Evidence details</summary>
            <p>
              {c.origin?.name || 'Origin not supplied'} →{' '}
              {c.destination?.name || 'Destination not supplied'}
            </p>
            <p>
              {c.associationTimeMs === null
                ? 'No usable association timestamp.'
                : 'Provider timestamp: ' + utc(c.associationTimeMs)}
            </p>
            <p>
              Other route checks: {c.structuralReason}. Callsign match:{' '}
              {c.callsignMatches === null
                ? 'not available'
                : c.callsignMatches
                  ? 'yes'
                  : 'no'}
              . Provider HTTP: {c.httpStatus ?? 'unknown'}.
            </p>
            <p>
              Timestamp meaning is not documented as the date of a flight.
              It must not be treated as one.
            </p>
            <p>Independent check: {c.independent.note}</p>
            <p>Evidence confidence: {c.independent.confidence}.</p>
            {c.independent.evidence.map((e) => (
              <p key={e.url}>
                <a href={e.url} target="_blank" rel="noopener noreferrer">
                  {e.title}
                </a>
              </p>
            ))}
          </details>
        </div>
        <section
          className="review-lookup"
          aria-label="Find the observed flight"
        >
          {fr24 ? (
            <a
              className="review-link-button"
              href={fr24}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open aircraft history in FR24
            </a>
          ) : (
            <a
              className="review-link-button"
              href="https://www.flightradar24.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open FR24 search
            </a>
          )}
          {!fr24 && (
            <p>
              No aircraft-specific link is available. Search by callsign
              and confirm the date.
            </p>
          )}
          <div className="review-copy">
            <input
              ref={callsignInput}
              aria-label="Callsign to search"
              readOnly
              value={c.callsign}
            />
            <button type="button" onClick={() => void copyCallsign()}>
              Copy callsign
            </button>
          </div>
          {Date.now() - c.observedAtMs > 7 * 86400000 && (
            <p className="review-notice">
              This observation is older than seven days. FR24 history may
              be unavailable on your plan.
            </p>
          )}
        </section>
        <section aria-label="Route verdict">
          <h3>2. Record your verdict</h3>
          <div className="review-verdicts">
            {(Object.keys(verdictLabels) as Verdict[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-label={verdictLabels[v]}
                aria-describedby={'meaning-' + v}
                aria-pressed={answer?.verdict === v}
                disabled={v === 'same-route' && !complete}
                onClick={() => update({ verdict: v })}
              >
                {verdictLabels[v]}
                <small id={'meaning-' + v}>{verdictHelp[v]}</small>
              </button>
            ))}
          </div>
          {!complete && (
            <p>
              No complete HexDB pair was supplied. Use Different route to
              record airports FR24 supplies; this will be counted as a
              recovered missing route, not a mismatch.
            </p>
          )}
          {answer && answer.verdict !== 'unable-to-verify' && (
            <fieldset>
              <legend>What did you match?</legend>
              {(
                [
                  ['same-aircraft-date', 'Same aircraft, flight and date'],
                  ['same-flight-date', 'Same flight and observed date'],
                  [
                    'different-date',
                    'Another date / only a general association',
                  ],
                  ['not-matched', 'Could not confidently match'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="review-radio">
                  <input
                    type="radio"
                    name={'match-' + c.id}
                    value={value}
                    checked={answer.matchScope === value}
                    onChange={() => update({ matchScope: value })}
                  />
                  {label}
                </label>
              ))}
              {!exactMatch(answer) && (
                <p>
                  This verdict will remain unverified unless the observed
                  flight and date are matched.
                </p>
              )}
            </fieldset>
          )}
          {answer?.verdict === 'different-route' && (
            <div className="review-airports">
              <label>
                FR24 origin
                <input
                  value={answer.originCode}
                  placeholder="e.g. MAN"
                  maxLength={4}
                  autoCapitalize="characters"
                  onChange={(e) =>
                    update({
                      originCode: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, '')
                        .slice(0, 4),
                    })
                  }
                />
              </label>
              <label>
                FR24 destination
                <input
                  value={answer.destinationCode}
                  placeholder="e.g. AMS"
                  maxLength={4}
                  autoCapitalize="characters"
                  onChange={(e) =>
                    update({
                      destinationCode: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, '')
                        .slice(0, 4),
                    })
                  }
                />
              </label>
              <p>
                Airport codes are optional; enter only what FR24 shows.
              </p>
            </div>
          )}
          {answer && (
            <details>
              <summary>Add a note or flight link (optional)</summary>
              <label className="review-notes">
                Notes (optional)
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={answer.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </label>
              <label className="review-notes">
                FR24 flight link (optional)
                <input
                  type="url"
                  value={answer.evidenceUrl}
                  maxLength={800}
                  placeholder="https://…"
                  onChange={(e) => update({ evidenceUrl: e.target.value })}
                />
              </label>
            </details>
          )}
        </section>
      </article>
      <nav className="review-navigation" aria-label="Review cases">
        <button
          type="button"
          disabled={draft.index === 0}
          onClick={() => move(-1)}
        >
          ← Previous
        </button>
        <span>
          {draft.index + 1} / {data.cases.length}
        </span>
        <button
          type="button"
          disabled={draft.index === data.cases.length - 1}
          onClick={() => move(1)}
        >
          Next →
        </button>
      </nav>
      <section className="review-results">
        <h2>Save your results</h2>
        <p>
          {reviewed === data.cases.length
            ? 'Every case has a verdict.'
            : 'You can export now and continue later.'}{' '}
          No results are sent automatically.
        </p>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void exportNow()}
        >
          Export review results
        </button>
        {downloadReady && (
          <button
            type="button"
            disabled={exporting}
            onClick={() => void exportNow(true)}
          >
            Download file instead
          </button>
        )}
        <p>
          In the share sheet choose Save to Files, or use Safari Downloads.
          Attach the JSON file in this development conversation. No text
          copying or developer tools are needed.
        </p>
        <label className="review-import">
          Resume from an exported file
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void importFile(e)}
          />
        </label>
        {imported && (
          <div className="review-notice">
            <p>
              Use the saved file’s answers where they differ? Your other
              answers will remain.
            </p>
            <button
              type="button"
              onClick={() => {
                setDraft((d) => ({
                  ...d,
                  answers: { ...d.answers, ...imported.answers },
                }));
                setImported(null);
                setMessage('Saved file answers applied.');
              }}
            >
              Use saved answers
            </button>
            <button type="button" onClick={() => setImported(null)}>
              Keep current answers
            </button>
          </div>
        )}
        <p className="review-status" aria-live="polite">
          {message}
        </p>
        <p>
          Local drafts belong to this browser and address. Export before
          clearing Safari data or switching devices. Normal aircraft
          tracking, its PIN and the 180-day rule are unchanged.
        </p>
      </section>
    </main>
  );
}
export default function RouteReview() {
  const [data, setData] = useState<ReviewDataset | null>(null),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    document.documentElement.classList.add('route-review-page');
    const title = document.title;
    document.title = 'Aero Pane · Route review';
    return () => {
      document.documentElement.classList.remove('route-review-page');
      document.title = title;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 10000);
    void fetch('/api/route-review', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw Error('Unavailable');
        const length = Number(response.headers.get('content-length'));
        if (length > 262144) throw Error('Too large');
        const result = parseReviewDataset(await response.json());
        if (!result) throw Error('Invalid sample');
        if (!disposed) setData(result);
      })
      .catch(() => {
        if (!disposed) setError(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [retry]);
  if (data) return <Reviewer key={data.fingerprint} data={data} />;
  return (
    <main className="route-review">
      <h1>Aero Pane route review</h1>
      {error ? (
        <>
          <p>
            The prepared review is unavailable here. The main display and
            its PIN have not changed.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(false);
              setRetry((v) => v + 1);
            }}
          >
            Try again
          </button>
        </>
      ) : (
        <p>Loading the prepared flight examples…</p>
      )}
    </main>
  );
}

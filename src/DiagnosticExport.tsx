import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DataDiagnostics } from './dataDiagnostics';
import { diagnosticFile } from './diagnosticExport';

type ExportFile = ReturnType<typeof diagnosticFile> & { message: string };
const TAP_GUARD_MS = 1500;

export function DiagnosticExport({
  source,
}: {
  source: () => DataDiagnostics | undefined;
}) {
  const [file, setFile] = useState<ExportFile | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const url = useRef<string | null>(null);
  const opened = useRef(false);
  const lastTap = useRef(-Infinity);

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  function close() {
    opened.current = false;
    setFile(null);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!file) return;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab') return;
      const targets = [
        ...(panel.current?.querySelectorAll<HTMLElement>(
          'button, summary, textarea',
        ) ?? []),
      ].filter((element) => element.getClientRects().length > 0);
      const next = event.shiftKey ? targets[targets.length - 1] : targets[0];
      if (
        document.activeElement ===
        (event.shiftKey ? targets[0] : targets[targets.length - 1])
      ) {
        event.preventDefault();
        next?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [file]);

  function download(filename: string) {
    if (!url.current) throw new Error('Download unavailable');
    const link = document.createElement('a');
    if (!('download' in link)) throw new Error('Download unavailable');
    link.href = url.current;
    link.download = filename;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
  }

  function exportNow() {
    const time = performance.now();
    if (opened.current || time - lastTap.current < TAP_GUARD_MS) return;
    lastTap.current = time;
    opened.current = true;
    const observer = source();
    if (!observer) {
      opened.current = false;
      return;
    }
    const result = diagnosticFile(observer, Date.now());
    let message =
      'Download requested. Check Safari Downloads or Files → Downloads.';
    try {
      // Retain one URL until the next deliberate export or unmount. Revoking
      // immediately after click can interrupt a browser consuming the download.
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
      url.current = URL.createObjectURL(
        new Blob([result.json], { type: 'application/json' }),
      );
      download(result.filename);
    } catch {
      message =
        'The download could not start. Try Download JSON, or copy the JSON below. Your observations are still here.';
    }
    setFile({ ...result, message });
  }

  function retry() {
    const time = performance.now();
    if (!file || time - lastTap.current < TAP_GUARD_MS) return;
    lastTap.current = time;
    try {
      download(file.filename);
      setFile({
        ...file,
        message:
          'Download requested. Check Safari Downloads or Files → Downloads.',
      });
    } catch {
      setFile({
        ...file,
        message:
          'The download could not start. Copy the JSON below. Your observations are still here.',
      });
    }
  }

  return (
    <span className="diagnostic-export">
      <button
        ref={trigger}
        type="button"
        className="diagnostic-export-trigger"
        aria-haspopup="dialog"
        aria-expanded={file !== null}
        onClick={exportNow}
      >
        Export diagnostics
      </button>
      <span className="diagnostic-memory-note">
        Export before closing this page
      </span>
      {file &&
        createPortal(
          <div className="diagnostic-export-backdrop">
            <div
              ref={panel}
              className="diagnostic-export-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="diagnostic-export-title"
              aria-describedby="diagnostic-export-status"
            >
              <h2 id="diagnostic-export-title">Diagnostic export</h2>
              <p id="diagnostic-export-status">
                {file.complete
                  ? 'Observation period ended. The file includes the coverage recorded.'
                  : 'Observation incomplete. This file contains the results so far; collection has not been reset.'}
              </p>
              <p role="status">{file.message}</p>
              <p className="diagnostic-export-filename">{file.filename}</p>
              <p>
                Once saved, share the file from Files or attach it in ChatGPT.
                Keep this page open until you have saved your results.
              </p>
              <div className="diagnostic-export-actions">
                <button type="button" onClick={retry}>
                  Download JSON
                </button>
                <button ref={closeButton} type="button" onClick={close}>
                  Close
                </button>
              </div>
              <details>
                <summary>Show JSON if the download is unavailable</summary>
                <p>Select and copy this text to share it for analysis.</p>
                <button
                  type="button"
                  onClick={() => {
                    text.current?.focus();
                    text.current?.select();
                  }}
                >
                  Select JSON
                </button>
                <textarea
                  ref={text}
                  aria-label="Diagnostic JSON"
                  readOnly
                  spellCheck={false}
                  value={file.json}
                />
              </details>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}

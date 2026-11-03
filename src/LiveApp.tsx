import { useEffect, useRef, useState } from 'react';
import { Display } from './App';
import { createPoller, liveScene } from './live';
import { createEnricher } from './enrichment';
import { createDataDiagnostics } from './dataDiagnostics';
import type { DataDiagnostics } from './dataDiagnostics';
import { DiagnosticExport } from './DiagnosticExport';
import { diagnosticDuration } from './diagnosticExport';
declare global {
  interface Window {
    aeroPaneDiagnostics?: {
      summary: () => ReturnType<DataDiagnostics['summary']>;
      export: () => string;
    };
  }
}
export default function LiveApp() {
  const [duration] = useState(() =>
    diagnosticDuration(
      window.location.search,
      import.meta.env.VITE_AERO_DIAGNOSTICS_ENABLED === 'true',
    ),
  );
  const observerRef = useRef<DataDiagnostics | undefined>(undefined);
  const [display, setDisplay] = useState(() => ({
    scene: liveScene(null, Date.now(), false),
    credited: false,
  }));
  useEffect(() => {
    const active = () =>
      document.visibilityState !== 'hidden' && navigator.onLine !== false;
    const observer =
      duration === undefined
        ? undefined
        : createDataDiagnostics(Date.now(), duration);
    observerRef.current = observer;
    const diagnosticHandle = observer
      ? {
          summary: () => observer.summary(Date.now()),
          export: () => JSON.stringify(observer.summary(Date.now()), null, 2),
        }
      : undefined;
    if (diagnosticHandle) window.aeroPaneDiagnostics = diagnosticHandle;
    const env = {
      fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
      now: Date.now,
      active,
      setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimer: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    };
    const enricher =
      import.meta.env.VITE_AERO_ENRICHMENT_ENABLED === 'true'
        ? createEnricher(
            (scene, credited) => setDisplay({ scene, credited }),
            env,
          )
        : undefined;
    const poller = createPoller(
      (scene) => {
        if (enricher) enricher.update(scene);
        else setDisplay({ scene, credited: false });
      },
      {
        ...env,
        observer,
        context: () => ({
          active: active(),
          visible: document.visibilityState !== 'hidden',
          online: navigator.onLine !== false,
        }),
      },
    );
    const resize = () =>
      document.documentElement.style.setProperty(
        '--app-height',
        `${window.visualViewport?.height ?? window.innerHeight}px`,
      );
    resize();
    poller.start();
    document.addEventListener('visibilitychange', poller.resume);
    window.addEventListener('online', poller.resume);
    window.addEventListener('offline', poller.resume);
    window.addEventListener('pageshow', poller.resume);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      enricher?.stop();
      poller.stop();
      if (observerRef.current === observer) observerRef.current = undefined;
      if (window.aeroPaneDiagnostics === diagnosticHandle)
        delete window.aeroPaneDiagnostics;
      document.removeEventListener('visibilitychange', poller.resume);
      window.removeEventListener('online', poller.resume);
      window.removeEventListener('offline', poller.resume);
      window.removeEventListener('pageshow', poller.resume);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [duration]);
  return (
    <Display
      scene={display.scene}
      live
      enrichmentCredit={display.credited}
      diagnosticControl={
        duration === undefined ? undefined : (
          <DiagnosticExport source={() => observerRef.current} />
        )
      }
    />
  );
}

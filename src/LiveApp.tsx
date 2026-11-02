import { useEffect, useState } from 'react';
import { Display } from './App';
import { createPoller, liveScene } from './live';
import { createEnricher } from './enrichment';
import { createDataDiagnostics } from './dataDiagnostics';
import type { DataDiagnostics } from './dataDiagnostics';
declare global {
  interface Window {
    aeroPaneDiagnostics?: {
      summary: () => ReturnType<DataDiagnostics['summary']>;
      export: () => string;
    };
  }
}
export default function LiveApp() {
  const [display, setDisplay] = useState(() => ({
    scene: liveScene(null, Date.now(), false),
    credited: false,
  }));
  useEffect(() => {
    const active = () =>
      document.visibilityState !== 'hidden' && navigator.onLine !== false;
    const minutes = Number(
      new URLSearchParams(window.location.search).get('diagnostics'),
    );
    const observer =
      import.meta.env.VITE_AERO_DIAGNOSTICS_ENABLED === 'true' &&
      minutes >= 30 &&
      minutes <= 60
        ? createDataDiagnostics(Date.now(), minutes * 60000)
        : undefined;
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
      if (window.aeroPaneDiagnostics === diagnosticHandle)
        delete window.aeroPaneDiagnostics;
      document.removeEventListener('visibilitychange', poller.resume);
      window.removeEventListener('online', poller.resume);
      window.removeEventListener('offline', poller.resume);
      window.removeEventListener('pageshow', poller.resume);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  return (
    <Display scene={display.scene} live enrichmentCredit={display.credited} />
  );
}

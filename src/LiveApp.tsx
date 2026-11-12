import { createSkyDiagnostics } from './skyDiagnostics';
import SkyTrialDisplay from './SkyTrialDisplay';
import { createRouteDiagnostics } from './routeDiagnostics';
import RouteTrialDisplay from './RouteTrialDisplay';
import { useEffect, useRef, useState } from 'react';
import { Display } from './App';
import { createPoller, liveScene } from './live';
import { createEnricher } from './enrichment';
import type { EnrichmentBudget } from './enrichment';
import { createDataDiagnostics } from './dataDiagnostics';
import type { DataDiagnostics } from './dataDiagnostics';
import { DiagnosticExport } from './DiagnosticExport';
import { diagnosticDuration } from './diagnosticExport';
declare global {
  interface Window {
    aeroPaneSkyDiagnostics?: {
      summary: ReturnType<typeof createSkyDiagnostics>['summary'];
      reference: ReturnType<typeof createSkyDiagnostics>['reference'];
    };
    aeroPaneRouteDiagnostics?: {
      summary: () => ReturnType<
        ReturnType<typeof createRouteDiagnostics>['summary']
      >;
      reference: (hex: string, callsign: string | null) => string | null;
    };
    aeroPaneDiagnostics?: {
      summary: () => ReturnType<DataDiagnostics['summary']>;
      export: () => string;
    };
  }
}
// Keep request deadlines for this page when Appliance remounts LiveApp on resume.
// No aircraft records, route cache or credentials are retained here.
const enrichmentBudget: EnrichmentBudget = {
  nextAllowed: 0,
  nextSecondaryAllowed: 0,
};
export default function LiveApp({
  routeTrialUntil,
}: { routeTrialUntil?: number } = {}) {
  const [skyDiagnostics] = useState(() =>
    routeTrialUntil && routeTrialUntil > Date.now()
      ? createSkyDiagnostics(routeTrialUntil)
      : undefined,
  );
  const [routeDiagnostics] = useState(() =>
    routeTrialUntil && routeTrialUntil > Date.now()
      ? createRouteDiagnostics(Date.now(), routeTrialUntil)
      : undefined,
  );
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
    const routeHandle = routeDiagnostics
      ? {
          summary: () => routeDiagnostics.summary(Date.now()),
          reference: routeDiagnostics.reference,
        }
      : undefined;
    if (routeHandle) window.aeroPaneRouteDiagnostics = routeHandle;
    const skyHandle = skyDiagnostics
      ? {
          summary: skyDiagnostics.summary,
          reference: skyDiagnostics.reference,
        }
      : undefined;
    if (skyHandle) window.aeroPaneSkyDiagnostics = skyHandle;
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
          export: () =>
            JSON.stringify(observer.summary(Date.now()), null, 2),
        }
      : undefined;
    if (diagnosticHandle) window.aeroPaneDiagnostics = diagnosticHandle;
    const env = {
      fetch: async (...args: Parameters<typeof fetch>) => {
        const r = await fetch(...args);
        if (r.status === 401)
          window.dispatchEvent(new Event('aero-auth-required'));
        return r;
      },
      now: Date.now,
      active,
      setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimer: (timer: ReturnType<typeof setTimeout>) =>
        clearTimeout(timer),
    };
    const enricher =
      import.meta.env.VITE_AERO_ENRICHMENT_ENABLED === 'true'
        ? createEnricher(
            (scene, credited) => {
              skyDiagnostics?.scene(scene, Date.now());
              skyDiagnostics?.plan(enricher?.plan() ?? []);
              setDisplay({ scene, credited });
            },
            {
              ...env,
              monotonicNow: () => performance.now(),
              budget: enrichmentBudget,
              ...(routeDiagnostics
                ? {
                    observe: (e) => {
                      routeDiagnostics.observe(e);
                      skyDiagnostics?.enrichment(e);
                    },
                  }
                : {}),
            },
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
        ...(skyDiagnostics
          ? { onSelection: skyDiagnostics.selection }
          : {}),
        ...(routeDiagnostics
          ? { onSnapshot: routeDiagnostics.snapshot }
          : {}),
        context: () => ({
          active: active(),
          visible: document.visibilityState !== 'hidden',
          online: navigator.onLine !== false,
        }),
      },
    );
    const routeContext = () =>
      routeDiagnostics?.context(active(), Date.now());
    document.addEventListener('visibilitychange', routeContext);
    window.addEventListener('offline', routeContext);
    window.addEventListener('online', routeContext);
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
      skyDiagnostics?.stop();
      if (window.aeroPaneSkyDiagnostics === skyHandle)
        delete window.aeroPaneSkyDiagnostics;
      routeDiagnostics?.stop(Date.now());
      if (window.aeroPaneRouteDiagnostics === routeHandle)
        delete window.aeroPaneRouteDiagnostics;
      document.removeEventListener('visibilitychange', routeContext);
      window.removeEventListener('offline', routeContext);
      window.removeEventListener('online', routeContext);
      poller.stop();
      if (observerRef.current === observer)
        observerRef.current = undefined;
      if (window.aeroPaneDiagnostics === diagnosticHandle)
        delete window.aeroPaneDiagnostics;
      document.removeEventListener('visibilitychange', poller.resume);
      window.removeEventListener('online', poller.resume);
      window.removeEventListener('offline', poller.resume);
      window.removeEventListener('pageshow', poller.resume);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [duration, routeDiagnostics, skyDiagnostics]);
  if (
    skyDiagnostics &&
    routeTrialUntil &&
    new URLSearchParams(location.search).get('sky') === '1'
  )
    return (
      <SkyTrialDisplay
        diagnostics={skyDiagnostics}
        until={routeTrialUntil}
      />
    );
  if (
    routeDiagnostics &&
    routeTrialUntil &&
    new URLSearchParams(location.search).get('view') !== 'normal'
  )
    return (
      <RouteTrialDisplay
        diagnostics={routeDiagnostics}
        expiresAtMs={routeTrialUntil}
      />
    );
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

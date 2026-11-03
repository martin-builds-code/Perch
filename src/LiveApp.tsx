import { useEffect, useState } from 'react';
import { Display } from './App';
import { createPoller, liveScene } from './live';
export default function LiveApp() {
  const [scene, setScene] = useState(() => liveScene(null, Date.now(), false));
  useEffect(() => {
    const poller = createPoller(setScene, {
      fetch: (...args) => fetch(...args),
      now: Date.now,
      active: () =>
        document.visibilityState !== 'hidden' && navigator.onLine !== false,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (timer) => clearTimeout(timer),
    });
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
      poller.stop();
      document.removeEventListener('visibilitychange', poller.resume);
      window.removeEventListener('online', poller.resume);
      window.removeEventListener('offline', poller.resume);
      window.removeEventListener('pageshow', poller.resume);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  return <Display scene={scene} live />;
}

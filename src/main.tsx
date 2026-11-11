import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import App from './App';
import LiveApp from './LiveApp';
import Appliance from './Appliance';
import { displayMode } from './mode';
import './style.css';
const live =
  displayMode(
    window.location.search,
    import.meta.env.VITE_AERO_LIVE_ENABLED === 'true',
  ) === 'live';
const reviewing =
  window.location.pathname.replace(/\/$/, '') === '/route-review';
const RouteReview = lazy(() => import('./RouteReview'));
createRoot(document.getElementById('root')!).render(
  reviewing ? (
    <Suspense fallback={<p>Loading route review…</p>}>
      <RouteReview />
    </Suspense>
  ) : live ? (
    import.meta.env.VITE_AERO_APPLIANCE_ENABLED === 'true' ? (
      <Appliance />
    ) : (
      <LiveApp />
    )
  ) : (
    <App />
  ),
);

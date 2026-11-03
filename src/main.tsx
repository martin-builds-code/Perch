import { createRoot } from 'react-dom/client';
import App from './App';
import LiveApp from './LiveApp';
import Appliance from './Appliance';
import { displayMode } from './mode';
import './style.css';
const live=displayMode(window.location.search,import.meta.env.VITE_AERO_LIVE_ENABLED==='true')==='live';
createRoot(document.getElementById('root')!).render(live?(import.meta.env.VITE_AERO_APPLIANCE_ENABLED==='true'?<Appliance/>:<LiveApp/>):<App/>);

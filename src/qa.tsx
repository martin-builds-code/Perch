// Development-only stills, excluded from the production entry/build.
import { createRoot } from 'react-dom/client';
import { Display } from './App';
import { scenes } from './simulation';
import './style.css';
const params=new URLSearchParams(window.location.search);
const index=Math.max(0,scenes.findIndex(s=>s.id===params.get('scene')));
const scene=scenes[index];
const stress={...scene,primary:scene.primary?{...scene.primary,manufacturer:'International Demonstration Aircraft',model:'Extended Demonstration Aircraft Model',operator:'Northern Isles Regional Air Services Demonstration Operator',altitudeFt:null,distanceKm:null}:null};
createRoot(document.getElementById('root')!).render(<Display scene={params.has('stress')?stress:scene} index={index}/>);

import { useEffect, useState } from 'react';
import type { Aircraft,Scene } from './simulation';
import { altitude,distance,offsetFor,sceneAt,scenes } from './simulation';
const stateLabels={available:'Demo data available',delayed:'Data delayed · last sample',unavailable:'Data unavailable',standby:'No aircraft reported'};
function Airport({airport,label}:{airport:Aircraft['origin'];label:string}){
 return <div className="airport"><span className="eyebrow">{label}</span><div className="airport-code">{airport?.code??'—'}</div><div className="airport-name">{airport?.name??'Not reported'}</div></div>;
}
function Primary({aircraft,delayed}:{aircraft:Aircraft;delayed:boolean}){
 return <article className={'primary '+(delayed?'is-delayed':'')} aria-label="Primary aircraft">
  <div className="primary-top"><div className={"identity "+((aircraft.model?.length??0)>28?"extended-identity":"")}><div className="eyebrow accent">{delayed?'Last reported aircraft':'Featured aircraft'}</div><h1><span className="manufacturer">{aircraft.manufacturer??'Unidentified'}</span><span className={'model '+(aircraft.model===null?'unknown':aircraft.model.length>28?'very-long-model':aircraft.model.length>15?'long-model':'')}>{aircraft.model??'Aircraft'}</span></h1><div className="operator">{aircraft.operator??'Operator not reported'}</div></div>
   <div className="measurements"><div className="metric altitude"><span className="eyebrow">Barometric altitude</span><div className={"metric-value "+(aircraft.altitudeFt===null?"missing-value":"")}>{altitude(aircraft.altitudeFt)}<span className="unit">{aircraft.altitudeFt===null?'':'ft'}</span></div></div><div className="metric"><span className="eyebrow">Horizontal distance</span><div className={"metric-value distance "+(aircraft.distanceKm===null?"missing-value":"")}>{distance(aircraft.distanceKm)}<span className="unit">{aircraft.distanceKm===null?'':'km'}</span></div></div></div>
  </div>
  <div className="primary-bottom"><div className="route"><Airport airport={aircraft.origin} label="From"/><div className="route-connection" aria-hidden="true"><span/><svg viewBox="0 0 24 24"><path d="m21 12-7-3V4.5a2 2 0 0 0-4 0V9l-7 3v2l7-1v5l-2 1v2l4-1 4 1v-2l-2-1v-5l7 1z"/></svg><span/></div><Airport airport={aircraft.destination} label="To"/></div>
   <dl className="details"><div><dt>Callsign</dt><dd>{aircraft.callsign??'Not reported'}</dd></div><div><dt>Registration</dt><dd>{aircraft.registration??'Not reported'}</dd></div><div><dt>Direction</dt><dd>{aircraft.direction??'Not reported'}</dd></div></dl>
  </div>
 </article>;
}
function Secondary({aircraft}:{aircraft:Aircraft}){
 return <article className="nearby-aircraft"><div className="nearby-identity"><h3>{[aircraft.manufacturer,aircraft.model].filter(Boolean).join(' ')||'Unidentified aircraft'}</h3><p>{aircraft.operator??'Operator not reported'}<span className="secondary-id">{aircraft.callsign??aircraft.registration??'Identifier not reported'}</span></p></div><div className={"nearby-value "+(aircraft.altitudeFt===null?"missing-value":"")}><span>{altitude(aircraft.altitudeFt)}<small> {aircraft.altitudeFt===null?'':'ft'}</small></span><small>Barometric</small></div><div className={"nearby-value nearby-distance "+(aircraft.distanceKm===null?"missing-value":"")}><span>{distance(aircraft.distanceKm)}<small> {aircraft.distanceKm===null?'':'km'}</small></span><small>Horizontal</small></div></article>;
}
function Empty({unavailable}:{unavailable:boolean}){
 return <section className="empty-state"><div className="empty-mark" aria-hidden="true">{unavailable?'—':'·'}</div><div className="eyebrow accent">{unavailable?'Simulated interruption':'A quiet moment'}</div><h1>{unavailable?'Aircraft data unavailable':'Nothing nearby right now'}</h1><p>{unavailable?'Aircraft information is hidden until data returns.':'No relevant aircraft are reported in this demonstration.'}<br/>{unavailable?'The demonstration will recover automatically.':'The display will update automatically.'}</p></section>;
}
export function Display({scene,index=0}:{scene:Scene;index?:number}){
 return <><div className="portrait-note">Aero Pane<span>Please turn your iPad to landscape.</span><small>DEMO — SIMULATED DATA</small></div><main className="display" data-scene={scene.id}>
  <header><div className="wordmark">Aero Pane<span>Aircraft, at a glance.</span></div><div className="demo-badge"><span/>DEMO — SIMULATED DATA</div></header>
  <div className={'status-line status-'+scene.state}><span className="status-dot"/><span>{stateLabels[scene.state]}</span><span className="status-explainer">{scene.state==='delayed'?'Positions may be out of date':scene.state==='available'?'Fictional flights · display prototype':'Automatic updates'}</span></div>
  <div className="content" key={scene.id}>{scene.primary?<Primary aircraft={scene.primary} delayed={scene.state==='delayed'}/>:<Empty unavailable={scene.state==='unavailable'}/>}
   <section className="nearby" aria-label="Other nearby aircraft"><div className="section-heading"><h2>Also nearby</h2><span>{scene.secondary.length?`${scene.secondary.length} other aircraft`:'No other aircraft reported'}</span></div><div className="nearby-list">{scene.secondary.length?scene.secondary.map(aircraft=><Secondary key={aircraft.id} aircraft={aircraft}/>):<p className="nearby-empty">{scene.state==='unavailable'?'Nearby aircraft will appear when data returns.':'Clear skies in this demo snapshot.'}</p>}</div></section>
  </div>
  <footer><span>PERCH <i/> Display study 01</span><div className="scene-track" aria-label={'Demo scenario: '+scene.label}>{scenes.map((s,i)=><span key={s.id} className={i===index?'selected':''}/>)}<span className="scene-label">{scene.label}</span></div></footer>
 </main></>;
}
export default function App(){
 const [offset]=useState(()=>offsetFor(new URLSearchParams(window.location.search).get('scene')));
 const [active,setActive]=useState(()=>sceneAt(offset));
 useEffect(()=>{
  const start=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;let disposed=false;
  function update(){if(disposed)return;if(timer!==undefined)clearTimeout(timer);const next=sceneAt(offset+performance.now()-start);setActive(next);timer=setTimeout(update,Math.max(20,next.remaining));}
  function resize(){document.documentElement.style.setProperty('--app-height',`${window.visualViewport?.height??window.innerHeight}px`);}
  update();resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);document.addEventListener('visibilitychange',update);
  return()=>{disposed=true;if(timer!==undefined)clearTimeout(timer);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',update);};
 },[offset]);
 return <Display scene={active.scene} index={active.index}/>;
}

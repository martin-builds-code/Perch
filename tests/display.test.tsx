import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Display } from '../src/App';
import { scenes,sceneAt,cycleMs,offsetFor,fleet,altitude,distance } from '../src/simulation';

test('Every scenario persists the demo label and never claims live tracking',()=>{
 for(const scene of scenes){const html=renderToStaticMarkup(<Display scene={scene}/>);assert.match(html,/DEMO — SIMULATED DATA/);assert.doesNotMatch(html,/>LIVE</);assert.match(html,/Also nearby/);}
});
test('Complete identity prioritises model and labels barometric/horizontal units',()=>{
 const html=renderToStaticMarkup(<Display scene={scenes[0]}/>);
 for(const text of ['A320neo','Airbus','Barometric altitude','Horizontal distance','2,500','1.2','Northline Air','LIS','MAN'])assert.ok(html.includes(text),text);
 assert.ok(html.indexOf('A320neo')<html.indexOf('NLA 204'));
});
test('Three secondaries, no duplicate featured aircraft',()=>{
 assert.equal(scenes[1].secondary.length,3);
 for(const s of scenes){assert.ok(s.secondary.length<=3);assert.ok(!s.secondary.some(a=>a.id===s.primary?.id));}
});
test('Unknown values remain explicit and are not made up',()=>{
 const html=renderToStaticMarkup(<Display scene={scenes[4]}/>);
 for(const text of ['Unidentified','Aircraft','Operator not reported','Not reported'])assert.ok(html.includes(text));
 assert.equal(altitude(null),'Not reported');assert.equal(distance(null),'Not reported');
});
test('Unavailable state hides last aircraft and recovers automatically in schedule',()=>{
 const html=renderToStaticMarkup(<Display scene={scenes[7]}/>);
 assert.match(html,/Aircraft data unavailable/);assert.doesNotMatch(html,/A320neo/);
 assert.equal(sceneAt(offsetFor('recovery')).scene.state,'available');
 assert.equal(sceneAt(offsetFor('standby')).scene.primary,null);
});
test('Deterministic transitions at exact boundaries and repeated 18-hour simulation',()=>{
 let offset=0;for(const scene of scenes){assert.equal(sceneAt(offset).scene.id,scene.id);assert.equal(sceneAt(offset+scene.duration-1).scene.id,scene.id);offset+=scene.duration;}
 assert.equal(sceneAt(cycleMs).scene.id,'single');
 for(let ms=0;ms<64800000;ms+=1000){const a=sceneAt(ms);const b=sceneAt(ms+cycleMs*500);assert.equal(a.scene.id,b.scene.id);assert.ok(a.remaining>0);}
 assert.equal(offsetFor('nonsense'),0);
});
test('Long manufacturer/operator and missing altitude render without truncating source strings',()=>{
 const aircraft={...fleet[0],manufacturer:'Long demonstration aircraft manufacturer',model:'Citation Latitude Extended Demonstration',operator:'Northern Isles Regional Air Services Demonstration Operator',altitudeFt:null,distanceKm:null};
 const html=renderToStaticMarkup(<Display scene={{...scenes[0],primary:aircraft}}/>);
 assert.ok(html.includes(aircraft.model));assert.ok(html.includes(aircraft.operator));assert.match(html,/Not reported/);
});

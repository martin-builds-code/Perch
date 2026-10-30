export interface Aircraft {
  id:string; manufacturer:string|null; model:string|null; operator:string|null;
  altitudeFt:number|null; distanceKm:number|null; origin:{code:string;name:string}|null;
  destination:{code:string;name:string}|null; callsign:string|null; registration:string|null;
  direction:string|null;
}
// All entities and identifiers below are fictional; no geographic observation point.
export const fleet:Aircraft[]=[
 {id:'demo-1',manufacturer:'Airbus',model:'A320neo',operator:'Northline Air',altitudeFt:2500,distanceKm:1.2,origin:{code:'LIS',name:'Lisbon'},destination:{code:'MAN',name:'Manchester'},callsign:'NLA 204',registration:'DEMO-A1',direction:'North-east'},
 {id:'demo-2',manufacturer:'Boeing',model:'737-800',operator:'Coast & Cloud',altitudeFt:4200,distanceKm:4.6,origin:{code:'DUB',name:'Dublin'},destination:{code:'LPL',name:'Liverpool'},callsign:'CCL 318',registration:'DEMO-B2',direction:'South-east'},
 {id:'demo-3',manufacturer:'Embraer',model:'E190',operator:'Daybreak Airways',altitudeFt:6800,distanceKm:8.3,origin:{code:'AMS',name:'Amsterdam'},destination:{code:'MAN',name:'Manchester'},callsign:'DBK 71',registration:'DEMO-C3',direction:'West'},
 {id:'demo-4',manufacturer:'ATR',model:'72-600',operator:'Northern Isles Regional Air Services',altitudeFt:3100,distanceKm:3.8,origin:{code:'BHD',name:'Belfast City'},destination:{code:'MAN',name:'Manchester'},callsign:'NIR 412',registration:'DEMO-D4',direction:'East'},
 {id:'demo-5',manufacturer:'Cessna',model:'Citation Latitude',operator:null,altitudeFt:8500,distanceKm:11.4,origin:null,destination:{code:'LPL',name:'Liverpool'},callsign:null,registration:'DEMO-E5',direction:'South'},
 {id:'demo-6',manufacturer:null,model:null,operator:null,altitudeFt:2700,distanceKm:2.1,origin:null,destination:null,callsign:'DEMO 06',registration:null,direction:null}
];
export type State='available'|'delayed'|'unavailable'|'standby';
export interface Scene {id:string;label:string;duration:number;state:State;primary:Aircraft|null;secondary:Aircraft[];}
const [airbus,boeing,embraer,atr,jet,unknown]=fleet;
export const scenes:Scene[]=[
 {id:'single',label:'Single aircraft',duration:20000,state:'available',primary:airbus,secondary:[]},
 {id:'multiple',label:'Nearby traffic',duration:24000,state:'available',primary:airbus,secondary:[boeing,embraer,atr]},
 {id:'changing',label:'Aircraft transition',duration:18000,state:'available',primary:boeing,secondary:[airbus,embraer,jet]},
 {id:'regional',label:'Aircraft transition',duration:18000,state:'available',primary:atr,secondary:[boeing,jet]},
 {id:'incomplete',label:'Incomplete identification',duration:22000,state:'available',primary:unknown,secondary:[jet,embraer]},
 {id:'standby',label:'Standby',duration:18000,state:'standby',primary:null,secondary:[]},
 {id:'delayed',label:'Delayed data',duration:14000,state:'delayed',primary:airbus,secondary:[boeing]},
 {id:'unavailable',label:'Data interruption',duration:14000,state:'unavailable',primary:null,secondary:[]},
 {id:'recovery',label:'Automatic recovery',duration:18000,state:'available',primary:jet,secondary:[airbus,atr]}
];
export const cycleMs=scenes.reduce((sum,scene)=>sum+scene.duration,0);
export function offsetFor(id:string|null):number {
 let offset=0;for(const scene of scenes){if(scene.id===id)return offset;offset+=scene.duration;}return 0;
}
export function sceneAt(elapsedMs:number):{scene:Scene;index:number;remaining:number} {
 let position=((elapsedMs%cycleMs)+cycleMs)%cycleMs;
 for(let i=0;i<scenes.length;i++){const scene=scenes[i];if(position<scene.duration)return {scene,index:i,remaining:scene.duration-position};position-=scene.duration;}
 return {scene:scenes[0],index:0,remaining:scenes[0].duration};
}
export function altitude(value:number|null):string{return value===null?'Not reported':value.toLocaleString('en-GB');}
export function distance(value:number|null):string{return value===null?'Not reported':value.toFixed(1);}

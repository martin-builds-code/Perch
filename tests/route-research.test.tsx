import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { capturePolicy, inspectAssociation, researchAuthorised, RESEARCH_PROJECT } from '../server/routeResearchCapture';
import { normaliseHexdb } from '../server/hexdb';
import handler from '../api/route-research';
import type { ProviderTrace } from '../src/routeTraceTypes';
const T=Date.parse('2026-11-11T12:00:00Z'),token='x'.repeat(43);
const env={VERCEL:'1',VERCEL_ENV:'preview',VERCEL_PROJECT_ID:RESEARCH_PROJECT,AERO_ROUTE_RESEARCH:JSON.stringify({enabled:true,digest:createHash('sha256').update(token).digest('hex'),startedAtMs:T-1000,expiresAtMs:T+60000})};
test('R02 private capture is exact-Preview scoped, token protected, absolutely expiring and never an app session',()=>{
 assert.ok(capturePolicy(env,T));assert.ok(researchAuthorised('Bearer '+token,env,T));
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_PROJECT_ID:'other'},{VERCEL:'0'},{VERCEL_TARGET_ENV:'production'},{AERO_ROUTE_RESEARCH:'{}'},{AERO_ROUTE_RESEARCH:'invalid'}]) assert.equal(researchAuthorised('Bearer '+token,{...env,...patch},T),false);
 assert.equal(researchAuthorised('Bearer '+token,env,T+60000),false);
 assert.equal(researchAuthorised('Bearer '+token,env,T-2000),false);
 assert.equal(researchAuthorised('Bearer '+'y'.repeat(43),env,T),false);
 assert.equal(researchAuthorised(undefined,env,T),false);
 assert.equal(capturePolicy({...env,AERO_ROUTE_RESEARCH:JSON.stringify({enabled:true,digest:'a'.repeat(64),startedAtMs:T,expiresAtMs:T+3600001})},T),null);
});
const trace:ProviderTrace={outcome:'rejected',reason:'route-too-old',httpStatus:200,requestStarted:true,endpoint:'v2/routes/:callsign'};
const origin={iata:'AMS',icao:'EHAM',name:'Amsterdam',latitude:52,longitude:4},destination={iata:'MAN',icao:'EGCC',name:'Manchester'};
for(const [days,category] of [[20,'recent-0-180'],[180,'recent-0-180'],[181,'historical-180-365'],[365,'historical-180-365'],[366,'historical-over-365'],[542,'historical-over-365']] as const){
 test('R02 research preserves original timestamp, category and operational guard at '+days+' days',()=>{
  const raw={callsign:'TST123',origin,destination,updated_at:new Date(T-days*86400000).toISOString()};
  const inspected=inspectAssociation('abcdef','TST123',raw,trace,T);
  assert.equal(inspected.ageCategory,category);assert.equal(inspected.associationAgeDays,days);assert.equal(inspected.updatedAtRaw,raw.updated_at);assert.ok(inspected.completeIataPair);
  assert.equal(JSON.stringify(inspected).includes('latitude'),false);assert.equal(JSON.stringify(inspected).includes('longitude'),false);
  // R02's original operational verdict stays frozen in evidence; R03 now recovers these valid pairs.
  assert.ok(normaliseHexdb('route','abcdef','TST123',raw,T));
 });
}
test('R02 historical structural contradictions remain rejected; no invented route or timestamp',()=>{
 const raw={callsign:'WRONG',origin,destination,updated_at:new Date(T-542*86400000).toISOString()};
 const v=inspectAssociation('abcdef','TST123',raw,trace,T);assert.equal(v.completeIataPair,false);assert.equal(v.structuralReason,'contradictory-route');
 const missing=inspectAssociation('abcdef','TST123',null,{...trace,outcome:'negative',reason:'http-404',httpStatus:404},T);
 assert.equal(missing.ageCategory,'missing-unusable');assert.equal(missing.associationTimeMs,null);assert.equal(missing.origin,null);
 const bad=inspectAssociation('abcdef','TST123',{callsign:'TST123',origin,destination,updated_at:'invalid'},trace,T);assert.equal(bad.timestampValid,false);assert.equal(bad.ageCategory,'missing-unusable');
});
test('R02 private capture rejects anonymous requests before provider or configuration access',async()=>{
 const server=createServer((req,res)=>{void handler(req,res)});server.listen(0,'127.0.0.1');await once(server,'listening');
 try {const address=server.address();assert.ok(address&&typeof address==='object');const r=await fetch('http://127.0.0.1:'+address.port+'/api/route-research',{method:'POST'});assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'not-found'});}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

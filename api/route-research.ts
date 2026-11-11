// Temporary private R02 sampler; removed from the final review build.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { liveSnapshot } from '../server/service.js';
import { enrichmentService, LocalEnrichmentDeferral } from '../server/enrichmentService.js';
import { EnrichmentError } from '../server/hexdb.js';
import { ProviderError } from '../server/provider.js';
import { capturedRoute, capturePolicy, researchAuthorised } from '../server/routeResearchCapture.js';
import { flightKey, validHex } from '../src/enrichmentTypes.js';
let nextAllowed = 0, pending = false, attempts = 0;
const seen = new Set<string>();
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Content-Type','application/json');
  if (!researchAuthorised(req.headers.authorization)) { res.statusCode=404;res.end('{"error":"not-found"}');return; }
  if (req.method !== 'POST' || req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) {res.statusCode=400;res.end('{"error":"invalid-request"}');return;}
  if (process.env.AERO_ENRICHMENT_ENABLED !== 'true' || process.env.AERO_LIVE_ENABLED !== 'true') {res.statusCode=404;res.end('{"error":"not-found"}');return;}
  const excludedHeader=req.headers['x-aero-research-seen'];
  if(excludedHeader!==undefined && (typeof excludedHeader!=='string'||excludedHeader.length>512||!/^([a-f0-9]{6}:[A-Z0-9]{2,8})(,[a-f0-9]{6}:[A-Z0-9]{2,8})*$/.test(excludedHeader))){res.statusCode=400;res.end('{"error":"invalid-request"}');return;}
  const excluded=new Set(typeof excludedHeader==='string'?excludedHeader.split(','):[]);
  const now=Date.now();
  if(pending || now < nextAllowed){res.statusCode=503;res.setHeader('Retry-After',String(Math.ceil(Math.max(90000,nextAllowed-now)/1000)));res.end('{"error":"local-deferral"}');return;}
  if(attempts>=20){res.end('{"state":"attempt-limit"}');return;}
  nextAllowed=now+90000;pending=true;
  try {
    const snapshot=await liveSnapshot();
    const observedNow=Date.now();
    const candidates=snapshot.aircraft.filter(a=>validHex(a.id)&&flightKey(a.callsign)&&a.onGround!==true&&a.validity.position&&a.validity.timestamp&&a.distanceKm!==null&&a.distanceKm<=15&&a.positionTimeMs!==null&&observedNow-a.positionTimeMs>=0&&observedNow-a.positionTimeMs<=30000&&!seen.has(a.id+':'+flightKey(a.callsign))&&!excluded.has(a.id+':'+flightKey(a.callsign)));
    candidates.sort((a,b)=>{
      const commercial=(t:string|null)=>/^(A[23]\d\d|A38\d|B7\d\d|E[12]\d\d|AT[47][26])/.test(t??'');
      return Number(commercial(b.typeCode))-Number(commercial(a.typeCode))||(a.distanceKm!-b.distanceKm!)||a.id.localeCompare(b.id);
    });
    const a=candidates[0];
    if(!a){res.end(JSON.stringify({state:'waiting-for-new-aircraft',attempts,seen:seen.size,expiresAtMs:capturePolicy()?.expiresAtMs}));return;}
    const callsign=flightKey(a.callsign)!,key=a.id+':'+callsign;
    attempts++;
    const result=await enrichmentService.get('route',a.id,callsign,true);
    seen.add(key);
    const capture=capturedRoute(a.id,callsign);
    res.end(JSON.stringify({state:capture?'case':'cached-without-raw-context',attempts,cache:result.cache,skipKey:key,
      ...(capture?{case:{...capture,registration:a.registration,model:a.description,typeCode:a.typeCode,observedAtMs:snapshot.fetchedAtMs,providerObservedAtMs:snapshot.providerTimeMs,aircraftPositionAtMs:a.positionTimeMs,providerRequestStarted:result.cache==='miss'&&!!result.result.providerTrace?.requestStarted}}:{})}));
  } catch(e) {
    const local=e instanceof LocalEnrichmentDeferral;
    const delay=e instanceof EnrichmentError||e instanceof ProviderError?e.retryAfterMs:300000;
    nextAllowed=Math.max(nextAllowed,Date.now()+delay);
    res.statusCode=503;res.setHeader('Retry-After',String(Math.ceil(delay/1000)));
    res.end(JSON.stringify({error:local?'local-deferral':e instanceof EnrichmentError||e instanceof ProviderError?e.code:'unavailable',upstream:!local,attempts}));
  } finally {pending=false;}
}

// Hosted static assets and browser-intercepted fixtures. No server authentication
// is bypassed and no aviation provider is contacted by these fixture checks.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium }=await import(process.env.PERCH_PLAYWRIGHT_MODULE);
const url=process.env.PERCH_HOSTED_URL;
if(!url||!/^https:\/\/perch-aero-pane-stage3a(?:-[a-z0-9]+-mml3)?\.vercel\.app\/$/.test(url))throw Error('Authorised isolated Preview URL required');
const out=process.env.PERCH_HOSTED_OUTPUT??'docs/route-r04/hosted';
await mkdir(out,{recursive:true});
const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-http2','--disable-quic'],...(proxy?{proxy:{server:proxy}}:{})});
const results=[];
try{
  const locked=await browser.newPage({viewport:{width:1024,height:768}});
  let protectedPositionCalls=0;
  locked.on('request',r=>{if(new URL(r.url()).pathname==='/api/aircraft')protectedPositionCalls++;});
  await locked.goto(url+'?mode=live');
  await locked.getByLabel('Eight-digit PIN').waitFor();
  assert.equal(protectedPositionCalls,0);
  assert.equal(await locked.evaluate(()=>window.aeroPaneSkyDiagnostics),undefined);
  await locked.screenshot({path:out+'/pin.png'});
  await locked.close();
  for(const height of [768,624]){
    const page=await browser.newPage({viewport:{width:1024,height}});
    await page.clock.install({time:new Date('2026-11-12T12:00:00Z')});
    await page.clock.pauseAt(new Date('2026-11-12T12:00:00Z'));
    let single=false,positions=0,lookups=0,providerRequests=0;
    const errors=[];
    page.on('pageerror',e=>errors.push(e.name));
    page.on('request',r=>{if(/(^|\.)(adsb\.fi|hexdb\.io)$/.test(new URL(r.url()).hostname))providerRequests++;});
    await page.route('**/api/session',r=>r.fulfill({contentType:'application/json',body:'{"authenticated":true}'}));
    await page.route('**/api/aircraft',async r=>{
      positions++;const now=await page.evaluate(()=>Date.now());
      const aircraft=[['abcdef','Airbus A380-800','A388',.3,36025,'SYNTH1'],['123456','Boeing 787-9 Dreamliner','B789',5,6500,'SYNTH2']].slice(0,single?1:2).map(([id,description,typeCode,distanceKm,alt,callsign])=>({id,description,typeCode,distanceKm,callsign,registration:'SYNTHETIC',barometricAltitudeFt:alt,geometricAltitudeFt:alt,heightAboveObserverKm:alt*.0003048-.031,heightReference:'geometric',bearingDegrees:0,trackDegrees:180,groundSpeedKnots:300,onGround:false,positionTimeMs:now-1000,source:'adsb.fi',validity:{position:true,timestamp:true,anomalies:[]}}));
      await r.fulfill({contentType:'application/json',body:JSON.stringify({aircraft,fetchedAtMs:now,providerTimeMs:now,pollIntervalMs:15000,rejectedRecords:0,anomalies:[]})});
    });
    await page.route('**/api/enrichment?*',async r=>{
      lookups++;const now=await page.evaluate(()=>Date.now()),q=new URL(r.request().url()).searchParams,hex=q.get('hex'),kind=q.get('kind');
      const airport=code=>({code,iata:code,icao:null,name:code==='AMS'?'Amsterdam Schiphol':code==='MAN'?'Manchester':code});
      await r.fulfill({contentType:'application/json',body:JSON.stringify({kind,hex,callsign:q.get('callsign'),source:'hexdb.io',status:'found',data:kind==='aircraft'?{operator:'Synthetic airline'}:{origin:airport(hex==='abcdef'?'AMS':'DUB'),destination:airport(hex==='abcdef'?'MAN':'LHR'),associationTimeMs:now-(hex==='abcdef'?266:1)*86400000},fetchedAtMs:now,expiresAtMs:now+(kind==='aircraft'?1800000:300000)})});
    });
    await page.goto(url+'?mode=live&sky=1');
    await page.getByText('Historical route',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.aeroPaneSkyDiagnostics),undefined,'query cannot enable diagnostic access without the server lease');
    const artwork=()=>page.locator('.artwork-stage').boundingBox();
    const before=await artwork();
    await page.clock.fastForward(30000);
    await page.getByText('DUB',{exact:true}).waitFor();
    assert.deepEqual(await artwork(),before,'secondary route update preserves artwork');
    await page.screenshot({path:`${out}/multiple-${height}.png`});
    single=true;await page.clock.fastForward(15000);
    await page.locator('.nearby').waitFor({state:'detached'});
    assert.deepEqual(await artwork(),before,'single/multiple transition preserves artwork');
    await page.screenshot({path:`${out}/single-${height}.png`});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
    const header=await page.locator('.aircraft-header').boundingBox();
    assert.ok(header.y>=0&&header.y+header.height<=height);
    assert.equal(providerRequests,0);assert.deepEqual(errors,[]);
    results.push({height,browserInterceptedFixtures:true,positions,lookups,providerRequests,normalPinIndependentlyObserved:true,diagnosticsAbsentWithoutLease:true,historicalVisible:true,secondaryRoutePublished:true,stationaryArtwork:before,noOverflow:true,header});
    await page.close();
  }
  await writeFile(out+'/checks.json',JSON.stringify({url,checks:results,limitations:'Browser-intercepted synthetic API data; not authenticated live tracking. The unmodified hosted PIN screen and HTTP API protection were separately checked.'},null,2)+'\n');
  console.log('PASS hosted normal PIN, historical/secondary routes, absent diagnostics without lease, stationary artwork and no overflow at both iPad sizes; zero provider requests.');
}finally{await browser.close();}

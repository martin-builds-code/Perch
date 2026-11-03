// Compile and exercise the server as ordinary Node ESM, without Vite or tsx.
// Only synthetic data/configuration; this script never requests an external API.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = process.argv[2];
const output = artifact
  ? resolve(artifact)
  : mkdtempSync(join(tmpdir(), 'perch-server-runtime-'));
const scope = artifact
  ? existsSync(join(output, 'api/enrichment.js'))
    ? existsSync(join(output, 'api/aircraft.js'))
      ? 'both'
      : 'enrichment'
    : 'position'
  : 'both';
const env = { ...process.env, NODE_OPTIONS: '' };
// Do not inherit any private observation point or active live configuration.
for (const key of Object.keys(env)) {
  if (key.startsWith('AERO_') || key.startsWith('VITE_AERO_')) delete env[key];
}
try {
  if (!artifact) {
    execFileSync(
      process.execPath,
      [
        join(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        join(root, 'tsconfig.server.json'),
        '--noEmit',
        'false',
        '--rootDir',
        root,
        '--outDir',
        output,
      ],
      { cwd: root, env, stdio: 'inherit', timeout: 30_000 },
    );
    writeFileSync(join(output, 'package.json'), '{"type":"module"}\n');
  }
  const probe = String.raw`
    import assert from 'node:assert/strict';
    import { createServer } from 'node:http';
    import { once } from 'node:events';
    const scenario = process.env.PERCH_RUNTIME_SCENARIO;
    let clock = 1800000000000;
    if (scenario === 'timing' || scenario === 'refresh-failure') Date.now = () => clock;
    let providerCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      providerCalls++;
      assert.match(String(url), /^https:\/\/opendata\.adsb\.fi\/api\/v3\/lat\/60\/lon\/25\/dist\//);
      assert.ok(options.signal);
      if (scenario === 'failure' || (scenario === 'refresh-failure' && providerCalls === 2)) return new Response('{}', {status: 503});
      return new Response(JSON.stringify({
        msg: 'No error', now: Date.now(),
        ac: scenario === 'empty' ? [] : [
          {hex:'abcdef', desc:'BOEING 737 MAX 8', lat:60.01, lon:25, seen_pos:1, alt_baro:12000},
          {hex:'123456', desc:'Outside radius fixture', lat:61, lon:25, seen_pos:1},
        ],
      }), {headers: {'Content-Type': 'application/json'}});
    };
    const {default: handler} = await import(process.env.PERCH_RUNTIME_ENTRY);
    const server = createServer((req, res) => {void handler(req, res);});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await realFetch('http://127.0.0.1:'+server.address().port+'/api/aircraft');
      const body = await response.json();
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (scenario === 'disabled' || scenario === 'production') {
        assert.equal(response.status, 404);
        assert.equal(body.error, 'live-disabled');
        assert.equal(providerCalls, 0);
      } else if (scenario === 'failure') {
        assert.equal(response.status, 503);
        assert.equal(body.error, 'http-error');
        assert.equal(providerCalls, 1);
      } else {
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('vercel-cdn-cache-control'), 'max-age=10');
        assert.equal(body.aircraft.length, scenario === 'empty' ? 0 : 1);
        if (scenario === 'populated') {
          assert.equal(body.aircraft[0].description, 'Boeing 737 MAX 8');
          assert.ok(Math.abs(body.aircraft[0].distanceKm-1.1119508)<0.000001);
          assert.ok(body.aircraft[0].validity.timestamp);
        }
        assert.equal(providerCalls, 1);
      }
      if (scenario === 'timing') {
        for (const delta of [9999, 10000, 10001, 14900, 14999, 15000, 15001]) {
          clock = 1800000000000 + delta;
          const next = await realFetch('http://127.0.0.1:'+server.address().port+'/api/aircraft');
          assert.equal(next.status, 200);
          const value = await next.json();
          assert.equal(providerCalls, delta < 15000 ? 1 : 2);
          if (delta < 15000) assert.deepEqual(value, body);
          else assert.equal(value.fetchedAtMs, 1800000015000);
        }
        clock = 1800000030000;
        const burst = await Promise.all(Array.from({length: 12}, () => realFetch('http://127.0.0.1:'+server.address().port+'/api/aircraft')));
        assert.ok(burst.every(r => r.status === 200));
        await Promise.all(burst.map(r => r.json()));
        assert.equal(providerCalls, 3);
      }
      if (scenario === 'refresh-failure') {
        for (const delta of [15000, 15001, 30000]) {
          clock = 1800000000000 + delta;
          const next = await realFetch('http://127.0.0.1:'+server.address().port+'/api/aircraft');
          const value = await next.json();
          assert.equal(next.status, delta < 30000 ? 503 : 200);
          assert.equal(providerCalls, delta < 30000 ? 2 : 3);
          if (delta < 30000) {
            assert.equal(value.error, 'http-error');
            assert.equal(next.headers.get('vercel-cdn-cache-control'), null);
            assert.equal(next.headers.get('retry-after'), '15');
          } else assert.equal(value.fetchedAtMs, clock);
        }
      }
      assert.doesNotMatch(JSON.stringify(body), /latitude|longitude|rawDescription|opendata/);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(e=>e?reject(e):resolve()));
    }
    console.log('PASS emitted Node ESM HTTP handler: '+scenario);
  `;
  for (const scenario of scope === 'enrichment'
    ? []
    : ['disabled', 'production', 'populated', 'empty', 'failure', 'timing', 'refresh-failure']) {
    execFileSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: output,
      env: {
        ...env,
        PERCH_RUNTIME_ENTRY: pathToFileURL(join(output, 'api/aircraft.js'))
          .href,
        PERCH_RUNTIME_SCENARIO: scenario,
        AERO_LIVE_ENABLED: scenario === 'disabled' ? 'false' : 'true',
        AERO_OBSERVATION_LATITUDE: '60',
        AERO_OBSERVATION_LONGITUDE: '25',
        VERCEL_ENV: scenario === 'production' ? 'production' : 'preview',
      },
      stdio: 'inherit',
      timeout: 10_000,
    });
  }
  const enrichmentProbe = String.raw`
    import assert from 'node:assert/strict';
    import {createServer} from 'node:http';
    import {once} from 'node:events';
    const scenario=process.env.PERCH_RUNTIME_SCENARIO;
    const kind=scenario==='route'?'route':'aircraft';
    const realFetch=globalThis.fetch;let calls=0;
    globalThis.fetch=async url=>{
      calls++;assert.ok(String(url).startsWith('https://hexdb.io/api/v2/'));
      if(scenario==='failure')return new Response('{}',{status:503});
      if(scenario==='empty')return new Response('{}',{status:404});
      return new Response(JSON.stringify(kind==='route'?{callsign:'EIN17A',origin:{icao:'EIDW',iata:'DUB',name:'Dublin Airport'},destination:{icao:'EGLL',iata:'LHR',name:'Heathrow Airport'},updated_at:new Date(Date.now()-1000).toISOString()}:{hex:'ABCDEF',manufacturer:'Airbus',type:'A319 111',registration:'TEST-REG',registered_owner:'easyJet UK',operator_flag_code:'EZY'}));
    };
    const {default:handler}=await import(process.env.PERCH_RUNTIME_ENTRY);
    const server=createServer((req,res)=>{void handler(req,res);});server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const response=await realFetch('http://127.0.0.1:'+server.address().port+'/api/enrichment?kind='+kind+'&hex=abcdef'+(kind==='route'?'&callsign=EIN17A':''));const body=await response.json();
      assert.equal(response.headers.get('cache-control'),'no-store');
      if(scenario==='disabled'||scenario==='production'){assert.equal(response.status,404);assert.equal(calls,0);}
      else if(scenario==='failure'){assert.equal(response.status,503);assert.equal(body.error,'http-error');assert.equal(calls,1);}
      else{assert.equal(response.status,200);assert.equal(calls,1);assert.equal(body.status,scenario==='empty'?'not-found':'found');if(scenario==='populated')assert.equal(body.data.operator,'easyJet');if(scenario==='route')assert.equal(body.data.origin.code,'DUB');}
      assert.doesNotMatch(JSON.stringify(body),/latitude|longitude|registered_owner|images|credentials/);
    }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
    console.log('PASS emitted Node ESM enrichment HTTP handler: '+scenario);
  `;
  for (const scenario of scope === 'position'
    ? []
    : ['disabled', 'production', 'populated', 'route', 'empty', 'failure']) {
    execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', enrichmentProbe],
      {
        cwd: output,
        env: {
          ...env,
          PERCH_RUNTIME_ENTRY: pathToFileURL(join(output, 'api/enrichment.js'))
            .href,
          PERCH_RUNTIME_SCENARIO: scenario,
          AERO_LIVE_ENABLED: 'true',
          AERO_ENRICHMENT_ENABLED: scenario === 'disabled' ? 'false' : 'true',
          VERCEL_ENV: scenario === 'production' ? 'production' : 'preview',
        },
        stdio: 'inherit',
        timeout: 10000,
      },
    );
  }
} finally {
  if (!artifact) rmSync(output, { recursive: true, force: true });
}

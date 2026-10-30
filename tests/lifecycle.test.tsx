import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { cycleMs } from '../src/simulation';

test('Mounted React soak: 30 full cycles, one timer, stable nodes, listener cleanup',async()=>{
 const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://demo.example/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 let now=0,id=0;const timers=new Map<number,{fn:()=>void;at:number}>();
 const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
 const originalNow=Object.getOwnPropertyDescriptor(performance,'now');
 Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
 globalThis.setTimeout=((fn:()=>void,ms:number)=>{const key=++id;timers.set(key,{fn,at:now+ms});return key;}) as unknown as typeof setTimeout;
 globalThis.clearTimeout=((key:number)=>{timers.delete(key);}) as unknown as typeof clearTimeout;
 let resizeListeners=0,visibilityListeners=0;
 const addWindow=dom.window.addEventListener.bind(dom.window),removeWindow=dom.window.removeEventListener.bind(dom.window);
 const addDoc=dom.window.document.addEventListener.bind(dom.window.document),removeDoc=dom.window.document.removeEventListener.bind(dom.window.document);
 dom.window.addEventListener=((type:string,...args:unknown[])=>{if(type==='resize')resizeListeners++;return (addWindow as (...args:unknown[])=>void)(type,...args);}) as typeof addWindow;
 dom.window.removeEventListener=((type:string,...args:unknown[])=>{if(type==='resize')resizeListeners--;return (removeWindow as (...args:unknown[])=>void)(type,...args);}) as typeof removeWindow;
 dom.window.document.addEventListener=((type:string,...args:unknown[])=>{if(type==='visibilitychange')visibilityListeners++;return (addDoc as (...args:unknown[])=>void)(type,...args);}) as typeof addDoc;
 dom.window.document.removeEventListener=((type:string,...args:unknown[])=>{if(type==='visibilitychange')visibilityListeners--;return (removeDoc as (...args:unknown[])=>void)(type,...args);}) as typeof removeDoc;
 const memorySamples:number[]=[];
 const root=createRoot(document.getElementById('root')!);const counts=new Map<string,number>();
 try{
  await act(async()=>{root.render(<App/>);});
  for(let transition=0;transition<270;transition++){
   if(transition%45===0){globalThis.gc?.();memorySamples.push(process.memoryUsage().heapUsed);console.info('Soak transition',transition,'heap MiB',Math.round(process.memoryUsage().heapUsed/1048576));}
   assert.equal(timers.size,1);assert.equal(resizeListeners,1);assert.equal(visibilityListeners,1);
   const scene=document.querySelector('main')!.getAttribute('data-scene')!;
   const count=document.querySelectorAll('*').length;
   if(counts.has(scene))assert.equal(count,counts.get(scene));else counts.set(scene,count);
   const [key,next]=timers.entries().next().value!;timers.delete(key);now=next.at;
   await act(async()=>{next.fn();});
   // A browser has separate timer tasks. Yield a real task to release WeakRef
   // keep-alive roots; a microtask-only fixture falsely retains detached DOM.
   if(transition%9===8) await new Promise<void>(resolve=>realSet(resolve,0));
  }
  console.info('Soak heap samples bytes',JSON.stringify(memorySamples));
  if(globalThis.gc) assert.ok(memorySamples[memorySamples.length-1]-memorySamples[1]<8*1048576,'post-warmup heap growth exceeds fixture budget');
  assert.equal(now,cycleMs*30);assert.equal(counts.size,9);assert.equal(document.querySelector('main')!.getAttribute('data-scene'),'single');
  // Resume after an inactive tab: replace, do not accumulate, its pending timer.
  now+=cycleMs*3+120000;
  await act(async()=>{document.dispatchEvent(new dom.window.Event('visibilitychange'));});
  assert.equal(timers.size,1);assert.equal(document.querySelector('main')!.getAttribute('data-scene'),'delayed');
  await act(async()=>{root.unmount();});assert.equal(timers.size,0);assert.equal(resizeListeners,0);assert.equal(visibilityListeners,0);
 }finally{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;if(originalNow)Object.defineProperty(performance,'now',originalNow);else delete (performance as unknown as Record<string,unknown>).now;dom.window.close();}
});

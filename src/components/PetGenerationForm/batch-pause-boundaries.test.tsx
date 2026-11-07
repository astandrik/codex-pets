// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {expect,it,vi,afterEach} from 'vitest';
import {PetGenerationModes} from './PetGenerationModes';
import {runBatch} from './batch-runner';
import {createBatch,batchSnapshot} from './batch-model';
import type {BatchStore} from './batch-store';
const m=vi.hoisted(()=>({store:undefined as unknown}));
vi.mock('./batch-store',()=>({openBatchStore:async()=>m.store}));
afterEach(()=>vi.unstubAllGlobals());
it('returns to the single form when review is disabled and no batch exists',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('indexedDB',{});
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}));
 Object.defineProperty(navigator,'locks',{configurable:true,value:{query:async()=>({held:[]}),request:async(_k:unknown,_o:unknown,cb:(lock:object)=>unknown)=>cb({})}});
 m.store={read:async()=>null,maintain:async()=>{}};const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const render=(review:boolean)=>act(async()=>{root.render(<ThemeProvider theme="light"><PetGenerationModes enabled reviewBase={review}/></ThemeProvider>);await new Promise(r=>setTimeout(r,20));});
 try{
  await render(true);
  const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Пакет изображений')!;
  await act(async()=>button.click());await render(false);
  expect(host.querySelector('textarea')!.closest('[hidden]')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();}
});
it('can resume a definitely unsent paused row after a day without replacing its UUID',async()=>{
 let data=createBatch(),clock=Date.now();const requestId=crypto.randomUUID();
 data.items=[{id:crypto.randomUUID(),requestId,name:'synthetic.png',type:'image/png',state:'ready'}];
 const store:BatchStore={read:async()=>structuredClone(data),update:async(_id,fn)=>{data=fn(structuredClone(data));},readFile:async()=>new Blob(['x'],{type:'image/png'}),readPreview:async()=>null,add:async()=>{},clear:async()=>{},maintain:async()=>{}};
 const paused=new AbortController(),request=vi.fn(async()=>Response.json({generation:{generationId:'a'.repeat(64),expiresAt:new Date(clock+86400000).toISOString(),status:'queued'}}));
 await runBatch(store,{expected:batchSnapshot(data),signal:paused.signal,now:()=>clock,request,remember:()=>true,changed:()=>{if(data.items[0].state==='sending')paused.abort();}});
 expect(request).not.toHaveBeenCalled();expect(data.items[0].state).toBe('ready');
 clock+=2*86400000;
 await runBatch(store,{expected:batchSnapshot(data),signal:new AbortController().signal,now:()=>clock,request,remember:()=>true});
 expect(request).toHaveBeenCalledTimes(1);expect(data.items[0].requestId).toBe(requestId);
});
it('preserves the original deadline when pausing a replay of an uncertain request',async()=>{
 let data=createBatch(),clock=Date.now();const firstSentAt=clock-1000,requestId=crypto.randomUUID();
 data.items=[{id:crypto.randomUUID(),requestId,name:'pending.png',type:'image/png',state:'uncertain',firstSentAt}];
 const store:BatchStore={read:async()=>structuredClone(data),update:async(_id,fn)=>{data=fn(structuredClone(data));},readFile:async()=>new Blob(['x'],{type:'image/png'}),readPreview:async()=>null,add:async()=>{},clear:async()=>{},maintain:async()=>{}};
 const paused=new AbortController(),request=vi.fn();
 await runBatch(store,{expected:batchSnapshot(data),signal:paused.signal,now:()=>clock,request,changed:()=>{if(data.items[0].state==='sending')paused.abort();}});
 expect(data.items[0].state).toBe('uncertain');expect(data.items[0].firstSentAt).toBe(firstSentAt);expect(request).not.toHaveBeenCalled();
 clock+=2*86400000;
 await runBatch(store,{expected:batchSnapshot(data),signal:new AbortController().signal,now:()=>clock,request});
 expect(request).not.toHaveBeenCalled();expect(data.items[0].requestId).toBe(requestId);expect(data.message).toContain('истёк');
});
it('keeps a saved package in read-only mode and returns to single mode after its deletion',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('indexedDB',{});
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}));
 Object.defineProperty(navigator,'locks',{configurable:true,value:{query:async()=>({held:[]}),request:async(_k:unknown,_o:unknown,cb:(lock:object)=>unknown)=>cb({})}});
 let saved:ReturnType<typeof createBatch>|null=createBatch();saved.started=true;
 saved.items=[{id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'saved.png',type:'image/png',state:'accepted',receipt:{generationId:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}}];
 m.store={read:async()=>saved,readPreview:async()=>null,maintain:async()=>{},clear:async()=>{saved=null;}};
 const request=vi.fn();vi.stubGlobal('fetch',request);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const click=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!.click();
 try {
  await act(async()=>{root.render(<ThemeProvider theme="dark"><PetGenerationModes enabled={false} reviewBase={false}/></ThemeProvider>);await new Promise(r=>setTimeout(r,30));});
  await act(async()=>{await new Promise(r=>setTimeout(r,20));});
  expect(host.querySelectorAll('a[href*="/generated/"]')).toHaveLength(1);expect(host.querySelector('textarea')!.closest('[hidden]')).not.toBeNull();
  await act(async()=>click('Удалить локальный пакет'));await act(async()=>click('Удалить пакет'));
  expect(host.querySelector('.generation-batch')).toBeNull();expect(host.querySelector('textarea')!.closest('[hidden]')).toBeNull();expect(request).not.toHaveBeenCalled();
 } finally {await act(async()=>root.unmount());host.remove();}
});

// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {beforeEach,afterEach,it,vi,expect} from 'vitest';
import {createBatch,batchSchema,batchSnapshot,assertBatchSnapshot,pruneExpiredBatch,type ImageBatch,type BatchItem} from './batch-model';
import {PetGenerationBatch} from './PetGenerationBatch';
import {PetGenerationModes} from './PetGenerationModes';
import {runBatch} from './batch-runner';
import {mockImageDecoding,settleImagePreparation} from './image-test-utils';
import type {BatchStore} from './batch-store';
const m=vi.hoisted(()=>({open:vi.fn(),remember:vi.fn(()=>true)}));
vi.mock('./batch-store',()=>({openBatchStore:m.open}));
vi.mock('@/lib/pets/generation/history',()=>({rememberGenerationVersion:m.remember,reconcileGenerationHistoryReceipt:m.remember}));
let batch:ImageBatch|null,store:BatchStore,host:HTMLElement,root:Root,requests:string[],clears:string[];
const row=():BatchItem=>({id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'fixture.png',type:'image/png',state:'ready'});
const receipt=()=>({generationId:'b'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()});
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('indexedDB',{});
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}));
 Object.defineProperty(navigator,'locks',{configurable:true,value:{query:async()=>({held:[]}),request:async(_key:unknown,_opts:unknown,cb:(lock:object|null)=>unknown)=>cb({})}});
 batch=createBatch();batch.items.push(row());requests=[];clears=[];
 store={read:async()=>structuredClone(batch),update:async(id,fn)=>{if(!batch||batch.id!==id)throw Error('batch changed');batch=fn(structuredClone(batch));},readFile:async()=>new Blob(['x'],{type:'image/png'}),readPreview:async()=>null,add:async(x,_f,_p,expected)=>{assertBatchSnapshot(batch,expected);(batch??=createBatch()).items.push(x);},clear:async expected=>{assertBatchSnapshot(batch,expected);if(batch)clears.push(batch.id);batch=null;},maintain:async now=>{if(batch)batch=pruneExpiredBatch(batch,now);}};
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{if(init?.method!=='POST')throw Error('unexpected GET');requests.push(init.body.get('requestId'));return Response.json({generation:{generationId:requests.length.toString(16).padStart(64,'0'),expiresAt:new Date(Date.now()+86400000).toISOString(),status:'queued'}},{status:202});}));
 m.open.mockResolvedValue(store);host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.clearAllMocks();});
async function render(node=<PetGenerationBatch enabled/>){await act(async()=>root.render(<ThemeProvider theme="dark">{node}</ThemeProvider>));await act(async()=>{await new Promise(r=>setTimeout(r,20));});}
const btn=(name:string)=>[...host.querySelectorAll('button')].find(x=>x.textContent===name)!;
it('stale Create 1 sends nothing after the displayed list changes',async()=>{
 await render();const clicked=btn('Создать 1 питомцев');expect(clicked?.disabled).toBe(false);
 batch!.items.push(row(),row(),row());
 await act(async()=>clicked.click());expect(requests).toEqual([]);expect(host.textContent).toContain('Пакет изменился');
});
it('confirmation for A preserves newly created B',async()=>{
 const a=batch!.id;await render();await act(async()=>btn('Удалить локальный пакет').click());const clicked=btn('Удалить пакет');expect(clicked).toBeTruthy();
 batch=createBatch();const b=batch.id;batch.items.push({...row(),state:'accepted',receipt:receipt()});
 await act(async()=>clicked.click());expect(a).not.toBe(b);expect(clears).toEqual([]);expect(batch?.id).toBe(b);
});
it('stale drop preserves an expired batch with a still-live receipt',async()=>{
 await render();batch=createBatch(Date.now()-8*86400000);batch.started=true;batch.items.push({...row(),state:'accepted',receipt:receipt()});const b=batch.id;
 const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[new File(['x'],'fixture.txt',{type:'text/plain'})],items:[],types:['Files']}});
 await act(async()=>{host.querySelector('section')!.dispatchEvent(event);await new Promise(r=>setTimeout(r,0));});expect(clears).toEqual([]);expect(batch?.id).toBe(b);expect(batch?.items[0].receipt).toBeTruthy();
});
it('a legacy receipt with an explicit history error is reconciled without POST',async()=>{
 batch!.started=true;batch!.total=1;batch!.items=[{...row(),state:'accepted',historyWarning:true,receipt:receipt()}];await render();
 expect(host.querySelectorAll('a[href*="/generated/"]')).toHaveLength(1);
 await runBatch(store,{expected:batchSnapshot(batch),signal:new AbortController().signal,remember:m.remember});
 expect(m.remember).toHaveBeenCalledTimes(1);expect(requests).toEqual([]);
});
it('turning off review keeps previously accepted batch links accessible',async()=>{
 batch!.started=true;batch!.items=[{...row(),state:'accepted',receipt:receipt()}];
 await render(<PetGenerationModes enabled reviewBase={false}/>);expect(host.querySelectorAll('a[href*="/generated/"]')).toHaveLength(1);expect(requests).toEqual([]);
});
it('uncertain replays remain safe across the format change',async()=>{
 const id=batch!.items[0].requestId;batch=batchSchema.parse({...batch,items:[{...batch!.items[0],pendingBase:false,readFailures:0,nextPollAt:Date.now()+60000,state:'uncertain'}]});
 await runBatch(store,{expected:batchSnapshot(batch),signal:new AbortController().signal,remember:m.remember});expect(requests).toEqual([id]);expect(batch!.items[0].receipt).toBeTruthy();
});
it('visiting batch mode preserves the single-form draft and pending recovery controls',async()=>{
 batch=null;
 const {webcrypto}=await import('node:crypto');vi.stubGlobal('crypto',webcrypto);
 const transport=vi.fn(async()=>{throw Error('lost');});vi.stubGlobal('fetch',transport);
 await render(<PetGenerationModes enabled reviewBase/>);
 const input=host.querySelector('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'private synthetic prompt');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(1));});
 expect(host.textContent).toContain('Retry unchanged request');
 await act(async()=>btn('Пакет изображений').click());await act(async()=>btn('Один питомец').click());
 expect(host.querySelector('textarea')!.value).toBe('private synthetic prompt');expect(host.textContent).toContain('Retry unchanged request');

});

it('rejects replacement of one ready image by another even when the count stays one',async()=>{
 await render();const clicked=btn('Создать 1 питомцев');batch!.items=[row()];
 await act(async()=>clicked.click());expect(requests).toEqual([]);expect(host.textContent).toContain('Пакет изменился');
});
it('rejects a resume button when the entire saved package has changed',async()=>{
 batch!.started=true;await render();const clicked=btn('Продолжить пакет');
 batch=createBatch();batch.items=[row()];const newId=batch.id;
 await act(async()=>clicked.click());expect(requests).toEqual([]);expect(batch.id).toBe(newId);
});
it('retains original reference bytes and request UUID through a mode switch after a lost response',async()=>{
 batch=null;const images=mockImageDecoding();const {webcrypto}=await import('node:crypto');vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('URL',{createObjectURL:()=> 'blob:single',revokeObjectURL:vi.fn()});
 const bodies:FormData[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{bodies.push(init.body);if(bodies.length===1)throw Error('lost');return Response.json({generation:{generationId:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}});}));
 try {
  await render(<PetGenerationModes enabled reviewBase/>);
  const file=new File(['unchanged original bytes'],'source.png',{type:'image/png'});
  const input=host.querySelector('input[type="file"]')!;Object.defineProperty(input,'files',{configurable:true,value:[file]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));await settleImagePreparation(host);
  await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await vi.waitFor(()=>expect(bodies).toHaveLength(1));});
  await act(async()=>btn('Пакет изображений').click());expect(host.querySelector('[inert]')).toBeTruthy();
  await act(async()=>btn('Один питомец').click());expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:single');
  await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await vi.waitFor(()=>expect(bodies).toHaveLength(2));});
  expect(bodies[1].get('requestId')).toBe(bodies[0].get('requestId'));
  expect(new Uint8Array(await (bodies[1].get('referenceImage') as File).arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
 } finally {images.restore();}
});

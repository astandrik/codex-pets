// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createBatch,type ImageBatch} from './batch-model';
import {PetGenerationBatch} from './PetGenerationBatch';
import {PetGenerationModes} from './PetGenerationModes';

const mocks=vi.hoisted(()=>({open:vi.fn(),run:vi.fn(),clear:vi.fn(),prepare:vi.fn()}));
vi.mock('./batch-store',()=>({openBatchStore:mocks.open}));
vi.mock('./batch-runner',()=>({runBatch:mocks.run}));
vi.mock('./prepare-reference-image',async original=>({...await original<typeof import('./prepare-reference-image')>(),prepareReferenceImage:mocks.prepare}));
let host:HTMLDivElement,root:Root,batch:ImageBatch;
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('indexedDB',{});
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})));
  Object.defineProperty(navigator,'locks',{configurable:true,value:{query:async()=>({held:[]}),request:async(_n:unknown,_o:unknown,fn:(lock:object)=>unknown)=>fn({})}});
  batch=createBatch();mocks.open.mockResolvedValue({read:async()=>structuredClone(batch),readPreview:async()=>null,update:async(_id:string,fn:(b:ImageBatch)=>ImageBatch)=>{batch=fn(structuredClone(batch));},clear:mocks.clear,maintain:async()=>{}});
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.clearAllMocks();});
async function render(){await act(async()=>root.render(<ThemeProvider theme="dark"><PetGenerationBatch enabled/></ThemeProvider>));await act(async()=>{await new Promise(r=>setTimeout(r,10));});}
it('renders all 100 accepted links beyond the 50-family history limit without dispatching',async()=>{
  batch.started=true;batch.total=100;
  batch.items=Array.from({length:100},(_,i)=>({id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:`image-${i}.png`,type:'image/png',state:'accepted',receipt:{generationId:i.toString(16).padStart(64,'0'),expiresAt:new Date(Date.now()+86400000).toISOString()}}));
  await render();expect(host.textContent).toContain('Принято 100 из 100');expect(host.querySelectorAll('a[href*="/generated/"]')).toHaveLength(100);expect(mocks.run).not.toHaveBeenCalled();expect(host.textContent).not.toContain('До проверки основы:');
});
it('requires explicit resume after reload and keeps the receipt when history failed',async()=>{
  batch.started=true;batch.total=2;batch.items=[{id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'one.png',type:'image/png',state:'accepted',historyWarning:true,receipt:{generationId:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}},{id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'two.png',type:'image/png',state:'uncertain'}];
  const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('full');});
  await render();write.mockRestore();expect(host.textContent).toContain('Продолжить пакет');expect(host.textContent).toContain('Ссылку не удалось сохранить');expect(mocks.run).not.toHaveBeenCalled();
  const button=[...host.querySelectorAll('button')].find(x=>x.textContent==='Продолжить пакет')!;
  await act(async()=>button.click());expect(mocks.run).toHaveBeenCalledTimes(1);
});
it('does not treat unavailable local storage as an empty new batch',async()=>{
  mocks.open.mockRejectedValueOnce(Error('quota'));await render();expect(host.textContent).toContain('Хранилище браузера недоступно');
  expect(host.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);expect(mocks.run).not.toHaveBeenCalled();
});
it('opens the saved batch after returning to /generate without starting it',async()=>{
  batch.started=true;batch.total=1;batch.items=[{id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'left.png',type:'image/png',state:'uncertain'}];
  await act(async()=>root.render(<ThemeProvider theme="dark"><PetGenerationModes enabled reviewBase/></ThemeProvider>));
  await act(async()=>{await new Promise(r=>setTimeout(r,20));});
  expect(host.textContent).toContain('Продолжить пакет');expect(mocks.run).not.toHaveBeenCalled();
});
it('does not dispatch two runs for a double click',async()=>{
  batch.items=[{id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'one.png',type:'image/png',state:'ready'}];
  await render();const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Создать 1 питомцев')!;
  await act(async()=>{button.click();button.click();});expect(mocks.run).toHaveBeenCalledTimes(1);
});
it('reads clipboard file items when the browser files list is empty, without submitting',async()=>{
  const add=vi.fn();mocks.open.mockResolvedValue({read:async()=>batch,readPreview:async()=>null,add,maintain:async()=>{}});mocks.prepare.mockRejectedValueOnce(Error('unreadable'));
  await render();const file=new File(['image'],'clipboard.png',{type:'image/png'}),event=new Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{files:[],items:[{kind:'file',getAsFile:()=>file}]}});
  await act(async()=>{host.querySelector('section')!.dispatchEvent(event);await new Promise(r=>setTimeout(r,0));});
  expect(event.defaultPrevented).toBe(true);expect(mocks.prepare).toHaveBeenCalledWith(file,expect.any(AbortSignal));
  expect(add).toHaveBeenCalledTimes(1);expect(mocks.run).not.toHaveBeenCalled();
});

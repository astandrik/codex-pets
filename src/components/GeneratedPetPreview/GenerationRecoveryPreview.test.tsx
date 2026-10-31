// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {afterEach,expect,it,vi} from 'vitest';
import {GenerationRecoveryPreview} from './GenerationRecoveryPreview';
import {CONTINUATION_STATES,type ContinuationOptions} from '@/lib/pets/generation/continuation-model';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as typeof window.matchMedia;
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('loads a shared atlas once and preserves playback pause, selection and focus',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const changed=vi.fn();
 const fetch=vi.fn(async()=>({ok:true,blob:async()=>new Blob(['image'])}));vi.stubGlobal('fetch',fetch);vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:atlas');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const strips:ContinuationOptions['strips']=CONTINUATION_STATES.map((state,row)=>({state,status:'saved',uncertain:false,preview:{kind:'atlas-row',url:'/private-atlas',row,frames:6}}));
 await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationRecoveryPreview strips={strips} required={[]} selected={[]} disabled={false} rebuild={false} onChange={changed}/></ThemeProvider>));
 await act(async()=>{await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));});
 const buttons=[...host.querySelectorAll('button')];const first=buttons.find(x=>x.getAttribute('aria-label')==='Просмотреть: Покой')!;
 await act(async()=>first.click());const dialog=document.querySelector('[role="dialog"]')!;
 await act(async()=>[...dialog.querySelectorAll('button')].find(x=>x.textContent==='Пауза')!.click());
 await act(async()=>dialog.querySelector<HTMLButtonElement>('[aria-label="Следующее изображение"]')!.click());
 expect(dialog.textContent).toContain('Воспроизвести');
 await act(async()=>dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());expect(changed).toHaveBeenCalled();expect(fetch).toHaveBeenCalledOnce();
 await act(async()=>dialog.querySelector<HTMLButtonElement>('[aria-label="Закрыть просмотр"]')!.click());
 await act(async()=>root.unmount());host.remove();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:atlas');vi.restoreAllMocks();vi.unstubAllGlobals();
});
it('limits loading to two concurrent raw files',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let active=0,max=0;const finish:Array<()=>void>=[];
 const fetch=vi.fn(()=>new Promise(resolve=>{active++;max=Math.max(max,active);finish.push(()=>{active--;resolve({ok:true,blob:async()=>new Blob(['x'])});});}));vi.stubGlobal('fetch',fetch);vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:raw');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const strips:ContinuationOptions['strips']=CONTINUATION_STATES.map(state=>({state,status:'saved',uncertain:false,preview:{kind:'source-image',url:'/'+state}}));
 await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationRecoveryPreview strips={strips} required={[]} selected={[]} disabled={false} rebuild={false} onChange={()=>{}}/></ThemeProvider>));
 expect(fetch).toHaveBeenCalledTimes(2);for(let i=0;i<11;i++)await act(async()=>finish[i]?.());expect(fetch).toHaveBeenCalledTimes(11);expect(max).toBe(2);
 await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();
});

it('does not start an animation timer for static raw-only previews',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);const interval=vi.spyOn(globalThis,'setInterval');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob(['image'])})));vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:raw');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationRecoveryPreview strips={CONTINUATION_STATES.map(state=>({state,status:'saved',uncertain:false,preview:{kind:'source-image',url:'/raw'}}))} required={[]} selected={[]} disabled={false} rebuild={false} onChange={()=>{}}/></ThemeProvider>));
  expect(interval.mock.calls.filter(([,ms])=>ms===140)).toHaveLength(0);
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('starts atlas playback only after loading and preserves tab visibility and pause',async()=>{
 vi.useFakeTimers();let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 const interval=vi.spyOn(globalThis,'setInterval'),clear=vi.spyOn(globalThis,'clearInterval');
 let finish!:()=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{finish=()=>resolve({ok:true,blob:async()=>new Blob(['atlas'])});})));
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:atlas');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const timers=()=>interval.mock.calls.map((args,i)=>({delay:args[1],id:interval.mock.results[i].value})).filter(t=>t.delay===140);
 try{
  await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationRecoveryPreview strips={[{state:'idle',status:'saved',uncertain:false,preview:{kind:'atlas-row',url:'/atlas',row:0,frames:6}}]} required={[]} selected={[]} disabled={false} rebuild={false} onChange={()=>{}}/></ThemeProvider>));
  expect(timers()).toHaveLength(0);await act(async()=>finish());expect(timers()).toHaveLength(1);
  hidden=true;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(clear).toHaveBeenCalledWith(timers()[0].id);
  hidden=false;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(timers()).toHaveLength(2);
  await act(async()=>host.querySelector<HTMLButtonElement>('.recovery-preview__heading button')!.click());expect(clear).toHaveBeenCalledWith(timers()[1].id);
  hidden=true;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));hidden=false;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(timers()).toHaveLength(2);
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('keeps raw strip arrows available for scrolling while retaining image navigation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob(['raw'])})));vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:raw');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<ThemeProvider theme="light"><GenerationRecoveryPreview strips={CONTINUATION_STATES.slice(0,2).map(state=>({state,status:'saved',uncertain:false,preview:{kind:'source-image',url:'/raw'}}))} required={[]} selected={[]} disabled={false} rebuild={false} onChange={()=>{}}/></ThemeProvider>));
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Просмотреть: Покой"]')!.click());
  const raw=document.querySelector<HTMLElement>('.recovery-preview__raw-large')!;
  expect(raw.tabIndex).toBe(0);raw.focus();expect(document.activeElement).toBe(raw);
  for(const key of ['ArrowLeft','ArrowRight']){const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});await act(async()=>raw.dispatchEvent(event));expect(event.defaultPrevented).toBe(false);expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Покой');}
  await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Следующее изображение"]')!.click());expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Работа');
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('stops playback when all shared-atlas cards leave the viewport without dropping cached images',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const interval=vi.spyOn(globalThis,'setInterval'),clear=vi.spyOn(globalThis,'clearInterval');
 const observers:Array<{nodes:Set<Element>;emit:(target:Element,isIntersecting:boolean)=>void}>=[];
 vi.stubGlobal('IntersectionObserver',class{
  nodes=new Set<Element>();
  constructor(private callback:(entries:Array<Pick<IntersectionObserverEntry,'target'|'isIntersecting'>>)=>void){observers.push(this);}
  observe(node:Element){this.nodes.add(node);}disconnect(){this.nodes.clear();}
  emit(target:Element,isIntersecting:boolean){this.callback([{target,isIntersecting}]);}
 });
 const fetch=vi.fn(async()=>({ok:true,blob:async()=>new Blob(['atlas'])}));vi.stubGlobal('fetch',fetch);
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:atlas');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const timers=()=>interval.mock.calls.map((args,i)=>({delay:args[1],id:interval.mock.results[i].value})).filter(t=>t.delay===140);
 try{
  await act(async()=>root.render(<ThemeProvider theme="light"><GenerationRecoveryPreview strips={CONTINUATION_STATES.slice(0,2).map((state,row)=>({state,status:'saved',uncertain:false,preview:{kind:'atlas-row',url:'/atlas',row,frames:6}}))} required={[]} selected={[]} disabled={false} rebuild={false} onChange={()=>{}}/></ThemeProvider>));
  const cards=host.querySelectorAll('.recovery-preview__card');
  const visible=async(index:number,value:boolean)=>act(async()=>observers.forEach(observer=>observer.emit(cards[index],value)));
  expect(timers()).toHaveLength(0);await visible(0,true);expect(timers()).toHaveLength(1);expect(fetch).toHaveBeenCalledOnce();
  await visible(1,true);await visible(0,false);expect(clear).not.toHaveBeenCalledWith(timers()[0].id);
  await visible(1,false);expect(clear).toHaveBeenCalledWith(timers()[0].id);
  await visible(0,true);expect(timers()).toHaveLength(2);expect(fetch).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());host.remove();}
 expect(observers.every(observer=>observer.nodes.size===0)).toBe(true);
});

it('starts paused with reduced motion but allows explicit playback',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
 const interval=vi.spyOn(globalThis,'setInterval');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob(['atlas'])})));
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:atlas');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationRecoveryPreview strips={[{state:'idle',status:'saved',uncertain:false,preview:{kind:'atlas-row',url:'/atlas',row:0,frames:6}}]} required={[]} selected={[]} disabled={false} rebuild={false} onChange={()=>{}}/></ThemeProvider>));
  expect(interval.mock.calls.filter(([,ms])=>ms===140)).toHaveLength(0);
  await act(async()=>host.querySelector<HTMLButtonElement>('.recovery-preview__heading button')!.click());
  expect(interval.mock.calls.filter(([,ms])=>ms===140)).toHaveLength(1);
 }finally{await act(async()=>root.unmount());host.remove();}
});

// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {expect,it,vi} from 'vitest';
import {GenerationRecoveryPreview} from './GenerationRecoveryPreview';
import {CONTINUATION_STATES,type ContinuationOptions} from '@/lib/pets/generation/continuation-model';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as typeof window.matchMedia;
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

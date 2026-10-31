// @vitest-environment jsdom
import path from 'node:path';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {compile} from 'sass';
import {ThemeProvider} from '@gravity-ui/uikit';
import {expect,it,vi} from 'vitest';
import {GenerationRecoveryPreview} from './GenerationRecoveryPreview';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as typeof window.matchMedia;

it.each(['light','dark'] as const)('keeps dialog controls at least 44 by 44 in %s theme',async theme=>{
 const host=document.createElement('div'),style=document.createElement('style');document.body.append(host);
 style.textContent=compile(path.resolve('src/components/GeneratedPetPreview/GenerationRecoveryView.scss')).css;document.head.append(style);
 const root=createRoot(host);vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>new Blob(['image'])})));
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:raw');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 try{
  await act(async()=>root.render(<ThemeProvider theme={theme}><GenerationRecoveryPreview strips={[{state:'idle',status:'saved',uncertain:false,preview:{kind:'source-image',url:'/raw'}}]} required={[]} selected={[]} disabled={false} rebuild={false} onChange={()=>{}}/></ThemeProvider>));
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Просмотреть: Покой"]')!.click());
  for(const name of ['Закрыть просмотр','Предыдущее изображение','Следующее изображение']){
   const button=document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;const css=getComputedStyle(button);
   expect(parseFloat(css.minWidth),name).toBeGreaterThanOrEqual(44);expect(parseFloat(css.minHeight),name).toBeGreaterThanOrEqual(44);
  }
 }finally{await act(async()=>root.unmount());host.remove();style.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});

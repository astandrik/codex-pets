// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {ThemeProvider} from '@gravity-ui/uikit';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {HomeGeneratedPetExample} from './HomeGeneratedPetExample';
import type {PublicPetSummary} from '@/lib/pets/types';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const pet={slug:'trolleybus',displayName:'Trolleybus',spritesheetUrl:'/api/assets/demo/spritesheet.webp'} as PublicPetSummary;
let root:Root,el:HTMLDivElement;
beforeEach(()=>{el=document.createElement('div');document.body.append(el);root=createRoot(el);});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals();});
it('SSR renders a paused first frame and a neutral missing-example fallback',()=>{
 expect(renderToStaticMarkup(<HomeGeneratedPetExample pet={pet}/>)).toContain('animation-play-state:paused');
 const fallback=renderToStaticMarkup(<HomeGeneratedPetExample pet={null}/>);expect(fallback).not.toContain('Made with');expect(fallback).toContain('/#gallery');
});
it('pauses for visibility without changing the user choice or creating operations',async()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request);
 await act(async()=>root.render(<ThemeProvider theme="dark"><HomeGeneratedPetExample pet={pet}/></ThemeProvider>));
 const img=el.querySelector('img')!;expect(img.style.animationPlayState).toBe('paused');
 await act(async()=>el.querySelector('button')!.click());expect(img.style.animationPlayState).toBe('running');
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(img.style.animationPlayState).toBe('paused');
 visibility.mockReturnValue('visible');await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(img.style.animationPlayState).toBe('running');
 await act(async()=>el.querySelector('button')!.click());expect(img.style.animationPlayState).toBe('paused');expect(request).not.toHaveBeenCalled();visibility.mockRestore();
});

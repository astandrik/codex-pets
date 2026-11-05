// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-unused-vars, @next/next/no-img-element, jsx-a11y/alt-text */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ThemeProvider} from '@gravity-ui/uikit';
import {MyGenerations} from '@/components/MyGenerations/MyGenerations';
import {pruneHistoryStatuses} from '@/components/MyGenerations/history-status-cache';
import {HISTORY_PREFIX,HISTORY_V2_PREFIX,rememberGenerationVersion,readGenerationHistory} from '@/lib/pets/generation/history';
vi.mock('next/link',()=>({default:({children,prefetch:_,...props}:React.ComponentProps<'a'>&{prefetch?:boolean})=><a {...props}>{children}</a>}));
vi.mock('next/image',()=>({default:({unoptimized:_,...props}:React.ComponentProps<'img'>&{unoptimized?:boolean})=><img {...props}/>}));
const id=(n:number)=>n.toString(16).padStart(64,'0'),now=Date.parse('2026-11-05T10:00:00Z'),day=86400000;
let root:Root,element:HTMLDivElement;
const data=(n:number,status='completed',extra={})=>({generationId:id(n),status,createdAt:new Date(now+n).toISOString(),expiresAt:new Date(now+day).toISOString(),progress:{completedSteps:12,totalSteps:12},pet:{displayName:'Fox '+n},...extra});
const response=(n:number,status='completed',extra={})=>({ok:true,status:200,json:async()=>({generation:data(n,status,extra)})});
function save(n:number,parent?:number){return rememberGenerationVersion(data(n),parent?{generationId:id(parent),kind:'continuation'}:undefined,now+100);}
async function render(){await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now+100);localStorage.clear();pruneHistoryStatuses([]);element=document.createElement('div');document.body.append(element);root=createRoot(element);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('groups legacy siblings immediately when their shared parent is absent',async()=>{
 for(const n of [2,3])localStorage.setItem(HISTORY_PREFIX+id(n),JSON.stringify({generationId:id(n),savedAt:now+n,expiresAt:now+day}));
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(response(Number.parseInt(url.slice(-2),16),'completed',{continuation:{sourceGenerationId:id(1),mode:'regenerate'}}))));
 await render();
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);
});
it('keeps the child current when its legacy expired parent was first opened later',async()=>{
 localStorage.setItem(HISTORY_PREFIX+id(1),JSON.stringify({generationId:id(1),savedAt:now+50,expiresAt:now+60}));
 save(2,1);vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(response(2,'queued'))));await render();
 const actions=element.querySelector('.my-generations__actions')!;
 expect(actions.querySelector(`a[href="/generated/${id(2)}"]`)).not.toBeNull();
});
it('does not silently change the focused action to a newer task',async()=>{
 save(1);vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(response(Number.parseInt(url.slice(-2),16)))));await render();
 const link=element.querySelector<HTMLAnchorElement>('.my-generations__actions a')!;link.focus();
 await act(async()=>{save(2,1);window.dispatchEvent(new StorageEvent('storage',{key:HISTORY_V2_PREFIX+id(2)}));});
 expect(document.activeElement?.getAttribute('href')).toBe('/generated/'+id(1));
});
it('cleans expired physical records when only using the generation saver',()=>{
 save(1);expect(localStorage.getItem(HISTORY_V2_PREFIX+id(1))).not.toBeNull();
 const later=now+9*day;vi.setSystemTime(later);
 rememberGenerationVersion({generationId:id(2),createdAt:new Date(later).toISOString(),expiresAt:new Date(later+day).toISOString()},undefined,later);
 expect(readGenerationHistory(later).entries.map(e=>e.generationId)).toEqual([id(2)]);
 expect(localStorage.getItem(HISTORY_V2_PREFIX+id(1))).toBeNull();
});
it('preserves unavailable summary focus and expansion during a late merge',async()=>{
 save(1);save(2);save(3,2);
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(url.endsWith(id(3))?{ok:false,status:410,json:async()=>({})}:response(Number.parseInt(url.slice(-2),16)))));await render();
 const details=element.querySelector<HTMLDetailsElement>('details')!;details.open=true;details.querySelector<HTMLElement>('summary')!.focus();
 await act(async()=>{save(2,1);window.dispatchEvent(new StorageEvent('storage',{key:HISTORY_V2_PREFIX+id(2)}));});
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);
 expect(document.activeElement).toBe(element.querySelector('summary'));
 expect(element.querySelector('details')?.open).toBe(true);
});

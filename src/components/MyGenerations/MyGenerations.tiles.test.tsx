// @vitest-environment jsdom
/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text, @typescript-eslint/no-unused-vars */
import "./browser.test-utils";
import {act, type ComponentProps} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MyGenerations} from './MyGenerations';
import {pruneHistoryStatuses} from './history-status-cache';
import {HISTORY_V2_PREFIX,SUBMISSION_HISTORY_PREFIX,rememberGenerationVersion,rememberGenerationSubmission,type HistoryGeneration} from '@/lib/pets/generation/history';
vi.mock('next/link',()=>({default:({children,prefetch:_,...props}:ComponentProps<'a'>&{prefetch?:boolean})=><a {...props}>{children}</a>}));
vi.mock('next/image',()=>({default:({unoptimized:_,...props}:ComponentProps<'img'>&{unoptimized?:boolean})=><img {...props}/>}));
const now=Date.parse('2026-11-08T10:00:00Z'),day=86400000;
const id=(n:number)=>n.toString(16).padStart(64,'0');
const receipt={petId:'pet_fox',slug:'fox',submittedAt:new Date(now).toISOString()};
let root:Root,element:HTMLDivElement;
const generations=new Map<string,HistoryGeneration>();
const request=vi.fn();
function save(n:number,extra:Partial<HistoryGeneration>={},parent?:number){
 const generation:HistoryGeneration={generationId:id(n),status:'completed',createdAt:new Date(now+n).toISOString(),expiresAt:new Date(now+day).toISOString(),progress:{completedSteps:12,totalSteps:12},pet:{displayName:'Fox '+n},baseUrl:'/base',...extra};
 generations.set(id(n),generation);rememberGenerationVersion(generation,parent?{generationId:id(parent),kind:'continuation'}:undefined);return generation;
}
const trigger=(n:number)=>element.querySelector<HTMLButtonElement>(`button[data-generation-id="${id(n)}"]`)!;
const dialog=()=>document.querySelector<HTMLElement>('[role="dialog"]')!;
async function render(){await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));}
async function open(n:number){const button=trigger(n);expect(button).not.toBeNull();await act(async()=>{button.focus();button.click();});await act(async()=>vi.advanceTimersByTimeAsync(200));return button;}
async function close(){await act(async()=>[...dialog().querySelectorAll('button')].find(b=>b.textContent==='Закрыть')!.click());await act(async()=>vi.advanceTimersByTimeAsync(400));}
function storage(){return Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]));}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);localStorage.clear();pruneHistoryStatuses([]);generations.clear();request.mockReset();
 request.mockImplementation((url:string)=>Promise.resolve({ok:true,status:200,json:async()=>({generation:generations.get(url.split('/').at(-1)!)})}));vi.stubGlobal('fetch',request);
 element=document.createElement('div');document.body.append(element);root=createRoot(element);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('keeps exact dates in a real dialog without reading or rewriting history on open',async()=>{
 save(1,{submission:receipt,expiresAt:new Date(now+2*3600000).toISOString(),canContinue:true});localStorage.setItem('pending-request','same-uuid-and-image');await render();
 const row=element.querySelector('.my-generations__item')!;
 expect(row.textContent).toContain('Доступен ещё 2 ч');expect(row.textContent).not.toContain('Saved');expect(row.textContent).not.toContain('Available until');
 expect(row.querySelectorAll('.my-generations__actions a')).toHaveLength(1);
 const before=storage(),count=request.mock.calls.length;const button=await open(1);
 expect(button.textContent).toBe('Даты и детали');expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
 expect(dialog().textContent).toContain('Текущая версия');expect(dialog().textContent).toContain('Saved');expect(dialog().textContent).toContain('Available until');expect(dialog().querySelectorAll('img')).toHaveLength(0);
 expect(dialog().contains(document.activeElement)).toBe(true);await close();expect(document.activeElement).toBe(button);
 expect(request).toHaveBeenCalledTimes(count);expect(storage()).toEqual(before);
});
it('keeps all versions and the previous accepted result without treating unaccepted animations as ready',async()=>{
 save(1,{submission:receipt});save(2,{animationRevision:{sourceGenerationId:id(1)}},1);save(3,{status:'failed'},2);await render();
 const card=element.querySelector('.my-generations__item')!;expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);
 expect(card.querySelector('.my-generations__previous')?.getAttribute('href')).toBe('/generated/'+id(1));
 const image=card.querySelector('img');await open(3);
 expect([...dialog().querySelectorAll('[data-history-version]')].map(e=>e.getAttribute('data-history-version'))).toEqual([id(3),id(2),id(1)]);
 expect(dialog().textContent).toContain('Отправлен на ревью');expect(card.querySelector('img')).toBe(image);
 expect(request.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
});
it('opens A, B and A with correct content and restores each trigger',async()=>{
 save(1);save(2);await render();for(const n of [1,2,1]){const button=await open(n);expect(dialog().textContent).toContain('Fox '+n);expect(dialog().querySelector('a')?.getAttribute('href')).toBe('/generated/'+id(n));await close();expect(document.activeElement).toBe(button);}
 expect(request).toHaveBeenCalledTimes(2);
});
it('keeps the dialog and focused version while polling updates progress',async()=>{
 save(1,{status:'generating',progress:{completedSteps:2,totalSteps:12}});await render();await open(1);
 const modal=dialog(),link=modal.querySelector<HTMLAnchorElement>('a')!;link.focus();generations.set(id(1),{...generations.get(id(1))!,progress:{completedSteps:6,totalSteps:12}});
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(dialog()).toBe(modal);expect(document.activeElement).toBe(link);expect(element.textContent).toContain('6 / 12');
});
it('keeps a filtered submitted family open and returns to the filter on close',async()=>{
 save(1);await render();const filter=element.querySelector<HTMLInputElement>('input')!;await act(async()=>filter.click());await open(1);const modal=dialog();
 await act(async()=>{rememberGenerationSubmission(id(1),new Date(now+day).toISOString(),receipt);const key=SUBMISSION_HISTORY_PREFIX+id(1);window.dispatchEvent(new StorageEvent('storage',{key,newValue:localStorage.getItem(key)}));});
 expect(element.querySelector<HTMLLIElement>('.my-generations__item')!.hidden).toBe(true);expect(dialog()).toBe(modal);expect(modal.contains(document.activeElement)).toBe(true);expect(modal.textContent).toContain('Отправлен на ревью');
 await close();expect(document.activeElement).toBe(filter);expect(request).toHaveBeenCalledOnce();
});
it('closes a deleted family and returns focus to refresh even when the history becomes empty',async()=>{
 save(1);await render();await open(1);await act(async()=>{localStorage.clear();window.dispatchEvent(new StorageEvent('storage',{key:null}));});await act(async()=>vi.advanceTimersByTimeAsync(400));
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(element.textContent).toContain('Запись больше не доступна в истории');expect(document.activeElement?.textContent).toBe('Refresh statuses');
});
it('follows the opening generation through a late cross-tab family merge',async()=>{
 save(1);save(2);save(3,{},2);await render();await open(3);const modal=dialog(),link=modal.querySelector<HTMLAnchorElement>(`a[href="/generated/${id(2)}"]`)!;link.focus();
 await act(async()=>{rememberGenerationVersion(generations.get(id(2))!,{generationId:id(1),kind:'base-refinement'});window.dispatchEvent(new StorageEvent('storage',{key:HISTORY_V2_PREFIX+id(2)}));});
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);expect(dialog()).toBe(modal);expect(document.activeElement?.getAttribute('href')).toBe('/generated/'+id(2));expect(dialog().querySelectorAll('[data-history-version]')).toHaveLength(3);
 await close();expect(document.activeElement).toBe(trigger(3));
});
it.each([[3610000,'1 ч','59 мин'],[61000,'1 мин','менее минуты']])('updates remaining time on a shared minute tick for %i without extra GETs',async(ms,first,next)=>{
 save(1,{submission:receipt,expiresAt:new Date(now+ms).toISOString()});await render();const row=element.querySelector('.my-generations__item'),image=row?.querySelector('img');const before=storage();
 expect(row?.textContent).toContain('Доступен ещё '+first);await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(row?.textContent).toContain('Доступен ещё '+next);
 expect(element.querySelector('.my-generations__item')).toBe(row);expect(row?.querySelector('img')).toBe(image);expect(storage()).toEqual(before);expect(request).toHaveBeenCalledOnce();
});
it('expires at the original deadline with an open dialog, retaining dates and receipt',async()=>{
 save(1,{submission:receipt,expiresAt:new Date(now+1000).toISOString()});await render();await open(1);await act(async()=>vi.advanceTimersByTimeAsync(1001));
 expect(element.querySelector('.my-generations__item')?.textContent).toContain('Expired');expect(dialog().querySelector('a')).toBeNull();expect(dialog().textContent).toContain('Отправлен на ревью');expect(dialog().textContent).toContain('Available until');expect(request).toHaveBeenCalledOnce();
});

it('returns focus to the surviving family when another tab merges it during closing',async()=>{
 save(1);save(2);save(3,{},2);await render();const oldTrigger=await open(3);
 const closeButton=[...dialog().querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Закрыть')!;
 await act(async()=>{closeButton.focus();closeButton.click();});
 await act(async()=>vi.advanceTimersByTimeAsync(50));
 await act(async()=>{rememberGenerationVersion(generations.get(id(2))!,{generationId:id(1),kind:'base-refinement'});window.dispatchEvent(new StorageEvent('storage',{key:HISTORY_V2_PREFIX+id(2)}));});
 const surviving=trigger(3),focus=vi.spyOn(surviving,'focus');
 await act(async()=>vi.advanceTimersByTimeAsync(400));
 expect(oldTrigger.isConnected).toBe(false);expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);
 expect(document.activeElement).toBe(surviving);expect(focus).toHaveBeenCalledWith({preventScroll:true});
 expect(document.querySelector('[role="dialog"]')).toBeNull();
 expect(request.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
});
it('returns focus to the filter when another tab submits the family during closing',async()=>{
 save(1);save(2,{},1);localStorage.setItem('pending-request','11111111-1111-4111-8111-111111111111');await render();
 const filter=element.querySelector<HTMLInputElement>('input')!;await act(async()=>filter.click());await open(2);
 const reads=request.mock.calls.length,closeButton=[...dialog().querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Закрыть')!;
 await act(async()=>{closeButton.focus();closeButton.click();});await act(async()=>vi.advanceTimersByTimeAsync(50));
 const focus=vi.spyOn(filter,'focus');
 await act(async()=>{rememberGenerationSubmission(id(2),new Date(now+day).toISOString(),receipt);const key=SUBMISSION_HISTORY_PREFIX+id(2);window.dispatchEvent(new StorageEvent('storage',{key,newValue:localStorage.getItem(key)}));});
 await act(async()=>vi.advanceTimersByTimeAsync(400));
 expect(element.querySelector<HTMLLIElement>('.my-generations__item')!.hidden).toBe(true);expect(document.activeElement).toBe(filter);
 expect(focus).toHaveBeenCalledWith({preventScroll:true});expect(document.querySelector('[role="dialog"]')).toBeNull();expect(request).toHaveBeenCalledTimes(reads);
 expect(localStorage.getItem('pending-request')).toBe('11111111-1111-4111-8111-111111111111');
});

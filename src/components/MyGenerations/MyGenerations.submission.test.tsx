// @vitest-environment jsdom
/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text, @typescript-eslint/no-unused-vars */
import "./browser.test-utils";
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ThemeProvider} from '@gravity-ui/uikit';
import {MyGenerations} from './MyGenerations';
import {cacheHistoryStatus,pruneHistoryStatuses} from './history-status-cache';
import {SUBMISSION_HISTORY_PREFIX,rememberGenerationSubmission,rememberGenerationVersion,readGenerationHistory,type HistoryGeneration} from '@/lib/pets/generation/history';
vi.mock('next/link',()=>({default:({children,prefetch:_,...props}:React.ComponentProps<'a'>&{prefetch?:boolean})=><a {...props}>{children}</a>}));
vi.mock('next/image',()=>({default:({unoptimized:_,...props}:React.ComponentProps<'img'>&{unoptimized?:boolean})=><img {...props}/>}));
const id=(n:number)=>n.toString(16).padStart(64,'0');
let root:Root,element:HTMLDivElement;
const now=Date.parse('2026-11-04T10:00:00Z');
const response=(n:number,status:HistoryGeneration["status"],extra={})=>({ok:true,status:200,json:async()=>({generation:{generationId:id(n),status,createdAt:new Date(now+n).toISOString(),expiresAt:new Date(now+86400000).toISOString(),progress:{completedSteps:1,totalSteps:12},baseUrl:'/base',...(status==='completed'?{pet:{displayName:'Previous fox'}}:{}),...extra}})});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now+100);localStorage.clear();pruneHistoryStatuses([]);element=document.createElement('div');document.body.append(element);root=createRoot(element);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.useRealTimers();vi.unstubAllGlobals();});
function save(n:number,parent?:number){rememberGenerationVersion({generationId:id(n),createdAt:new Date(now+n).toISOString(),expiresAt:new Date(now+86400000).toISOString()},parent?{generationId:id(parent),kind:'continuation'}:undefined);}
it('shows submission per version and filters only the current ready unsent version',async()=>{
 save(1);save(2,1);save(3);
 const receipt={petId:'pet_a',slug:'fox',submittedAt:new Date(now).toISOString()};
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(response(Number.parseInt(url.slice(-2),16),'completed',url.endsWith(id(1))||url.endsWith(id(3))?{submission:receipt}:{}))));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.textContent).toContain('Ранее отправлена другая версия');
 expect(element.textContent).toContain('Отправлен на ревью');
 expect(element.querySelector('p .g-label')).toBeNull();
 const filter=element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
 expect(filter).not.toBeNull();
 await act(async()=>filter.click());
 expect(element.textContent).not.toContain('Запись скрыта фильтром');
 expect(element.querySelectorAll('.my-generations__item:not([hidden])')).toHaveLength(1);
 expect(element.querySelector('.my-generations__item:not([hidden])')?.getAttribute('data-history-version')).toBe(id(2));
 expect(element.textContent).toContain('Не отправлен');
});
it('keeps expired and unreadable submissions unknown',async()=>{
 rememberGenerationVersion({generationId:id(1),expiresAt:new Date(now+50).toISOString()},undefined,now);
 vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve({ok:false,status:503,json:async()=>({})})));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.textContent).toContain('Отправка неизвестна');
 expect(element.textContent).not.toContain('Не отправлен');
});

it('updates only the submitted row across tabs, preserves focus and does not refetch',async()=>{
 save(1);save(2);
 const fetcher=vi.fn((url:string)=>Promise.resolve(response(Number.parseInt(url.slice(-2),16),'completed')));vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 const filter=element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
 await act(async()=>filter.click());
 const row=element.querySelector<HTMLElement>('[data-history-version="'+id(2)+'"]')!;
 row.querySelector<HTMLAnchorElement>('a')!.focus();
 const before=fetcher.mock.calls.length;
 const receipt={petId:'pet_b',slug:'fox-b',submittedAt:new Date(now).toISOString()};
 await act(async()=>{
   rememberGenerationSubmission(id(2),new Date(now+86400000).toISOString(),receipt);
   const key=SUBMISSION_HISTORY_PREFIX+id(2);
   window.dispatchEvent(new StorageEvent('storage',{key,newValue:localStorage.getItem(key)}));
 });
 expect(fetcher).toHaveBeenCalledTimes(before);
 expect(row.hidden).toBe(true);expect(document.activeElement).toBe(filter);
 expect(element.textContent).toContain('Запись скрыта фильтром');
 expect(element.querySelectorAll('.my-generations__item:not([hidden])')).toHaveLength(1);
 await act(async()=>filter.click());expect(row.hidden).toBe(false);
 expect(element.querySelector('[data-history-version="'+id(2)+'"]')).toBe(row);
});
it('keeps an observed submission when an older GET finishes later',async()=>{
 save(1);let finish!:(value:ReturnType<typeof response>)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{finish=resolve;})));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 const receipt={petId:'pet_a',slug:'fox',submittedAt:new Date(now).toISOString()};
 await act(async()=>{
   rememberGenerationSubmission(id(1),new Date(now+86400000).toISOString(),receipt);
   const key=SUBMISSION_HISTORY_PREFIX+id(1);window.dispatchEvent(new StorageEvent('storage',{key,newValue:localStorage.getItem(key)}));
   finish(response(1,'completed'));
 });
 expect(element.textContent).toContain('Отправлен на ревью');expect(element.textContent).not.toContain('Не отправлен');
});
it('excludes unaccepted animation versions and failed reads from ready filter',async()=>{
 save(1);save(2);let failed=false;
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(failed?{ok:false,status:503,json:async()=>({})}:response(Number.parseInt(url.slice(-2),16),'completed',url.endsWith(id(2))?{animationRevision:{sourceGenerationId:id(3)}}:{}))));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 const filter=element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;await act(async()=>filter.click());
 expect(element.querySelectorAll('.my-generations__item:not([hidden])')).toHaveLength(1);
 failed=true;await act(async()=>element.querySelector<HTMLButtonElement>('button')!.click());
 expect(filter.checked).toBe(true);expect(element.querySelectorAll('.my-generations__item:not([hidden])')).toHaveLength(0);
 expect(element.textContent).toContain('Отправка неизвестна');
});

it('treats an expired negative cache as unknown while the latest GET is pending',async()=>{
 save(1);const entry=readGenerationHistory().entries[0];
 const generation=(await response(1,'completed').json()).generation;
 cacheHistoryStatus(entry,{generation,failedReads:0},null,now-60000);
 const fetcher=vi.fn(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(fetcher).toHaveBeenCalledOnce();expect(element.textContent).not.toContain('Не отправлен');
 expect(element.textContent).toContain('Отправка неизвестна');
 await act(async()=>element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 expect(element.querySelectorAll('.my-generations__item:not([hidden])')).toHaveLength(0);
});
it('rechecks an unsent completed version after the thirty-second cache lifetime',async()=>{
 save(1);const entry=readGenerationHistory().entries[0];
 cacheHistoryStatus(entry,{generation:(await response(1,'completed').json()).generation,failedReads:0},null,now+100);
 const receipt={petId:'pet_a',slug:'fox',submittedAt:new Date(now).toISOString()};
 const fetcher=vi.fn(()=>Promise.resolve(response(1,'completed',{submission:receipt})));vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(fetcher).not.toHaveBeenCalled();expect(element.textContent).toContain('Не отправлен');
 await act(async()=>vi.advanceTimersByTimeAsync(31000));
 expect(fetcher).toHaveBeenCalledOnce();expect(element.textContent).toContain('Отправлен на ревью');
 await act(async()=>vi.advanceTimersByTimeAsync(90000));expect(fetcher).toHaveBeenCalledOnce();
});

it.each(['503','timeout'])('bounds failed submission refreshes after %s without new operations',async mode=>{
 save(1);let calls=0;
 const fetcher=vi.fn((_url:string,init?:RequestInit)=>{
  if(++calls===1)return Promise.resolve(response(1,'completed'));
  if(mode==='503')return Promise.resolve({ok:false,status:503,json:async()=>({})});
  return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('timed out')),{once:true}));
 });
 vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 await act(async()=>element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 await act(async()=>vi.advanceTimersByTimeAsync(120000));
 expect(fetcher).toHaveBeenCalledTimes(4);
 expect(element.querySelectorAll('.my-generations__item:not([hidden])')).toHaveLength(0);
 expect(element.textContent).toContain('Отправка неизвестна');
 await act(async()=>vi.advanceTimersByTimeAsync(120000));expect(fetcher).toHaveBeenCalledTimes(4);
 expect(fetcher.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
});

it('retains a confirmation received across expiry after a cold reload without changing recovery data',async()=>{
 const expiresAt=new Date(now+1100).toISOString();
 const generation=(await response(1,'completed',{expiresAt}).json()).generation;
 rememberGenerationVersion(generation);
 const original=readGenerationHistory().entries[0];
 const recovery=JSON.stringify({requestId:'unchanged-uuid',mode:'regenerate',states:['failed']});
 localStorage.setItem('pending-request',recovery);
 let finish!:(value:ReturnType<typeof response>)=>void;
 const fetcher=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 await act(async()=>vi.advanceTimersByTimeAsync(1100));
 const receipt={petId:'pet_a',slug:'fox',submittedAt:new Date(now+100).toISOString()};
 await act(async()=>finish(response(1,'completed',{expiresAt,submission:receipt})));
 expect(element.textContent).toContain('Отправлен на ревью');
 expect(readGenerationHistory().entries[0]).toEqual({...original,submission:receipt});
 expect(localStorage.getItem('pending-request')).toBe(recovery);
 await act(async()=>root.unmount());pruneHistoryStatuses([]);root=createRoot(element);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.textContent).toContain('Отправлен на ревью');
 expect(element.textContent).toContain('Expired');
 expect(fetcher).toHaveBeenCalledOnce();
 expect(localStorage.getItem('pending-request')).toBe(recovery);
});

it.each(['link','history'])('moves an expired filtered %s to the checkbox without fetching again',async control=>{
 save(1);
 rememberGenerationVersion({generationId:id(2),createdAt:new Date(now+2).toISOString(),expiresAt:new Date(now+1100).toISOString()},{generationId:id(1),kind:'continuation'});
 for(const n of [1,2]){
   const generation=(await response(n,'completed',n===2?{expiresAt:new Date(now+1100).toISOString()}:{}).json()).generation;
   cacheHistoryStatus(readGenerationHistory().entries.find(entry=>entry.generationId===id(n))!,{generation,failedReads:0},null,now+100);
 }
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 const filter=element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
 await act(async()=>filter.click());
 const row=element.querySelector<HTMLLIElement>('.my-generations__item')!;
 const focused=row.querySelector<HTMLElement>(control==='history'?'button[data-generation-id]':'a')!;focused.focus();
 await act(async()=>vi.advanceTimersByTimeAsync(1100));
 expect(row.hidden).toBe(true);expect(document.activeElement).toBe(filter);
 expect(fetcher).not.toHaveBeenCalled();
});

it.each(['link','history'])('restores a filtered %s after an unchanged recheck and keeps the row and thumbnail',async control=>{
 save(1);save(2,1);
 for(const n of [1,2]){
   cacheHistoryStatus(readGenerationHistory().entries.find(entry=>entry.generationId===id(n))!,{generation:(await response(n,'completed').json()).generation,failedReads:0},null,now+100);
 }
 let finish!:(value:ReturnType<typeof response>)=>void;
 const fetcher=vi.fn((url:string)=>url.endsWith(id(2))?new Promise(resolve=>{finish=resolve;}):Promise.resolve(response(1,'completed')));vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 const filter=element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
 await act(async()=>filter.click());
 const row=element.querySelector<HTMLLIElement>('.my-generations__item')!;
 const thumbnail=row.querySelector('img');
 const focused=row.querySelector<HTMLElement>(control==='history'?'button[data-generation-id]':'a')!;focused.focus();
 await act(async()=>vi.advanceTimersByTimeAsync(31000));
 expect(row.hidden).toBe(true);
 await act(async()=>finish(response(2,'completed')));
 expect(row.hidden).toBe(false);expect(document.activeElement).toBe(focused);
 expect(row.querySelector('img')).toBe(thumbnail);
 expect(element.querySelector('.my-generations__item')).toBe(row);
});

it('does not restore a rechecked row after the user moves focus away and back to the filter',async()=>{
 save(1);const entry=readGenerationHistory().entries[0];
 cacheHistoryStatus(entry,{generation:(await response(1,'completed').json()).generation,failedReads:0},null,now+100);
 let finish!:(value:ReturnType<typeof response>)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{finish=resolve;})));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 const filter=element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
 await act(async()=>filter.click());element.querySelector<HTMLAnchorElement>('.my-generations__item a')!.focus();
 await act(async()=>vi.advanceTimersByTimeAsync(31000));
 element.querySelector<HTMLButtonElement>('button')!.focus();filter.focus();
 await act(async()=>finish(response(1,'completed')));
 expect(element.querySelector<HTMLLIElement>('.my-generations__item')!.hidden).toBe(false);
 expect(document.activeElement).toBe(filter);
});

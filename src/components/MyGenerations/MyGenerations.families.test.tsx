// @vitest-environment jsdom
/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text, @typescript-eslint/no-unused-vars */
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ThemeProvider} from '@gravity-ui/uikit';
import {MyGenerations} from './MyGenerations';
import {pruneHistoryStatuses} from './history-status-cache';
import {rememberGenerationVersion} from '@/lib/pets/generation/history';
vi.mock('next/link',()=>({default:({children,prefetch:_,...props}:React.ComponentProps<'a'>&{prefetch?:boolean})=><a {...props}>{children}</a>}));
vi.mock('next/image',()=>({default:({unoptimized:_,...props}:React.ComponentProps<'img'>&{unoptimized?:boolean})=><img {...props}/>}));
const id=(n:number)=>n.toString(16).padStart(64,'0');
let root:Root,element:HTMLDivElement;
const now=Date.parse('2026-11-04T10:00:00Z');
const response=(n:number,status:string,extra={})=>({ok:true,status:200,json:async()=>({generation:{generationId:id(n),status,createdAt:new Date(now+n).toISOString(),expiresAt:new Date(now+86400000).toISOString(),progress:{completedSteps:1,totalSteps:12},baseUrl:'/base',...(status==='completed'?{pet:{displayName:'Previous fox'}}:{}),...extra}})});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now+100);localStorage.clear();pruneHistoryStatuses([]);element=document.createElement('div');document.body.append(element);root=createRoot(element);(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.useRealTimers();vi.unstubAllGlobals();});
function save(n:number,parent?:number){rememberGenerationVersion({generationId:id(n),createdAt:new Date(now+n).toISOString(),expiresAt:new Date(now+86400000).toISOString()},parent?{generationId:id(parent),kind:'continuation'}:undefined);}
it.each(['queued','failed','awaiting_confirmation'])('keeps one row and the previous ready result while new version is %s',async status=>{
 save(1);save(2,1);const fetcher=vi.fn((url:string,_init?:RequestInit)=>Promise.resolve(url.endsWith(id(1))?response(1,'completed'):response(2,status)));vi.stubGlobal('fetch',fetcher);
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);
 expect(element.textContent).toContain('Previous fox');expect(element.textContent).toContain('История версий · 2');
 expect(element.querySelector(`a[href="/generated/${id(1)}"]`)?.textContent).toBe('Открыть предыдущий готовый результат');
 const row=element.querySelector('.my-generations__item'),details=element.querySelector('details')!;
 await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
 expect(fetcher.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(element.querySelector('.my-generations__item')).toBe(row);expect(element.querySelector('details')?.open).toBe(true);
});
it('does not treat an unaccepted animation revision as the previous ready result',async()=>{
 save(1);save(2,1);save(3,2);vi.stubGlobal('fetch',vi.fn((url:string,_init?:RequestInit)=>Promise.resolve(url.endsWith(id(1))?response(1,'completed'):url.endsWith(id(2))?response(2,'completed',{animationRevision:{sourceGenerationId:id(1)}}):response(3,'failed'))));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.querySelector('a')?.getAttribute('href')).toBe('/generated/'+id(3));
 expect([...element.querySelectorAll('a')].find(a=>a.textContent==='Открыть предыдущий готовый результат')?.getAttribute('href')).toBe('/generated/'+id(1));
});

it('returns focus to the same version when a legacy relationship merges two rows',async()=>{
 save(1);save(2);let finish!:(value:ReturnType<typeof response>)=>void;
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith(id(1))?Promise.resolve(response(1,'completed')):new Promise(resolve=>{finish=resolve;})));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 const old=element.querySelector<HTMLAnchorElement>(`a[href="/generated/${id(2)}"]`)!;old.focus();
 await act(async()=>finish(response(2,'queued',{continuation:{sourceGenerationId:id(1),mode:'regenerate'}})));
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);
 expect(document.activeElement?.getAttribute('href')).toBe('/generated/'+id(2));
});
it('removes an expired previous-ready action on its own deadline while the next task is active',async()=>{
 rememberGenerationVersion({generationId:id(1),createdAt:new Date(now+1).toISOString(),expiresAt:new Date(now+200).toISOString()});save(2,1);
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(url.endsWith(id(1))?{ok:true,status:200,json:async()=>({generation:{generationId:id(1),status:'completed',expiresAt:new Date(now+200).toISOString(),progress:{completedSteps:12,totalSteps:12},pet:{displayName:'Old fox'}}})}:response(2,'queued'))));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.textContent).toContain('Открыть предыдущий готовый результат');
 await act(async()=>vi.advanceTimersByTimeAsync(201));
 expect(element.textContent).not.toContain('Открыть предыдущий готовый результат');
});

it('keeps summary focus when two legacy families are reconciled',async()=>{
 save(1);save(2);save(3,2);let finish!:(value:ReturnType<typeof response>)=>void;
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith(id(2))?new Promise(resolve=>{finish=resolve;}):Promise.resolve(response(url.endsWith(id(1))?1:3,url.endsWith(id(1))?'completed':'queued'))));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 element.querySelector<HTMLElement>('summary')!.focus();
 await act(async()=>finish(response(2,'queued',{continuation:{sourceGenerationId:id(1),mode:'regenerate'}})));
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);
 expect(document.activeElement).toBe(element.querySelector('summary'));
});

it('falls back to the previous image once, without retrying broken images on status updates',async()=>{
 save(1);save(2,1);vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(url.endsWith(id(1))?response(1,'completed'):response(2,'queued'))));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.querySelector('img')?.getAttribute('src')).toContain(id(2));
 await act(async()=>element.querySelector('img')!.dispatchEvent(new Event('error')));
 expect(element.querySelector('img')?.getAttribute('src')).toContain(id(1));
 await act(async()=>element.querySelector('img')!.dispatchEvent(new Event('error')));
 expect(element.querySelector('img')).toBeNull();
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(element.querySelector('img')).toBeNull();
});

it('retains summary focus when a relationship arrives from another window',async()=>{
 save(1);save(2);save(3,2);
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(response(Number.parseInt(url.slice(-2),16),'queued'))));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(2);
 element.querySelector<HTMLDetailsElement>('details')!.open=true;
 element.querySelector<HTMLElement>('summary')!.focus();
 await act(async()=>{
  rememberGenerationVersion({generationId:id(2),createdAt:new Date(now+2).toISOString(),expiresAt:new Date(now+86400000).toISOString()},{generationId:id(1),kind:'base-refinement'});
  window.dispatchEvent(new StorageEvent('storage',{key:'pets-generation-history-v2:'+id(2)}));
 });
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(1);
 expect(document.activeElement).toBe(element.querySelector('summary'));
 expect(element.querySelector('details')?.open).toBe(true);
});

it('keeps the previous ready result while an overflow legacy child is being classified',async()=>{
 for(let n=1;n<=50;n++)save(n);
 localStorage.setItem('pets-generation-history-v1:'+id(51),JSON.stringify({generationId:id(51),savedAt:now+100,expiresAt:now+86400000}));
 vi.stubGlobal('fetch',vi.fn((url:string)=>{const n=Number.parseInt(url.slice(-2),16);return Promise.resolve(n===51?response(n,'queued',{continuation:{sourceGenerationId:id(1),mode:'regenerate'}}):response(n,'completed'));}));
 await act(async()=>root.render(<ThemeProvider theme='light'><MyGenerations/></ThemeProvider>));
 expect(element.querySelectorAll('.my-generations__item')).toHaveLength(50);
 const current=element.querySelector(`a[href="/generated/${id(51)}"]`)!.closest('.my-generations__item')!;
 expect(current.textContent).toContain('Открыть предыдущий готовый результат');
 expect(current.querySelector(`a[href="/generated/${id(1)}"]`)).not.toBeNull();
});

// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {GenerationContinuation} from "./GenerationContinuation";
import {CONTINUATION_STATES} from "@/lib/pets/generation/continuation-model";
import {CONTINUATION_PENDING,rememberContinuation} from "./continuation-request";
const {push}=vi.hoisted(()=>({push:vi.fn()}));vi.mock("next/navigation",()=>({useRouter:()=>({push})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false}))as typeof window.matchMedia;
let root:Root,element:HTMLDivElement;const fetchMock=vi.fn(),continued=vi.fn(),id="a".repeat(64);
const options=()=>({sourceRevision:"f".repeat(64),canRebuild:true,canRegenerate:true,requiredStates:["running-right"],strips:CONTINUATION_STATES.map(state=>({state,status:state==="running-right"?"missing":"saved",uncertain:false})),rebuildsRemaining:3,issues:[]});
const response=(value:unknown,status=200)=>({ok:status<400,status,json:async()=>value});
const accepted=(requestId:string,target=id)=>({operation:{id:requestId,mode:target===id?"rebuild":"regenerate",state:"accepted",generationId:target},generation:{generationId:target,expiresAt:new Date(Date.now()+86400000).toISOString(),status:"queued"}});
const button=(text:string)=>text==="Продолжить"?element.querySelector<HTMLButtonElement>("[data-continuation-submit]")!:[...element.querySelectorAll("button")].find(b=>b.textContent===text)!;
async function mount(enabled=true){await act(async()=>root.render(<ThemeProvider theme="light"><GenerationContinuation generationId={id} enabled={enabled} onContinued={continued}/></ThemeProvider>));}
async function open(){await mount();await act(async()=>button("Продолжить генерацию").click());}
beforeEach(()=>{localStorage.clear();element=document.createElement("div");document.body.append(element);root=createRoot(element);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();push.mockReset();continued.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("shows all eleven strips and freezes input while sending",async()=>{
 let resolve:(value:unknown)=>void=()=>{};fetchMock.mockImplementation(async(_url,init)=>init?.method==="POST"?new Promise(r=>{resolve=r;}):response({options:options()}));
 await open();expect(element.querySelectorAll('input[type="checkbox"]')).toHaveLength(11);expect(element.querySelector<HTMLInputElement>('input[type="checkbox"]:checked')?.disabled).toBe(true);
 await act(async()=>button("Продолжить").click());expect([...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input=>input.disabled)).toBe(true);
 const body=JSON.parse(fetchMock.mock.calls.find(([,init])=>init?.method==="POST")![1].body);expect(body.states).toEqual(["running-right"]);
 await act(async()=>resolve(response(accepted(body.requestId,"b".repeat(64)))));expect(push).toHaveBeenCalledWith("/generated/"+"b".repeat(64));
});
it("retries identical UUID and input after a lost response",async()=>{
 let attempts=0;fetchMock.mockImplementation(async(_url,init)=>{if(!init?.method)return response({options:options()});if(++attempts===1)throw Error("network");return response(accepted(JSON.parse(init.body).requestId,"b".repeat(64)));});
 await open();await act(async()=>button("Продолжить").click());expect(localStorage.getItem(CONTINUATION_PENDING+id)).not.toBeNull();
 await act(async()=>button("Повторить тот же запрос").click());const posts=fetchMock.mock.calls.filter(([,init])=>init?.method==="POST");expect(posts[0][1].body).toBe(posts[1][1].body);expect(localStorage.getItem(CONTINUATION_PENDING+id)).toBeNull();
});
it("uses no new selection or POST when recovering an already accepted request",async()=>{
 const uuid=crypto.randomUUID();rememberContinuation(localStorage,id,uuid);fetchMock.mockResolvedValue(response(accepted(uuid)));
 await mount();await act(async()=>button("Проверить запрос").click());expect(fetchMock.mock.calls.every(([,init])=>init?.method!=="POST")).toBe(true);expect(continued).toHaveBeenCalledOnce();
});
it("unlocks a definitively refused new request",async()=>{
 fetchMock.mockImplementation(async(_url,init)=>init?.method==="POST"?response({code:"queue_full"},429):response({options:options()}));await open();await act(async()=>button("Продолжить").click());
 expect(localStorage.getItem(CONTINUATION_PENDING+id)).toBeNull();expect(element.querySelector('fieldset[disabled]')).toBeNull();
});
it("retains UUID on invalid success and does not store request fields",async()=>{
 fetchMock.mockImplementation(async(_url,init)=>init?.method==="POST"?response({generation:{}}):response({options:options()}));await open();await act(async()=>button("Продолжить").click());
 const saved=JSON.parse(localStorage.getItem(CONTINUATION_PENDING+id)!);expect(Object.keys(saved)).toEqual(["requestId"]);expect(button("Повторить тот же запрос")).toBeDefined();
});
it("submits a free rebuild without selected image stages",async()=>{
 fetchMock.mockImplementation(async(_url,init)=>init?.method==="POST"?response(accepted(JSON.parse(init.body).requestId)):response({options:options()}));await open();
 await act(async()=>element.querySelector<HTMLInputElement>('input[value="rebuild"]')!.click());await act(async()=>button("Продолжить").click());
 const body=JSON.parse(fetchMock.mock.calls.find(([,init])=>init?.method==="POST")![1].body);expect(body.mode).toBe("rebuild");expect(body.states).toBeUndefined();expect(continued).toHaveBeenCalledOnce();
});
it("allows a new selection after an accepted rebuild fails again",async()=>{
  fetchMock.mockImplementation(async(_url,init)=>init?.method==="POST"?response(accepted(JSON.parse(init.body).requestId)):response({options:options()}));
  await open();await act(async()=>element.querySelector<HTMLInputElement>('input[value="rebuild"]')!.click());await act(async()=>button("Продолжить").click());
  await act(async()=>button("Продолжить генерацию").click());
  expect(element.querySelector('fieldset[disabled]')).toBeNull();expect(button("Продолжить").disabled).toBe(false);
  await act(async()=>button("Продолжить").click());
  const posts=fetchMock.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>JSON.parse(init.body));
  expect(posts[1]).toMatchObject({mode:"regenerate",states:["running-right"]});expect(posts[1].requestId).not.toBe(posts[0].requestId);
});

it.each([false,true])("tolerates a blocked storage getter with continuation enabled=%s",async enabled=>{
  vi.spyOn(globalThis,"localStorage","get").mockImplementation(()=>{throw new DOMException("Storage blocked","SecurityError");});
  await mount(enabled);
  expect(element.textContent).toBe(enabled?"Продолжить генерацию":"");
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([404,410])("keeps receipt recovery available after source options return %s",async status=>{
  const uuid=crypto.randomUUID(),target="b".repeat(64);rememberContinuation(localStorage,id,uuid);
  fetchMock.mockImplementation(async url=>String(url).includes("requestId=")?response(accepted(uuid,target)):response({code:status===410?"generation_expired":"not_found"},status));
  await mount();await act(async()=>button("Обновить изображения").click());
  expect(button("Проверить запрос").disabled).toBe(false);
  expect(localStorage.getItem(CONTINUATION_PENDING+id)).not.toBeNull();
  await act(async()=>button("Проверить запрос").click());
  expect(push).toHaveBeenCalledWith("/generated/"+target);expect(localStorage.getItem(CONTINUATION_PENDING+id)).toBeNull();
  expect(fetchMock.mock.calls.every(([,init])=>init?.method!=="POST")).toBe(true);
});
it("ends recovery only when the receipt endpoint reports expiry",async()=>{
  const uuid=crypto.randomUUID();rememberContinuation(localStorage,id,uuid);fetchMock.mockResolvedValue(response({code:"generation_expired"},410));
  await mount();await act(async()=>button("Проверить запрос").click());
  expect(localStorage.getItem(CONTINUATION_PENDING+id)).toBeNull();expect(element.textContent).toContain("Результат продолжения истёк.");
  expect(element.querySelector('a[href="/generate"]')).not.toBeNull();expect(push).not.toHaveBeenCalled();
});
it("preserves uncertain UUID and selection after a refused replay and missing receipt",async()=>{
  let posts=0;fetchMock.mockImplementation(async(url,init)=>{
    if(init?.method==="POST"){if(++posts===1)throw Error("lost response");return response({code:"rate_limited"},429);}
    return String(url).includes("requestId=")?response({code:"not_found"},404):response({options:options()});
  });
  await open();await act(async()=>button("Продолжить").click());const saved=localStorage.getItem(CONTINUATION_PENDING+id);
  await act(async()=>button("Повторить тот же запрос").click());await act(async()=>button("Проверить запрос").click());
  expect(localStorage.getItem(CONTINUATION_PENDING+id)).toBe(saved);expect([...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input=>input.disabled)).toBe(true);
  const attempts=fetchMock.mock.calls.filter(([,init])=>init?.method==="POST");expect(attempts[1][1].body).toBe(attempts[0][1].body);
});
it("does not send a new request when its UUID cannot be saved",async()=>{
  fetchMock.mockResolvedValue(response({options:options()}));await open();
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new DOMException("Storage blocked","SecurityError");});
  await act(async()=>button("Продолжить").click());
  expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);expect(element.textContent).toContain("Запрос не отправлен");
});
it('preserves an unsent selection when options are refreshed',async()=>{
 fetchMock.mockImplementation(async()=>response({options:options()}));await open();const idle=[...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0];await act(async()=>idle.click());
 await act(async()=>button('Обновить изображения').click());expect(element.querySelector<HTMLInputElement>('input[aria-label="Пересоздать: Покой"]')!.checked).toBe(true);
 expect(fetchMock.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);expect(localStorage.length).toBe(0);
});

it('adds a diagnosed required row to the draft without creating an operation',async()=>{
 let diagnosed=false;const createId=vi.spyOn(crypto,'randomUUID');
 fetchMock.mockImplementation(async()=>response({options:diagnosed?{...options(),sourceRevision:'e'.repeat(64),requiredStates:['running-right','failed'],issues:[{state:'failed',kind:'invalid',frame:1,actual:389,expected:9003}],strips:options().strips.map(s=>s.state==='failed'?{...s,status:'invalid'}:s)}:options()}));
 await open();await act(async()=>element.querySelector<HTMLInputElement>('[aria-label="Пересоздать: Покой"]')!.click());
 diagnosed=true;await act(async()=>button('Обновить изображения').click());await act(async()=>window.dispatchEvent(new Event('resize')));
 for(const state of ['Покой','Движение вправо','Неудача'])expect(element.querySelector<HTMLInputElement>(`[aria-label="Пересоздать: ${state}"]`)!.checked).toBe(true);
 expect(element.textContent).toContain('Извлечённый кадр 2 значительно меньше остальных');
 expect(fetchMock.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);expect(createId).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});

it('preserves an unsent selection when a verified atlas makes the old issue historical',async()=>{
 let verified=false;const createId=vi.spyOn(crypto,'randomUUID');
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:verified');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 fetchMock.mockImplementation(async url=>String(url)==='/atlas'?{ok:true,blob:async()=>new Blob(['atlas'])}:response({options:{...options(),
  sourceRevision:verified?'e'.repeat(64):'f'.repeat(64),requiredStates:verified?[]:['running-right'],
  issues:[{state:'running-right',kind:'invalid',frame:1,actual:389,expected:9003}],
  strips:CONTINUATION_STATES.map((state,row)=>({state,status:!verified&&state==='running-right'?'invalid':'saved',uncertain:false,...(verified?{preview:{kind:'atlas-row',url:'/atlas',row,frames:6}}:{})}))}}));
 await open();await act(async()=>element.querySelector<HTMLInputElement>('[aria-label="Пересоздать: Покой"]')!.click());
 expect(element.textContent).toContain('Нужно исправить: Движение вправо');
 verified=true;await act(async()=>button('Обновить изображения').click());
 await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationContinuation generationId={id} enabled onContinued={continued}/></ThemeProvider>));
 await act(async()=>window.dispatchEvent(new Event('resize')));
 expect(element.textContent).toContain('Сохранённый атлас прошёл проверку');expect(element.textContent).not.toContain('Нужно исправить');
 for(const name of ['Покой','Движение вправо'])expect(element.querySelector<HTMLInputElement>(`[aria-label="Пересоздать: ${name}"]`)!.checked).toBe(true);
 expect(element.querySelector<HTMLInputElement>('[aria-label="Пересоздать: Движение вправо"]')!.disabled).toBe(false);
 expect(fetchMock.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);expect(createId).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});

it('keeps a frozen request unchanged after the server diagnostic revision changes',async()=>{
 let diagnosed=false;let posts=0;
 fetchMock.mockImplementation(async(_url,init)=>{
  if(init?.method==='POST'){posts++;if(posts===1)throw Error('lost');return response({code:'continuation_source_conflict'},409);}
  return response({options:diagnosed?{...options(),sourceRevision:'e'.repeat(64),requiredStates:['failed'],issues:[{state:'failed',kind:'invalid',frame:1,actual:389,expected:9003}],strips:options().strips.map(s=>s.state==='failed'?{...s,status:'invalid'}:s)}:options()});
 });
 await open();await act(async()=>button('Продолжить').click());const saved=localStorage.getItem(CONTINUATION_PENDING+id);const original=fetchMock.mock.calls.find(([,init])=>init?.method==='POST')![1].body;
 diagnosed=true;expect(button('Обновить изображения')).toBeUndefined();
 await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationContinuation generationId={id} enabled onContinued={continued}/></ThemeProvider>));
 await act(async()=>window.dispatchEvent(new Event('resize')));await act(async()=>button('Повторить тот же запрос').click());
 const attempts=fetchMock.mock.calls.filter(([,init])=>init?.method==='POST');expect(attempts).toHaveLength(2);expect(attempts[1][1].body).toBe(original);expect(localStorage.getItem(CONTINUATION_PENDING+id)).toBe(saved);
});

it('restores an unknown selection with the original UUID and keeps replay frozen after flag-off and theme changes',async()=>{
 const uuid=crypto.randomUUID();rememberContinuation(localStorage,id,uuid);const createId=vi.spyOn(crypto,'randomUUID');let posts=0;
 fetchMock.mockImplementation(async(url,init)=>{
  if(init?.method==='POST'){
   if(++posts===1)throw Error('lost response');
   return response(accepted(uuid,'b'.repeat(64)));
  }
  return String(url).includes('requestId=')?response({code:'not_found'},404):response({options:options()});
 });
 await mount();await act(async()=>button('Проверить запрос').click());await act(async()=>button('Обновить изображения').click());
 expect(posts).toBe(0);expect(createId).not.toHaveBeenCalled();
 const confirm=()=>element.querySelector<HTMLInputElement>('.generation-recovery__manual input')!;
 await act(async()=>confirm().click());
 await act(async()=>element.querySelector<HTMLInputElement>('input[aria-label="Пересоздать: Покой"]')!.click());
 expect(confirm().checked).toBe(false);expect(button('Повторить тот же запрос').disabled).toBe(true);
 await act(async()=>confirm().click());await act(async()=>button('Повторить тот же запрос').click());
 const firstBody=fetchMock.mock.calls.find(([,init])=>init?.method==='POST')![1].body;
 expect(JSON.parse(firstBody)).toEqual({requestId:uuid,mode:'regenerate',sourceRevision:'f'.repeat(64),states:['idle','running-right']});
 await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationContinuation generationId={id} enabled={false} onContinued={continued}/></ThemeProvider>));
 await act(async()=>window.dispatchEvent(new Event('resize')));
 expect(posts).toBe(1);expect([...element.querySelectorAll<HTMLInputElement>('.recovery-preview__choice input')].every(input=>input.disabled)).toBe(true);
 expect(JSON.parse(localStorage.getItem(CONTINUATION_PENDING+id)!)).toEqual({requestId:uuid});
 expect(createId).not.toHaveBeenCalled();
 await act(async()=>button('Повторить тот же запрос').click());
 const attempts=fetchMock.mock.calls.filter(([,init])=>init?.method==='POST');expect(attempts).toHaveLength(2);expect(attempts[1][1].body).toBe(firstBody);
 expect(push).toHaveBeenCalledWith('/generated/'+'b'.repeat(64));
});

it('reports recovery hidden after flag-off without discarding the unsent selection',async()=>{
 const visibility=vi.fn();fetchMock.mockResolvedValue(response({options:options()}));
 const render=(enabled:boolean)=><ThemeProvider theme="light"><GenerationContinuation generationId={id} enabled={enabled} onContinued={continued} onVisibilityChange={visibility}/></ThemeProvider>;
 await act(async()=>root.render(render(true)));await act(async()=>button('Продолжить генерацию').click());
 await act(async()=>element.querySelector<HTMLInputElement>('input[aria-label="Пересоздать: Покой"]')!.click());
 await act(async()=>root.render(render(false)));expect(element.textContent).toBe('');expect(visibility).toHaveBeenLastCalledWith(false);
 await act(async()=>root.render(render(true)));expect(visibility).toHaveBeenLastCalledWith(true);
 expect(element.querySelector<HTMLInputElement>('input[aria-label="Пересоздать: Покой"]')!.checked).toBe(true);
 expect(fetchMock).toHaveBeenCalledOnce();
});

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
const button=(text:string)=>[...element.querySelectorAll("button")].find(b=>b.textContent===text)!;
async function mount(){await act(async()=>root.render(<ThemeProvider theme="light"><GenerationContinuation generationId={id} enabled onContinued={continued}/></ThemeProvider>));}
async function open(){await mount();await act(async()=>button("Продолжить генерацию").click());}
beforeEach(()=>{localStorage.clear();element=document.createElement("div");document.body.append(element);root=createRoot(element);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();push.mockReset();continued.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("shows all eleven strips and freezes input while sending",async()=>{
 let resolve:(value:unknown)=>void=()=>{};fetchMock.mockImplementation(async(_url,init)=>init?.method==="POST"?new Promise(r=>{resolve=r;}):response({options:options()}));
 await open();expect(element.querySelectorAll('input[type="checkbox"]')).toHaveLength(11);expect(element.querySelector<HTMLInputElement>('input[type="checkbox"]:checked')?.disabled).toBe(true);
 await act(async()=>button("Продолжить").click());expect(element.querySelector('fieldset[disabled]')).not.toBeNull();
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
 await act(async()=>element.querySelector<HTMLInputElement>('input[type="radio"]')!.click());await act(async()=>button("Продолжить").click());
 const body=JSON.parse(fetchMock.mock.calls.find(([,init])=>init?.method==="POST")![1].body);expect(body.mode).toBe("rebuild");expect(body.states).toBeUndefined();expect(continued).toHaveBeenCalledOnce();
});
it("allows a new selection after an accepted rebuild fails again",async()=>{
  fetchMock.mockImplementation(async(_url,init)=>init?.method==="POST"?response(accepted(JSON.parse(init.body).requestId)):response({options:options()}));
  await open();await act(async()=>element.querySelector<HTMLInputElement>('input[type="radio"]')!.click());await act(async()=>button("Продолжить").click());
  await act(async()=>button("Продолжить генерацию").click());
  expect(element.querySelector('fieldset[disabled]')).toBeNull();expect(button("Продолжить").disabled).toBe(false);
  await act(async()=>button("Продолжить").click());
  const posts=fetchMock.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>JSON.parse(init.body));
  expect(posts[1]).toMatchObject({mode:"regenerate",states:["running-right"]});expect(posts[1].requestId).not.toBe(posts[0].requestId);
});

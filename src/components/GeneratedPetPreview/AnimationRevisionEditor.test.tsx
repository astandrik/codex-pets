// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {webcrypto} from "node:crypto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {AnimationRevisionEditor} from "./AnimationRevisionEditor";
const navigation=vi.hoisted(()=>({push:vi.fn()}));vi.mock("next/navigation",()=>({useRouter:()=>navigation}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false})) as typeof window.matchMedia;
let root:Root,element:HTMLDivElement;const fetchMock=vi.fn(),id="a".repeat(64);
const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
beforeEach(()=>{element=document.createElement("div");document.body.append(element);root=createRoot(element);sessionStorage.clear();localStorage.clear();vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();navigation.push.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.unstubAllGlobals();});
const button=(text:string)=>[...element.querySelectorAll("button")].find(b=>b.textContent?.includes(text))!;
async function render(canEdit=true){await act(async()=>root.render(<ThemeProvider theme="light"><AnimationRevisionEditor generationId={id} metadataRevision={2} canEdit={canEdit} blocked={false}/></ThemeProvider>));}
async function submit(text:string) {
  const count=fetchMock.mock.calls.length;
  await act(async()=>{button(text).click();await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(count+1),{timeout:2000,interval:10});});
}
async function open(){await render();await act(async()=>button("Редактировать анимации").click());await act(async()=>element.querySelector<HTMLInputElement>('input[value="idle"]')!.click());}
function edit(text:string){act(()=>{const input=element.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,text);input.dispatchEvent(new Event("input",{bubbles:true}));});}
it("pins the submitted text and selection after lost response and retries the same UUID",async()=>{
  await open();edit("Tilt gently");let reject!:(error:Error)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail;}));
  await submit("Создать новую версию");
  expect(element.querySelector("textarea")?.disabled).toBe(true);expect(element.querySelector<HTMLInputElement>('input[value="idle"]')?.matches(":disabled")).toBe(true);
  await act(async()=>reject(Error("lost")));expect(element.querySelector("textarea")?.disabled).toBe(true);
  fetchMock.mockResolvedValue(response({generation:{generationId:"b".repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}},202));
  await submit("Повторить тот же запрос");
  expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  expect(navigation.push).toHaveBeenCalledWith("/generated/"+"b".repeat(64));
  expect(JSON.stringify({...sessionStorage,...localStorage})).not.toContain("Tilt gently");
});
it("unlocks input only after a definite first refusal",async()=>{
  await open();fetchMock.mockResolvedValue(response({code:"queue_full"},429));
  await submit("Создать новую версию");expect(element.querySelector("textarea")?.disabled).toBe(false);
  edit("New instruction");fetchMock.mockRejectedValueOnce(Error("lost"));await submit("Создать новую версию");
  const unknownBody=fetchMock.mock.calls[1][1].body;
  fetchMock.mockResolvedValue(response({code:"queue_full"},429));await submit("Повторить тот же запрос");
  expect(element.querySelector("textarea")?.disabled).toBe(true);expect(fetchMock.mock.calls[2][1].body).toBe(unknownBody);
});
it("recovers by UUID after reload with feature disabled without requiring stored text",async()=>{
  await open();edit("Private correction");fetchMock.mockRejectedValueOnce(Error("lost"));await submit("Создать новую версию");
  await act(async()=>root.unmount());root=createRoot(element);
  fetchMock.mockResolvedValue(response({generation:{generationId:"c".repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}}));
  await render(false);await act(async()=>button("Проверить отправленную версию").click());
  expect(fetchMock.mock.calls.at(-1)?.[1]?.method).not.toBe("POST");expect(navigation.push).toHaveBeenCalledWith("/generated/"+"c".repeat(64));
});

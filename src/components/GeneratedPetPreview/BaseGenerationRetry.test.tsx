// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {BaseGenerationRetry} from "./BaseGenerationRetry";
import {BASE_RETRY_PENDING} from "./base-retry-request";
const push=vi.fn(),router={push};vi.mock("next/navigation",()=>({useRouter:()=>router}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}})) as unknown as typeof window.matchMedia;
const id="a".repeat(64),child="b".repeat(64),revision="c".repeat(64);
const options={sourceRevision:revision,sourceExpiresAt:new Date(Date.now()+86400000).toISOString(),inputState:"saved",prompt:"Original description",referenceUrl:"/reference",availableModes:["saved"]};
const reply=(requestId:string)=>({requestId,sourceGenerationId:id,reused:false,generation:{generationId:child,status:"queued",expiresAt:new Date(Date.now()+86400000).toISOString(),previewUrl:"/generated/"+child}});
const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
let host:HTMLDivElement,root:Root;const fetcher=vi.fn();
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);localStorage.clear();push.mockReset();vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("fetch",fetcher);fetcher.mockReset();fetcher.mockImplementation(async(_url,init)=>init?.method==="POST"?response(reply(JSON.parse(init.body).requestId)):response({options}));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const render=(canRetry=true,theme:"light"|"dark"="dark")=>act(async()=>root.render(<ThemeProvider theme={theme}><BaseGenerationRetry generationId={id} canRetry={canRetry}/></ThemeProvider>));
const button=(name:string)=>[...document.querySelectorAll("button")].find(b=>b.textContent===name)!;
const open=()=>act(async()=>button("Повторить создание персонажа").click());
const posts=()=>fetcher.mock.calls.filter(([,init])=>init?.method==="POST");

it("opens only a GET preview, and a closed retained dialog does not lock scrolling",async()=>{
 await render();expect(document.body.style.overflow).not.toBe("hidden");expect(fetcher).not.toHaveBeenCalled();
 await open();expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Original description");expect(posts()).toHaveLength(0);expect(localStorage.getItem(BASE_RETRY_PENDING+id)).toBeNull();
 await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
 expect(document.body.style.overflow).not.toBe("hidden");
});
it("coalesces double submission and leaves a real accepted URL",async()=>{
 let resolve!:(value:unknown)=>void;
 fetcher.mockImplementation(async(_url,init)=>init?.method==="POST"?new Promise(r=>{resolve=r;}):response({options}));
 await render();await open();await act(async()=>{button("Создать новую попытку").click();button("Создать новую попытку").click();});
 expect(posts()).toHaveLength(1);const requestId=JSON.parse(posts()[0][1].body).requestId;
 await act(async()=>resolve(response(reply(requestId))));
 expect(document.querySelector(`a[href="/generated/${child}"]`)).not.toBeNull();expect(push).toHaveBeenCalledWith("/generated/"+child);
});
it("keeps legacy input across close/theme/resize and requires a choice",async()=>{
 fetcher.mockResolvedValue(response({options:{...options,inputState:"legacy",prompt:undefined,availableModes:["legacy-image-only","legacy-text"]}}));
 await render();await open();expect(button("Создать новую попытку").disabled).toBe(true);
 const radio=document.querySelector<HTMLInputElement>('input[value="legacy-text"]')!;await act(async()=>radio.click());
 const text=document.querySelector<HTMLTextAreaElement>('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(text,"Typed description");text.dispatchEvent(new Event("input",{bubbles:true}));});
 await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));await render(true,"light");await open();
 await act(async()=>window.dispatchEvent(new Event("resize")));
 expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe("Typed description");expect(posts()).toHaveLength(0);
});
it("recovers lost response after remount even when new retries are disabled",async()=>{
 fetcher.mockImplementation(async(_url,init)=>{if(init?.method==="POST")throw Error("lost");return response({options});});
 await render();await open();await act(async()=>button("Создать новую попытку").click());
 const saved=JSON.parse(localStorage.getItem(BASE_RETRY_PENDING+id)!);expect(posts()).toHaveLength(1);
 await act(async()=>root.unmount());root=createRoot(host);fetcher.mockImplementation(async()=>response(reply(saved.requestId)));
 await render(false);expect(document.querySelector(`a[href="/generated/${child}"]`)).not.toBeNull();expect(fetcher.mock.calls.at(-1)?.[0]).toContain("requestId="+saved.requestId);
});
it("does not POST if recovery identity cannot be saved",async()=>{
 await render();await open();vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("storage blocked");});
 await act(async()=>button("Создать новую попытку").click());expect(posts()).toHaveLength(0);expect(document.body.textContent).toContain("сохранить");
});
it("keeps the accepted link when history writes fail",async()=>{
 await render();await open();const original=Storage.prototype.setItem;
 vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){if(key.startsWith("pets-generation-history"))throw Error("history blocked");return original.call(this,key,value);});
 await act(async()=>button("Создать новую попытку").click());
 expect(document.querySelector(`a[href="/generated/${child}"]`)).not.toBeNull();expect(push).not.toHaveBeenCalled();expect(posts()).toHaveLength(1);
});
it("does not trust an accepted response for a different source",async()=>{
 fetcher.mockImplementation(async(_url,init)=>init?.method==="POST"?response({...reply(JSON.parse(init.body).requestId),sourceGenerationId:"d".repeat(64)}):response({options}));
 await render();await open();await act(async()=>button("Создать новую попытку").click());
 expect(push).not.toHaveBeenCalled();expect(localStorage.getItem(BASE_RETRY_PENDING+id)).not.toBeNull();expect(document.body.textContent).toContain("не подтверждён");
});
it("can render when access to localStorage itself is denied",async()=>{
 vi.spyOn(window,"localStorage","get").mockImplementation(()=>{throw Error("storage denied");});
 await render();expect(button("Повторить создание персонажа")).toBeDefined();expect(fetcher).not.toHaveBeenCalled();
});

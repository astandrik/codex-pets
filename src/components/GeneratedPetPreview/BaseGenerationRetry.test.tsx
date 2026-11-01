// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {BaseGenerationRetry} from "./BaseGenerationRetry";
import {BASE_RETRY_PENDING,BASE_RETRY_SETTINGS,prepareBaseRetryRequest} from "./base-retry-request";
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
const button=(name:string)=>[...document.querySelectorAll("button")].find(b=>b.textContent===name)!;
const posts=()=>fetcher.mock.calls.filter(([,init])=>init?.method==="POST");
const waitForIdle=()=>vi.waitFor(async()=>{
 // Flush each observation; a polling callback inside one act would hold these updates.
 await act(async()=>{});
 const trigger=button("Проверить повтор")??button("Повторить создание персонажа");
 expect(trigger).toBeDefined();expect(trigger.disabled).toBe(false);
});
const interact=async(run:()=>void)=>{await act(async()=>run());await waitForIdle();};
const render=async(canRetry=true,theme:"light"|"dark"="dark")=>{
 await act(async()=>root.render(<ThemeProvider theme={theme}><BaseGenerationRetry generationId={id} canRetry={canRetry}/></ThemeProvider>));
 await waitForIdle();
};
const open=()=>interact(()=>button("Повторить создание персонажа").click());
const submit=()=>interact(()=>button("Создать новую попытку").click());

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
 await act(async()=>{await vi.waitFor(()=>expect(posts()).toHaveLength(1));});
 expect(posts()).toHaveLength(1);const requestId=JSON.parse(posts()[0][1].body).requestId;
 await act(async()=>resolve(response(reply(requestId))));await waitForIdle();
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
 await render();await open();await submit();
 const saved=JSON.parse(localStorage.getItem(BASE_RETRY_PENDING+id)!);expect(posts()).toHaveLength(1);
 await act(async()=>root.unmount());root=createRoot(host);fetcher.mockImplementation(async()=>response(reply(saved.requestId)));
 await render(false);expect(document.querySelector(`a[href="/generated/${child}"]`)).not.toBeNull();expect(fetcher.mock.calls.at(-1)?.[0]).toContain("requestId="+saved.requestId);
});
it("does not POST if recovery identity cannot be saved",async()=>{
 await render();await open();vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("storage blocked");});
 await submit();expect(posts()).toHaveLength(0);expect(document.body.textContent).toContain("сохранить");
});
it("keeps the accepted link when history writes fail",async()=>{
 await render();await open();const original=Storage.prototype.setItem;
 vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){if(key.startsWith("pets-generation-history"))throw Error("history blocked");return original.call(this,key,value);});
 await submit();
 expect(document.querySelector(`a[href="/generated/${child}"]`)).not.toBeNull();expect(push).not.toHaveBeenCalled();expect(posts()).toHaveLength(1);
});
it("does not trust an accepted response for a different source",async()=>{
 fetcher.mockImplementation(async(_url,init)=>init?.method==="POST"?response({...reply(JSON.parse(init.body).requestId),sourceGenerationId:"d".repeat(64)}):response({options}));
 await render();await open();await submit();
 expect(push).not.toHaveBeenCalled();expect(localStorage.getItem(BASE_RETRY_PENDING+id)).not.toBeNull();expect(document.body.textContent).toContain("не подтверждён");
});
it("can render when access to localStorage itself is denied",async()=>{
 vi.spyOn(window,"localStorage","get").mockImplementation(()=>{throw Error("storage denied");});
 await render();expect(button("Повторить создание персонажа")).toBeDefined();expect(fetcher).not.toHaveBeenCalled();
});

const withPolicy={...options,baseRetries:{min:0,default:5,max:50}};
const countField=()=>document.querySelector<HTMLInputElement>('input[aria-label="Автоповторы при ошибке"]');
const enterCount=async(value:string)=>act(async()=>{const field=countField()!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));});
it.each([0,1,5,50])("submits the chosen base retry count %s and freezes it after a lost response",async count=>{
 const digest=crypto.subtle.digest.bind(crypto.subtle);
 vi.spyOn(crypto.subtle,"digest").mockImplementation(async(...args)=>{await new Promise(resolve=>setTimeout(resolve,25));return digest(...args);});
 fetcher.mockImplementation(async(_url,init)=>{if(init?.method==="POST")throw Error("lost");return response({options:withPolicy});});
 await render();await open();expect(countField()?.value).toBe("5");expect(document.body.textContent).toContain("До 6 попыток создания базового образа");await enterCount(String(count));await submit();
 expect(JSON.parse(posts()[0][1].body).maxRetries).toBe(count);expect(countField()?.disabled).toBe(true);expect(countField()?.value).toBe(String(count));
});
it.each(["","-1","51","1.5"])("rejects invalid count %s before identity or POST",async value=>{
 fetcher.mockResolvedValue(response({options:withPolicy}));const uuid=vi.spyOn(crypto,"randomUUID");await render();await open();await enterCount(value);
 expect(button("Создать новую попытку").disabled).toBe(true);await submit();expect(posts()).toHaveLength(0);expect(uuid).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});
it("omits the setting without the advertised capability",async()=>{
 await render();await open();expect(countField()).toBeNull();await submit();expect(JSON.parse(posts()[0][1].body)).not.toHaveProperty("maxRetries");
});
it("keeps the draft count on close, repeated options, theme and resize",async()=>{
 fetcher.mockResolvedValue(response({options:{...withPolicy,inputState:"legacy",prompt:undefined,availableModes:["legacy-text","legacy-image-only"]}}));await render();await open();await enterCount("12");
 await act(async()=>document.querySelector<HTMLInputElement>('input[value="legacy-text"]')!.click());await act(async()=>document.querySelector<HTMLInputElement>('input[value="legacy-image-only"]')!.click());
 await act(async()=>button("Закрыть").click());await render(true,"light");await open();await act(async()=>window.dispatchEvent(new Event("resize")));
 expect(countField()?.value).toBe("12");expect(document.querySelectorAll('input[aria-label="Автоповторы при ошибке"]')).toHaveLength(1);expect(posts()).toHaveLength(0);expect(localStorage.length).toBe(0);
});
it.each([undefined,0,50])("restores a frozen policy and exact body after reload: %s",async maxRetries=>{
 const prepared=await prepareBaseRetryRequest(localStorage,id,{sourceRevision:revision,mode:"saved",...(maxRetries===undefined?{}:{maxRetries})});
 fetcher.mockImplementation(async(url,init)=>init?.method==="POST"?response(reply(JSON.parse(init.body).requestId)):String(url).includes("requestId=")?response({},404):response({options:withPolicy}));
 await render();expect(fetcher.mock.calls[0][0]).toContain("requestId="+prepared.input.requestId);expect(countField()?.disabled).toBe(true);
 if(maxRetries===undefined)expect(document.body.textContent).toContain("прежняя политика");else expect(countField()?.value).toBe(String(maxRetries));
 await submit();expect(JSON.parse(posts()[0][1].body)).toEqual(prepared.input);
});
it.each(["missing","corrupt"])("requires explicit policy for %s settings after checking the receipt",async kind=>{
 const prepared=await prepareBaseRetryRequest(localStorage,id,{sourceRevision:revision,mode:"saved",maxRetries:1});const key=BASE_RETRY_SETTINGS+id+":"+prepared.input.requestId;
 if(kind==="missing")localStorage.removeItem(key);else localStorage.setItem(key,"{}");
 fetcher.mockImplementation(async(url,init)=>init?.method==="POST"?response(reply(JSON.parse(init.body).requestId)):String(url).includes("requestId=")?response({},404):response({options:withPolicy}));
 await render();expect(countField()?.value).toBe("");expect(button("Создать новую попытку").disabled).toBe(true);expect(posts()).toHaveLength(0);
 await enterCount("5");await submit();expect(posts()).toHaveLength(0);
 await enterCount("1");await submit();expect(JSON.parse(posts()[0][1].body)).toEqual(prepared.input);
});
it("recovers missing legacy settings only after an explicit omission choice",async()=>{
 const prepared=await prepareBaseRetryRequest(localStorage,id,{sourceRevision:revision,mode:"saved"});localStorage.removeItem(BASE_RETRY_SETTINGS+id+":"+prepared.input.requestId);
 fetcher.mockImplementation(async(url,init)=>init?.method==="POST"?response(reply(JSON.parse(init.body).requestId)):String(url).includes("requestId=")?response({},404):response({options:withPolicy}));await render();
 expect(button("Создать новую попытку").disabled).toBe(true);await act(async()=>document.querySelector<HTMLInputElement>('[aria-label="В запросе не было настройки автоповторов"]')!.click());await submit();expect(JSON.parse(posts()[0][1].body)).toEqual(prepared.input);
});
it.each([undefined,{maxAttempts:2,attempts:1,phase:"active"}])("displays the accepted existing child's actual policy: %s",async baseRepair=>{
 fetcher.mockResolvedValue(response({options:{existingGeneration:{...reply("00000000-0000-4000-8000-000000000000").generation,...(baseRepair?{baseRepair}:{})}}}));await render();await open();
 expect(countField()?.disabled).toBe(true);if(baseRepair)expect(countField()?.value).toBe("1");else expect(document.body.textContent).toContain("прежняя политика");expect(posts()).toHaveLength(0);
});
it.each(["settings","identity"])("blocks POST and preserves draft when the %s write fails",async phase=>{
 fetcher.mockResolvedValue(response({options:withPolicy}));await render();await open();await enterCount("12");const original=Storage.prototype.setItem;
 vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){if(key.startsWith(phase==="settings"?BASE_RETRY_SETTINGS:BASE_RETRY_PENDING))throw Error("blocked");return original.call(this,key,value);});
 await submit();expect(posts()).toHaveLength(0);expect(countField()?.value).toBe("12");expect(localStorage.length).toBe(0);
});

it("shows a frozen legacy omission after a lost reply without capability",async()=>{
 fetcher.mockImplementation(async(_url,init)=>{if(init?.method==="POST")throw Error("lost");return response({options});});await render();await open();await submit();
 expect(document.body.textContent).toContain("прежняя политика");expect(countField()?.disabled).toBe(true);
});
it("keeps receipt checking available but prevents a new POST with canRetry false",async()=>{
 const prepared=await prepareBaseRetryRequest(localStorage,id,{sourceRevision:revision,mode:"saved",maxRetries:5});fetcher.mockImplementation(async url=>String(url).includes("requestId=")?response({},404):response({options:withPolicy}));await render(false);
 expect(fetcher.mock.calls[0][0]).toContain(prepared.input.requestId);expect(button("Создать новую попытку").disabled).toBe(true);expect(button("Проверить запрос").disabled).toBe(false);expect(posts()).toHaveLength(0);
});
it("keeps accepted link and actual policy when router navigation throws",async()=>{
 fetcher.mockImplementation(async(_url,init)=>init?.method==="POST"?response({...reply(JSON.parse(init.body).requestId),generation:{...reply(JSON.parse(init.body).requestId).generation,baseRepair:{maxAttempts:2,attempts:0,phase:"active"}}}):response({options:withPolicy}));push.mockImplementation(()=>{throw Error("navigation");});await render();await open();await submit();
 expect(document.querySelector(`a[href="/generated/${child}"]`)).not.toBeNull();expect(countField()?.value).toBe("1");expect(posts()).toHaveLength(1);
});

it("replays the exact UI body after loss and remount without creating a UUID",async()=>{
 fetcher.mockImplementation(async(url,init)=>{if(init?.method==="POST")throw Error("lost");return String(url).includes("requestId=")?response({},404):response({options:withPolicy});});await render();await open();await enterCount("50");await submit();const first=posts()[0][1].body;
 await act(async()=>root.unmount());root=createRoot(host);const uuid=vi.spyOn(crypto,"randomUUID");await render();expect(countField()?.value).toBe("50");expect(countField()?.disabled).toBe(true);await submit();expect(posts()[1][1].body).toBe(first);expect(uuid).not.toHaveBeenCalled();
});
it("requires the identical legacy description on replay without persisting it",async()=>{
 const prepared=await prepareBaseRetryRequest(localStorage,id,{sourceRevision:revision,mode:"legacy-text",prompt:"Private original",maxRetries:1});fetcher.mockImplementation(async(url,init)=>init?.method==="POST"?response(reply(JSON.parse(init.body).requestId)):String(url).includes("requestId=")?response({},404):response({options:{...withPolicy,inputState:"legacy",availableModes:["legacy-text"]}}));await render();
 const setPrompt=async(value:string)=>act(async()=>{const field=document.querySelector<HTMLTextAreaElement>("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));});
 await setPrompt("Different");await submit();expect(posts()).toHaveLength(0);await setPrompt("Private original");await submit();expect(JSON.parse(posts()[0][1].body)).toEqual(prepared.input);expect(Object.values(localStorage).join()).not.toContain("Private original");
});

it("returns keyboard focus after Escape and preserves the editable count",async()=>{
 fetcher.mockResolvedValue(response({options:withPolicy}));await render();const trigger=button("Повторить создание персонажа");trigger.focus();await open();await enterCount("12");countField()!.focus();expect(document.activeElement).toBe(countField());
 await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,250));});expect(document.activeElement).toBe(trigger);expect(document.body.style.overflow).not.toBe("hidden");await open();expect(countField()?.value).toBe("12");
});

it.each([
 {original:5,stored:1},
 {original:5,stored:null},
 {original:undefined,stored:1},
])("restores the exact request after a schema-valid retry setting mismatch: $original -> $stored",async({original,stored})=>{
 const prepared=await prepareBaseRetryRequest(localStorage,id,{sourceRevision:revision,mode:"saved",...(original===undefined?{}:{maxRetries:original})});
 const pointer=localStorage.getItem(BASE_RETRY_PENDING+id),key=BASE_RETRY_SETTINGS+id+":"+prepared.input.requestId;
 const damaged=JSON.stringify({requestId:prepared.input.requestId,maxRetries:stored});localStorage.setItem(key,damaged);
 const uuid=vi.spyOn(crypto,"randomUUID");
 fetcher.mockImplementation(async(url,init)=>{if(init?.method==="POST")throw Error("lost response");return String(url).includes("requestId=")?response({},404):response({options:withPolicy});});
 await render();expect(fetcher.mock.calls[0][0]).toContain("requestId="+prepared.input.requestId);expect(countField()?.disabled).toBe(true);
 await submit();
 expect(posts()).toHaveLength(0);expect(localStorage.getItem(BASE_RETRY_PENDING+id)).toBe(pointer);expect(localStorage.getItem(key)).toBe(damaged);
 const legacyChoice=()=>document.querySelector<HTMLInputElement>('[aria-label="В запросе не было настройки автоповторов"]')!;
 expect(legacyChoice()).not.toBeNull();expect(legacyChoice().disabled).toBe(false);
 if(stored===null)await act(async()=>legacyChoice().click());
 expect(countField()?.disabled).toBe(false);
 await enterCount("2");await submit();expect(posts()).toHaveLength(0);
 await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));await render(true,"light");
 await interact(()=>button("Проверить повтор").click());await act(async()=>window.dispatchEvent(new Event("resize")));
 expect(countField()?.value).toBe("2");expect(countField()?.disabled).toBe(false);
 if(original===undefined)await act(async()=>legacyChoice().click());else await enterCount(String(original));
 await interact(()=>{button("Создать новую попытку").click();button("Создать новую попытку").click();});
 expect(posts()).toHaveLength(1);expect(JSON.parse(posts()[0][1].body)).toEqual(prepared.input);expect(uuid).not.toHaveBeenCalled();
 expect(localStorage.getItem(BASE_RETRY_PENDING+id)).toBe(pointer);expect(countField()?.disabled).toBe(true);
 await act(async()=>root.unmount());root=createRoot(host);await render();
 expect(countField()?.disabled).toBe(true);if(original!==undefined)expect(countField()?.value).toBe(String(original));
 await submit();
 expect(posts()).toHaveLength(2);expect(posts()[1][1].body).toBe(posts()[0][1].body);expect(uuid).not.toHaveBeenCalled();
});

it("uses the receipt policy instead of unlocking corrupt settings for an accepted request",async()=>{
 const prepared=await prepareBaseRetryRequest(localStorage,id,{sourceRevision:revision,mode:"saved",maxRetries:5});
 localStorage.setItem(BASE_RETRY_SETTINGS+id+":"+prepared.input.requestId,JSON.stringify({requestId:prepared.input.requestId,maxRetries:1}));
 fetcher.mockResolvedValue(response({...reply(prepared.input.requestId),generation:{...reply(prepared.input.requestId).generation,baseRepair:{maxAttempts:6,attempts:1,phase:"active"}}}));
 const uuid=vi.spyOn(crypto,"randomUUID");await render();
 expect(countField()?.value).toBe("5");expect(countField()?.disabled).toBe(true);expect(document.querySelector('[aria-label="В запросе не было настройки автоповторов"]')).toBeNull();
 expect(document.querySelector(`a[href="/generated/${child}"]`)).not.toBeNull();expect(posts()).toHaveLength(0);expect(uuid).not.toHaveBeenCalled();
});

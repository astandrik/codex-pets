// @vitest-environment jsdom
import "./browser.test-utils";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {MyGenerations} from "./MyGenerations";
import {HISTORY_PREFIX,rememberGeneration} from "@/lib/pets/generation/history";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false})) as typeof window.matchMedia;
const id="a".repeat(64);let element:HTMLDivElement,root:Root;const request=vi.fn();
const expiry=()=>new Date(Date.now()+86400000).toISOString();
function reply(status="queued",generationId=id){return{ok:true,status:200,json:async()=>({generation:{generationId,status,expiresAt:expiry(),progress:{completedSteps:status==="completed"?12:3,totalSteps:12},...(status==="completed"?{pet:{displayName:"Synthetic fox"}}:{})}})}}
beforeEach(()=>{vi.useFakeTimers();localStorage.clear();element=document.createElement("div");document.body.append(element);root=createRoot(element);request.mockReset();vi.stubGlobal("fetch",request);});
afterEach(async()=>{await act(async()=>{localStorage.clear();window.dispatchEvent(new StorageEvent("storage",{key:null}));});await act(async()=>root.unmount());element.remove();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function render(){await act(async()=>root.render(<ThemeProvider theme="light"><MyGenerations/></ThemeProvider>));}
async function tick(ms=5000){await act(async()=>vi.advanceTimersByTimeAsync(ms));}
describe("my browser generations",()=>{
 it("shows an empty history without requesting or creating a task",async()=>{await render();expect(element.textContent).toContain("No generations saved");expect(request).not.toHaveBeenCalled();});
 it("refreshes progress using GET, then stops polling a ready pet",async()=>{
  rememberGeneration(id,expiry());request.mockResolvedValueOnce(reply("generating")).mockResolvedValue(reply("completed"));await render();
  expect(element.textContent).toContain("Generating");expect(element.textContent).toContain("3 / 12");await tick();
  expect(element.textContent).toContain("Ready");expect(element.textContent).toContain("Synthetic fox");expect(element.querySelector('a[href="/generated/'+id+'"]')).not.toBeNull();
  await tick(15000);expect(request).toHaveBeenCalledTimes(2);expect(request.mock.calls.every(([,init])=>!init?.method||init.method==="GET")).toBe(true);
 });
 it("shows expired results without fetching or linking them",async()=>{
  rememberGeneration(id,new Date(Date.now()+1000).toISOString());await tick(1001);await render();expect(element.textContent).toContain("Expired");expect(request).not.toHaveBeenCalled();expect(element.querySelector('a[href^="/generated/"]')).toBeNull();
 });
 it("updates after another tab saves a generation",async()=>{
  await render();rememberGeneration(id,expiry());request.mockResolvedValue(reply("queued"));await act(async()=>window.dispatchEvent(new StorageEvent("storage",{key:HISTORY_PREFIX+id})));
  expect(element.textContent).toContain("Queued");expect(request).toHaveBeenCalledTimes(1);
 });
 it("does not trust a response for another capability or expose arbitrary URLs",async()=>{
  rememberGeneration(id,expiry());request.mockResolvedValue(reply("completed","b".repeat(64)));await render();expect(element.textContent).toContain("Could not refresh");expect(element.textContent).not.toContain("Synthetic fox");
  await tick(30000);expect(request).toHaveBeenCalledTimes(3);expect(request.mock.calls.every(([url])=>url==="/api/pet-generations/"+id)).toBe(true);
 });
 it("tolerates blocked storage without falling back to listing other users",async()=>{
  vi.spyOn(Storage.prototype,"key").mockImplementation(()=>{throw Error("blocked")});localStorage.setItem("any","value");await render();expect(element.textContent).toContain("Browser storage is unavailable");expect(request).not.toHaveBeenCalled();
 });
 it("ignores a stale response after a manual refresh",async()=>{
  rememberGeneration(id,expiry());let old!:(value:unknown)=>void;
  request.mockImplementationOnce(()=>new Promise(resolve=>{old=resolve})).mockResolvedValue(reply("completed"));await render();
  await act(async()=>[...element.querySelectorAll("button")].find(b=>b.textContent==="Refresh statuses")!.click());
  await act(async()=>old(reply("generating")));expect(element.textContent).toContain("Ready");expect(element.textContent).not.toContain("Generating");
 });
 it("keeps ready rows and thumbnails mounted when returning to the tab",async()=>{
  rememberGeneration(id,expiry());request.mockResolvedValue(reply("completed"));await render();
  const row=element.querySelector("li"),image=element.querySelector("img");
  request.mockImplementation(()=>new Promise(()=>{}));
  await act(async()=>document.dispatchEvent(new Event("visibilitychange")));
  expect(element.querySelector("li")).toBe(row);
  expect(element.querySelector("img")).toBe(image);
  expect(element.textContent).toContain("Synthetic fox");
  expect(request).toHaveBeenCalledTimes(1);
 });
 it("keeps known content visible during manual revalidation",async()=>{
  rememberGeneration(id,expiry());request.mockResolvedValue(reply("completed"));await render();
  const row=element.querySelector("li");let finish!:(value:unknown)=>void;
  request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>[...element.querySelectorAll("button")].find(b=>b.textContent==="Refresh statuses")!.click());
  expect(element.querySelector("li")).toBe(row);expect(element.textContent).toContain("Synthetic fox");
  await act(async()=>finish(reply("failed")));expect(element.textContent).toContain("Failed");
 });
 it("shows each returned row without waiting for another slow request",async()=>{
  rememberGeneration(id,expiry());rememberGeneration("b".repeat(64),expiry());
  request.mockImplementation((url:string)=>url.endsWith(id)?Promise.resolve(reply("completed")):new Promise(()=>{}));
  await render();expect(element.textContent).toContain("Synthetic fox");expect(element.textContent).toContain("Checking status");
 });
 it("reuses fresh statuses after leaving the page and returning",async()=>{
  rememberGeneration(id,expiry());request.mockResolvedValue(reply("completed"));await render();
  await act(async()=>root.unmount());root=createRoot(element);
  request.mockImplementation(()=>new Promise(()=>{}));await render();
  expect(element.textContent).toContain("Synthetic fox");expect(request).toHaveBeenCalledTimes(1);
 });
 it("revalidates an older cached status without clearing it",async()=>{
  rememberGeneration(id,expiry());request.mockResolvedValue(reply("completed"));await render();
  await act(async()=>root.unmount());root=createRoot(element);await tick(30001);
  request.mockImplementation(()=>new Promise(()=>{}));await render();
  expect(element.textContent).toContain("Synthetic fox");expect(request).toHaveBeenCalledTimes(2);
 });
 it("revalidates after a same-tab result update while history is unmounted",async()=>{
  rememberGeneration(id,expiry());request.mockResolvedValue(reply("completed"));await render();
  await act(async()=>root.unmount());root=createRoot(element);
  localStorage.setItem(HISTORY_PREFIX+"refresh","new-status");
  request.mockResolvedValue(reply("failed"));await render();
  expect(element.textContent).toContain("Failed");expect(request).toHaveBeenCalledTimes(2);
 });
 it("forgets cached results when browser history is cleared",async()=>{
  const expiresAt=expiry();rememberGeneration(id,expiresAt);request.mockResolvedValue(reply("completed"));await render();
  await act(async()=>{localStorage.clear();window.dispatchEvent(new StorageEvent("storage",{key:null}));});
  expect(element.textContent).toContain("No generations saved");
  request.mockImplementation(()=>new Promise(()=>{}));rememberGeneration(id,expiresAt);
  await act(async()=>window.dispatchEvent(new StorageEvent("storage",{key:HISTORY_PREFIX+id})));
  expect(element.textContent).not.toContain("Synthetic fox");expect(request).toHaveBeenCalledTimes(2);
 });
});

it("limits status requests to three concurrent reads",async()=>{
 for(let i=1;i<=5;i++)rememberGeneration(i.toString(16).repeat(64),expiry());
 const finish:Array<()=>void>=[];let active=0,max=0;
 request.mockImplementation((url:string)=>new Promise(resolve=>{active++;max=Math.max(max,active);finish.push(()=>{active--;resolve(reply("completed",url.split("/").at(-1)));});}));
 await render();expect(request).toHaveBeenCalledTimes(3);
 await act(async()=>finish.splice(0).forEach(done=>done()));expect(request).toHaveBeenCalledTimes(5);
 await act(async()=>finish.splice(0).forEach(done=>done()));expect(max).toBe(3);
});

it("gives every queued status read its own timeout window",async()=>{
 for(let i=1;i<=5;i++)rememberGeneration(i.toString(16).repeat(64),expiry());
 request.mockImplementation((url:string,init:RequestInit)=>new Promise((resolve,reject)=>{
  const signal=init.signal;
  const abort=()=>{clearTimeout(timer);reject(new DOMException("aborted","AbortError"));};
  const timer=setTimeout(()=>{signal?.removeEventListener("abort",abort);resolve(reply("completed",url.split("/").at(-1)));},8000);
  if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});
 }));
 await render();await tick(16001);
 const ready=[...element.querySelectorAll(".my-generations__item")].filter(row=>row.textContent?.includes("Ready"));
 expect(ready).toHaveLength(5);expect(element.textContent).not.toContain("Could not refresh");expect(request).toHaveBeenCalledTimes(5);
});

it("keeps valid history visible when expired-record cleanup is blocked", async () => {
  rememberGeneration(id, expiry());
  const staleId = "e".repeat(64), now = Date.now();
  localStorage.setItem(HISTORY_PREFIX + staleId, JSON.stringify({ generationId: staleId, savedAt: now - 8 * 86400000, expiresAt: now - 7 * 86400000 }));
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("cleanup blocked"); });
  request.mockResolvedValue(reply("completed"));
  await render();
  expect(element.textContent).toContain("Synthetic fox");
  expect(element.textContent).not.toContain("Browser storage is unavailable");
  expect(request).toHaveBeenCalledTimes(1);
});

it("prunes expired records only after the history DOM is committed", async () => {
  rememberGeneration(id, expiry());
  const staleId = "e".repeat(64), now = Date.now();
  localStorage.setItem(HISTORY_PREFIX + staleId, JSON.stringify({ generationId: staleId, savedAt: now - 8 * 86400000, expiresAt: now - 7 * 86400000 }));
  const remove = Storage.prototype.removeItem;
  const committedAtRemoval: boolean[] = [];
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
    committedAtRemoval.push(element.querySelector(".my-generations") !== null);
    return remove.call(this, key);
  });
  request.mockResolvedValue(reply("completed"));
  await render();
  expect(committedAtRemoval.length).toBeGreaterThan(0);
  expect(committedAtRemoval.every(Boolean)).toBe(true);
  expect(localStorage.getItem(HISTORY_PREFIX + staleId)).toBeNull();
});

describe("cached status retry recovery", () => {
  const cases = ["completed", "failed", "awaiting_confirmation"].flatMap(status =>
    ["HTTP 503", "timeout"].map(error => ({status, error})),
  );
  function savedResponse(status: string, displayName = "Cached fox") {
    return {ok: true, status: 200, json: async () => ({generation: {
      generationId: id, status, expiresAt: expiry(),
      progress: {completedSteps: status === "completed" ? 12 : 3, totalSteps: 12},
      pet: {displayName}, baseUrl: `/api/pet-generations/${id}/base`,
    }})};
  }
  function failRead(error: string) {
    return (_url: string, init: RequestInit) => {
      if (error === "HTTP 503") return Promise.resolve({ok: false, status: 503});
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), {once: true});
      });
    };
  }
  async function refreshStatuses() {
    await act(async () => [...element.querySelectorAll("button")].find(button => button.textContent === "Refresh statuses")!.click());
  }

  it.each(cases)("stops after three failed reads of cached $status after $error while preserving its row and image", async ({status, error}) => {
    rememberGeneration(id, expiry());
    const saved = localStorage.getItem(HISTORY_PREFIX + id);
    request.mockResolvedValueOnce(savedResponse(status)).mockImplementation(failRead(error));
    await render();
    const row = element.querySelector("li"), image = element.querySelector("img");
    expect(row).not.toBeNull();
    expect(image).not.toBeNull();
    await act(async () => image!.dispatchEvent(new Event("load")));
    await refreshStatuses();

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (error === "timeout") {
        await tick(14999);
        expect(element.textContent?.includes("Could not refresh")).toBe(attempt > 1);
        await tick(1);
      }
      expect(request).toHaveBeenCalledTimes(1 + attempt);
      expect(element.textContent).toContain("Could not refresh");
      expect(element.textContent).toContain("Cached fox");
      expect(element.textContent).not.toContain("Checking status");
      expect(element.querySelector("li")).toBe(row);
      expect(element.querySelector("img")).toBe(image);
      if (attempt < 3) {
        await tick(4999);
        expect(request).toHaveBeenCalledTimes(1 + attempt);
        await tick(1);
      }
    }
    await tick(30000);
    expect(request).toHaveBeenCalledTimes(4); // Initial success plus three failed revalidation reads.
    expect(localStorage.getItem(HISTORY_PREFIX + id)).toBe(saved);
    expect(request.mock.calls.every(([url, init]) => url === `/api/pet-generations/${id}` && (!init?.method || init.method === "GET"))).toBe(true);
  });

  it.each(["HTTP 503", "timeout"])("recovers from %s and returns to normal submission revalidation", async error => {
    rememberGeneration(id, expiry());
    request.mockResolvedValueOnce(savedResponse("completed"))
      .mockImplementationOnce(failRead(error))
      .mockResolvedValue(savedResponse("completed", "Updated fox"));
    await render();
    const row = element.querySelector("li"), image = element.querySelector("img");
    expect(image).not.toBeNull();
    await act(async () => image!.dispatchEvent(new Event("load")));
    await refreshStatuses();
    if (error === "timeout") await tick(15000);
    expect(element.textContent).toContain("Could not refresh");
    await tick();
    expect(element.textContent).toContain("Updated fox");
    expect(element.textContent).not.toContain("Could not refresh");
    expect(element.querySelector("li")).toBe(row);
    expect(element.querySelector("img")).toBe(image);
    await tick(29999);
    expect(request).toHaveBeenCalledTimes(3);
    await tick(1);
    expect(request).toHaveBeenCalledTimes(4);
    expect(element.textContent).not.toContain("Could not refresh");
  });

  it.each([404, 410])("stops retrying after a cached result becomes unavailable with HTTP %i", async status => {
    rememberGeneration(id, expiry());
    request.mockResolvedValueOnce(savedResponse("completed"))
      .mockResolvedValueOnce({ok: false, status: 503})
      .mockResolvedValue({ok: false, status});
    await render();
    await refreshStatuses();
    await tick();
    expect(element.textContent).toContain("Expired");
    expect(element.querySelector("img")).toBeNull();
    await tick(30000);
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe("generation thumbnails", () => {
  const imageUrl = () => new URL(element.querySelector("img")!.getAttribute("src")!, window.location.href);
  function withBase(status = "failed") {
    const response = reply(status);
    return {...response, json: async () => ({generation: {
      ...(await response.json()).generation,
      baseUrl: "https://untrusted.example/private-image.png",
      canContinue: true,
    }})};
  }

  it("shows the saved character using only the current capability URL", async () => {
    rememberGeneration(id, expiry());
    const saved = localStorage.getItem(HISTORY_PREFIX + id);
    request.mockResolvedValue(withBase());
    await render();
    const image = element.querySelector("img")!;
    expect(image).not.toBeNull();
    expect(imageUrl().pathname).toBe(`/api/pet-generations/${id}/base`);
    expect(imageUrl().origin).toBe(window.location.origin);
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.getAttribute("alt")).toBe("");
    expect(element.querySelector('.my-generations__actions a')?.getAttribute("href")).toBe("/generated/"+id);
    expect(request).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(HISTORY_PREFIX + id)).toBe(saved);
  });

  it("uses a static atlas frame for a ready legacy result without a base", async () => {
    rememberGeneration(id, expiry());
    request.mockResolvedValue(reply("completed"));
    await render();
    expect(imageUrl().pathname).toBe(`/api/pet-generations/${id}/files/spritesheet.webp`);
    expect(element.querySelector(".my-generations__thumbnail-frame")).not.toBeNull();
    expect(element.textContent).toContain("Synthetic fox");
  });

  it.each([[1536, 1872], [1536, 2288]])("shows a valid %i×%i legacy atlas", async (width, height) => {
    rememberGeneration(id, expiry());
    request.mockResolvedValue(reply("completed"));
    await render();
    const image = element.querySelector("img")!;
    Object.defineProperties(image, {naturalWidth: {value: width}, naturalHeight: {value: height}});
    await act(async () => image.dispatchEvent(new Event("load")));
    expect(element.querySelector("img")).toBe(image);
    expect(image.classList.contains("my-generations__thumbnail-image_loading")).toBe(false);
  });

  it("hides an incorrectly sized atlas without losing the ready result", async () => {
    rememberGeneration(id, expiry());
    request.mockResolvedValue(reply("completed"));
    await render();
    const image = element.querySelector("img")!;
    Object.defineProperties(image, {naturalWidth: {value: 512}, naturalHeight: {value: 512}});
    await act(async () => image.dispatchEvent(new Event("load")));
    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain("Synthetic fox");
    expect(element.textContent).toContain("Open pet");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("adds a thumbnail when polling first reports that the base is ready", async () => {
    rememberGeneration(id, expiry());
    request.mockResolvedValueOnce(reply("generating")).mockResolvedValue(withBase("awaiting_confirmation"));
    await render();
    expect(element.querySelector("img")).toBeNull();
    await tick();
    expect(imageUrl().pathname).toBe(`/api/pet-generations/${id}/base`);
    expect(element.textContent).toContain("Review character");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps the recovery link and selection history when the image is unavailable", async () => {
    rememberGeneration(id, expiry());
    const saved = localStorage.getItem(HISTORY_PREFIX + id);
    request.mockResolvedValue(withBase());
    await render();
    await act(async () => element.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(element.querySelector("img")).toBeNull();
    expect(element.querySelector(".my-generations__thumbnail")).not.toBeNull();
    expect(element.querySelector('.my-generations__actions a')?.getAttribute("href")).toBe("/generated/"+id);
    expect(element.textContent).toContain("Failed");
    expect(localStorage.getItem(HISTORY_PREFIX + id)).toBe(saved);
    await tick(15000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("removes the thumbnail at expiry without another image or status request", async () => {
    rememberGeneration(id, new Date(Date.now() + 1000).toISOString());
    request.mockResolvedValue(withBase());
    await render();
    expect(element.querySelector("img")).not.toBeNull();
    await tick(1001);
    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain("Expired");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps an already loaded image mounted while the status changes", async () => {
    rememberGeneration(id, expiry());
    request.mockResolvedValueOnce(withBase("generating")).mockResolvedValue(withBase("processing"));
    await render();
    const image = element.querySelector("img");
    await tick();
    expect(element.querySelector("img")).toBe(image);
    expect(element.textContent).toContain("Processing");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(["ready","failed"])("manual refresh retries a failed thumbnail and preserves a %s one",async status=>{
    rememberGeneration(id,expiry());request.mockResolvedValue(withBase());await render();
    const image=element.querySelector("img")!;
    await act(async()=>image.dispatchEvent(new Event(status==="ready"?"load":"error")));
    await act(async()=>[...element.querySelectorAll("button")].find(b=>b.textContent==="Refresh statuses")!.click());
    const next=element.querySelector("img");expect(next).not.toBeNull();
    if(status==="ready")expect(next).toBe(image);else expect(next).not.toBe(image);
  });
});

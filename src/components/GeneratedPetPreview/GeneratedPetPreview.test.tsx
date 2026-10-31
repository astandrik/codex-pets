// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratedPetPreview } from "./GeneratedPetPreview";
import { publicGenerationError } from "@/lib/pets/generation/public-error";

vi.mock("@/components/StatePreview/StatePreview", () => ({ StatePreview: ({slots, active = true}: {active?: boolean; slots?: {afterStage?: ReactNode; sidePanel?: ReactNode; afterControls?: ReactNode}}) => <div>{active && <>Animation preview{slots?.afterStage}</>}{slots?.sidePanel}{active && slots?.afterControls}</div> }));
vi.mock("next/navigation", () => ({useRouter: () => ({push: vi.fn()})}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
let root: Root; let element: HTMLDivElement;
const fetchMock = vi.fn();
const id = "a".repeat(64);
const receipt = { petId: "pet_demo", slug: "demo", submittedAt: "2026-10-11T09:00:00Z" };
function generation(submission?: typeof receipt, status = "completed", displayName = "Demo", pollAfterSeconds = 0) {
  return { generation: { generationId: id, status, expiresAt: "2026-10-12T09:00:00Z", pollAfterSeconds,
    ...(status === "completed" ? { pet: { displayName } } : {}), submission } };
}
function response(body: unknown, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
function defaultFetch(url: string, init?: RequestInit) {
  if (url.endsWith("/slug-check")) return Promise.resolve(response({ available: true, suggestedSlug: JSON.parse(String(init?.body)).slug }));
  if (init?.method === "PUT") return Promise.resolve(response({ submission: receipt }, 201));
  return Promise.resolve(response(generation()));
}
beforeEach(() => {
  vi.useFakeTimers(); element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  vi.stubGlobal("fetch", fetchMock); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
  fetchMock.mockReset(); fetchMock.mockImplementation(defaultFetch);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function render() { await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={id} /></ThemeProvider>)); }
async function tick(ms = 300) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function button() { return [...document.body.querySelectorAll("button")].find(b => b.textContent?.includes("Submit for review")); }
function input() { return document.body.querySelector<HTMLInputElement>("#generated-pet-public-slug")!; }
function edit(value: string) { act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
function puts() { return fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"); }

describe("generated pet public URL and moderation", () => {
  it("explains output moderation, stops polling and offers no automatic retry or submission", async () => {
    const data = generation(undefined, "failed");
    const error = publicGenerationError("provider_rejected", { httpStatus: 400, code: "moderation_blocked", moderationStage: "output" });
    fetchMock.mockResolvedValue(response({ generation: { ...data.generation, error } }));
    await render(); await tick(30000);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("blocked the generated image");
    expect(document.body.textContent).toContain("No image was returned");
    expect(document.body.textContent).toContain("No further automatic retry will be started");
    expect(button()).toBeUndefined(); expect(puts()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("shows an honest fallback for an old server returning only an error code", async () => {
    fetchMock.mockResolvedValue(response({ generation: { ...generation(undefined, "failed").generation, error: { code: "provider_rejected" } } }));
    await render();
    expect(document.body.textContent).toContain("do not identify the reason");
    expect(document.body.textContent).not.toContain("blocked the generated image");
  });
  it("suggests a transliterated slug, waits 300ms and submits PUT only after a click", async () => {
    fetchMock.mockResolvedValueOnce(response(generation(undefined, "completed", "Мятня")));
    await render();
    expect(input().value).toBe("myatnya"); expect(button()?.disabled).toBe(true);
    expect(document.body.textContent).toContain("https://pets.example/pets/myatnya");
    await tick(299); expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1); expect(fetchMock).toHaveBeenCalledTimes(2); expect(button()?.disabled).toBe(false);
    expect(puts()).toHaveLength(0);
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => { button()!.click(); button()!.click(); });
    expect(puts()).toHaveLength(1); expect(puts()[0][1]).toMatchObject({ method: "PUT", body: '{"slug":"myatnya"}' });
    expect(button()?.disabled).toBe(true);
    await act(async () => resolve(response({ submission: { ...receipt, slug: "myatnya" } }, 201)));
    expect(document.body.textContent).toContain("Sent for review"); expect(document.body.textContent).toContain("after approval");
    expect(button()).toBeUndefined(); expect(input().readOnly).toBe(true);
    expect(document.body.querySelector('a[href$="pet.zip"]')).not.toBeNull();
  });
  it("preserves the edited slug across status polls and debounces multiple edits", async () => {
    fetchMock.mockResolvedValueOnce(response(generation(undefined, "completed", "Demo", 1)));
    await render(); edit("mine"); await tick(200); edit("my-fox"); await tick(299);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1); expect(JSON.parse(fetchMock.mock.calls[1][1].body).slug).toBe("my-fox");
    await tick(500); expect(input().value).toBe("my-fox");
    expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2);
  });
  it("ignores an older availability response even if its aborted fetch resolves", async () => {
    let stale!: (value: unknown) => void;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/slug-check") && JSON.parse(String(init?.body)).slug === "demo"
      ? new Promise(resolve => { stale = resolve; }) : defaultFetch(url, init));
    await render(); await tick(); edit("my-fox"); await tick();
    await act(async () => stale(response({ available: false, suggestedSlug: "demo-2" })));
    expect(input().value).toBe("my-fox"); expect(button()?.disabled).toBe(false);
  });
  it("previews a suffix but submits the original base and pins the final race-safe receipt", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/slug-check")) return Promise.resolve(response({ available: false, suggestedSlug: "demo-2" }));
      if (init?.method === "PUT") return Promise.resolve(response({ submission: { ...receipt, slug: "demo-3" } }, 201));
      return defaultFetch(url, init);
    });
    await render(); await tick(); expect(input().value).toBe("demo");
    expect(document.body.textContent).toContain("already taken"); await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(button()?.disabled).toBe(false);
    expect(document.body.textContent).toContain("https://pets.example/pets/demo-2");
    await act(async () => button()!.click());
    expect(JSON.parse(puts()[0][1].body).slug).toBe("demo");
    expect(input().value).toBe("demo-3"); expect(input().readOnly).toBe(true);
    expect(document.body.textContent).toContain("https://pets.example/pets/demo-3");
  });
  it("uses the saved first-wins receipt even when submission returns a different slug", async () => {
    await render(); edit("different-draft"); await tick();
    await act(async () => button()!.click());
    expect(JSON.parse(puts()[0][1].body).slug).toBe("different-draft");
    expect(input().value).toBe("demo"); expect(input().readOnly).toBe(true);
    expect(document.body.textContent).toContain("Saved public URL: https://pets.example/pets/demo");
  });
  it("pins a receipt returned by the check and never creates another submission", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/slug-check")
      ? Promise.resolve(response({ available: true, suggestedSlug: "saved", submission: { ...receipt, slug: "saved" } })) : defaultFetch(url, init));
    await render(); await tick();
    expect(input().value).toBe("saved"); expect(input().readOnly).toBe(true); expect(button()).toBeUndefined();
    expect(puts()).toHaveLength(0);
  });
  it("retries PUT after a network error without falling back to legacy POST", async () => {
    await render(); await tick();
    fetchMock.mockRejectedValueOnce(new Error("network"));
    await act(async () => button()!.click());
    expect(document.body.textContent).toContain("Try again"); expect(button()?.disabled).toBe(false);
    await act(async () => button()!.click()); expect(puts()).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith("/submission") && init?.method === "POST")).toBe(false);
    expect(document.body.textContent).toContain("Sent for review");
  });
  it("does not fall back to POST when the server does not support PUT", async () => {
    await render(); await tick(); fetchMock.mockResolvedValueOnce(response({}, 405));
    await act(async () => button()!.click());
    expect(puts()).toHaveLength(1); expect(document.body.textContent).toContain("Could not confirm submission");
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith("/submission") && init?.method === "POST")).toBe(false);
  });
  it("ignores a late PUT from the previous generation and keeps the next submission busy", async () => {
    const nextId = "b".repeat(64);
    let finishOld!: (value: unknown) => void;
    let finishNext!: (value: unknown) => void;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return new Promise(resolve => {
        if (url.includes(nextId)) finishNext = resolve; else finishOld = resolve;
      });
      if (url.endsWith(nextId)) return Promise.resolve(response(generation(undefined, "completed", "Other")));
      return defaultFetch(url, init);
    });
    await render(); await tick(); await act(async () => button()!.click());
    expect(button()?.disabled).toBe(true);
    const oldSignal: AbortSignal = puts()[0][1].signal;
    await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={nextId} /></ThemeProvider>));
    expect(oldSignal.aborted).toBe(true); expect(input().value).toBe("other");
    await tick(); expect(button()?.disabled).toBe(false);
    await act(async () => button()!.click()); expect(puts()).toHaveLength(2);
    await act(async () => finishOld(response({ submission: receipt }, 201)));
    expect(input().value).toBe("other"); expect(input().readOnly).toBe(false);
    expect(button()?.disabled).toBe(true); expect(document.body.textContent).not.toContain("Sent for review");
    await act(async () => finishNext(response({ submission: { ...receipt, petId: "pet_other", slug: "other" } }, 201)));
    expect(input().value).toBe("other"); expect(input().readOnly).toBe(true);
  });
  it("ignores an old poll JSON body that resolves after navigation to another generation", async () => {
    let finishOldJson!: (value: unknown) => void;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => new Promise(resolve => { finishOldJson = resolve; }) });
    await render();
    const nextId = "b".repeat(64);
    fetchMock.mockResolvedValueOnce(response(generation(undefined, "completed", "Other")));
    await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={nextId} /></ThemeProvider>));
    await act(async () => finishOldJson(generation(receipt)));
    expect(input().value).toBe("other"); expect(input().readOnly).toBe(false);
    expect(document.body.textContent).not.toContain("Sent for review");
  });
  it("requires manual entry when the name cannot provide an ASCII slug and rejects invalid input", async () => {
    fetchMock.mockResolvedValueOnce(response(generation(undefined, "completed", "東京")));
    await render(); expect(input().value).toBe(""); expect(button()?.disabled).toBe(true);
    edit("../private"); await tick(); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button()?.disabled).toBe(true); edit("my-pet"); await tick(); expect(button()?.disabled).toBe(false);
    expect(input().getAttribute("aria-describedby")).toContain("generated-pet-public-url");
  });
  it("shows an existing receipt after reload and preserves it when a late poll has no receipt", async () => {
    fetchMock.mockResolvedValueOnce(response(generation(receipt, "completed", "Demo", 1)));
    await render(); await tick(1000);
    expect(input().value).toBe("demo"); expect(input().readOnly).toBe(true); expect(button()).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/slug-check"))).toBe(false);
  });
  it("never offers submission before completion or after expiry", async () => {
    fetchMock.mockResolvedValueOnce(response(generation(undefined, "processing")));
    await render(); expect(button()).toBeUndefined();
    await act(async () => root.unmount()); root = createRoot(element);
    fetchMock.mockResolvedValueOnce(response({}, 410)); await render(); expect(button()).toBeUndefined();
    expect(document.body.textContent).toContain("expired");
  });
});

it("imports an explicitly opened valid private result into this browser history",async()=>{
 localStorage.clear();
 fetchMock.mockResolvedValueOnce(response({generation:{...generation().generation,expiresAt:new Date(Date.now()+86400000).toISOString()}}));
 await render();const {readGenerationHistory}=await import("@/lib/pets/generation/history");
 expect(readGenerationHistory().entries.map(entry=>entry.generationId)).toEqual([id]);
 expect(document.body.querySelector('a[href="/my-generations"]')).not.toBeNull();
});

it("requires saved metadata before downloads and moderation, then forwards the new revision",async()=>{
 const metadata={displayName:"Demo",description:"Original description",tags:["blue"],revision:0,editable:true,automaticState:"completed",edited:false};
 fetchMock.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.endsWith('/metadata'))return Promise.resolve(response({metadata:{...metadata,...JSON.parse(String(init?.body)),revision:1,edited:true}}));
  if(url.endsWith('/slug-check'))return Promise.resolve(response({available:true,suggestedSlug:'demo'}));
  if(init?.method==='PUT')return Promise.resolve(response({submission:receipt},201));
  return Promise.resolve(response({generation:{...generation().generation,metadata}}));
 });
 await render();await tick();const area=document.body.querySelector<HTMLTextAreaElement>('#generated-description')!;
 act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Edited description');area.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(button()?.disabled).toBe(true);expect(document.body.querySelector('a[href$="pet.zip"]')).toBeNull();
 await act(async()=>document.body.querySelector('form.generated-pet-metadata')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(button()?.disabled).toBe(false);expect(document.body.querySelector('a[href$="pet.zip"]')).not.toBeNull();
 expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/metadata'))).toHaveLength(1);expect(area.value).toBe('Edited description');
});

it("offers explicit reload and blocks stale metadata submission after a conflict",async()=>{
 const metadata={description:"A pet.",tags:["blue"],revision:0,editable:true,automaticState:"completed",edited:false};
 fetchMock.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.endsWith('/slug-check'))return Promise.resolve(response({available:true,suggestedSlug:JSON.parse(String(init?.body)).slug}));
  if(init?.method==='PUT')return Promise.resolve(response({code:'metadata_conflict'},409));
  return Promise.resolve(response({generation:{...generation().generation,metadata}}));
 });
 await render();await tick();await act(async()=>button()!.click());
 expect(document.body.textContent).toContain('Name, description or tags changed');expect(document.body.querySelector('a[data-metadata-reload]')).not.toBeNull();expect(button()?.disabled).toBe(true);
 edit('new-url');await tick();expect(button()?.disabled).toBe(true);expect(puts()).toHaveLength(1);
});

it.each([false,true])("updates the heading and preserves a manually selected URL: %s",async manualSlug=>{
 const metadata={displayName:"Generated pet",description:"Blue bus",tags:["blue"],revision:0,editable:true,automaticState:"completed",edited:false};
 fetchMock.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.endsWith('/metadata'))return Promise.resolve(response({metadata:{...metadata,...JSON.parse(String(init?.body)),revision:1,edited:true}}));
  if(url.endsWith('/slug-check'))return Promise.resolve(response({available:true,suggestedSlug:JSON.parse(String(init?.body)).slug}));
  return Promise.resolve(response({generation:{...generation(undefined,'completed','Generated pet').generation,metadata}}));
 });
 await render();await tick();if(manualSlug)edit('my-own-url');
 const name=document.body.querySelector<HTMLInputElement>('#generated-name')!;
 act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Мятня');name.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(button()?.disabled).toBe(true);
 await act(async()=>document.body.querySelector('form.generated-pet-metadata')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(document.body.querySelector('h1')?.textContent).toBe('Мятня');expect(input().value).toBe(manualSlug?'my-own-url':'myatnya');await tick();expect(button()?.disabled).toBe(false);
});

it("waits without polling, refreshes on focus and resumes polling after idempotent confirmation", async () => {
  const waiting = {...generation(undefined, "awaiting_confirmation").generation, expiresAt: new Date(Date.now() + 86400000).toISOString(), reviewBase: true};
  let confirmed = false;
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {confirmed = true; return response({generation: {...waiting, status: "queued", baseConfirmed: true, pollAfterSeconds: 5}}, 202);}
    return response({generation: confirmed ? {...waiting, status: "queued", pollAfterSeconds: 5} : waiting});
  });
  await render(); await tick(30000);
  expect(fetchMock).toHaveBeenCalledOnce(); expect(document.body.querySelector('img')?.getAttribute("src")).toBe(`/api/pet-generations/${id}/base`);
  expect(document.body.textContent).toContain("Confirmation does not extend");
  await act(async () => window.dispatchEvent(new Event("focus"))); expect(fetchMock).toHaveBeenCalledTimes(2);
  act(() => document.body.querySelector("img")!.dispatchEvent(new Event("load")));
  const animate = [...document.body.querySelectorAll("button")].find(b => b.textContent === "Animate this character")!;
  await act(async () => {animate.click(); animate.click();});
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(document.body.textContent).toContain("Waiting in the queue");
  const calls = fetchMock.mock.calls.length; await tick(5000); expect(fetchMock.mock.calls.length).toBe(calls + 1);
});

it("keeps base visible on queue refusal and disables confirmation at expiry", async () => {
  const waiting = {...generation(undefined, "awaiting_confirmation").generation, expiresAt: new Date(Date.now() + 10000).toISOString()};
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST" ? response({code: "queue_full"}, 429) : response({generation: waiting}));
  await render();
  act(() => document.body.querySelector("img")!.dispatchEvent(new Event("load")));
  await act(async () => [...document.body.querySelectorAll("button")].find(b => b.textContent === "Animate this character")!.click());
  expect(document.body.textContent).toContain("Your character is saved"); expect(document.body.querySelector("img")).not.toBeNull();
  await tick(10001); expect(document.body.textContent).toContain("This generation has expired");
  expect([...document.body.querySelectorAll("button")].some(b => b.textContent === "Animate this character")).toBe(false);
});

it("keeps polling after a successful confirmation when the immediate status read fails", async () => {
  const waiting = {...generation(undefined, "awaiting_confirmation").generation, progress: {completedSteps: 1, totalSteps: 12}, expiresAt: new Date(Date.now() + 86400000).toISOString(), reviewBase: true, baseConfirmed: false};
  let confirmed = false, failedReads = 0;
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {confirmed = true; return response({generation: {...waiting, status: "queued", baseConfirmed: true, pollAfterSeconds: 5}}, 202);}
    if (!confirmed) return response({generation: waiting});
    if (failedReads++ === 0) return response({code: "generation_unavailable"}, 503);
    return response(generation());
  });
  await render(); act(() => document.body.querySelector("img")!.dispatchEvent(new Event("load")));
  await act(async () => [...document.body.querySelectorAll("button")].find(b => b.textContent === "Animate this character")!.click());
  await tick(5000);
  expect(document.body.textContent).toContain("Ready");
  expect(document.body.textContent).not.toContain("Animation requested. Refreshing progress");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

it("keeps a completed candidate private until another tab accepts it, refreshing without periodic status polling", async () => {
  const candidate={...generation().generation,expiresAt:new Date(Date.now()+86400000).toISOString(),animationRevision:{sourceGenerationId:"b".repeat(64),selectedStates:["idle"],corrections:{idle:["Tilt only"]},beforeSpritesheetUrl:"/before.webp"}};
  fetchMock.mockResolvedValue(response({generation:candidate}));
  await render(); await tick(5000);
  expect(document.body.textContent).toContain("Проверьте новую версию");
  expect(document.body.textContent).toContain("Tilt only");
  expect(document.body.querySelector('a[href$="pet.zip"]')).toBeNull();expect(button()).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValue(response({generation:{...candidate,animationRevision:{...candidate.animationRevision,acceptedAt:Date.now()}}}));
  await act(async()=>window.dispatchEvent(new Event("focus")));
  expect(document.body.textContent).not.toContain("Проверьте новую версию");
  expect(document.body.textContent).toContain("Tilt only");
  expect(document.body.querySelector('a[href$="pet.zip"]')).not.toBeNull();expect(button()).toBeDefined();
});

it.each([404, 410])("disables stale candidate acceptance when status refresh returns %i", async status => {
  const candidate = {...generation().generation, expiresAt: new Date(Date.now() + 1000).toISOString(), animationRevision: {sourceGenerationId: "b".repeat(64), selectedStates: ["idle"], corrections: {}, beforeSpritesheetUrl: "/before.webp"}};
  let unavailable = false;
  fetchMock.mockImplementation(async () => unavailable ? response({code: status === 410 ? "generation_expired" : "not_found"}, status) : response({generation: candidate}));
  await render();
  const accept = () => [...document.body.querySelectorAll("button")].find(button => button.textContent === "Принять новую версию")!;
  expect(accept().disabled).toBe(false);
  unavailable = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(document.body.textContent).toContain("has expired");
  expect(accept().disabled).toBe(true);
  await act(async () => accept().click());
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
});

it("keeps metadata drafts and gates while panels close, resize and polling refreshes", async () => {
  const metadata = { displayName: "Demo", description: "Original", tags: ["blue"], revision: 0, editable: true, automaticState: "completed", edited: false };
  fetchMock.mockImplementation((url, init) => url.endsWith("/slug-check") ? defaultFetch(url, init) : Promise.resolve(response({ generation: { ...generation(undefined, "completed", "Demo", 1).generation, metadata } })));
  await render(); await tick();
  const click = async (label: string) => act(async () => [...document.body.querySelectorAll("button")].find(b => b.textContent?.includes(label))!.click());
  await click("Name, description & tags");
  const name = document.querySelector<HTMLInputElement>("#generated-name")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Unsaved"); name.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(document.querySelector('a[href$="pet.zip"]')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close metadata panel"]')!.click());
  await act(async () => window.dispatchEvent(new Event("resize"))); await tick(1000);
  await click("Prepare gallery submission"); expect(button()?.disabled).toBe(true);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close publication panel"]')!.click());
  await click("Name, description & tags");
  expect(document.querySelector("#generated-name")).toBe(name); expect(name.value).toBe("Unsaved");
  expect(puts()).toHaveLength(0);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").every(([url]) => url.endsWith("/slug-check"))).toBe(true);
});

it("keeps instructions escaped and source and previous versions distinct in details", async () => {
  const source = "b".repeat(64), previous = "c".repeat(64);
  const prompt = "Move slowly\n<script>example</script>";
  fetchMock.mockImplementation((url, init) => url.endsWith("/slug-check") ? defaultFetch(url, init) : Promise.resolve(response({ generation: { ...generation().generation, baseConfirmed: true, animationPrompt: prompt, continuation: { mode: "regenerate", sourceGenerationId: source } } })));
  await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={id} previousGenerationId={previous} /></ThemeProvider>));
  await act(async () => [...document.querySelectorAll("button")].find(b => b.textContent?.startsWith("Generation details"))!.click());
  const details = document.querySelector('[role="dialog"][aria-label="Generation details"]')!;
  expect(details.textContent).toContain(prompt); expect(details.querySelector("script")).toBeNull();
  expect(details.querySelector(`a[href="/generated/${source}"]`)?.textContent).toBe("Исходное задание");
  expect(details.querySelector(`a[href="/generated/${previous}"]`)?.textContent).toBe("Open previous version");
  expect(puts()).toHaveLength(0);
});

it("keeps an in-flight saved animation recovery alive when the initial read becomes ready", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  sessionStorage.setItem(`pets-animation-revision-v1:${id}`, JSON.stringify({requestId, states:["idle"], sourceMetadataRevision:0, hash:"d".repeat(64), expiresAt:Date.now()+86400000}));
  let finishStatus!: (value: unknown) => void, finishRecovery!: (value: unknown) => void;
  fetchMock.mockImplementation((url, init) => {
    if (url.includes("/animation-revisions?")) return new Promise(resolve => {finishRecovery = resolve;});
    if (url.endsWith(id)) return new Promise(resolve => {finishStatus = resolve;});
    return defaultFetch(url, init);
  });
  await render();
  await act(async () => [...document.querySelectorAll("button")].find(b => b.textContent === "Проверить отправленную версию")!.click());
  const recovery = fetchMock.mock.calls.find(([url]) => url.includes("/animation-revisions?"))!;
  expect(recovery[1].signal.aborted).toBe(false);
  await act(async () => finishStatus(response(generation())));
  expect(recovery[1].signal.aborted).toBe(false);
  await act(async () => finishRecovery(response({generation:{generationId:"b".repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}})));
  expect(document.querySelector(`a[href="/generated/${"b".repeat(64)}"]`)?.textContent).toBe("Открыть новую версию");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  expect(sessionStorage.getItem(`pets-animation-revision-v1:${id}`)).toBeNull();
});

it("does not create request identities or extra requests when result panels and viewport change", async () => {
  const metadata = {displayName:"Demo",description:"Original",tags:[],revision:0,editable:true,automaticState:"completed",edited:false};
  fetchMock.mockImplementation((url, init) => url.endsWith("/slug-check") ? defaultFetch(url, init) : Promise.resolve(response({generation:{...generation().generation,metadata,baseConfirmed:true,animationPrompt:"Wave slowly"}})));
  const uuid = vi.spyOn(crypto, "randomUUID"), storage = vi.spyOn(Storage.prototype, "setItem");
  try {
    await render(); await tick(); const baseline = fetchMock.mock.calls.length; const initialIds = uuid.mock.calls.length, initialWrites = storage.mock.calls.length;
    for (const [open, close] of [["Name, description & tags", "Close metadata panel"], ["Prepare gallery submission", "Close publication panel"], ["Generation details", "Close details panel"]]) {
      await act(async () => [...document.querySelectorAll("button")].find(node => node.textContent?.startsWith(open))!.click());
      await act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="${close}"]`)!.click());
      await tick();
    }
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(fetchMock.mock.calls).toHaveLength(baseline);
    expect(uuid).toHaveBeenCalledTimes(initialIds); expect(storage).toHaveBeenCalledTimes(initialWrites);
  } finally {uuid.mockRestore(); storage.mockRestore();}
});

it.each(["queued", "completed"])("restores the page title and status after another tab moves recovery to %s", async statusAfterRefresh => {
  localStorage.clear();
  let status = "failed";
  fetchMock.mockImplementation(async url => url.endsWith("/continuations")
    ? response({options: {sourceRevision: "f".repeat(64), canRebuild: true, canRegenerate: true, requiredStates: [], strips: [], rebuildsRemaining: 3, issues: []}})
    : response({generation: {...generation(undefined, status).generation, canContinue: status === "failed", reviewBase: true, baseConfirmed: true}}));
  await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={id} continuationEnabled /></ThemeProvider>));
  await act(async () => [...element.querySelectorAll("button")].find(b => b.textContent === "Продолжить генерацию")!.click());
  expect(element.querySelector(".generation-recovery")).not.toBeNull();
  status = statusAfterRefresh;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(element.querySelector(".generation-recovery")).toBeNull();
  expect(element.querySelector("h1")!.closest("[hidden]")).toBeNull();
  expect(element.textContent).toContain(status === "queued" ? "Waiting in the queue" : "Ready");
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});

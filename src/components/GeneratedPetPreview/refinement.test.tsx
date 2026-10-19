// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {GeneratedPetPreview} from "./GeneratedPetPreview";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false})) as typeof window.matchMedia;
const original = "a".repeat(64), child = "b".repeat(64), next = "c".repeat(64);
const navigate = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({useRouter: () => ({push: navigate})}));
const fetchMock = vi.fn(); let root: Root; let host: HTMLDivElement;
const deadline = () => new Date(Date.now() + 86400000).toISOString();
const reply = (generationId: string) => ({generation: {generationId, status: "awaiting_confirmation", progress: {completedSteps: 1, totalSteps: 12}, reviewBase: true, baseConfirmed: false, expiresAt: deadline()}});
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset(); fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const id = url.split("/")[3];
    if (init?.method === "POST" && url.endsWith("/refine")) return Response.json(reply(id === original ? child : next), {status: 202});
    if (init?.method === "POST" && url.endsWith("/confirm")) return Response.json({generation: {...reply(id).generation, status: "queued", baseConfirmed: true}}, {status: 202});
    return Response.json(reply(id));
  });
  navigate.mockReset(); navigate.mockImplementation((url: string) => {
    const target = new URL(url, "https://pets.example");
    root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={target.pathname.split("/")[2]} previousGenerationId={target.searchParams.get("from") ?? undefined}/></ThemeProvider>);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();});
const findButton = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label);
async function render() {
  await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={original}/></ThemeProvider>));
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("load")));
}
async function edit(text = "Make the scarf red") {
  const button = findButton("Edit character"); expect(button).toBeDefined();
  await act(async () => button!.click());
  const input = host.querySelector("textarea")!;
  act(() => {Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", {bubbles: true}));});
}
async function submit(waitForResponse = true) {
  const previousPosts = posts().length;
  await act(async () => (findButton("Create new version") ?? findButton("Check submitted version"))!.click());
  await vi.waitFor(async () => {
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 0));});
    expect(posts().length > previousPosts || Boolean(host.querySelector("[role=alert]"))).toBe(true);
  });
  if (waitForResponse) await vi.waitFor(async () => {
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 0));});
    expect(findButton("Cancel edit")?.disabled ?? false).toBe(false);
  });
}
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

it("uses the displayed base, preserves its link and confirms only the resulting version", async () => {
  await render(); await edit(); await submit();
  expect(posts()).toHaveLength(1);
  expect(posts()[0][0]).toBe(`/api/pet-generations/${original}/refine`);
  expect(JSON.parse(String(posts()[0][1].body))).toMatchObject({prompt: "Make the scarf red", requestId: expect.any(String)});
  expect(host.querySelector(`a[href="/generated/${original}"]`)).not.toBeNull();
  expect(host.querySelector(`a[href="/generated/${child}"]`)).not.toBeNull();
  const current = [...host.querySelectorAll("img")].find(img => img.src.endsWith(`/${child}/base`)); expect(current).toBeDefined();
  await act(async () => current!.dispatchEvent(new Event("load")));
  await act(async () => findButton("Animate this character")!.click());
  expect(posts().map(([url]) => url)).toEqual([`/api/pet-generations/${original}/refine`, `/api/pet-generations/${child}/confirm`]);
  expect(localStorage.getItem("pets-generation-history-v1:" + original)).not.toBeNull();
  expect(localStorage.getItem("pets-generation-history-v1:" + child)).not.toBeNull();
  expect(JSON.stringify({...sessionStorage, ...localStorage})).not.toContain("Make the scarf red");
});

it("reuses a request after a lost response, but a later intentional refinement gets a new request", async () => {
  const normal = fetchMock.getMockImplementation()!; let lost = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine") && !lost) {lost = true; throw Error("synthetic lost response");}
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  expect(host.querySelector(`img[src="/api/pet-generations/${original}/base"]`)).not.toBeNull();
  await submit();
  const firstIds = posts().map(([, init]) => JSON.parse(String(init.body)).requestId);
  expect(firstIds).toHaveLength(2); expect(firstIds[1]).toBe(firstIds[0]);
  await act(async () => host.querySelector(`img[src="/api/pet-generations/${child}/base"]`)!.dispatchEvent(new Event("load")));
  await edit(); await submit();
  expect(posts()[2][0]).toBe(`/api/pet-generations/${child}/refine`);
  expect(JSON.parse(String(posts()[2][1].body)).requestId).not.toBe(firstIds[0]);
});

it("keeps the original and the draft editable when a new attempt is rejected", async () => {
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith("/refine") ? Response.json({code: "rate_limited", limitScope: "ip"}, {status: 429}) : normal(url, init));
  await render(); await edit(); await submit();
  expect(host.textContent).toContain("IP address");
  expect(host.querySelector("textarea")?.value).toBe("Make the scarf red");
  expect(host.querySelector(`img[src="/api/pet-generations/${original}/base"]`)).not.toBeNull();
  expect(findButton("Animate this character")?.disabled).toBe(false);
  expect(posts()).toHaveLength(1);
});

it("keeps an accepted refinement response recoverable when the source expires while it is in flight", async () => {
  const normal = fetchMock.getMockImplementation()!;
  const expiresAt = new Date(Date.now() + 1500).toISOString();
  let finish!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => {finish = resolve;});
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) return delayed;
    if (url === `/api/pet-generations/${original}`) return Response.json({generation: {...reply(original).generation, expiresAt}});
    return normal(url, init);
  });
  await render(); await edit(); await submit(false);
  expect(posts()).toHaveLength(1);
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 1550));});
  await act(async () => {finish(Response.json(reply(child), {status: 202})); await new Promise(resolve => setTimeout(resolve, 20));});
  expect(navigate).toHaveBeenCalledWith(`/generated/${child}?from=${original}`);
  expect(localStorage.getItem("pets-generation-history-v1:" + child)).not.toBeNull();
});

it("replays the fixed submitted edit after an expired source and a lost response", async () => {
  const normal = fetchMock.getMockImplementation()!; let lost = false;
  const expiresAt = new Date(Date.now() + 1500).toISOString();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine") && !lost) {lost = true; throw Error("synthetic lost response after admission");}
    if (url === `/api/pet-generations/${original}`) return Response.json({generation: {...reply(original).generation, expiresAt}});
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  const firstBody = String(posts()[0][1].body);
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 1550));});
  const retry = findButton("Check submitted version"); expect(retry).toBeDefined(); expect(retry?.disabled).toBe(false);
  expect(host.querySelector("textarea")?.disabled).toBe(true);
  await act(async () => {retry!.click(); await new Promise(resolve => setTimeout(resolve, 50));});
  expect(posts()).toHaveLength(2); expect(String(posts()[1][1].body)).toBe(firstBody);
  expect(navigate).toHaveBeenCalledWith(`/generated/${child}?from=${original}`);
});

it("receives the new version when another tab confirms the source during the request", async () => {
  const normal = fetchMock.getMockImplementation()!; let confirmedElsewhere = false;
  let finish!: (response: Response) => void; const delayed = new Promise<Response>(resolve => {finish = resolve;});
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) return delayed;
    if (url === `/api/pet-generations/${original}` && confirmedElsewhere) return Response.json({generation: {...reply(original).generation, status: "queued", baseConfirmed: true}});
    return normal(url, init);
  });
  await render(); await edit(); await submit(false);
  const signal = posts()[0][1].signal as AbortSignal;
  confirmedElsewhere = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(signal.aborted).toBe(false);
  await act(async () => {finish(Response.json(reply(child), {status: 202})); await new Promise(resolve => setTimeout(resolve, 20));});
  expect(navigate).toHaveBeenCalledWith(`/generated/${child}?from=${original}`);
  expect(localStorage.getItem("pets-generation-history-v1:" + child)).not.toBeNull();
});

it("creates a fresh request when the user returns to the original and intentionally repeats the same edit", async () => {
  await render(); await edit(); await submit();
  const first = JSON.parse(String(posts()[0][1].body));
  await render(); await edit(); await submit();
  expect(posts().map(([url]) => url)).toEqual([`/api/pet-generations/${original}/refine`, `/api/pet-generations/${original}/refine`]);
  const second = JSON.parse(String(posts()[1][1].body));
  expect(second.prompt).toBe(first.prompt); expect(second.requestId).not.toBe(first.requestId);
});


it.each(["expired", "confirmed"])("recovers a lost receipt after remount with a %s source", async condition => {
  const normal = fetchMock.getMockImplementation()!; let lost = false; let remounted = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine") && !lost) {lost = true; throw Error("synthetic lost receipt");}
    if (remounted && url === `/api/pet-generations/${original}`) return condition === "expired"
      ? Response.json({code: "generation_expired"}, {status: 410})
      : Response.json({generation: {...reply(original).generation, status: "queued", baseConfirmed: true}});
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  const body = String(posts()[0][1].body);
  await act(async () => root.unmount()); root = createRoot(host); remounted = true;
  await act(async () => {root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={original}/></ThemeProvider>);});
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 50));});
  const recovery = findButton("Recover submitted edit"); expect(recovery).toBeDefined();
  await act(async () => recovery!.click());
  const input = host.querySelector("textarea")!;
  const type = (value: string) => act(() => {Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", {bubbles: true}));});
  type("A different edit");
  await act(async () => {findButton("Check submitted version")!.click(); await new Promise(resolve => setTimeout(resolve, 50));});
  expect(posts()).toHaveLength(1);
  expect(host.textContent).toContain("same edit text");
  type("Make the scarf red");
  await act(async () => {findButton("Check submitted version")!.click(); await new Promise(resolve => setTimeout(resolve, 50));});
  expect(posts()).toHaveLength(2); expect(String(posts()[1][1].body)).toBe(body);
  expect(navigate).toHaveBeenCalledWith(`/generated/${child}?from=${original}`);
  expect(localStorage.getItem("pets-generation-history-v1:" + child)).not.toBeNull();
});

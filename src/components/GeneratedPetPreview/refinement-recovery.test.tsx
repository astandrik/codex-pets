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
  const button = (findButton("Edit character") ?? findButton("Recover submitted edit")); expect(button).toBeDefined();
  await act(async () => button!.click());
  const input = host.querySelector("textarea")!;
  act(() => {Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", {bubbles: true}));});
}
async function submit() {await act(async () => {(findButton("Create new version") ?? findButton("Check submitted version"))!.click(); await new Promise(resolve => setTimeout(resolve, 50));});}
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");


function changeText(value: string) {
  const input = host.querySelector("textarea")!;
  act(() => {Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", {bubbles: true}));});
}

it.each([false, true])("keeps uncertain identity pinned when changed text follows lost response (remount=%s)", async remount => {
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) throw Error("synthetic accepted request with lost response");
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  const first = JSON.parse(String(posts()[0][1].body));
  if (remount) {
    await act(async () => root.unmount()); root = createRoot(host);
    await render(); await edit("Make the scarf green");
  } else changeText("Make the scarf green");
  await submit();
  // Without an explicit abandon action, no differently identified paid request may replace recovery.
  for (const [, init] of posts()) expect(JSON.parse(String(init.body))).toEqual(first);
});

it.each(["before", "after"])("keeps recovery visible when cancel occurs %s local expiry without a status refresh", async when => {
  const normal = fetchMock.getMockImplementation()!;
  const expiresAt = new Date(Date.now() + 1000).toISOString();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) throw Error("synthetic accepted request with lost response");
    if (url === `/api/pet-generations/${original}`) return Response.json({generation: {...reply(original).generation, expiresAt}});
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  expect(posts()).toHaveLength(1);
  const reads = fetchMock.mock.calls.filter(([, init]) => !init?.method).length;
  if (when === "before") await act(async () => findButton("Cancel edit")!.click());
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 1100));});
  if (when === "after") await act(async () => findButton("Cancel edit")!.click());
  expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(reads);
  expect(host.textContent).toContain("This generation has expired.");
  await vi.waitFor(async () => {
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 0));});
    expect(findButton("Recover submitted edit")?.disabled).toBe(false);
  });
});

it("keeps the recovery identity when local history cannot save the accepted link", async () => {
  const native = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage) throw new DOMException("Synthetic quota exhaustion", "QuotaExceededError");
    return native.call(this, key, value);
  });
  try {
    await render(); await edit(); await submit();
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector(`a[href="/generated/${child}?from=${original}"]`)).not.toBeNull();
    expect(host.querySelector("[role=alert]")?.textContent).toMatch(/My generations/);
    expect(localStorage.getItem("pets-generation-history-v1:" + child)).toBeNull();
    const {hasPendingRefinement} = await import("../PetGenerationForm/request");
    expect(await hasPendingRefinement(sessionStorage, original)).toBe(true);
  } finally {spy.mockRestore();}
});


it("allows changed text after a definitive quota rejection", async () => {
  const normal = fetchMock.getMockImplementation()!; let rejected = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine") && !rejected) {rejected = true; return Response.json({code: "rate_limited", limitScope: "ip"}, {status: 429});}
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  expect(host.querySelector("textarea")?.disabled).toBe(false);
  changeText("Make the scarf green"); await submit();
  const bodies = posts().map(([, init]) => JSON.parse(String(init.body)));
  expect(bodies).toHaveLength(2); expect(bodies[1].prompt).toBe("Make the scarf green");
  expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  expect(localStorage.getItem("pets-generation-history-v1:" + child)).not.toBeNull();
});

it.each(["http", "receipt"])("pins the submitted text after an uncertain %s response", async kind => {
  const normal = fetchMock.getMockImplementation()!; let failed = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine") && !failed) {
      failed = true;
      return kind === "http" ? Response.json({code: "generation_unavailable"}, {status: 503}) : new Response("not JSON", {status: 202});
    }
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  expect(host.querySelector("textarea")?.disabled).toBe(true);
  await submit();
  expect(String(posts()[1][1].body)).toBe(String(posts()[0][1].body));
  expect(localStorage.getItem("pets-generation-history-v1:" + child)).not.toBeNull();
});


it.each([403, 400, 413])("retains an uncertain request when a retry fails before dedup with HTTP %s", async status => {
  const normal = fetchMock.getMockImplementation()!; let attempts = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) {
      attempts++;
      if (attempts === 1) throw Error("synthetic accepted request with lost response");
      if (attempts === 2) return Response.json({code: {403: "invalid_origin", 400: "invalid_argument", 413: "body_too_large"}[status]}, {status});
    }
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  const first = String(posts()[0][1].body);
  await submit();
  const {hasPendingRefinement} = await import("../PetGenerationForm/request");
  expect(await hasPendingRefinement(sessionStorage, original)).toBe(true);
  expect(host.querySelector("textarea")?.disabled).toBe(true);
  changeText("Make the scarf green"); await submit();
  expect(posts()).toHaveLength(3);
  expect(posts().map(([, init]) => String(init.body))).toEqual([first, first, first]);
});

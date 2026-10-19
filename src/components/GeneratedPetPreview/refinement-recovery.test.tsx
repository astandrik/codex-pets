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

async function expiredStatusAfterLostReceipt() {
  const normal = fetchMock.getMockImplementation()!; let expired = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) throw Error("synthetic accepted request with lost response");
    if (expired && url === `/api/pet-generations/${original}`) return Response.json({code: "generation_expired"}, {status: 410});
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  expect(posts()).toHaveLength(1);
  await act(async () => findButton("Cancel edit")!.click());
  expired = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.textContent).toContain("This generation is unavailable or has expired.");
  await vi.waitFor(async () => {
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 0));});
    expect(findButton("Recover submitted edit")).toBeDefined();
  });
}

it("shows only one recovery control after a loaded review source returns410", async () => {
  await expiredStatusAfterLostReceipt();
  // Both entry points become visible after their async pending-identity reads settle.
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 50));});
  expect([...host.querySelectorAll("button")].filter(b => b.textContent === "Recover submitted edit")).toHaveLength(1);
});

it("does not abort an in-flight recovery when another recovery entry is opened", async () => {
  await expiredStatusAfterLostReceipt();
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 50));});
  let finish!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => {finish = resolve;});
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith("/refine") ? delayed : normal(url, init));
  await act(async () => findButton("Recover submitted edit")!.click());
  changeText("Make the scarf red"); await submit(false);
  expect(posts()).toHaveLength(2);
  const signal = posts()[1][1].signal as AbortSignal;
  try {
    const other = findButton("Recover submitted edit");
    if (other) await act(async () => other.click());
    expect(signal.aborted).toBe(false);
  } finally {
    await act(async () => {finish(Response.json(reply(child), {status: 202})); await new Promise(resolve => setTimeout(resolve, 0));});
  }
});


it("keeps standalone recovery available when the initial status response is410", async () => {
  const {prepareGenerationRequest} = await import("../PetGenerationForm/request");
  const saved = await prepareGenerationRequest(sessionStorage, {prompt: "Make the scarf red", sourceBaseId: original});
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === `/api/pet-generations/${original}`
    ? Response.json({code: "generation_expired"}, {status: 410}) : normal(url, init));
  await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={original}/></ThemeProvider>));
  await vi.waitFor(async () => {
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 0));});
    expect(findButton("Recover submitted edit")?.disabled).toBe(false);
  });
  expect(host.textContent).not.toContain("Review your character");
  expect([...host.querySelectorAll("button")].filter(b => b.textContent === "Recover submitted edit")).toHaveLength(1);
  await act(async () => findButton("Recover submitted edit")!.click());
  changeText("Make the scarf red"); await submit();
  expect(JSON.parse(String(posts()[0][1].body)).requestId).toBe(saved.requestId);
  expect(localStorage.getItem("pets-generation-history-v1:" + child)).not.toBeNull();
});

const refusalCodes = ["generation_paused", "generation_disabled", "generation_review_disabled", "saved_stage_unavailable", "client_ip_unavailable"];

it.each(refusalCodes)("unlocks text after the first acknowledged %s refusal without admission", async code => {
  const normal = fetchMock.getMockImplementation()!;
  let refused = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine") && !refused) {refused = true; return Response.json({code}, {status: 503});}
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  expect(posts()).toHaveLength(1);
  expect(host.querySelector("textarea")?.disabled).toBe(false);
  const {hasPendingRefinement} = await import("../PetGenerationForm/request");
  expect(await hasPendingRefinement(sessionStorage, original)).toBe(false);
  const first = JSON.parse(String(posts()[0][1].body));
  expect(Object.keys(first).sort()).toEqual(["prompt", "requestId"]);
  changeText("Make the scarf green"); await submit();
  const second = JSON.parse(String(posts()[1][1].body));
  expect(second.prompt).toBe("Make the scarf green"); expect(second.requestId).not.toBe(first.requestId);
  expect(localStorage.getItem("pets-generation-history-v1:" + child)).not.toBeNull();
});

it.each([...refusalCodes, "rate_limited", "base_not_ready"])("preserves an earlier uncertain request when a retry reports %s", async code => {
  const normal = fetchMock.getMockImplementation()!; let attempted = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) {
      if (!attempted) {attempted = true; throw Error("synthetic uncertain admission");}
      return Response.json({code}, {status: code === "rate_limited" ? 429 : code === "base_not_ready" ? 409 : 503});
    }
    return normal(url, init);
  });
  await render(); await edit(); await submit();
  const originalBody = String(posts()[0][1].body);
  await submit();
  expect(host.querySelector("textarea")?.disabled).toBe(true);
  const {hasPendingRefinement} = await import("../PetGenerationForm/request");
  expect(await hasPendingRefinement(sessionStorage, original)).toBe(true);
  expect(String(posts()[1][1].body)).toBe(originalBody);
});


it.each(["remount", "late-metadata"])("keeps reused identity uncertain after503 even with an empty submitted state (%s)", async mode => {
  const normal = fetchMock.getMockImplementation()!; let send = false;
  const {prepareGenerationRequest, hasPendingRefinement} = await import("../PetGenerationForm/request");
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) {
      if (!send) {send = true; throw Error("synthetic uncertain admission");}
      return Response.json({code: "generation_paused"}, {status: 503});
    }
    return normal(url, init);
  });
  let requestId: string;
  if (mode === "remount") {
    await render(); await edit(); await submit();
    requestId = JSON.parse(String(posts()[0][1].body)).requestId;
    await act(async () => root.unmount()); root = createRoot(host);
    await render(); await edit();
  } else {
    await render(); await edit();
    // The editor opened before a pending identity was visible to its parent.
    requestId = (await prepareGenerationRequest(sessionStorage, {prompt: "Make the scarf red", sourceBaseId: original})).requestId;
    send = true;
  }
  await submit();
  expect(host.querySelector("textarea")?.disabled).toBe(true);
  expect(await hasPendingRefinement(sessionStorage, original)).toBe(true);
  expect(JSON.parse(String(posts().at(-1)![1].body)).requestId).toBe(requestId);
});


it("does not navigate after the editor unmounts during receipt cleanup", async () => {
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  let held = false; const waiting: (() => void)[] = [];
  const spy = vi.spyOn(webcrypto.subtle, "digest").mockImplementation((algorithm, data) => held
    ? new Promise<ArrayBuffer>((resolve, reject) => {waiting.push(() => {void digest(algorithm, data).then(resolve, reject);});})
    : digest(algorithm, data));
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refine")) held = true;
    return normal(url, init);
  });
  try {
    await render(); await edit(); await submit(false);
    const navigations = navigate.mock.calls.length;
    await act(async () => root.unmount()); root = createRoot(host);
    held = false;
    await act(async () => {waiting.forEach(release => release()); await new Promise(resolve => setTimeout(resolve, 0));});
    expect(navigate).toHaveBeenCalledTimes(navigations);
  } finally {held = false; waiting.forEach(release => release()); spy.mockRestore();}
});

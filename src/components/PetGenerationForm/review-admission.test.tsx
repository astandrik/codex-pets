// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act} from "react";
import {createRoot} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, expect, it, vi} from "vitest";
import {PetGenerationForm} from "./PetGenerationForm";
import {createGenerationService, petGeneration} from "@/lib/pets/generation/service";
import {MemoryStore} from "@/lib/pets/generation/test-store";
import {POST} from "@/app/api/pet-generations/route";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false})) as typeof window.matchMedia;
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();});

async function renderForm(reviewBase: boolean, loseFirstResponse = false) {
  sessionStorage.clear(); localStorage.clear(); vi.stubGlobal("crypto", webcrypto);
  const store = new MemoryStore();
  const service = createGenerationService(store, {enabled: () => true, secret: () => "synthetic-form-secret-at-least-32-characters"});
  vi.spyOn(petGeneration, "generate").mockImplementation(service.generate);
  const origin = "https://pets.example";
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
  const statuses: number[] = [], contentTypes: string[] = [];
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    headers.set("origin", origin); headers.set("x-pets-client-ip", "203.0.113.5");
    let body: string;
    if (typeof init.body === "string") body = init.body;
    else {
      // Encode the browser's actual text-only FormData at the HTTP boundary.
      const form = init.body as FormData, boundary = "synthetic-form-boundary";
      const parts: string[] = [];
      for (const [key, value] of form.entries()) {
        if (typeof value !== "string") throw Error("Unexpected image in text-only fixture");
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
      }
      body = parts.join("") + `--${boundary}--\r\n`;
      headers.set("content-type", `multipart/form-data; boundary=${boundary}`);
    }
    contentTypes.push(headers.get("content-type") ?? "");
    const response = await POST(new Request(origin + url, {method: "POST", headers, body}));
    statuses.push(response.status);
    if (loseFirstResponse && statuses.length === 1) throw Error("synthetic lost admission response");
    return response;
  });
  vi.stubGlobal("fetch", request);
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  await act(async () => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase={reviewBase} /></ThemeProvider>));
  const input = element.querySelector("textarea")!;
  act(() => {Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Synthetic private fox"); input.dispatchEvent(new Event("input", {bubbles: true}));});
  const submit = () => act(async () => {
    element.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  const cleanup = async () => {await act(async () => root.unmount()); element.remove();};
  return {store, element, submit, cleanup, statuses, contentTypes, request};
}

it("rejects a stale review form without silently admitting an automatic job", async () => {
  const form = await renderForm(true);
  try {
    vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
    await form.submit();
    expect(form.request).toHaveBeenCalledOnce();
    expect(form.statuses).toEqual([503]);
    expect(form.contentTypes[0]).toContain("multipart/form-data");
    expect(form.store.jobs.size).toBe(0); expect(form.store.ledger.size).toBe(0);
    expect(form.element.textContent).toContain("Character review is not currently enabled");
  } finally {await form.cleanup();}
});

it("replays a text-only review admission after a lost response and flag rollback", async () => {
  const form = await renderForm(true, true);
  try {
    await form.submit();
    const job = [...form.store.jobs.values()][0];
    expect(job.reviewBase).toBe(true);
    const ledger = structuredClone(form.store.ledger);
    vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
    await form.submit();
    expect(form.statuses).toEqual([202, 202]);
    expect(form.contentTypes.every(type => type.startsWith("multipart/form-data"))).toBe(true);
    expect(form.store.jobs.size).toBe(1); expect(form.store.ledger).toEqual(ledger);
    expect(form.element.querySelector('a')?.getAttribute("href")).toBe("/generated/" + job.id);
    expect(JSON.stringify(localStorage)).not.toContain("Synthetic private fox");
  } finally {await form.cleanup();}
});

it("preserves JSON automatic admission for a legacy form with the flag off", async () => {
  const form = await renderForm(false);
  try {
    vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
    await form.submit();
    expect(form.statuses).toEqual([202]); expect(form.contentTypes).toEqual(["application/json"]);
    expect([...form.store.jobs.values()][0].reviewBase).toBeUndefined();
  } finally {await form.cleanup();}
});

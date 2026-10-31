// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {POST} from "@/app/api/pet-generations/route";
import {createGenerationService, petGeneration} from "@/lib/pets/generation/service";
import {MemoryStore} from "@/lib/pets/generation/test-store";
import {REQUEST_STORAGE_KEY} from "@/components/PetGenerationForm/request";
import GeneratePage from "./page";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= (() => ({matches: false, addEventListener() {}, removeEventListener() {}})) as unknown as typeof window.matchMedia;
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  vi.stubEnv("PET_GENERATION_ENABLED", "true"); vi.stubEnv("PET_GENERATION_ENABLE_FILE", "");
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "30"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost");
  vi.stubEnv("PET_GENERATION_FORM_ORIGIN", "http://localhost");
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
function render() {
  act(() => root.render(<ThemeProvider theme="dark"><GeneratePage /></ThemeProvider>));
}
function describePet(value: string) {
  const input = host.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
}
async function submit() {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    await new Promise(resolve => setTimeout(resolve, 50));
  });
}

it.each(["rerender", "reload"])("recovers a lost accepted UUID after %s with invalid queue configuration", async mode => {
  const store = new MemoryStore();
  const service = createGenerationService(store, {enabled: () => true, secret: () => "synthetic-queue-recovery-secret"});
  vi.spyOn(petGeneration, "generate").mockImplementation(service.generate);
  const uuid = vi.spyOn(webcrypto, "randomUUID");
  let loseResponse = true;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/pet-generations");
    const response = await POST(new Request("http://localhost/api/pet-generations", {
      ...init, headers: {"content-type": "application/json", origin: "http://localhost", "x-pets-client-ip": "203.0.113.10"},
    }));
    if (loseResponse) {loseResponse = false; throw Error("lost response");}
    return response;
  });
  render(); describePet("Synthetic recovery fox"); await submit();
  expect(store.jobs.size).toBe(1); expect(fetchMock).toHaveBeenCalledOnce();
  const saved = sessionStorage.getItem(REQUEST_STORAGE_KEY);
  const requestId = JSON.parse(saved!).requestId;
  const ledger = structuredClone([...store.ledger]);
  const uuidCalls = uuid.mock.calls.length;
  const generationId = [...store.jobs.keys()][0];

  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "invalid");
  if (mode === "reload") {await act(async () => root.unmount()); root = createRoot(host);}
  render();
  expect(fetchMock).toHaveBeenCalledOnce();
  describePet("Changed details must not replace recovery"); await submit();
  expect(fetchMock).toHaveBeenCalledOnce(); expect(uuid).toHaveBeenCalledTimes(uuidCalls);
  expect(sessionStorage.getItem(REQUEST_STORAGE_KEY)).toBe(saved);

  describePet("Synthetic recovery fox"); await submit();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(requestId);
  expect(uuid).toHaveBeenCalledTimes(uuidCalls);
  expect(store.jobs.size).toBe(1); expect([...store.ledger]).toEqual(ledger);
  expect(sessionStorage.getItem(REQUEST_STORAGE_KEY)).toBe(saved);
  expect(host.querySelector(`a[href="/generated/${generationId}"]`)).not.toBeNull();
});

it("does not allocate a UUID, save recovery or send a new request while the queue config is invalid", async () => {
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "invalid");
  const uuid = vi.spyOn(webcrypto, "randomUUID");
  render(); describePet("No previous request"); await submit();
  expect(uuid).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(REQUEST_STORAGE_KEY)).toBeNull();
  expect(host.querySelector("textarea")?.value).toBe("No previous request");
});

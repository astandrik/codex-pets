// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, expect, it, vi} from "vitest";
import {MyGenerations} from "@/components/MyGenerations/MyGenerations";
import {GeneratedPetPreview} from "@/components/GeneratedPetPreview/GeneratedPetPreview";
import {HISTORY_PREFIX, rememberGeneration} from "@/lib/pets/generation/history";

vi.mock("@/components/StatePreview/StatePreview", () => ({StatePreview: () => <div>Preview</div>}));
vi.mock("next/navigation", () => ({useRouter: () => ({push: vi.fn()})}));

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

it("preserves the source list when a new result window broadcasts its first status", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T06:00:00Z"));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const generationId = "a".repeat(64);
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  localStorage.clear();
  rememberGeneration(generationId, expiresAt);

  const storageEvents: string[] = [];
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    const oldValue = this.getItem(key);
    setItem.call(this, key, value);
    // Browsers deliver this event to the other window, not the writer.
    if (this === localStorage && oldValue !== value) {
      storageEvents.push(key);
      window.dispatchEvent(new StorageEvent("storage", {key, oldValue, newValue: value, storageArea: localStorage}));
    }
  });

  const generation = {
    generationId, status: "completed", expiresAt,
    progress: {completedSteps: 12, totalSteps: 12},
    pet: {displayName: "Saved fox"},
  };
  const response = (displayName = "Saved fox") => ({
    ok: true, status: 200,
    json: async () => ({generation: {...generation, pet: {displayName}}}),
  });
  let statusReads = 0;
  let finishRefresh!: (value: ReturnType<typeof response>) => void;
  const request = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") throw new Error("Unexpected write request");
    if (url.includes("slug-check")) {
      return Promise.resolve({ok: true, status: 200, json: async () => ({available: true})});
    }
    if (url !== `/api/pet-generations/${generationId}`) throw new Error(`Unexpected request: ${url}`);
    statusReads++;
    if (statusReads <= 2) return Promise.resolve(response());
    return new Promise<ReturnType<typeof response>>(resolve => {finishRefresh = resolve;});
  });
  vi.stubGlobal("fetch", request);

  const list = document.createElement("div");
  const detail = document.createElement("div");
  document.body.append(list, detail);
  const listRoot = createRoot(list);
  const detailRoot = createRoot(detail);
  try {
    await act(async () => listRoot.render(<ThemeProvider theme="light"><MyGenerations/></ThemeProvider>));
    const row = list.querySelector("li");
    const image = list.querySelector("img");
    expect(row).not.toBeNull();
    expect(image).not.toBeNull();
    expect(list.textContent).toContain("Saved fox");

    // A separate React root represents the newly opened result window.
    await act(async () => detailRoot.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={generationId}/></ThemeProvider>));
    expect(storageEvents).toEqual([HISTORY_PREFIX + "refresh"]);
    expect(statusReads).toBe(3);
    expect(list.querySelector("li")).toBe(row);
    expect(list.querySelector("img")).toBe(image);
    expect(list.textContent).toContain("Saved fox");
    expect(list.textContent).not.toContain("Checking status");

    await act(async () => finishRefresh(response("Updated fox")));
    expect(list.textContent).toContain("Updated fox");
    expect(list.textContent).not.toContain("Saved fox");
    expect(list.querySelector("li")).toBe(row);
    expect(list.querySelector("img")).toBe(image);
    expect(request.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  } finally {
    await act(async () => {listRoot.unmount(); detailRoot.unmount();});
    list.remove();
    detail.remove();
  }
});

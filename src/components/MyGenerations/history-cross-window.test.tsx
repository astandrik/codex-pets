// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, expect, it, vi} from "vitest";
import {MyGenerations} from "@/components/MyGenerations/MyGenerations";
import {GeneratedPetPreview} from "@/components/GeneratedPetPreview/GeneratedPetPreview";
import {HISTORY_PREFIX, readGenerationHistory, rememberGeneration} from "@/lib/pets/generation/history";
vi.mock("@/components/StatePreview/StatePreview", () => ({StatePreview: () => <div>Synthetic animation preview</div>}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false})) as typeof window.matchMedia;
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();});
it("refreshes visible history when another window confirms and completes a saved character", async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse("2026-10-18T06:00:00Z"));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  localStorage.clear(); const id = "a".repeat(64), expiresAt = new Date(Date.now() + 86400000).toISOString();
  rememberGeneration(id, expiresAt);
  const originalEntry = localStorage.getItem(HISTORY_PREFIX + id);
  let state = "awaiting_confirmation", storageEvents = 0;
  const setItem = Storage.prototype.setItem;
  // Model the browser's cross-window rule: only a changed stored value emits a storage event.
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
    const oldValue = this.getItem(key); setItem.call(this, key, value);
    if (this === localStorage && oldValue !== value) {storageEvents++; window.dispatchEvent(new StorageEvent("storage", {key, oldValue, newValue: value, storageArea: localStorage}));}
  });
  function generation() {return {generationId: id, status: state, expiresAt, reviewBase: true, baseConfirmed: state !== "awaiting_confirmation", progress: {completedSteps: state === "completed" ? 12 : 1, totalSteps: 12}, ...(["queued", "generating"].includes(state) ? {pollAfterSeconds: 5} : {}), ...(state === "completed" ? {pet: {displayName: "Synthetic fox"}} : {})};}
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/slug-check")) return {ok: true, status: 200, json: async () => ({available: true, suggestedSlug: JSON.parse(String(init?.body)).slug})};
    if (url.endsWith("/confirm")) {state = "queued"; return {ok: true, status: 202, json: async () => ({generation: generation()})};}
    return {ok: true, status: 200, json: async () => ({generation: generation()})};
  });
  vi.stubGlobal("fetch", request);
  const historyElement = document.createElement("div"), previewElement = document.createElement("div"); document.body.append(historyElement, previewElement);
  const historyRoot = createRoot(historyElement), previewRoot = createRoot(previewElement);
  try {
    await act(async () => historyRoot.render(<ThemeProvider theme="light"><MyGenerations /></ThemeProvider>));
    expect(historyElement.textContent).toContain("Review character");
    await act(async () => previewRoot.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={id}/></ThemeProvider>));
    expect(storageEvents).toBe(1);
    const requestsAtReview = request.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(request).toHaveBeenCalledTimes(requestsAtReview);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(storageEvents).toBe(1); // Same status must not broadcast again.
    act(() => previewElement.querySelector("img")!.dispatchEvent(new Event("load")));
    await act(async () => [...previewElement.querySelectorAll("button")].find(button => button.textContent === "Animate this character")!.click());
    state = "completed";
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(previewElement.textContent).toContain("Your pet is ready");
    expect(request.mock.calls.filter(([url]) => url.endsWith("/confirm"))).toHaveLength(1);
    expect(storageEvents).toBe(3); // First observed, queued and completed.
    expect(localStorage.getItem(HISTORY_PREFIX + id)).toBe(originalEntry);
    expect(readGenerationHistory().entries).toHaveLength(1);
    expect(localStorage.length).toBe(2); // One old-format entry plus one bounded signal key.
    expect(JSON.stringify(localStorage)).not.toMatch(/Synthetic fox|reference|prompt/);
    expect(historyElement.textContent).toContain("Ready");
  } finally {await act(async () => {historyRoot.unmount(); previewRoot.unmount();}); historyElement.remove(); previewElement.remove();}
});

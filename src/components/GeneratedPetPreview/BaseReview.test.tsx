// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {BaseReview} from "./BaseReview";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false})) as typeof window.matchMedia;
let root: Root; let element: HTMLDivElement;
const fetchMock = vi.fn(), confirmed = vi.fn();
const id = "a".repeat(64);
beforeEach(() => {vi.useFakeTimers(); element = document.createElement("div"); document.body.append(element); root = createRoot(element); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); confirmed.mockReset();});
afterEach(async () => {await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); vi.unstubAllGlobals();});
async function render() {await act(async () => root.render(<ThemeProvider theme="light"><BaseReview generationId={id} expiresAt={new Date(Date.now() + 86400000).toISOString()} disabled={false} onConfirmed={confirmed}/></ThemeProvider>));}
const animate = () => [...element.querySelectorAll("button")].find(button => button.textContent === "Animate this character")!;

it("does not authorize animations before the user can see the base or after the image fails", async () => {
  await render();
  expect(animate().disabled).toBe(true);
  act(() => element.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(animate().disabled).toBe(true);
  expect(element.textContent).toContain("Could not load");
  await act(async () => animate().click()); expect(fetchMock).not.toHaveBeenCalled();
  const retry = [...element.querySelectorAll("button")].find(button => button.textContent === "Reload character")!;
  act(() => retry.click());
  act(() => element.querySelector("img")!.dispatchEvent(new Event("load")));
  expect(animate().disabled).toBe(false);
});

it("does not treat an HTML success page or a mismatched job as a confirmation receipt", async () => {
  await render(); act(() => element.querySelector("img")!.dispatchEvent(new Event("load")));
  fetchMock.mockResolvedValueOnce({ok: true, status: 200, json: async () => {throw Error("html response");}});
  await act(async () => animate().click());
  expect(confirmed).not.toHaveBeenCalled(); expect(animate().disabled).toBe(false);
  fetchMock.mockResolvedValueOnce({ok: true, status: 202, json: async () => ({generation: {generationId: "b".repeat(64), status: "queued", baseConfirmed: true}})});
  await act(async () => animate().click()); expect(confirmed).not.toHaveBeenCalled();
});

it("starts a fresh attempt for identical input while preserving generation history", async () => {
  const {webcrypto} = await import("node:crypto"); vi.stubGlobal("crypto", webcrypto);
  const {prepareGenerationRequest} = await import("@/components/PetGenerationForm/request");
  sessionStorage.clear(); localStorage.clear(); localStorage.setItem("pets-generation-history-v1:kept", "synthetic-history");
  const before = await prepareGenerationRequest(sessionStorage, {prompt: "Same character"});
  await render();
  const link = element.querySelector<HTMLAnchorElement>('a[href="/generate"]')!;
  link.addEventListener("click", event => event.preventDefault());
  act(() => link.click());
  const after = await prepareGenerationRequest(sessionStorage, {prompt: "Same character"});
  expect(after.requestId).not.toBe(before.requestId);
  expect(localStorage.getItem("pets-generation-history-v1:kept")).toBe("synthetic-history");
});

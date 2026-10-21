// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {BaseReview} from "./BaseReview";
import {GeneratedPetPreview} from "./GeneratedPetPreview";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false})) as typeof window.matchMedia;
let root: Root, host: HTMLDivElement;
const id = "a".repeat(64), fetchMock = vi.fn(), confirmed = vi.fn();
const text = "Вправо — голова вправо. При прыжке поджимает лапы.";
const receipt = (animationPrompt?: string) => Response.json({generation: {generationId: id, status: "queued", baseConfirmed: true, ...(animationPrompt ? {animationPrompt} : {})}}, {status: 202});
beforeEach(() => {host = document.createElement("div"); document.body.append(host); root = createRoot(host); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); confirmed.mockReset(); sessionStorage.clear(); localStorage.clear();});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();});
async function render(enabled = true) {
  await act(async () => root.render(<ThemeProvider theme="light"><BaseReview generationId={id} expiresAt={new Date(Date.now() + 86400000).toISOString()} disabled={false} animationHintsEnabled={enabled} onConfirmed={confirmed} onEditingChange={() => {}}/></ThemeProvider>));
  act(() => host.querySelector("img")!.dispatchEvent(new Event("load")));
}
function input(value: string) {
  const field = host.querySelector("textarea")!;
  act(() => {Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", {bubbles: true}));});
}
async function submit() {await act(async () => [...host.querySelectorAll("button")].find(b => /Animate this character|Check animation request/.test(b.textContent ?? ""))!.click());}
it("shows a bounded optional field only when enabled and sends its normalized text", async () => {
  await render(); expect(host.textContent).toContain("Как должен двигаться персонаж?"); expect(host.querySelector("textarea")?.maxLength).toBe(2000);
  input("  " + text + "\r\n  "); fetchMock.mockResolvedValue(receipt(text)); await submit();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({animationPrompt: text});
  expect(host.querySelector("textarea")?.disabled).toBe(true); expect(confirmed).toHaveBeenCalledWith(false);
  expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
});
it.each([true, false])("preserves no-body confirmation for an empty field (enabled=%s)", async enabled => {
  await render(enabled); if (!enabled) expect(host.querySelector("textarea")).toBeNull();
  fetchMock.mockResolvedValue(receipt()); await submit(); expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
});
it("locks input while pending, then replays the same text after an uncertain result", async () => {
  await render(); input(text); let reject!: (error: Error) => void;
  fetchMock.mockImplementationOnce(() => new Promise((_resolve, fail) => {reject = fail;}));
  await submit(); expect(host.querySelector("textarea")?.disabled).toBe(true);
  await act(async () => reject(Error("lost response"))); expect(host.querySelector("textarea")?.disabled).toBe(true);
  fetchMock.mockResolvedValueOnce(receipt(text)); await submit();
  expect(String(fetchMock.mock.calls[1][1].body)).toBe(String(fetchMock.mock.calls[0][1].body)); expect(confirmed).toHaveBeenCalledWith(false);
});
it("allows editing after a definite first refusal but preserves uncertainty after a later refusal", async () => {
  await render(); input(text); fetchMock.mockResolvedValueOnce(Response.json({code: "queue_full"}, {status: 429})); await submit();
  expect(host.querySelector("textarea")?.disabled).toBe(false);
  input("Медленно оглядывается"); fetchMock.mockRejectedValueOnce(Error("lost")); await submit();
  fetchMock.mockResolvedValueOnce(Response.json({code: "queue_full"}, {status: 429})); await submit();
  expect(host.querySelector("textarea")?.disabled).toBe(true);
  expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[1][1].body);
});
it.each([undefined, "Сохранённый вариант другой вкладки"])("shows actual accepted settings from another tab (%s)", async saved => {
  await render(); input(text); fetchMock.mockResolvedValueOnce(receipt(saved)); await submit();
  expect(host.querySelector("textarea")?.value).toBe(saved ?? "");
  expect(host.textContent).toContain("другой вкладке"); expect(confirmed).toHaveBeenCalledWith(true);
});
it("treats malformed animation settings as an uncertain receipt", async () => {
  await render(); input(text); fetchMock.mockResolvedValueOnce(Response.json({generation: {generationId: id, baseConfirmed: true, status: "queued", animationPrompt: 12}})); await submit();
  expect(confirmed).not.toHaveBeenCalled(); expect(host.querySelector("textarea")?.disabled).toBe(true);
});

it("integrates accepted text and the other-tab notice into the result page after status refresh", async () => {
  let accepted = false;
  const generation = () => ({generationId: id, status: accepted ? "queued" : "awaiting_confirmation", baseConfirmed: accepted, reviewBase: true, progress: {completedSteps: 1, totalSteps: 12}, expiresAt: new Date(Date.now()+86400000).toISOString(), ...(accepted ? {animationPrompt: "Сохранённый вариант"} : {})});
  fetchMock.mockImplementation(async (_url, init) => {if (init?.method === "POST") accepted = true; return Response.json({generation: generation()});});
  await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={id} animationHintsEnabled/></ThemeProvider>));
  act(() => host.querySelector("img")!.dispatchEvent(new Event("load")));
  input(text); await submit();
  expect(host.textContent).toContain("другой вкладке");
  expect(host.querySelector('[aria-label="Принятые пожелания"]')?.textContent).toContain("Сохранённый вариант");
  expect(host.querySelector("textarea")).toBeNull();
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetPreview generationId={id} animationHintsEnabled={false}/></ThemeProvider>));
  expect(host.querySelector('[aria-label="Принятые пожелания"]')?.textContent).toContain("Сохранённый вариант");
});

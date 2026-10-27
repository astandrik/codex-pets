// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {renderToString} from "react-dom/server";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {getPetSheet, PET_STATES} from "@/lib/pets/types";
import {AnimationOverview} from "./AnimationOverview";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, reduced = false, hidden = false;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); reduced = false; hidden = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", fetchMock.mockReset());
  vi.stubGlobal("matchMedia", (query: string) => ({matches: reduced && query.includes("reduced-motion"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}}));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();});
async function render(suspended = false, version: 1 | 2 = 2) {
  await act(async () => root.render(<ThemeProvider theme="light"><AnimationOverview spritesheetUrl="/sheet.webp" sheet={getPetSheet(version)} suspended={suspended}/></ThemeProvider>));
}
const cards = () => [...host.querySelectorAll<HTMLButtonElement>(".animation-overview__card")];
const frames = () => [...host.querySelectorAll<HTMLElement>(".animation-overview__sprite")].map(node => node.style.backgroundPosition);
const control = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
async function click(node: HTMLButtonElement) {await act(async () => {node.focus(); node.click();});}
async function tick(count = 1) {await act(async () => vi.advanceTimersByTimeAsync(count * 140));}
const detail = () => document.querySelector<HTMLElement>(".animation-overview__large-sprite")!;

it.each([1, 2] as const)("plays all nine complete atlas v%s loops with one clock and no requests", async version => {
  await render(false, version);
  expect(cards()).toHaveLength(9); expect(host.textContent).not.toMatch(/\d+ frames/);
  expect(vi.getTimerCount()).toBe(1);
  for (let tickIndex = 0; tickIndex < 16; tickIndex++) {
    frames().forEach((position, index) => {
      const state = PET_STATES[index];
      expect(position).toBe(`${(tickIndex % state.frames) / 7 * 100}% ${state.row / (getPetSheet(version).rows - 1) * 100}%`);
    });
    await tick();
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps grid pause independent from detail playback and restores it on close", async () => {
  await render(); await click(control("Pause all animations")); const before = frames();
  await click(cards()[3]); expect(control("Play animation")).not.toBeNull();
  await click(control("Play animation")); const first = detail().style.backgroundPosition; await tick();
  expect(detail().style.backgroundPosition).not.toBe(first); expect(frames()).toEqual(before);
  await click(control("Pause animation")); const paused = detail().style.backgroundPosition; await tick(2);
  expect(detail().style.backgroundPosition).toBe(paused);
  await click(control("Next animation")); expect(control("Play animation")).not.toBeNull();
  expect(detail().style.backgroundPosition).toBe("0% 40%");
  await click(control("Close animation preview")); await tick(3);
  expect(frames()).toEqual(before); expect(control("Play all animations")).not.toBeNull();
  expect(document.activeElement).toBe(cards()[4]);
});
it("inherits playing, wraps all nine, handles arrows and Escape, then resumes the grid", async () => {
  await render(); const before = frames(); await click(cards()[0]);
  expect(control("Pause animation")).not.toBeNull();
  await click(control("Previous animation")); expect(document.body.textContent).toContain("9 of 9");
  for (let index = 0; index < 9; index++) {
    await click(control("Next animation"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(PET_STATES[index].label);
  }
  await act(async () => control("Next animation").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true})));
  expect(document.body.textContent).toContain("1 of 9");
  await act(async () => control("Next animation").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true})));
  expect(document.body.textContent).toContain("9 of 9");
  await act(async () => control("Next animation").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})));
  await tick(3); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(frames()).not.toEqual(before); expect(document.activeElement).toBe(cards()[8]);
});
it("suspends the visible player for other panels and hidden tabs without losing pause preference", async () => {
  await render(); await tick(); const before = frames();
  await render(true); await tick(2); expect(frames()).toEqual(before);
  await render(); await tick(); expect(frames()).not.toEqual(before);
  hidden = true; await act(async () => document.dispatchEvent(new Event("visibilitychange"))); const hiddenFrames = frames();
  await tick(2); expect(frames()).toEqual(hiddenFrames);
  hidden = false; await act(async () => document.dispatchEvent(new Event("visibilitychange"))); await tick();
  expect(frames()).not.toEqual(hiddenFrames);
  await click(control("Pause all animations")); await render(true); await render();
  expect(control("Play all animations")).not.toBeNull();
});
it("starts paused in SSR and reduced motion, allows manual play, and clears its timer", async () => {
  reduced = true;
  expect(renderToString(<AnimationOverview spritesheetUrl="/sheet.webp" sheet={getPetSheet(2)} suspended={false}/>)).toContain("Play all animations");
  await render(); expect(control("Play all animations")).not.toBeNull(); expect(vi.getTimerCount()).toBe(0);
  const interval = vi.spyOn(window, "setInterval"), clear = vi.spyOn(window, "clearInterval");
  await click(control("Play all animations")); expect(interval).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null)); expect(clear).toHaveBeenCalledWith(interval.mock.results[0].value);
});

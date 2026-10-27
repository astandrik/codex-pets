// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StatePreview } from "./StatePreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
let root: Root, element: HTMLDivElement;
const fetchMock = vi.fn();
let version = 2, imageHeight = 2288;
beforeEach(() => {
  vi.useFakeTimers(); version = 2; imageHeight = 2288;
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  fetchMock.mockReset().mockImplementation(async () => ({ ok: true, text: async () => JSON.stringify({ id: "pet", displayName: "Pet", description: "Pet", spritesheetPath: "spritesheet.webp", spriteVersionNumber: version }) }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Image", class { naturalWidth = 1536; naturalHeight = imageHeight; onload?: () => void; set src(_: string) { this.onload?.(); } });
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(hideControls = false) {
  await act(async () => root.render(<ThemeProvider theme="light"><StatePreview petJsonUrl="/pet.json" spritesheetUrl="/sprite.webp" layout="generation" hideControls={hideControls} slots={{ afterStage: <a href="/pet.zip">Download ZIP</a>, sidePanel: <div>Metadata actions</div>, afterControls: <div>Generation details</div> }} /></ThemeProvider>));
}
const button = (name: string) => [...document.body.querySelectorAll("button")].find(b => b.textContent?.includes(name))!;
it("orders one overview, downloads, gaze, actions and details", async () => {
  await render();
  const sections = [...element.querySelector(".state-preview")!.children];
  expect(sections.map(node => node.className)).toEqual(["state-preview__stage", "state-preview__downloads", "state-preview__generation-controls", "state-preview__actions", "state-preview__details"]);
  expect(element.querySelectorAll(".animation-overview__sprite")).toHaveLength(9);
  expect(element.querySelectorAll(".animation-overview__card")).toHaveLength(9);
  expect(element.querySelector("select")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("pauses all sixteen gaze directions and resumes the same 140ms clock", async () => {
  await render(); await act(async () => button("Look directions").click());
  expect(document.querySelectorAll(".state-preview__directions button")).toHaveLength(16);
  await act(async () => document.querySelector<HTMLButtonElement>('.state-preview__directions button[title*="090"]')!.click());
  const sprite = () => document.querySelector<HTMLElement>(".state-preview__gaze-sprite")!;
  const position = sprite().style.backgroundPosition;
  await act(async () => vi.advanceTimersByTimeAsync(420));
  expect(sprite().style.backgroundPosition).toBe(position);
  expect(document.body.textContent).toContain("Paused");
  await act(async () => button("Resume").click());
  await act(async () => vi.advanceTimersByTimeAsync(140));
  expect(sprite().style.backgroundPosition).not.toBe(position);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close gaze panel"]')!.click());
  await act(async () => button("Look directions").click());
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([[1, 1872], [2, 1872], [2, 1000]])("omits gaze for declared %s and image height %s", async (declared, height) => {
  version = declared; imageHeight = height; await render();
  expect(button("Look directions")).toBeUndefined();
});
it("honors hidden controls even in generation layout", async () => {
  await render(true); expect(element.querySelectorAll("button, select")).toHaveLength(0);
});

it("keeps the side panel mounted while inactive without loading or playing a preview", async () => {
  let mounts = 0;
  function Editor() { const [value] = useState(() => { mounts++; return "Recovery"; }); return <div>{value}</div>; }
  const draw = (active: boolean) => <ThemeProvider theme="light"><StatePreview petJsonUrl="/pet.json" spritesheetUrl="/sprite.webp" layout="generation" active={active} slots={{sidePanel:<Editor/>}} /></ThemeProvider>;
  await act(async () => root.render(draw(false)));
  expect(fetchMock).not.toHaveBeenCalled(); expect(element.querySelector(".state-preview__stage")).toBeNull();
  await act(async () => root.render(draw(true)));
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(mounts).toBe(1);
});

it("returns from gaze to all nine animations and opens Idle directly", async () => {
  await render(); await act(async () => button("Look directions").click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close gaze panel"]')!.click());
  expect(element.querySelectorAll(".animation-overview__card")).toHaveLength(9);
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Open Idle animation"]')!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Idle");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("retains a single controlled preview even in generation layout", async () => {
  await act(async () => root.render(<ThemeProvider theme="light"><StatePreview petJsonUrl="/pet.json" spritesheetUrl="/sprite.webp" layout="generation" selectedKey="waving" frame={2}/></ThemeProvider>));
  expect(element.querySelectorAll(".state-preview__sprite")).toHaveLength(1);
  expect(element.querySelector(".animation-overview")).toBeNull();
  expect(element.querySelector<HTMLElement>(".state-preview__sprite")!.style.backgroundPosition).toBe("28.57142857142857% 30%");
});

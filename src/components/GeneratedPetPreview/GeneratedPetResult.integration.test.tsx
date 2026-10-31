// @vitest-environment jsdom
import {act, useState} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {GeneratedPetResult} from "./GeneratedPetResult";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn(), mutation = vi.fn();
window.matchMedia ??= ((query: string) => ({matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}})) as typeof window.matchMedia;
function Editor({label}: {label: string}) {const [value, setValue] = useState("Original"); return <input aria-label={label} value={value} onChange={event => setValue(event.target.value)}/>;}
beforeEach(() => {
  vi.useFakeTimers(); mutation.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchMock.mockReset().mockResolvedValue({ok:true,text:async()=>JSON.stringify({id:"pet",displayName:"Pet",description:"Pet",spritesheetPath:"spritesheet.webp",spriteVersionNumber:2})});
  vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("Image", class {naturalWidth=1536; naturalHeight=2288; onload?:()=>void; set src(_: string) {this.onload?.();}});
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers();});
async function render(theme: "light" | "dark" = "light", ready = true) {
  await act(async () => root.render(<ThemeProvider theme={theme}><GeneratedPetResult ready={ready} petJsonUrl="/pet.json" spritesheetUrl="/sheet.webp" downloads={<a href="/pet.zip">Download ZIP</a>} metadataEditor={<Editor label="Metadata draft"/>} animationEditor={<Editor label="Animation draft"/>} publicationForm={<form onSubmit={event=>{event.preventDefault();mutation();}}><button type="submit">Submit for review</button></form>} generationDetails={<p>Saved instructions</p>} metadataBlocked={false} metadataConflict={false} submitted={false}/></ThemeProvider>));
}
const button = (text: string) => [...document.querySelectorAll("button")].find(node=>node.textContent?.includes(text))!;
async function click(node: HTMLButtonElement) {await act(async () => node.click());}
const positions = () => [...host.querySelectorAll<HTMLElement>(".animation-overview__sprite")].map(node=>node.style.backgroundPosition);
it("integrates nine previews, gaze and persistent drafts without passive mutations or asset refetches", async () => {
  await render(); expect(positions()).toHaveLength(9);
  await click(button("Name, description & tags")); const input = document.querySelector<HTMLInputElement>('[aria-label="Metadata draft"]')!;
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Unsaved draft"); input.dispatchEvent(new Event("input",{bubbles:true}));});
  const paused = positions(); await act(async () => vi.advanceTimersByTimeAsync(420)); expect(positions()).toEqual(paused);
  await click(document.querySelector<HTMLButtonElement>('[aria-label="Close metadata panel"]')!);
  await render("dark"); await act(async () => window.dispatchEvent(new Event("resize")));
  await click(button("Name, description & tags")); expect(document.querySelector('[aria-label="Metadata draft"]')).toBe(input); expect(input.value).toBe("Unsaved draft");
  await click(document.querySelector<HTMLButtonElement>('[aria-label="Close metadata panel"]')!);
  await click(button("Look directions")); expect(document.querySelectorAll(".state-preview__direction")).toHaveLength(16);
  const gaze = document.querySelector<HTMLElement>(".state-preview__gaze-sprite")!;
  await click(document.querySelector<HTMLButtonElement>('.state-preview__direction[title*="090"]')!); const direction=gaze.style.backgroundPosition;
  await act(async () => vi.advanceTimersByTimeAsync(420)); expect(gaze.style.backgroundPosition).toBe(direction);
  await click(button("Resume")); await act(async () => vi.advanceTimersByTimeAsync(350)); expect(gaze.style.backgroundPosition).not.toBe(direction);
  await click(document.querySelector<HTMLButtonElement>('[aria-label="Close gaze panel"]')!);
  await click(button("Prepare gallery submission")); await click(document.querySelector<HTMLButtonElement>('[aria-label="Close publication panel"]')!);
  await click(button("Generation details")); expect(document.body.textContent).toContain("Saved instructions");
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(mutation).not.toHaveBeenCalled();
});
it("keeps animation recovery mounted while the result is inactive and does not load the atlas", async () => {
  await render("light", false); const editor=host.querySelector('[aria-label="Animation draft"]');
  expect(editor).not.toBeNull(); expect(positions()).toHaveLength(0); expect(fetchMock).not.toHaveBeenCalled();
  await render(); expect(host.querySelector('[aria-label="Animation draft"]')).toBe(editor); expect(positions()).toHaveLength(9);
});

// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GeneratedPetResult } from "./GeneratedPetResult";
vi.mock("@/components/StatePreview/StatePreview", () => ({ StatePreview: ({ slots }: { slots: { afterStage: ReactNode; sidePanel: ReactNode; afterControls: ReactNode } }) => <div>{slots.afterStage}{slots.sidePanel}{slots.afterControls}</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
let root: Root, element: HTMLDivElement;
const mounted = vi.fn(), mutation = vi.fn();
function Editor() {
  const [value, setValue] = useState("Original");
  useEffect(() => { mounted(); }, []);
  return <input aria-label="Draft name" value={value} onChange={event => setValue(event.target.value)} />;
}
beforeEach(() => { mounted.mockReset(); mutation.mockReset(); element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
const button = (text: string) => [...document.querySelectorAll("button")].find(node => node.textContent?.includes(text))!;
async function render() { await act(async () => root.render(<ThemeProvider theme="light"><GeneratedPetResult petJsonUrl="/pet.json" spritesheetUrl="/sheet.webp" downloads={<a href="/pet.zip">Download ZIP</a>} metadataEditor={<Editor />} animationEditor={<div>Edit animations</div>} publicationForm={<form onSubmit={event => { event.preventDefault(); mutation(); }}><button type="submit">Submit for review</button></form>} generationDetails={<p>Saved instructions</p>} metadataBlocked={false} metadataConflict={false} submitted={false} /></ThemeProvider>)); }
it("retains the same draft across closing, reopening and rerendering panels", async () => {
  await render(); await act(async () => button("Name, description & tags").click());
  const input = document.querySelector<HTMLInputElement>('[aria-label="Draft name"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Draft"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close metadata panel"]')!.click());
  await render(); await act(async () => button("Name, description & tags").click());
  expect(document.querySelector('[aria-label="Draft name"]')).toBe(input); expect(input.value).toBe("Draft"); expect(mounted).toHaveBeenCalledTimes(1);
});
it("opens publication and details without submitting work", async () => {
  await render(); await act(async () => button("Prepare gallery submission").click());
  expect(document.querySelector('[role="dialog"][aria-label="Gallery submission"]')).not.toBeNull();
  expect(mutation).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close publication panel"]')!.click());
  await act(async () => button("Generation details").click());
  expect(document.querySelector('[role="dialog"][aria-label="Generation details"]')?.textContent).toContain("Saved instructions");
  expect(mutation).not.toHaveBeenCalled();
});

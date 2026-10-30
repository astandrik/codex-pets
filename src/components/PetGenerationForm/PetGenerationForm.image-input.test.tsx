// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {PetGenerationForm} from "./PetGenerationForm";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((media: string) => ({media, matches:false, addEventListener(){}, removeEventListener(){}})) as typeof window.matchMedia;
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  sessionStorage.clear(); localStorage.clear(); fetchMock.mockReset();
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(URL, "createObjectURL").mockImplementation(blob => "blob:" + (blob as File).name);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render(enabled = true, reviewBase = true) {
  await act(async () => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled={enabled} reviewBase={reviewBase}/></ThemeProvider>));
}
function file(name = "clipboard.png", bytes = "same image bytes", type = "image/png") {
  const value = new File([bytes], name, {type});
  Object.defineProperty(value, "arrayBuffer", {value: async () => new TextEncoder().encode(bytes).buffer});
  return value;
}
async function transfer(type: "paste" | "drop" | "dragenter" | "dragleave" | "dragover", files: File[], target: Element = host.querySelector("textarea")!, itemsOnly = false, textOnly = false) {
  const event = new Event(type, {bubbles:true,cancelable:true});
  const data = {files: itemsOnly ? [] : files, items: files.map(value => ({kind:"file",getAsFile:()=>value})), types: textOnly ? ["text/plain"] : files.length ? ["Files"] : [], dropEffect:"none"};
  Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", {value:data});
  await act(async () => target.dispatchEvent(event));
  return event;
}
async function input(selector: string, text: string) {
  const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => {Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,"value")!.set!.call(node,text);node.dispatchEvent(new Event("input",{bubbles:true}));});
}
async function choose(value: File) {
  const node=host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(node,"files",{configurable:true,value:[value]});
  await act(async () => node.dispatchEvent(new Event("change",{bubbles:true})));
}
async function submit(expectedCalls: number) {
  await act(async () => {host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(expectedCalls));});
}

it.each(["paste", "drop"] as const)("accepts %s on the description while preserving the draft and avoiding requests", async type => {
  await render(); await input("textarea", "Keep the red scarf");
  await act(async () => [...host.querySelectorAll("button")].find(b=>b.textContent?.includes("Add a name"))!.click());
  await input("#pet-generation-name", "Draft name");
  const uuid=vi.spyOn(crypto,"randomUUID"), storage=vi.spyOn(Storage.prototype,"setItem");
  const event=await transfer(type,[file()]);
  expect(event.defaultPrevented).toBe(true);
  expect(host.querySelector('img[alt="Selected character reference"]')?.getAttribute("src")).toBe("blob:clipboard.png");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Keep the red scarf");
  expect(host.querySelector<HTMLInputElement>("#pet-generation-name")!.value).toBe("Draft name");
  expect(fetchMock).not.toHaveBeenCalled();expect(uuid).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();
});
it("accepts clipboard file items even when the files collection is empty", async () => {
  await render();const zone=host.querySelector(".pet-generation-form__reference")!;
  expect(zone.getAttribute("tabindex")).toBe("0");
  await transfer("paste",[file()],zone,true);
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:clipboard.png");
});
it.each(["paste","drop"] as const)("leaves text-only %s to the browser and keeps the current image", async type => {
  await render();await choose(file("original.png"));
  const event=await transfer(type,[],undefined,false,true);
  expect(event.defaultPrevented).toBe(false);
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:original.png");expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["paste","drop"] as const)("rejects invalid %s replacements and revokes the old preview", async type => {
  await render();await choose(file("original.png"));
  await transfer(type,[file("invalid.svg","<svg/>","image/svg+xml")]);
  expect(host.querySelector("img")).toBeNull();expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:original.png");expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["paste","drop"] as const)("keeps one-file and size validation for %s", async type => {
  await render();
  for (const files of [[file("a.png"),file("b.png")],[new File([new Uint8Array(5*1024*1024+1)],"big.png",{type:"image/png"})],[new File([],"empty.png",{type:"image/png"})]]) {
    await transfer(type,files);expect(host.querySelector("img")).toBeNull();expect(host.querySelector('[role="alert"]')).not.toBeNull();
  }
  expect(fetchMock).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});
it("ignores file input methods when generation or the review flow is disabled", async () => {
  await render(false);await transfer("paste",[file()]);await transfer("drop",[file()]);expect(host.querySelector("img")).toBeNull();
  await render(true,false);await transfer("paste",[file()]);await transfer("drop",[file()]);expect(host.querySelector("img")).toBeNull();expect(fetchMock).not.toHaveBeenCalled();
});
it("cannot change the reference during an in-flight submission or after acceptance", async () => {
  let finish!: (value: unknown) => void;fetchMock.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await render();await transfer("paste",[file("original.png")]);await submit(1);
  await transfer("paste",[file("ignored.png")]);await transfer("drop",[file("ignored.png")]);
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:original.png");expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => finish({ok:true,json:async()=>({generation:{generationId:"a".repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}})}));
  await transfer("paste",[file()],host.querySelector("form")!);await transfer("drop",[file()],host.querySelector("form")!);
  expect(host.textContent).toContain("Task accepted");expect(host.querySelector("img")).toBeNull();expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("reuses recovery identity for the same bytes across paste and drop", async () => {
  await render();fetchMock.mockRejectedValue(new Error("lost response"));
  await transfer("paste",[file("pasted.png")]);await submit(1);
  const first=(fetchMock.mock.calls[0][1].body as FormData).get("requestId");
  await transfer("drop",[file("dropped.png")]);expect(fetchMock).toHaveBeenCalledTimes(1);
  await submit(2);expect((fetchMock.mock.calls[1][1].body as FormData).get("requestId")).toBe(first);
  expect((fetchMock.mock.calls[1][1].body as FormData).get("referenceImage")).toBeInstanceOf(File);
});
it("clears the native picker after paste so the same saved file can be chosen again", async () => {
  await render();const node=host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(node,"value",{configurable:true,writable:true,value:"old-picker-file.png"});
  await transfer("paste",[file()]);expect(node.value).toBe("");
  await choose(file("saved.png"));expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:saved.png");
});
it("highlights only file drags and clears the highlight after nested leave or drop", async () => {
  await render();const form=host.querySelector("form")!, target=host.querySelector("textarea")!, files=[file()];
  await transfer("dragenter",files,form);await transfer("dragenter",files,target);
  expect(form.classList.contains("pet-generation-form--dragging")).toBe(true);
  await transfer("dragleave",files,target);expect(form.classList.contains("pet-generation-form--dragging")).toBe(true);
  await transfer("dragleave",files,form);expect(form.classList.contains("pet-generation-form--dragging")).toBe(false);
  const text=await transfer("dragover",[],form,false,true);expect(text.defaultPrevented).toBe(false);
  await transfer("dragenter",files,form);await transfer("drop",files,target);expect(form.classList.contains("pet-generation-form--dragging")).toBe(false);
});

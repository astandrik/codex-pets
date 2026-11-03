// @vitest-environment jsdom
import {webcrypto} from "node:crypto";
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {PetGenerationForm} from "./PetGenerationForm";
import {mockImageDecoding} from "./image-test-utils";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= ((media: string) => ({media, matches: false, addEventListener() {}, removeEventListener() {}})) as typeof window.matchMedia;
let root: Root, host: HTMLDivElement, decode: ReturnType<typeof mockImageDecoding>;
const request = vi.fn();
beforeEach(async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  localStorage.clear(); sessionStorage.clear(); request.mockReset();
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", request);
  let url = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:gallery-${++url}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  decode = mockImageDecoding();
  await act(async () => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase/></ThemeProvider>));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); decode.restore();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function galleryFile(name: string, bytes = new Uint8Array([1, 2, 3])) {
  const file = new File([bytes], name, {type: "image/png"});
  const stream = vi.fn(() => new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(bytes); controller.close();}}));
  Object.defineProperty(file, "stream", {value: stream});
  return {file, stream};
}
async function choose(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {configurable: true, value: [file]});
  await act(async () => input.dispatchEvent(new Event("change", {bubbles: true})));
  return input;
}
async function ready() { await act(async () => vi.waitFor(() => expect(host.querySelector('img[alt="Selected character reference"]')).not.toBeNull())); }
async function setPrompt(value: string) {
  const field = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", {bubbles: true}));
  });
}

it("starts reading before clearing the picker or inspecting source size, and blocks submit until ready", async () => {
  const item = galleryFile("pending.png");
  let finish!: ReadableStreamDefaultController<Uint8Array>;
  item.stream.mockImplementation(() => new ReadableStream({start(controller) {finish = controller;}}));
  const size = vi.fn(() => 3); Object.defineProperty(item.file, "size", {get: size});
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "value", {configurable: true, writable: true, value: "selected.png"});
  await setPrompt("Keep this draft");
  await choose(item.file);
  expect(item.stream).toHaveBeenCalledOnce(); expect(size).not.toHaveBeenCalled();
  expect(input.value).toBe("selected.png");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
  expect(request).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  await act(async () => {finish.enqueue(new Uint8Array([1, 2, 3])); finish.close();});
  await ready(); expect(input.value).toBe(""); expect(host.querySelector("textarea")!.value).toBe("Keep this draft");
});

it("reports unreadable image data and preserves the draft without submitting", async () => {
  decode.control.result = false; await setPrompt("Keep the scarf");
  await choose(galleryFile("broken.png").file);
  await act(async () => vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull()));
  expect(host.textContent).toContain("Could not read"); expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("textarea")!.value).toBe("Keep the scarf");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(request).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:gallery-1");
});

it("handles a later visible-preview error instead of leaving a broken image ready to submit", async () => {
  await choose(galleryFile("readable.png").file); await ready();
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});

it("cancels an older read and prevents it from replacing a newer image", async () => {
  const first = galleryFile("old.png"); const cancel = vi.fn();
  first.stream.mockImplementation(() => new ReadableStream({start() {}, cancel}));
  await choose(first.file); await choose(galleryFile("new.png").file); await ready();
  expect(cancel).toHaveBeenCalledOnce(); expect(host.textContent).toContain("new.png"); expect(host.textContent).not.toContain("old.png");
  expect(request).not.toHaveBeenCalled();
});

it("retries one transient local read without creating a generation request", async () => {
  const item = galleryFile("retry.png");
  item.stream.mockImplementationOnce(() => new ReadableStream({start(controller) {controller.error(new DOMException("Temporary", "NotReadableError"));}}));
  await choose(item.file); await ready();
  expect(item.stream).toHaveBeenCalledTimes(2); expect(request).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
});

it("releases an unmounted pending decoder and never publishes its result", async () => {
  decode.control.result = null; await choose(galleryFile("waiting.png").file);
  expect(decode.images).toHaveLength(1);
  await act(async () => root.unmount()); root = createRoot(host);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:gallery-1");
  expect(request).not.toHaveBeenCalled();
});

it("releases a prepared URL if unmounted before the ready state commits", async () => {
  decode.control.result = null;
  await choose(galleryFile("ready-to-publish.png").file);
  expect(decode.images).toHaveLength(1);
  await act(async () => {
    decode.images[0].onload?.(new Event("load"));
    for (let index = 0; index < 5; index++) await Promise.resolve();
    root.unmount();
  });
  root = createRoot(host);
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:gallery-1");
  expect(request).not.toHaveBeenCalled();
});

it("releases each accepted URL once on replace, remove and unmount", async () => {
  await choose(galleryFile("first.png").file); await ready();
  await choose(galleryFile("second.png").file); await ready();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Remove image")!.click());
  await choose(galleryFile("third.png").file); await ready();
  await act(async () => root.unmount()); root = createRoot(host);
  expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual(["blob:gallery-1", "blob:gallery-2", "blob:gallery-3"]);
});

it("lets the user cancel a pending read while retaining text", async () => {
  const item = galleryFile("cancel.png"), cancel = vi.fn();
  item.stream.mockImplementation(() => new ReadableStream({cancel}));
  await setPrompt("Keep this description"); await choose(item.file);
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Cancel image")!.click());
  expect(cancel).toHaveBeenCalledOnce(); expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  expect(host.querySelector("textarea")!.value).toBe("Keep this description");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it("cancels pending image work if generation becomes disabled", async () => {
  const item = galleryFile("disabled.png"), cancel = vi.fn();
  item.stream.mockImplementation(() => new ReadableStream({cancel}));
  await choose(item.file);
  await act(async () => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled={false} reviewBase/></ThemeProvider>));
  expect(cancel).toHaveBeenCalledOnce(); expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it("preserves byte identity and UUID after reading the same image again", async () => {
  request.mockRejectedValue(new Error("Lost response"));
  await choose(galleryFile("first.png").file); await ready();
  const submit = async (count: number) => act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(count));
  });
  await submit(1); const first = request.mock.calls[0][1].body as FormData;
  await choose(galleryFile("same-bytes.png").file); await ready(); await submit(2);
  const second = request.mock.calls[1][1].body as FormData;
  expect(second.get("requestId")).toBe(first.get("requestId"));
  expect(Array.from(new Uint8Array(await (second.get("referenceImage") as File).arrayBuffer()))).toEqual([1, 2, 3]);
});

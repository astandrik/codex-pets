// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {prepareReferenceImage} from "./prepare-reference-image";
import {mockImageDecoding} from "./image-test-utils";

let decode: ReturnType<typeof mockImageDecoding>;
beforeEach(() => {
  decode = mockImageDecoding();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:prepared");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {decode.restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();});

function streamed(chunks: Uint8Array[], cancel = vi.fn()) {
  const file = new File(["provider-backed"], "gallery.png", {type: "image/png"});
  let index = 0;
  const stream = vi.fn(() => new ReadableStream<Uint8Array>({
    pull(controller) {if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close();}, cancel,
  }));
  Object.defineProperty(file, "stream", {value: stream});
  return {file, stream, cancel};
}

it("copies identical bytes before previewing without inspecting the provider file size", async () => {
  const item = streamed([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
  const size = vi.fn(() => {throw new Error("provider metadata read");});
  Object.defineProperty(item.file, "size", {get: size});
  const result = await prepareReferenceImage(item.file, new AbortController().signal);
  expect(size).not.toHaveBeenCalled(); expect(result.file).not.toBe(item.file);
  expect(result.file.name).toBe("gallery.png"); expect(result.file.type).toBe("image/png");
  expect(Array.from(new Uint8Array(await result.file.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  expect(result.url).toBe("blob:prepared"); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it("accepts exactly 5 MiB", async () => {
  const item = streamed([new Uint8Array(5 * 1024 * 1024)]);
  const result = await prepareReferenceImage(item.file, new AbortController().signal);
  expect(result.file.size).toBe(5 * 1024 * 1024);
});

it("cancels an oversized stream before creating a preview", async () => {
  const item = streamed([new Uint8Array(5 * 1024 * 1024), new Uint8Array(1), new Uint8Array(1)]);
  await expect(prepareReferenceImage(item.file, new AbortController().signal)).rejects.toMatchObject({code: "too_large"});
  expect(item.cancel).toHaveBeenCalledOnce(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("rejects an empty stream", async () => {
  await expect(prepareReferenceImage(streamed([]).file, new AbortController().signal)).rejects.toMatchObject({code: "invalid"});
});

it("rejects an unsupported type without starting a read", async () => {
  const stream = vi.fn(); const file = new File(["data"], "photo.heic", {type: "image/heic"});
  Object.defineProperty(file, "stream", {value: stream});
  await expect(prepareReferenceImage(file, new AbortController().signal)).rejects.toMatchObject({code: "invalid"});
  expect(stream).not.toHaveBeenCalled();
});

it("bounds a persistent NotReadableError to two local reads", async () => {
  const item = streamed([]);
  item.stream.mockImplementation(() => new ReadableStream({start(controller) {controller.error(new DOMException("Unavailable", "NotReadableError"));}}));
  await expect(prepareReferenceImage(item.file, new AbortController().signal)).rejects.toMatchObject({code: "unreadable"});
  expect(item.stream).toHaveBeenCalledTimes(2); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("cancels a pending read without retrying it", async () => {
  const item = streamed([]); item.stream.mockImplementation(() => new ReadableStream({cancel: item.cancel}));
  const controller = new AbortController();
  const pending = prepareReferenceImage(item.file, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({name: "AbortError"});
  expect(item.stream).toHaveBeenCalledOnce(); expect(item.cancel).toHaveBeenCalledOnce();
});

it("times out a stalled read and cancels its reader", async () => {
  vi.useFakeTimers();
  const item = streamed([]); item.stream.mockImplementation(() => new ReadableStream({cancel: item.cancel}));
  const rejection = expect(prepareReferenceImage(item.file, new AbortController().signal)).rejects.toMatchObject({code: "unreadable"});
  await vi.advanceTimersByTimeAsync(15000); await rejection;
  expect(item.cancel).toHaveBeenCalledOnce(); expect(item.stream).toHaveBeenCalledOnce();
});

it("releases the object URL if decoding fails", async () => {
  decode.control.result = false;
  await expect(prepareReferenceImage(streamed([new Uint8Array([1])]).file, new AbortController().signal)).rejects.toMatchObject({code: "unreadable"});
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});

it("times out and releases a stalled image decoder", async () => {
  vi.useFakeTimers(); decode.control.result = null;
  const rejection = expect(prepareReferenceImage(streamed([new Uint8Array([1])]).file, new AbortController().signal)).rejects.toMatchObject({code: "unreadable"});
  await vi.advanceTimersByTimeAsync(15000); await rejection;
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:prepared");
});

it("supports FileReader when Blob streams are unavailable", async () => {
  const source = new File([new Uint8Array([9, 8, 7])], "fallback.webp", {type: "image/webp"});
  const result = await prepareReferenceImage(source, new AbortController().signal);
  expect(Array.from(new Uint8Array(await result.file.arrayBuffer()))).toEqual([9, 8, 7]);
});

it("keeps the size limit in the FileReader fallback", async () => {
  const source = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {type: "image/png"});
  const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
  await expect(prepareReferenceImage(source, new AbortController().signal)).rejects.toMatchObject({code: "too_large"});
  expect(read).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

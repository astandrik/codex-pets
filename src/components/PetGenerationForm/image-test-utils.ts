import {Buffer} from "node:buffer";
import {vi} from "vitest";
import {act} from "react";

export async function settleImagePreparation(host: Element) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    if (host.querySelector('[aria-busy="true"]')) throw new Error("Image preparation is still pending");
  });
}

export function mockImageDecoding() {
  const original = Object.getOwnPropertyDescriptor(File.prototype, "arrayBuffer");
  if (!original) Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value(this: File) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          // Node 20 WebCrypto rejects ArrayBuffers from jsdom's realm.
          const bytes = Buffer.from(new Uint8Array(reader.result as ArrayBuffer));
          resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
  const control = {result: true as boolean | null};
  class DecodedImage {
    naturalWidth = 32;
    naturalHeight = 32;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    private source = "";
    set src(value: string) {
      this.source = value;
      if (!value) return;
      queueMicrotask(() => {
        if (this.source !== value || control.result === null) return;
        if (control.result) this.onload?.(new Event("load"));
        else this.onerror?.(new Event("error"));
      });
    }
  }
  const images: DecodedImage[] = [];
  vi.stubGlobal("Image", class extends DecodedImage {
    constructor() { super(); images.push(this); }
  });
  return {control, images, restore() {
    if (!original) Reflect.deleteProperty(File.prototype, "arrayBuffer");
  }};
}

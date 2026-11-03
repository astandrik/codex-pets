// @vitest-environment jsdom
import {Buffer} from "node:buffer";
import {createHash, webcrypto} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {mockImageDecoding} from "./image-test-utils";

afterEach(() => vi.unstubAllGlobals());

it.each([
  {name: "empty", bytes: []},
  {name: "binary", bytes: [0, 1, 127, 128, 254, 255]},
])("reads exact $name file bytes usable by Node WebCrypto", async ({bytes}) => {
  const decoding = mockImageDecoding();
  try {
    const file = new File([new Uint8Array(bytes)], "reference.png", {type: "image/png"});
    const result = await file.arrayBuffer();
    expect(result.byteLength).toBe(bytes.length);
    expect(Array.from(new Uint8Array(result))).toEqual(bytes);
    const digest = await webcrypto.subtle.digest("SHA-256", result);
    expect(Buffer.from(digest).toString("hex")).toBe(createHash("sha256").update(Buffer.from(bytes)).digest("hex"));
  } finally {
    decoding.restore();
  }
});

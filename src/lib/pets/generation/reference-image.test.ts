import sharp from "sharp";
import {describe, expect, it} from "vitest";
import {normalizeGenerationReference} from "./reference-image";
import {readBrowserGenerationInput} from "./browser-input";
import {randomUUID} from "node:crypto";

async function png(width = 80, height = 40) {return sharp({create: {width, height, channels: 4, background: {r: 20, g: 60, b: 90, alpha: .5}}}).png().toBuffer();}
function request(form: FormData) {return new Request("https://pets.example/api/pet-generations", {method: "POST", body: form});}
function form(bytes: Buffer, type = "image/png") {
  const value = new FormData(); value.set("requestId", randomUUID()); value.set("referenceImage", new Blob([new Uint8Array(bytes)], {type}), "private-name.png"); return value;
}

describe("generation reference input", () => {
  it("fully decodes, rotates, strips metadata and preserves aspect ratio and transparency", async () => {
    const original = await sharp(await png(1600, 800)).withMetadata({orientation: 6}).png().toBuffer();
    const normalized = await normalizeGenerationReference(original, "image/png");
    const metadata = await sharp(normalized.bytes).metadata();
    expect(metadata).toMatchObject({width: 512, height: 1024, format: "png", hasAlpha: true});
    expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined(); expect(metadata.icc).toBeUndefined();
    expect(normalized.metadata.sourceSha256).not.toBe(normalized.metadata.sha256);
    const small = await normalizeGenerationReference(await png(), "image/png");
    expect(small.metadata).toMatchObject({width: 80, height: 40, normalizationVersion: 1});
  });
  it("accepts JPEG and static WebP, rejecting mismatched MIME and truncated pixels", async () => {
    for (const format of ["jpeg", "webp"] as const) {
      const bytes = await sharp(await png()).toFormat(format).toBuffer();
      expect((await normalizeGenerationReference(bytes, "image/" + format)).metadata.width).toBe(80);
      await expect(normalizeGenerationReference(bytes, "image/png")).rejects.toMatchObject({code: "invalid_reference_image"});
      await expect(normalizeGenerationReference(bytes.subarray(0, bytes.length / 2), "image/" + format)).rejects.toMatchObject({code: "invalid_reference_image"});
    }
  });
  it("rejects empty, non-image, animated PNG, oversized bytes and pixel bombs", async () => {
    const original = await png();
    const actl = Buffer.alloc(20); actl.writeUInt32BE(8); actl.write("acTL", 4); actl.writeUInt32BE(2, 8);
    const animated = Buffer.concat([original.subarray(0, 33), actl, original.subarray(33)]);
    for (const bytes of [Buffer.alloc(0), Buffer.from("not an image"), animated]) {
      await expect(normalizeGenerationReference(bytes, "image/png")).rejects.toMatchObject({code: "invalid_reference_image"});
    }
    await expect(normalizeGenerationReference(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png")).rejects.toMatchObject({code: "reference_image_too_large"});
    await expect(normalizeGenerationReference(await png(5001, 5000), "image/png")).rejects.toMatchObject({code: "invalid_reference_image"});
    const frames = Buffer.alloc(16 * 32 * 4, 255); frames.fill(0, 16 * 16 * 4);
    const animation = await sharp(frames, {raw: {width: 16, height: 32, channels: 4, pageHeight: 16}}).webp({loop: 0, delay: [100, 100]}).toBuffer();
    expect((await sharp(animation).metadata()).pages).toBe(2);
    await expect(normalizeGenerationReference(animation, "image/webp")).rejects.toMatchObject({code: "invalid_reference_image"});
    await expect(normalizeGenerationReference(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml")).rejects.toMatchObject({code: "invalid_reference_image"});
  });
  it("accepts image-only and image with changes, but rejects duplicates and unexpected fields", async () => {
    const bytes = await png(); const imageOnly = await readBrowserGenerationInput(request(form(bytes)));
    expect(imageOnly.input).toMatchObject({prompt: ""}); expect(imageOnly.reference?.bytes.length).toBeGreaterThan(0);
    const changes = form(bytes); changes.set("prompt", "Red sweater");
    expect((await readBrowserGenerationInput(request(changes))).input).toMatchObject({prompt: "Red sweater"});
    for (const [key, value] of [["prompt", "second"], ["referenceImage", new Blob([bytes], {type: "image/png"})], ["reviewBase", "false"]] as const) {
      const invalid = form(bytes); invalid.set("prompt", "first"); invalid.append(key, value);
      await expect(readBrowserGenerationInput(request(invalid))).rejects.toMatchObject({code: "invalid_argument"});
    }
    await expect(readBrowserGenerationInput(request(form(Buffer.alloc(0))))).rejects.toMatchObject({code: "invalid_reference_image"});
  });
  it("bounds streamed multipart before parsing, without trusting Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream({pull(controller) {controller.enqueue(new Uint8Array(1024 * 1024));}, cancel() {cancelled = true;}});
    const oversized = new Request("https://pets.example", {method: "POST", headers: {"content-type": "multipart/form-data; boundary=test", "content-length": "1"}, body, duplex: "half"} as RequestInit);
    await expect(readBrowserGenerationInput(oversized)).rejects.toMatchObject({code: "body_too_large"});
    expect(cancelled).toBe(true);
  });
});

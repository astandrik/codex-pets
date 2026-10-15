import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { validateUploadedPackage } from "@/lib/pets/package";
import { getPetSheet, type SpriteVersionNumber } from "@/lib/pets/types";

describe("uploaded pet packages", () => {
  it.each([1, 2] as const)("accepts a matching v%s package", async (version) => {
    const input = await createPackage(version);
    const result = await validateUploadedPackage(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.petJson.spriteVersionNumber).toBe(version);
  });

  it.each(["pet.json", "spritesheet.webp"])("rejects mismatched ZIP member %s", async (filename) => {
    const input = await createPackage(2);
    const zip = await JSZip.loadAsync(input.zipBuffer);
    zip.file(filename, "different bytes");
    const result = await validateUploadedPackage({
      ...input, zipBuffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    });
    expect(result).toMatchObject({ ok: false, error: "invalid_zip_contents" });
  });

  it("rejects a compressed entry that appends bytes to the uploaded sprite", async () => {
    const input = await createPackage(2);
    const zip = await JSZip.loadAsync(input.zipBuffer);
    zip.file("spritesheet.webp", Buffer.concat([input.spritesheetBuffer, Buffer.alloc(2 * 1024 * 1024)]));
    const result = await validateUploadedPackage({
      ...input, zipBuffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    });
    expect(result).toMatchObject({ ok: false, error: "invalid_zip_contents" });
  });

  it("rejects missing root entries and unreadable ZIPs", async () => {
    const input = await createPackage(2);
    const zip = await JSZip.loadAsync(input.zipBuffer);
    zip.remove("pet.json");
    await expect(validateUploadedPackage({ ...input, zipBuffer: await zip.generateAsync({ type: "nodebuffer" }) }))
      .resolves.toMatchObject({ ok: false, error: "invalid_zip_contents" });
    await expect(validateUploadedPackage({ ...input, zipBuffer: Buffer.from("not a ZIP") }))
      .resolves.toMatchObject({ ok: false, error: "invalid_zip" });
  });
});

async function createPackage(version: SpriteVersionNumber) {
  const sheet = getPetSheet(version);
  const petJsonBuffer = Buffer.from(JSON.stringify({
    id: "rose-katana", displayName: "Rose Katana", description: "A Codex pet.",
    spriteVersionNumber: version, spritesheetPath: "spritesheet.webp",
  }));
  const spritesheetBuffer = await sharp({
    create: { width: sheet.width, height: sheet.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).webp({ lossless: true }).toBuffer();
  const zip = new JSZip();
  zip.file("pet.json", petJsonBuffer);
  zip.file("spritesheet.webp", spritesheetBuffer);
  return { petJsonBuffer, spritesheetBuffer, zipBuffer: await zip.generateAsync({ type: "nodebuffer" }), spritesheetExt: "webp" as const };
}

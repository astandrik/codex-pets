import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { validateUploadedPackage } from "@/lib/pets/package";

describe("uploaded pet packages", () => {
  it("accepts a complete v2 package", async () => {
    const petJsonBuffer = Buffer.from(
      JSON.stringify({
        id: "rose-katana",
        displayName: "Rose Katana",
        description: "A Codex v2 pet.",
        spriteVersionNumber: 2,
        spritesheetPath: "spritesheet.webp",
      }),
    );
    const spritesheetBuffer = await sharp({
      create: {
        width: 1536,
        height: 2288,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .webp({ lossless: true })
      .toBuffer();
    const zip = new JSZip();
    zip.file("pet.json", petJsonBuffer);
    zip.file("spritesheet.webp", spritesheetBuffer);

    const result = await validateUploadedPackage({
      petJsonBuffer,
      spritesheetBuffer,
      zipBuffer: await zip.generateAsync({ type: "nodebuffer" }),
      spritesheetExt: "webp",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.petJson.spriteVersionNumber).toBe(2);
    }
  });
});

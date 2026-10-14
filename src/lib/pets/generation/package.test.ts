import { describe, expect, it } from "vitest";
import sharp from "sharp";
import JSZip from "jszip";
import { buildGeneratedPackage, validateGeneratedSheet, buildGenerationPrompt } from "@/lib/pets/generation/package";
import { PET_STATES, PET_LOOK_DIRECTIONS } from "@/lib/pets/types";
import type { GenerationJob } from "@/lib/pets/generation/model";

async function sheet(options: { missing?: boolean; clipped?: boolean; opaque?: boolean } = {}) {
  const width = 1536; const height = 2288;
  const bytes = Buffer.alloc(width * height * 4, options.opaque ? 255 : 0);
  const cells = [...PET_STATES.flatMap((s) => Array.from({ length: s.frames }, (_, col) => ({ row: s.row, col }))), ...PET_LOOK_DIRECTIONS.map((c) => ({ row: c.row, col: c.column }))];
  for (const [index, cell] of cells.entries()) {
    if (index === 0 && options.missing) continue;
    for (let y = 40; y < 160; y += 1) for (let x = options.clipped && index === 0 ? 0 : 50; x < 140; x += 1) {
      const offset = ((cell.row * 208 + y) * width + cell.col * 192 + x) * 4;
      bytes[offset] = 100; bytes[offset + 1] = 160; bytes[offset + 2] = 240; bytes[offset + 3] = 255;
    }
  }
  return sharp(bytes, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("generated pet atlas and ZIP", () => {
  it("includes every required animation and gaze cell and validates the downloadable package", async () => {
    const source = await sheet();
    const validation = await validateGeneratedSheet(source);
    expect(validation.requiredFrames).toBe(PET_STATES.reduce((n, s) => n + s.frames, 16));
    const job: GenerationJob = { id: "a".repeat(64), prompt: "A blue robot", displayName: "Robot", status: "processing", createdAt: 1_700_000_000_000, expiresAt: 1_700_086_400_000, worker: "test", promptRevision: "test", pipelineVersion: 1, stages: [] };
    const result = await buildGeneratedPackage(job, source);
    const zip = await JSZip.loadAsync(result["pet.zip"]);
    expect(Object.keys(zip.files).sort()).toEqual(["pet.json", "spritesheet.webp"]);
    expect(JSON.parse(await zip.file("pet.json")!.async("string"))).toMatchObject({ displayName: "Robot", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" });
    expect(await zip.file("spritesheet.webp")!.async("nodebuffer")).toEqual(result["spritesheet.webp"]);
    expect(buildGenerationPrompt(job)).toContain("1536x2288");
  });
  it.each(["", "   "])("packages a saved atlas after its prompt has been cleared (%j)", async (prompt) => {
    const job: GenerationJob = { id: "a".repeat(64), prompt, displayName: "Lumi", status: "processing", createdAt: 1_700_000_000_000, expiresAt: 1_700_086_400_000, worker: "test", promptRevision: "test", pipelineVersion: 2, stages: [] };
    const files = await buildGeneratedPackage(job, await sheet());
    const metadata = JSON.parse(files["pet.json"].toString());
    expect(metadata.description).toBe("Animated pet created from a saved character reference.");
    const zip = await JSZip.loadAsync(files["pet.zip"]);
    expect(await zip.file("pet.json")!.async("nodebuffer")).toEqual(files["pet.json"]);
    expect(await zip.file("spritesheet.webp")!.async("nodebuffer")).toEqual(files["spritesheet.webp"]);
  });
  it("rejects corrupt bytes and incorrect grid size", async () => {
    await expect(validateGeneratedSheet(Buffer.from("invalid"))).rejects.toMatchObject({ code: "invalid_generated_image" });
    const small = await sharp({ create: { width: 20, height: 20, channels: 4, background: "transparent" } }).png().toBuffer();
    await expect(validateGeneratedSheet(small)).rejects.toMatchObject({ code: "invalid_grid_dimensions" });
  });
  it("rejects missing frames, opaque backgrounds and clipped characters", async () => {
    await expect(validateGeneratedSheet(await sheet({ missing: true }))).rejects.toMatchObject({ code: "missing_animation_frame" });
    await expect(validateGeneratedSheet(await sheet({ opaque: true }))).rejects.toMatchObject({ code: "clipped_animation_frame" });
    await expect(validateGeneratedSheet(await sheet({ clipped: true }))).rejects.toMatchObject({ code: "clipped_animation_frame" });
  });
});

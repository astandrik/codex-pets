import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  assembleAtlas,
  chooseChromaColor,
  hatchV2Pet,
  processGrid,
  STANDARD_ROW_SPECS,
  V2_ATLAS,
} from "./pet-generation-pipeline.mjs";

async function sourceGrid(width: number, height: number, columns: number, rows: number): Promise<Buffer> {
  const panelWidth = width / columns;
  const panelHeight = height / rows;
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
  }).composite(Array.from({ length: columns * rows }, (_, index) => ({
    input: {
      create: {
        width: Math.floor(panelWidth * 0.4),
        height: Math.floor(panelHeight * 0.6),
        channels: 4 as const,
        background: { r: 220, g: 30, b: 30, alpha: 1 },
      },
    },
    left: Math.floor(index % columns * panelWidth + panelWidth * 0.3),
    top: Math.floor(Math.floor(index / columns) * panelHeight + panelHeight * 0.25),
  }))).png().toBuffer();
}

describe("deterministic v2 pet pipeline", () => {
  it("chooses the most distant chroma and extracts exactly eight bounded frames", async () => {
    const base = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: "magenta" },
    }).png().toBuffer();
    expect(await chooseChromaColor(base)).toEqual([0, 255, 0]);

    const processed = await processGrid({
      buffer: await sourceGrid(1536, 1024, 4, 2),
      columns: 4,
      rows: 2,
      chroma: [0, 255, 0],
      rowIndex: 0,
    });
    expect(processed.frames).toHaveLength(8);
    expect(processed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(processed.frames.every((frame) => frame.length === 192 * 208 * 4)).toBe(true);
  });

  it("assembles the exact 8x11 v2 WebP atlas", async () => {
    const frame = Buffer.alloc(192 * 208 * 4);
    const atlas = await assembleAtlas(Array.from({ length: 11 }, () => Array(8).fill(frame)));
    const metadata = await sharp(atlas).metadata();
    expect(metadata).toMatchObject({ width: V2_ATLAS.width, height: V2_ATLAS.height, format: "webp" });
  });

  it("builds every source row, both look rows, previews, and one independent review", async () => {
    const base = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: "magenta" },
    }).png().toBuffer();
    const generated = new Map<string, Buffer>();
    for (const spec of STANDARD_ROW_SPECS) generated.set(spec.key, await sourceGrid(1536, 1024, 4, 2));
    generated.set("cardinal", await sourceGrid(1024, 1024, 2, 2));
    generated.set("look-row-9", await sourceGrid(1536, 1024, 4, 2));
    generated.set("look-row-10", await sourceGrid(1536, 1024, 4, 2));
    const stages: string[] = [];
    const invokeImage = vi.fn(async (stage: string) => {
      stages.push(stage);
      return { image: generated.get(stage)!, requestId: `req_${stage}`, usage: {} };
    });
    const invokeReview = vi.fn(async () => ({ review: { pass: true, issues: [] }, requestId: "req_review", usage: {} }));
    const provider = { moderate: vi.fn(async () => ({ flagged: false })) };

    const result = await hatchV2Pet({ prompt: "red test pet", baseImage: base, provider, invokeImage, invokeReview });

    expect(stages).toEqual([
      ...STANDARD_ROW_SPECS.map((spec) => spec.key), "cardinal", "look-row-9", "look-row-10",
    ]);
    expect(stages.filter((stage) => stage === "running-left")).toHaveLength(1);
    expect(invokeImage).toHaveBeenCalledTimes(12);
    expect(invokeReview).toHaveBeenCalledTimes(1);
    expect(result.qa).toMatchObject({ pass: true, despillPasses: 1 });
    expect(result.qa.lookDirections).toHaveLength(16);
    expect(result.artifacts.map((artifact) => artifact.key)).toEqual(expect.arrayContaining([
      "source-idle", "source-running-left", "source-cardinal", "source-look-row-9", "source-look-row-10",
      "spritesheet", "contact-sheet", "direction-sheet", "qa", "animation-idle", "animation-review",
    ]));
    expect(await sharp(result.artifacts.find((artifact) => artifact.key === "spritesheet")!.buffer).metadata())
      .toMatchObject({ width: 1536, height: 2288, format: "webp" });
  }, 30_000);
});

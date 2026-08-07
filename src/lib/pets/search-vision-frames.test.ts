import { createHash } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  PET_VISION_FRAME_POLICY,
  PET_VISION_FRAME_POLICY_V2,
  PET_VISION_FRAME_POLICY_V3,
  extractPetVisionFrames,
  type PetVisionFramePolicy,
} from "@/lib/pets/search-vision-frames";
import { PET_SHEETS, type SpriteVersionNumber } from "@/lib/pets/types";

const COLORS = [
  { r: 255, g: 0, b: 0, alpha: 255 },
  { r: 0, g: 255, b: 0, alpha: 255 },
  { r: 0, g: 0, b: 255, alpha: 255 },
  { r: 255, g: 255, b: 0, alpha: 255 },
  { r: 255, g: 0, b: 255, alpha: 255 },
  { r: 0, g: 255, b: 255, alpha: 255 },
  { r: 128, g: 64, b: 32, alpha: 255 },
  { r: 64, g: 128, b: 255, alpha: 255 },
  { r: 240, g: 240, b: 240, alpha: 255 },
] as const;

describe("pet vision frame extraction", () => {
  it.each([1, 2] as const)(
    "extracts the four fixed lossless PNG cells from sprite version %s",
    async (version) => {
      const atlas = await createAtlas(version);
      const extracted = await extractPetVisionFrames(atlas);

      expect(extracted.spriteVersion).toBe(version);
      expect(extracted.spritesheetSha256).toBe(
        createHash("sha256").update(atlas).digest("hex"),
      );
      expect(extracted.frames.map(({ state, row, frame }) => ({
        state,
        row,
        frame,
      }))).toEqual([
        { state: "idle", row: 0, frame: 3 },
        { state: "running-right", row: 1, frame: 4 },
        { state: "waving", row: 3, frame: 2 },
        { state: "review", row: 8, frame: 3 },
      ]);

      for (const [index, frame] of extracted.frames.entries()) {
        const metadata = await sharp(frame.png).metadata();
        expect(metadata).toMatchObject({
          width: 192,
          height: 208,
          format: "png",
        });
        const pixel = await sharp(frame.png)
          .ensureAlpha()
          .extract({ left: 0, top: 0, width: 1, height: 1 })
          .raw()
          .toBuffer();
        expect([...pixel]).toEqual(Object.values(COLORS[index] ?? COLORS[0]));
        expect(frame.dataUrl).toBe(
          `data:image/png;base64,${frame.png.toString("base64")}`,
        );
      }
    },
  );

  it.each([1, 2] as const)(
    "extracts the same nine semantic rows from sprite version %s",
    async (version) => {
      const atlas = await createAtlas(version, PET_VISION_FRAME_POLICY_V2);
      const extracted = await extractPetVisionFrames(
        atlas,
        PET_VISION_FRAME_POLICY_V2,
      );

      expect(extracted.frames.map(({ state, row, frame }) => ({
        state,
        row,
        frame,
      }))).toEqual([
        { state: "idle", row: 0, frame: 3 },
        { state: "running-right", row: 1, frame: 4 },
        { state: "running-left", row: 2, frame: 4 },
        { state: "waving", row: 3, frame: 2 },
        { state: "jumping", row: 4, frame: 2 },
        { state: "failed", row: 5, frame: 4 },
        { state: "waiting", row: 6, frame: 3 },
        { state: "running", row: 7, frame: 3 },
        { state: "review", row: 8, frame: 3 },
      ]);
      expect(extracted.frames).toHaveLength(9);
    },
  );

  it.each([1, 2] as const)(
    "extracts the V3 four-frame experiment from sprite version %s",
    async (version) => {
      const atlas = await createAtlas(version, PET_VISION_FRAME_POLICY_V3);
      const extracted = await extractPetVisionFrames(
        atlas,
        PET_VISION_FRAME_POLICY_V3,
      );

      expect(extracted.frames.map(({ state, row, frame }) => ({
        state,
        row,
        frame,
      }))).toEqual([
        { state: "idle", row: 0, frame: 3 },
        { state: "running-right", row: 1, frame: 4 },
        { state: "waving", row: 3, frame: 2 },
        { state: "review", row: 8, frame: 3 },
      ]);
    },
  );

  it("rejects invalid atlas dimensions before extracting frames", async () => {
    const invalid = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    await expect(extractPetVisionFrames(invalid)).rejects.toThrow(
      /sprite atlas dimensions/i,
    );
  });

  it("rejects non-PNG/WebP bytes before Sharp decodes the atlas", async () => {
    const sheet = PET_SHEETS[2];
    const gif = await sharp({
      create: {
        width: sheet.width,
        height: sheet.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .gif()
      .toBuffer();

    await expect(extractPetVisionFrames(gif)).rejects.toThrow(
      /sprite image format/i,
    );
  });

  it("freezes the frame policy identifier and central-frame table", () => {
    expect(PET_VISION_FRAME_POLICY).toEqual({
      id: "pet-vision-central-frames-v1",
      frames: [
        { state: "idle", row: 0, frameCount: 6, frame: 3 },
        { state: "running-right", row: 1, frameCount: 8, frame: 4 },
        { state: "waving", row: 3, frameCount: 4, frame: 2 },
        { state: "review", row: 8, frameCount: 6, frame: 3 },
      ],
    });
    expect(PET_VISION_FRAME_POLICY_V2.id).toBe(
      "pet-vision-nine-central-frames-v2",
    );
    expect(PET_VISION_FRAME_POLICY_V3).toEqual({
      id: "pet-vision-four-central-frames-v3",
      frames: PET_VISION_FRAME_POLICY.frames,
    });
  });
});

async function createAtlas(
  version: SpriteVersionNumber,
  framePolicy: PetVisionFramePolicy = PET_VISION_FRAME_POLICY,
): Promise<Buffer> {
  const sheet = PET_SHEETS[version];
  const cells = await Promise.all(
    framePolicy.frames.map((frame, index) =>
      sharp({
        create: {
          width: sheet.cellWidth,
          height: sheet.cellHeight,
          channels: 4,
          background: COLORS[index] ?? COLORS[0],
        },
      })
        .png()
        .toBuffer()
        .then((input) => ({
          input,
          left: frame.frame * sheet.cellWidth,
          top: frame.row * sheet.cellHeight,
        })),
    ),
  );

  return sharp({
    create: {
      width: sheet.width,
      height: sheet.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(cells)
    .png()
    .toBuffer();
}

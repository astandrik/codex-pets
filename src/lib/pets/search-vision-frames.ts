import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  PET_SHEETS,
  inferSpriteVersionNumber,
  type SpriteVersionNumber,
} from "@/lib/pets/types";

export const PET_VISION_FRAME_POLICY = {
  id: "pet-vision-central-frames-v1",
  frames: [
    { state: "idle", row: 0, frameCount: 6, frame: 3 },
    { state: "running-right", row: 1, frameCount: 8, frame: 4 },
    { state: "waving", row: 3, frameCount: 4, frame: 2 },
    { state: "review", row: 8, frameCount: 6, frame: 3 },
  ],
} as const;

export type PetVisionFrame = {
  state: (typeof PET_VISION_FRAME_POLICY.frames)[number]["state"];
  row: number;
  frame: number;
  png: Buffer;
  dataUrl: string;
};

export type ExtractedPetVisionFrames = {
  spriteVersion: SpriteVersionNumber;
  spritesheetSha256: string;
  frames: PetVisionFrame[];
};

export async function extractPetVisionFrames(
  spritesheet: Buffer,
): Promise<ExtractedPetVisionFrames> {
  const metadata = await sharp(spritesheet).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const spriteVersion = inferSpriteVersionNumber(width, height);
  if (!spriteVersion) {
    throw new Error(
      `Unsupported sprite atlas dimensions: ${width}x${height}.`,
    );
  }

  const sheet = PET_SHEETS[spriteVersion];
  const frames = await Promise.all(
    PET_VISION_FRAME_POLICY.frames.map(async (selected) => {
      const png = await sharp(spritesheet)
        .extract({
          left: selected.frame * sheet.cellWidth,
          top: selected.row * sheet.cellHeight,
          width: sheet.cellWidth,
          height: sheet.cellHeight,
        })
        .png()
        .toBuffer();
      return {
        state: selected.state,
        row: selected.row,
        frame: selected.frame,
        png,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      };
    }),
  );

  return {
    spriteVersion,
    spritesheetSha256: createHash("sha256")
      .update(spritesheet)
      .digest("hex"),
    frames,
  };
}

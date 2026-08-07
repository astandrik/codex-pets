import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  PET_SHEETS,
  inferSpriteVersionNumber,
  type SpriteVersionNumber,
} from "@/lib/pets/types";
import {
  PET_VISION_FRAME_POLICY_V1,
  PET_VISION_FRAME_POLICY_V2 as PIPELINE_FRAME_POLICY_V2,
  PET_VISION_FRAME_POLICY_V3 as PIPELINE_FRAME_POLICY_V3,
  type PetVisionFrameSelection,
} from "@/lib/pets/search-vision-pipelines.mjs";

export const PET_VISION_FRAME_POLICY = PET_VISION_FRAME_POLICY_V1;
export const PET_VISION_FRAME_POLICY_V2 = PIPELINE_FRAME_POLICY_V2;
export const PET_VISION_FRAME_POLICY_V3 = PIPELINE_FRAME_POLICY_V3;

export type PetVisionFramePolicy = {
  id: string;
  frames: readonly PetVisionFrameSelection[];
};

export type PetVisionFrame = {
  state: string;
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
  framePolicy: PetVisionFramePolicy = PET_VISION_FRAME_POLICY,
): Promise<ExtractedPetVisionFrames> {
  if (!hasSupportedSpriteSignature(spritesheet)) {
    throw new Error("Unsupported sprite image format; expected PNG or WebP.");
  }

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
    framePolicy.frames.map(async (selected) => {
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

function hasSupportedSpriteSignature(buffer: Buffer): boolean {
  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";

  return isPng || isWebp;
}

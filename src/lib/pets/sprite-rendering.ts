import sharp from "sharp";

import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import { PET_SHEET, PET_STATES, type PublicPet } from "@/lib/pets/types";

export type PetAnimationState = (typeof PET_STATES)[number];

export const DEFAULT_ANIMATION_STATE = PET_STATES[0];
export const DEFAULT_SPRITE_SCALE = 2;
export const MAX_SPRITE_SCALE = 4;
export const SPRITE_FRAME_DELAY_MS = 140;

export function readPetAnimationState(value: string | null): PetAnimationState {
  return PET_STATES.find((state) => state.key === value) ?? DEFAULT_ANIMATION_STATE;
}

export function readSpriteScale(value: string | null): number {
  const parsed = typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SPRITE_SCALE;
  }

  return Math.min(MAX_SPRITE_SCALE, Math.max(1, Math.floor(parsed)));
}

export async function renderAnimatedSpriteGif(input: {
  pet: PublicPet;
  state: PetAnimationState;
  scale: number;
}): Promise<Buffer> {
  const assetId = assetIdFromSpritesheetUrl(input.pet.spritesheetUrl);
  if (!assetId) {
    throw new Error("Unsupported spritesheet URL.");
  }

  const asset = await readPetSpritesheetAsset({ assetId });
  const frames = await Promise.all(
    Array.from({ length: input.state.frames }, (_, frame) =>
      renderSpriteFrame({
        spritesheet: asset.buffer,
        state: input.state,
        frame,
        scale: input.scale,
      }),
    ),
  );

  return sharp(frames, { join: { animated: true } })
    .gif({
      delay: Array.from(
        { length: input.state.frames },
        () => SPRITE_FRAME_DELAY_MS,
      ),
      dither: 0,
      effort: 6,
      keepDuplicateFrames: true,
      loop: 0,
    })
    .toBuffer();
}

export function spriteDimensions(scale: number): {
  width: number;
  height: number;
} {
  return {
    width: PET_SHEET.cellWidth * scale,
    height: PET_SHEET.cellHeight * scale,
  };
}

export function spriteCssValues(input: {
  state: PetAnimationState;
  scale: number;
}): {
  backgroundSize: string;
  endX: string;
  rowY: string;
  width: string;
  height: string;
  frames: number;
  duration: string;
} {
  return {
    backgroundSize: `${PET_SHEET.width * input.scale}px ${PET_SHEET.height * input.scale}px`,
    endX: `-${input.state.frames * PET_SHEET.cellWidth * input.scale}px`,
    rowY: `-${input.state.row * PET_SHEET.cellHeight * input.scale}px`,
    width: `${PET_SHEET.cellWidth * input.scale}px`,
    height: `${PET_SHEET.cellHeight * input.scale}px`,
    frames: input.state.frames,
    duration: `${input.state.frames * SPRITE_FRAME_DELAY_MS}ms`,
  };
}

function renderSpriteFrame(input: {
  spritesheet: Buffer;
  state: PetAnimationState;
  frame: number;
  scale: number;
}): Promise<Buffer> {
  return sharp(input.spritesheet)
    .extract({
      left: input.frame * PET_SHEET.cellWidth,
      top: input.state.row * PET_SHEET.cellHeight,
      width: PET_SHEET.cellWidth,
      height: PET_SHEET.cellHeight,
    })
    .resize({
      width: PET_SHEET.cellWidth * input.scale,
      height: PET_SHEET.cellHeight * input.scale,
      fit: "contain",
      kernel: "nearest",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

function assetIdFromSpritesheetUrl(value: string): string | null {
  const pathname = getPathname(value);
  const match = pathname.match(
    /\/api\/assets\/([^/]+)\/spritesheet\.(?:webp|png)$/,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function getPathname(value: string): string {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return value;
  }

  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

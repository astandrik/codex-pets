import sharp from "sharp";

import { PET_SHEET, type PetKind } from "@/lib/pets/types";

export type PetJson = {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; message: string; field?: string };

const KINDS = new Set<PetKind>(["creature", "object", "character"]);

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function normalizeKind(value: unknown): PetKind {
  return typeof value === "string" && KINDS.has(value as PetKind)
    ? (value as PetKind)
    : "creature";
}

export function validatePetJson(value: unknown): ValidationResult<PetJson> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error: "invalid_pet_json",
      message: "pet.json must be a JSON object.",
    };
  }

  const record = value as Record<string, unknown>;
  const id = readRequiredString(record.id, "id");
  if (!id.ok) return id;

  const displayName = readRequiredString(record.displayName, "displayName");
  if (!displayName.ok) return displayName;

  const description = readRequiredString(record.description, "description");
  if (!description.ok) return description;

  const spritesheetPath = readRequiredString(
    record.spritesheetPath,
    "spritesheetPath",
  );
  if (!spritesheetPath.ok) return spritesheetPath;

  if (!/^spritesheet\.(webp|png)$/.test(spritesheetPath.value)) {
    return {
      ok: false,
      error: "invalid_spritesheet_path",
      field: "spritesheetPath",
      message: "spritesheetPath must be spritesheet.webp or spritesheet.png.",
    };
  }

  return {
    ok: true,
    value: {
      id: id.value,
      displayName: displayName.value.slice(0, 80),
      description: description.value.slice(0, 320),
      spritesheetPath: spritesheetPath.value,
    },
  };
}

export function validateSpriteDimensions(
  width: number,
  height: number,
): ValidationResult<{ width: number; height: number }> {
  if (width !== PET_SHEET.width || height !== PET_SHEET.height) {
    return {
      ok: false,
      error: "invalid_spritesheet_dimensions",
      message: `Spritesheet must be ${PET_SHEET.width}x${PET_SHEET.height}; got ${width}x${height}.`,
    };
  }

  return { ok: true, value: { width, height } };
}

export async function validateSpriteBuffer(
  buffer: Buffer,
): Promise<ValidationResult<{ width: number; height: number }>> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return {
      ok: false,
      error: "invalid_spritesheet_image",
      message: "Spritesheet must be a readable WebP or PNG image.",
    };
  }

  if (!metadata.width || !metadata.height) {
    return {
      ok: false,
      error: "invalid_spritesheet_image",
      message: "Spritesheet dimensions could not be read.",
    };
  }

  return validateSpriteDimensions(metadata.width, metadata.height);
}

export function validateSpriteExtension(
  value: unknown,
): ValidationResult<"webp" | "png"> {
  if (value === "webp" || value === "png") {
    return { ok: true, value };
  }
  return {
    ok: false,
    error: "invalid_spritesheet_ext",
    field: "spritesheetExt",
    message: "spritesheetExt must be webp or png.",
  };
}

export function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

function readRequiredString(
  value: unknown,
  field: keyof PetJson,
): ValidationResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      error: "missing_field",
      field,
      message: `${field} is required.`,
    };
  }
  return { ok: true, value: value.trim() };
}

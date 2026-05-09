import JSZip from "jszip";

import {
  validatePetJson,
  validateSpriteBuffer,
  type PetJson,
  type ValidationResult,
} from "@/lib/pets/validation";

export type ValidatedPackage = {
  petJson: PetJson;
  spritesheetBytes: number;
  zipBytes: number;
};

export async function validateUploadedPackage(input: {
  petJsonBuffer: Buffer;
  spritesheetBuffer: Buffer;
  zipBuffer: Buffer;
  spritesheetExt: "webp" | "png";
}): Promise<ValidationResult<ValidatedPackage>> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.petJsonBuffer.toString("utf8"));
  } catch {
    return {
      ok: false,
      error: "invalid_pet_json",
      message: "pet.json must be valid JSON.",
    };
  }

  const petJson = validatePetJson(parsedJson);
  if (!petJson.ok) return petJson;

  const expectedSpriteName = `spritesheet.${input.spritesheetExt}`;
  if (petJson.value.spritesheetPath !== expectedSpriteName) {
    return {
      ok: false,
      error: "spritesheet_path_mismatch",
      field: "spritesheetPath",
      message: `spritesheetPath must match uploaded ${expectedSpriteName}.`,
    };
  }

  const sprite = await validateSpriteBuffer(input.spritesheetBuffer);
  if (!sprite.ok) return sprite;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input.zipBuffer);
  } catch {
    return {
      ok: false,
      error: "invalid_zip",
      message: "ZIP package could not be read.",
    };
  }

  if (!zip.file("pet.json") || !zip.file(expectedSpriteName)) {
    return {
      ok: false,
      error: "invalid_zip_contents",
      message: `ZIP must contain pet.json and ${expectedSpriteName} at the root.`,
    };
  }

  return {
    ok: true,
    value: {
      petJson: petJson.value,
      spritesheetBytes: input.spritesheetBuffer.byteLength,
      zipBytes: input.zipBuffer.byteLength,
    },
  };
}

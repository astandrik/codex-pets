import { Readable } from "node:stream";
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

  const sprite = await validateSpriteBuffer(
    input.spritesheetBuffer,
    petJson.value.spriteVersionNumber,
  );
  if (!sprite.ok) return sprite;

  try {
    const zip = await JSZip.loadAsync(input.zipBuffer);
    const petJsonEntry = zip.file("pet.json");
    const spriteEntry = zip.file(expectedSpriteName);
    if (!petJsonEntry || !spriteEntry) {
      return {
        ok: false,
        error: "invalid_zip_contents",
        message: `ZIP must contain pet.json and ${expectedSpriteName} at the root.`,
      };
    }
    if (
      !(await zipEntryMatches(petJsonEntry, input.petJsonBuffer)) ||
      !(await zipEntryMatches(spriteEntry, input.spritesheetBuffer))
    ) {
      return {
        ok: false,
        error: "invalid_zip_contents",
        message: "ZIP contents must match the uploaded pet.json and spritesheet.",
      };
    }
  } catch {
    return {
      ok: false,
      error: "invalid_zip",
      message: "ZIP package could not be read.",
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

async function zipEntryMatches(entry: JSZip.JSZipObject, expected: Buffer): Promise<boolean> {
  let offset = 0;
  // Stop at the uploaded size or first mismatch instead of buffering an untrusted expanded entry.
  for await (const chunk of new Readable().wrap(entry.nodeStream())) {
    if (
      !Buffer.isBuffer(chunk) ||
      offset + chunk.length > expected.length ||
      !chunk.equals(expected.subarray(offset, offset + chunk.length))
    ) {
      return false;
    }
    offset += chunk.length;
  }
  return offset === expected.length;
}

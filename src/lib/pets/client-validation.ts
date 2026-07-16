import type { SpriteVersionNumber } from "@/lib/pets/types";

export type ClientPetJson = {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber?: SpriteVersionNumber;
  spritesheetPath: string;
};

export function parseClientPetJson(text: string): ClientPetJson {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pet.json must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  for (const key of ["id", "displayName", "description", "spritesheetPath"]) {
    if (typeof record[key] !== "string" || !record[key]) {
      throw new Error(`pet.json is missing ${key}.`);
    }
  }
  if (
    record.spriteVersionNumber !== undefined &&
    record.spriteVersionNumber !== 1 &&
    record.spriteVersionNumber !== 2
  ) {
    throw new Error("spriteVersionNumber must be 1 or 2.");
  }
  return record as ClientPetJson;
}

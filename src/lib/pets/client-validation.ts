import type { SpriteVersionNumber } from "@/lib/pets/types";

export type ClientPetJson = {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber?: SpriteVersionNumber;
  spritesheetPath: string;
};

export function parseClientPetJson(text: string): ClientPetJson {
  const value = JSON.parse(text) as Record<string, unknown>;
  for (const key of ["id", "displayName", "description", "spritesheetPath"]) {
    if (typeof value[key] !== "string" || !value[key]) {
      throw new Error(`pet.json is missing ${key}.`);
    }
  }
  if (
    value.spriteVersionNumber !== undefined &&
    value.spriteVersionNumber !== 1 &&
    value.spriteVersionNumber !== 2
  ) {
    throw new Error("spriteVersionNumber must be 1 or 2.");
  }
  return value as ClientPetJson;
}

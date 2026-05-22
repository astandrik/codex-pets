export type SubmitPetJson = {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
};

export type SubmitSpriteExt = "webp" | "png";

export type EditablePetJsonResult =
  | {
      ok: true;
      value: {
        petJson: SubmitPetJson;
        spritesheetExt: SubmitSpriteExt;
      };
    }
  | {
      ok: false;
      message: string;
    };

const REQUIRED_FIELDS: Array<keyof SubmitPetJson> = [
  "id",
  "displayName",
  "description",
  "spritesheetPath",
];

export function readOriginalPetJsonId(text: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function parseEditablePetJson(input: {
  text: string;
  originalId: string | null;
}): EditablePetJsonResult {
  let value: unknown;
  try {
    value = JSON.parse(input.text);
  } catch {
    return { ok: false, message: "pet.json must be valid JSON." };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "pet.json must be a JSON object." };
  }

  const record = value as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      return { ok: false, message: `pet.json is missing ${field}.` };
    }
  }

  const petJson = {
    id: String(record.id).trim(),
    displayName: String(record.displayName).trim(),
    description: String(record.description).trim(),
    spritesheetPath: String(record.spritesheetPath).trim(),
  };

  if (input.originalId && petJson.id !== input.originalId) {
    return {
      ok: false,
      message: "pet.json id cannot be changed after upload.",
    };
  }

  const spritesheetExt = spriteExtFromPath(petJson.spritesheetPath);
  if (!spritesheetExt.ok) {
    return spritesheetExt;
  }

  return {
    ok: true,
    value: {
      petJson,
      spritesheetExt: spritesheetExt.value,
    },
  };
}

export function spriteExtFromPath(
  path: string,
): { ok: true; value: SubmitSpriteExt } | { ok: false; message: string } {
  if (path === "spritesheet.webp") return { ok: true, value: "webp" };
  if (path === "spritesheet.png") return { ok: true, value: "png" };
  return {
    ok: false,
    message: "spritesheetPath must be spritesheet.webp or spritesheet.png.",
  };
}

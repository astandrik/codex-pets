import { describe, expect, it } from "vitest";

import { parseClientPetJson } from "@/lib/pets/client-validation";

describe("client pet validation", () => {
  it.each(["null", "42", JSON.stringify("value"), "[]"])(
    "rejects non-object pet JSON: %s",
    (text) => {
      expect(() => parseClientPetJson(text)).toThrow(
        "pet.json must be a JSON object.",
      );
    },
  );

  it.each(["id", "displayName", "description", "spritesheetPath"] as const)(
    "rejects a whitespace-only %s",
    (field) => {
      const petJson = {
        id: "rose-katana",
        displayName: "Rose Katana",
        description: "A Codex v2 pet.",
        spriteVersionNumber: 2,
        spritesheetPath: "spritesheet.webp",
      };
      petJson[field] = " \t ";

      expect(() => parseClientPetJson(JSON.stringify(petJson))).toThrow(
        `pet.json is missing ${field}.`,
      );
    },
  );

  it("preserves spriteVersionNumber 2", () => {
    expect(
      parseClientPetJson(
        JSON.stringify({
          id: "rose-katana",
          displayName: "Rose Katana",
          description: "A Codex v2 pet.",
          spriteVersionNumber: 2,
          spritesheetPath: "spritesheet.webp",
        }),
      ),
    ).toMatchObject({ spriteVersionNumber: 2 });
  });

  it("rejects unsupported sprite versions", () => {
    expect(() =>
      parseClientPetJson(
        JSON.stringify({
          id: "future-pet",
          displayName: "Future Pet",
          description: "An unsupported pet.",
          spriteVersionNumber: 3,
          spritesheetPath: "spritesheet.webp",
        }),
      ),
    ).toThrow("spriteVersionNumber must be 1 or 2.");
  });
});

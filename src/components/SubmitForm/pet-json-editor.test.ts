import { describe, expect, it } from "vitest";

import { parseEditablePetJson, readOriginalPetJsonId } from "./pet-json-editor";

describe("pet-json editor helpers", () => {
  it("accepts display name and description edits when the id is unchanged", () => {
    const result = parseEditablePetJson({
      originalId: "demo",
      text: JSON.stringify({
        id: "demo",
        displayName: "Better Demo",
        description: "Updated description.",
        spritesheetPath: "spritesheet.webp",
      }),
    });

    expect(result).toEqual({
      ok: true,
      value: {
        petJson: {
          id: "demo",
          displayName: "Better Demo",
          description: "Updated description.",
          spritesheetPath: "spritesheet.webp",
        },
        spritesheetExt: "webp",
      },
    });
  });

  it("rejects changing a valid original id", () => {
    const result = parseEditablePetJson({
      originalId: "demo",
      text: JSON.stringify({
        id: "other-demo",
        displayName: "Demo",
        description: "Demo pet.",
        spritesheetPath: "spritesheet.webp",
      }),
    });

    expect(result).toEqual({
      ok: false,
      message: "pet.json id cannot be changed after upload.",
    });
  });

  it("accepts adding an id when the original pet.json had no valid id", () => {
    const result = parseEditablePetJson({
      originalId: null,
      text: JSON.stringify({
        id: "new-demo",
        displayName: "Demo",
        description: "Demo pet.",
        spritesheetPath: "spritesheet.webp",
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.petJson.id).toBe("new-demo");
  });

  it("rejects invalid JSON", () => {
    expect(
      parseEditablePetJson({
        originalId: null,
        text: "{",
      }),
    ).toEqual({
      ok: false,
      message: "pet.json must be valid JSON.",
    });
  });

  it("rejects missing required fields", () => {
    expect(
      parseEditablePetJson({
        originalId: null,
        text: JSON.stringify({
          id: "demo",
          displayName: "Demo",
          spritesheetPath: "spritesheet.webp",
        }),
      }),
    ).toEqual({
      ok: false,
      message: "pet.json is missing description.",
    });
  });

  it("rejects invalid spritesheet paths", () => {
    expect(
      parseEditablePetJson({
        originalId: "demo",
        text: JSON.stringify({
          id: "demo",
          displayName: "Demo",
          description: "Demo pet.",
          spritesheetPath: "https://example.com/spritesheet.webp",
        }),
      }),
    ).toEqual({
      ok: false,
      message: "spritesheetPath must be spritesheet.webp or spritesheet.png.",
    });
  });

  it("derives the spritesheet extension from the edited spritesheetPath", () => {
    const result = parseEditablePetJson({
      originalId: "demo",
      text: JSON.stringify({
        id: "demo",
        displayName: "Demo",
        description: "Demo pet.",
        spritesheetPath: "spritesheet.png",
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.spritesheetExt).toBe("png");
  });

  it("preserves a supported sprite version", () => {
    const result = parseEditablePetJson({
      originalId: "demo",
      text: JSON.stringify({
        id: "demo",
        displayName: "Demo",
        description: "Demo pet.",
        spriteVersionNumber: 2,
        spritesheetPath: "spritesheet.webp",
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.petJson.spriteVersionNumber).toBe(2);
  });

  it("rejects an unsupported sprite version", () => {
    expect(
      parseEditablePetJson({
        originalId: "demo",
        text: JSON.stringify({
          id: "demo",
          displayName: "Demo",
          description: "Demo pet.",
          spriteVersionNumber: 3,
          spritesheetPath: "spritesheet.webp",
        }),
      }),
    ).toEqual({
      ok: false,
      message: "spriteVersionNumber must be 1 or 2.",
    });
  });

  it("reads the original id only when it is valid", () => {
    expect(readOriginalPetJsonId('{"id":" demo "}')).toBe("demo");
    expect(readOriginalPetJsonId('{"id":""}')).toBeNull();
    expect(readOriginalPetJsonId("{")).toBeNull();
  });
});

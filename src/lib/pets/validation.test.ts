import { describe, expect, it } from "vitest";

import {
  slugify,
  validatePetJson,
  validateSpriteDimensions,
  validateSpriteExtension,
} from "@/lib/pets/validation";

describe("pet validation", () => {
  it("slugifies pet ids for public URLs", () => {
    expect(slugify("  Crawlstack Polished!!  ")).toBe("crawlstack-polished");
    expect(slugify("Привет")).toBe("");
  });

  it("accepts the Codex pet metadata shape", () => {
    const result = validatePetJson({
      id: "crawlstack-polished",
      displayName: "Crawlstack",
      description: "A compact Codex pet.",
      spritesheetPath: "spritesheet.webp",
    });

    expect(result.ok).toBe(true);
  });

  it("accepts and preserves v2 pet metadata", () => {
    const result = validatePetJson({
      id: "rose-katana",
      displayName: "Rose Katana",
      description: "A Codex v2 pet.",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: "rose-katana",
        displayName: "Rose Katana",
        description: "A Codex v2 pet.",
        spriteVersionNumber: 2,
        spritesheetPath: "spritesheet.webp",
      },
    });
  });

  it("rejects unsupported sprite versions", () => {
    const result = validatePetJson({
      id: "future-pet",
      displayName: "Future Pet",
      description: "An unsupported pet.",
      spriteVersionNumber: 3,
      spritesheetPath: "spritesheet.webp",
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_sprite_version",
      field: "spriteVersionNumber",
      message: "spriteVersionNumber must be 1 or 2.",
    });
  });

  it("rejects unsupported spritesheet paths", () => {
    const result = validatePetJson({
      id: "bad",
      displayName: "Bad",
      description: "Bad package.",
      spritesheetPath: "https://example.com/spritesheet.webp",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_spritesheet_path");
  });

  it("requires dimensions that match the sprite version", () => {
    expect(validateSpriteDimensions(1536, 1872).ok).toBe(true);
    expect(validateSpriteDimensions(1536, 1872, 1).ok).toBe(true);
    expect(validateSpriteDimensions(1536, 2288, 2).ok).toBe(true);
    expect(validateSpriteDimensions(1536, 2288).ok).toBe(false);
    expect(validateSpriteDimensions(1536, 1872, 2).ok).toBe(false);
    expect(validateSpriteDimensions(256, 256).ok).toBe(false);
  });

  it("allows only webp or png spritesheets", () => {
    expect(validateSpriteExtension("webp").ok).toBe(true);
    expect(validateSpriteExtension("jpg").ok).toBe(false);
  });
});

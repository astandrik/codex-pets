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

  it("requires the 8x9 Codex atlas dimensions", () => {
    expect(validateSpriteDimensions(1536, 1872).ok).toBe(true);
    expect(validateSpriteDimensions(256, 256).ok).toBe(false);
  });

  it("allows only webp or png spritesheets", () => {
    expect(validateSpriteExtension("webp").ok).toBe(true);
    expect(validateSpriteExtension("jpg").ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  assetUrl,
  getPetIdleStripUrl,
  getPetPreviewUrl,
} from "@/lib/pets/asset-urls";

describe("asset URLs", () => {
  it("builds internal asset URLs", () => {
    expect(assetUrl("asset_123456789abc", "pet.json")).toBe(
      "/api/assets/asset_123456789abc/pet.json",
    );
  });

  it("builds preview URLs from internal spritesheet URLs", () => {
    expect(
      getPetPreviewUrl("/api/assets/asset_123456789abc/spritesheet.webp"),
    ).toBe("/api/assets/asset_123456789abc/preview.webp");
    expect(
      getPetPreviewUrl(
        "/codex-pets/api/assets/asset_123456789abc/spritesheet.png",
      ),
    ).toBe("/codex-pets/api/assets/asset_123456789abc/preview.webp");
  });

  it("builds idle strip URLs from internal spritesheet URLs", () => {
    expect(
      getPetIdleStripUrl("/api/assets/asset_123456789abc/spritesheet.webp"),
    ).toBe("/api/assets/asset_123456789abc/idle-strip.webp");
    expect(
      getPetIdleStripUrl(
        "/codex-pets/api/assets/asset_123456789abc/spritesheet.png",
      ),
    ).toBe("/codex-pets/api/assets/asset_123456789abc/idle-strip.webp");
  });

  it("does not build preview URLs from external or unsupported URLs", () => {
    expect(
      getPetPreviewUrl(
        "https://assets.example/api/assets/asset_123/spritesheet.webp",
      ),
    ).toBeNull();
    expect(getPetPreviewUrl("/api/assets/asset_123/pet.zip")).toBeNull();
    expect(getPetIdleStripUrl("/api/assets/asset_123/pet.zip")).toBeNull();
  });
});

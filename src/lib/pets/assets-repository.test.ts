import { describe, expect, it } from "vitest";

import { assetUrl } from "@/lib/pets/assets-repository";

describe("asset repository", () => {
  it("builds internal asset URLs", () => {
    expect(assetUrl("asset_123456789abc", "pet.json")).toBe(
      "/api/assets/asset_123456789abc/pet.json",
    );
  });
});

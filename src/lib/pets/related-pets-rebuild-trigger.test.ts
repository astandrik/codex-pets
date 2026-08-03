import { describe, expect, it } from "vitest";

import { isRelatedPetsTextRefreshCompatible } from "@/lib/pets/related-pets-rebuild-trigger";

describe("related pets rebuild trigger", () => {
  it("requires the current text ranking revision and dimensions", () => {
    expect(
      isRelatedPetsTextRefreshCompatible({
        revision: "yandex-text-embeddings-v2-768-2026-07",
        dimensions: 768,
      }),
    ).toBe(true);
    expect(isRelatedPetsTextRefreshCompatible(null)).toBe(false);
    expect(
      isRelatedPetsTextRefreshCompatible({
        revision: "yandex-text-search-2026-07",
        dimensions: 256,
      }),
    ).toBe(false);
    expect(
      isRelatedPetsTextRefreshCompatible({
        revision: "yandex-text-embeddings-v2-768-2026-07",
        dimensions: 256,
      }),
    ).toBe(false);
  });
});

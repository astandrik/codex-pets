import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pets/related/related-pets-rebuild", () => ({
  invalidateRelatedPets: vi.fn(),
  rebuildRelatedPets: vi.fn(),
}));

vi.mock("@/lib/pets/search/search-provider-runtime", () => {
  const petSearchRuntimeConfig = {
    semantic: null,
  };
  return { getPetSearchProviders: () => ({ petSearchRuntimeConfig }) };
});

import {
  invalidateRelatedPets,
  rebuildRelatedPets,
} from "@/lib/pets/related/related-pets-rebuild";
import {
  isRelatedPetsTextRefreshCompatible,
  rebuildRelatedPetsBestEffort,
} from "@/lib/pets/related/related-pets-rebuild-trigger";
import { getPetSearchProviders } from "@/lib/pets/search/search-provider-runtime";

describe("related pets rebuild trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPetSearchProviders().petSearchRuntimeConfig.semantic = null;
  });

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

  it("invalidates snapshots instead of rebuilding under an incompatible text profile", async () => {
    vi.mocked(invalidateRelatedPets).mockResolvedValueOnce({
      operation: "invalidate",
      status: "invalidated",
      generationId: "generation-invalidated",
      rankingRevision: "related-pets-hybrid-rrf-v1",
      failureReason: "text_profile_incompatible",
      durationMs: 1,
    });

    await expect(
      rebuildRelatedPetsBestEffort({
        trigger: "owner-delete",
        includeVisual: true,
      }),
    ).resolves.toBe(true);

    expect(invalidateRelatedPets).toHaveBeenCalledWith({
      failureReason: "text_profile_incompatible",
    });
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
  });
});

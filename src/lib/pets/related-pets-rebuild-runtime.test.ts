import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  isYdbConfigured: vi.fn(),
  listApprovedPetsForSearch: vi.fn(),
  listPetSearchCaptions: vi.fn(),
  listRawPetSearchEmbeddings: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPetsForSearch: runtimeMocks.listApprovedPetsForSearch,
}));
vi.mock("@/lib/pets/search-captions-repository", () => ({
  listPetSearchCaptions: runtimeMocks.listPetSearchCaptions,
}));
vi.mock("@/lib/pets/search-embeddings-repository", () => ({
  listRawPetSearchEmbeddings: runtimeMocks.listRawPetSearchEmbeddings,
}));
vi.mock("@/lib/pets/related-pets-repository", () => ({
  activateRelatedPetsGeneration: vi.fn(),
  cleanupInactiveRelatedPetsGeneration: vi.fn(),
  cleanupRelatedPetsGenerations: vi.fn(),
  getRelatedPetsState: vi.fn(),
  markRelatedPetsGenerationFailed: vi.fn(),
  recoverPreviousRelatedPetsGeneration: vi.fn(),
  requestRelatedPetsBuild: vi.fn(),
  writeRelatedPetsSnapshot: vi.fn(),
}));
vi.mock("@/lib/ydb/client", () => ({
  isYdbConfigured: runtimeMocks.isYdbConfigured,
}));

const TEXT_REVISION = "yandex-text-embeddings-v2-768-2026-07";
const VISUAL_REVISION =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1";
const CAPTION_REVISION =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1";

describe("related pets production visual source compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    runtimeMocks.isYdbConfigured.mockReturnValue(true);
    runtimeMocks.listApprovedPetsForSearch.mockResolvedValue([]);
    runtimeMocks.listPetSearchCaptions.mockResolvedValue([]);
    runtimeMocks.listRawPetSearchEmbeddings.mockResolvedValue([]);
  });

  it("does not read 768-dimensional visual rows when unset config resolves to the legacy revision", async () => {
    vi.stubEnv("YANDEX_AI_STUDIO_FOLDER_ID", "folder-1");
    vi.stubEnv("PET_SEARCH_VISUAL_MODEL_REVISION", "");
    vi.stubEnv("PET_SEARCH_VISION_CAPTION_REVISION", "");
    const { rebuildRelatedPets } = await import(
      "@/lib/pets/related-pets-rebuild"
    );

    await rebuildRelatedPets({ mode: "dry-run", includeVisual: true });

    expect(
      runtimeMocks.listRawPetSearchEmbeddings.mock.calls.map(
        ([revision]) => revision,
      ),
    ).toEqual([TEXT_REVISION]);
    expect(runtimeMocks.listPetSearchCaptions).not.toHaveBeenCalled();
  });

  it("reads visual rows only for an exact current visual and caption revision match", async () => {
    vi.stubEnv("YANDEX_AI_STUDIO_FOLDER_ID", "folder-1");
    vi.stubEnv("PET_SEARCH_VISUAL_MODEL_REVISION", VISUAL_REVISION);
    vi.stubEnv("PET_SEARCH_VISION_CAPTION_REVISION", CAPTION_REVISION);
    const { rebuildRelatedPets } = await import(
      "@/lib/pets/related-pets-rebuild"
    );

    await rebuildRelatedPets({ mode: "dry-run", includeVisual: true });

    expect(
      runtimeMocks.listRawPetSearchEmbeddings.mock.calls.map(
        ([revision]) => revision,
      ),
    ).toEqual([TEXT_REVISION, VISUAL_REVISION]);
    expect(runtimeMocks.listPetSearchCaptions).toHaveBeenCalledWith(
      CAPTION_REVISION,
    );
  });
});

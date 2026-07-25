import { describe, expect, it, vi } from "vitest";

import type { PetSearchConfig } from "@/lib/pets/search-config";
import {
  PET_DERIVED_VISION_CAPTION_REVISION,
  PET_VISION_CAPTION_REVISION,
  buildPetVisionCaptionText,
  createPetDerivedVisionCaptionEnvelope,
  createPetDerivedVisionCaptionSourceHash,
  createPetVisionCaptionTextHash,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  type PetVisionCaption,
} from "@/lib/pets/search-vision-contract";
import {
  createPetVisionSearchRuntime,
  type PetVisionRefreshResult,
} from "@/lib/pets/search-vision-runtime";

const config: PetSearchConfig = {
  mode: "hybrid",
  semantic: null,
  fallbackReason: null,
  visualMode: "shadow",
  visual: {
    folderId: "folder-1",
    apiKey: "secret",
    captionRevision: "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1",
    visualRevision: "yandex-text-search-2026-07-pet-vision-v1",
    embeddingModelId: "yandex-text-search-v1-256",
    dimensions: 256,
    profile: null,
    visionTimeoutMs: 30_000,
    modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
  },
  visualFallbackReason: null,
};

const pet = {
  slug: "velvet-byte",
  status: "approved" as const,
  spritesheetUrl: "/api/assets/asset-123/spritesheet.webp",
};

const caption: PetVisionCaption = {
  subject: { en: "woman", ru: "женщина" },
  appearance: { en: "silver hair", ru: "серебряные волосы" },
  clothing: { en: "black dress", ru: "чёрное платье" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "confident", ru: "уверенная" },
  colors: { en: ["black"], ru: ["чёрный"] },
  search_terms_en: ["anime woman", "gothic", "elegant"],
  search_terms_ru: ["аниме девушка", "готика", "элегантная"],
};

const captionSourceHash = createPetVisionCaptionSourceHash({
  captionRevision: config.visual!.captionRevision,
  modelUri: config.visual!.modelUri,
  assetId: "asset-123",
  spritesheetSha256: "a".repeat(64),
});
const captionText = buildPetVisionCaptionText(caption);
const captionJson = JSON.stringify(
  createPetVisionCaptionEnvelope({
    assetId: "asset-123",
    spritesheetSha256: "a".repeat(64),
    caption,
  }),
);
const visualSourceHash = createPetVisualEmbeddingSourceHash({
  visualRevision: config.visual!.visualRevision,
  captionRevision: config.visual!.captionRevision,
  captionSourceHash,
  captionText,
});

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    config,
    embeddingClient: {
      embedDocument: vi.fn(async () => Array(256).fill(0.25)),
    },
    visionClient: {
      createCaption: vi.fn(async () => caption),
    },
    rewriteClient: null,
    readSpritesheet: vi.fn(async () => ({
      buffer: Buffer.from("spritesheet"),
      contentType: "image/webp",
      filename: "spritesheet.webp",
    })),
    extractFrames: vi.fn(async () => ({
      spriteVersion: 1 as const,
      spritesheetSha256: "a".repeat(64),
      frames: [],
    })),
    getCaption: vi.fn(async () => null),
    upsertCaption: vi.fn(async () => undefined),
    getEmbeddingMetadata: vi.fn(async () => null),
    upsertEmbedding: vi.fn(async () => undefined),
    now: () => new Date("2026-07-22T12:00:00.000Z"),
    ...overrides,
  };
}

describe("pet vision search indexing runtime", () => {
  it("does not write captions or vectors while visual rollout is off", async () => {
    const deps = dependencies({
      config: { ...config, visualMode: "off" },
    });
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(runtime.refresh(pet)).resolves.toBe("skipped");
    expect(deps.readSpritesheet).not.toHaveBeenCalled();
    expect(deps.visionClient.createCaption).not.toHaveBeenCalled();
    expect(deps.embeddingClient.embedDocument).not.toHaveBeenCalled();
    expect(deps.upsertCaption).not.toHaveBeenCalled();
    expect(deps.upsertEmbedding).not.toHaveBeenCalled();
  });

  it("skips non-approved pets without reading assets", async () => {
    const deps = dependencies();
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(
      runtime.refresh({
        ...pet,
        status: "rejected",
      }),
    ).resolves.toBe("skipped");
    expect(deps.readSpritesheet).not.toHaveBeenCalled();
  });

  it("returns unchanged when caption and visual vector are fresh", async () => {
    const deps = dependencies({
      getCaption: vi.fn(async () => ({
        slug: pet.slug,
        sourceHash: captionSourceHash,
        captionJson,
        captionText,
        updatedAt: "2026-07-22T11:00:00.000Z",
      })),
      getEmbeddingMetadata: vi.fn(async () => ({
        sourceHash: visualSourceHash,
        dimensions: 256,
      })),
    });
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(runtime.refresh(pet)).resolves.toBe("unchanged");
    expect(deps.visionClient.createCaption).not.toHaveBeenCalled();
    expect(deps.embeddingClient.embedDocument).not.toHaveBeenCalled();
  });

  it("reuses a fresh caption when only the visual vector is stale", async () => {
    const deps = dependencies({
      getCaption: vi.fn(async () => ({
        slug: pet.slug,
        sourceHash: captionSourceHash,
        captionJson,
        captionText,
        updatedAt: "2026-07-22T11:00:00.000Z",
      })),
    });
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(runtime.refresh(pet)).resolves.toBe("vector-only");
    expect(deps.visionClient.createCaption).not.toHaveBeenCalled();
    expect(deps.embeddingClient.embedDocument).toHaveBeenCalledWith(captionText);
    expect(deps.upsertEmbedding).toHaveBeenCalledWith({
      modelRevision: config.visual!.visualRevision,
      slug: pet.slug,
      sourceHash: visualSourceHash,
      dimensions: 256,
      embedding: Array(256).fill(0.25),
      updatedAt: "2026-07-22T12:00:00.000Z",
    });
  });

  it("writes a new caption before embedding and preserves partial progress", async () => {
    const events: string[] = [];
    const deps = dependencies({
      upsertCaption: vi.fn(async () => {
        events.push("caption");
      }),
      embeddingClient: {
        embedDocument: vi.fn(async () => {
          events.push("embedding");
          throw new Error("embedding failed");
        }),
      },
    });
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(runtime.refresh(pet)).rejects.toThrow("embedding failed");
    expect(events).toEqual(["caption", "embedding"]);
    expect(deps.upsertEmbedding).not.toHaveBeenCalled();
    expect(deps.upsertCaption).toHaveBeenCalledWith({
      captionRevision: config.visual!.captionRevision,
      slug: pet.slug,
      sourceHash: captionSourceHash,
      captionJson,
      captionText,
      updatedAt: "2026-07-22T12:00:00.000Z",
    });
  });

  it.each([
    [false, "caption-and-vector"],
    [true, "caption-and-vector"],
  ] as const)(
    "regenerates stale captions and supports force=%s",
    async (force, expected) => {
      const deps = dependencies({
        getCaption: force
          ? vi.fn(async () => ({
              slug: pet.slug,
              sourceHash: captionSourceHash,
              captionJson,
              captionText,
              updatedAt: "2026-07-22T11:00:00.000Z",
            }))
          : vi.fn(async () => null),
        getEmbeddingMetadata: force
          ? vi.fn(async () => ({
              sourceHash: visualSourceHash,
              dimensions: 256,
            }))
          : vi.fn(async () => null),
      });
      const runtime = createPetVisionSearchRuntime(deps);

      await expect(runtime.refresh(pet, { force })).resolves.toBe(
        expected satisfies PetVisionRefreshResult,
      );
      expect(deps.visionClient.createCaption).toHaveBeenCalledTimes(1);
      expect(deps.upsertCaption).toHaveBeenCalledTimes(1);
      expect(deps.upsertEmbedding).toHaveBeenCalledTimes(1);
    },
  );

  it("derives a caption only from the validated current Qwen caption", async () => {
    const rewrittenCaption: PetVisionCaption = {
      ...caption,
      search_terms_en: ["silver-haired woman", "gothic", "pixel art"],
    };
    const derivedConfig: PetSearchConfig = {
      ...config,
      visual: {
        ...config.visual!,
        captionRevision: PET_DERIVED_VISION_CAPTION_REVISION,
        visualRevision:
          "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-deepseek-v4-v1",
        embeddingModelId: "yandex-text-embeddings-v2-768",
        dimensions: 768,
        modelUri: "gpt://folder-1/deepseek-v4-flash",
      },
    };
    const upstreamStoredCaption = {
      slug: pet.slug,
      sourceHash: captionSourceHash,
      captionJson,
      captionText,
      updatedAt: "2026-07-22T11:00:00.000Z",
    };
    const derivedSourceHash = createPetDerivedVisionCaptionSourceHash({
      captionRevision: PET_DERIVED_VISION_CAPTION_REVISION,
      modelUri: derivedConfig.visual!.modelUri,
      upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
      upstreamSourceHash: captionSourceHash,
      upstreamCaptionText: captionText,
    });
    const rewriteClient = {
      rewriteCaption: vi.fn(async () => rewrittenCaption),
    };
    const deps = dependencies({
      config: derivedConfig,
      embeddingClient: {
        embedDocument: vi.fn(async () => Array(768).fill(0.25)),
      },
      rewriteClient,
      getCaption: vi.fn(async (revision: string) =>
        revision === PET_VISION_CAPTION_REVISION
          ? upstreamStoredCaption
          : null
      ),
    });
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(runtime.refresh(pet)).resolves.toBe("caption-and-vector");
    expect(deps.visionClient.createCaption).not.toHaveBeenCalled();
    expect(rewriteClient.rewriteCaption).toHaveBeenCalledWith(caption);
    expect(deps.upsertCaption).toHaveBeenCalledWith({
      captionRevision: PET_DERIVED_VISION_CAPTION_REVISION,
      slug: pet.slug,
      sourceHash: derivedSourceHash,
      captionJson: JSON.stringify(
        createPetDerivedVisionCaptionEnvelope({
          upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
          upstreamSourceHash: captionSourceHash,
          upstreamCaptionTextSha256:
            createPetVisionCaptionTextHash(captionText),
          caption: rewrittenCaption,
        }),
      ),
      captionText: buildPetVisionCaptionText(rewrittenCaption),
      updatedAt: "2026-07-22T12:00:00.000Z",
    });
    expect(deps.upsertEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision: derivedConfig.visual!.visualRevision,
        dimensions: 768,
        embedding: Array(768).fill(0.25),
      }),
    );
  });

  it("creates the Qwen upstream row before a missing derived caption", async () => {
    const writes: string[] = [];
    const derivedConfig: PetSearchConfig = {
      ...config,
      visual: {
        ...config.visual!,
        captionRevision: PET_DERIVED_VISION_CAPTION_REVISION,
        visualRevision:
          "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-deepseek-v4-v1",
        embeddingModelId: "yandex-text-embeddings-v2-768",
        dimensions: 768,
        modelUri: "gpt://folder-1/deepseek-v4-flash",
      },
    };
    const deps = dependencies({
      config: derivedConfig,
      embeddingClient: {
        embedDocument: vi.fn(async () => Array(768).fill(0.25)),
      },
      rewriteClient: {
        rewriteCaption: vi.fn(async () => caption),
      },
      upsertCaption: vi.fn(async (input: { captionRevision: string }) => {
        writes.push(input.captionRevision);
      }),
    });
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(runtime.refresh(pet)).resolves.toBe("caption-and-vector");
    expect(writes).toEqual([
      PET_VISION_CAPTION_REVISION,
      PET_DERIVED_VISION_CAPTION_REVISION,
    ]);
  });
});

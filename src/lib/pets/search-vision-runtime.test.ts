import { describe, expect, it, vi } from "vitest";

import type { PetSearchConfig } from "@/lib/pets/search-config";
import {
  PET_VISION_CAPTION_REVISION_V2,
  PET_VISUAL_MODEL_REVISION_V2,
  buildPetVisionCaptionText,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  type PetVisionCaption,
  type PetVisionCaptionV2,
} from "@/lib/pets/search-vision-contract";
import {
  createPetVisionSearchRuntime,
  type PetVisionRefreshResult,
} from "@/lib/pets/search-vision-runtime";

const config: PetSearchConfig = {
  mode: "hybrid",
  semantic: null,
  fallbackReason: null,
  visualMode: "off",
  visual: {
    folderId: "folder-1",
    apiKey: "secret",
    captionRevision: "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1",
    visualRevision: "yandex-text-search-2026-07-pet-vision-v1",
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
  it("writes and reuses only envelopes matching the configured v2 revision", async () => {
    const v2Config: PetSearchConfig = {
      ...config,
      visual: {
        ...config.visual!,
        captionRevision: PET_VISION_CAPTION_REVISION_V2,
        visualRevision: PET_VISUAL_MODEL_REVISION_V2,
      },
    };
    const v2Caption: PetVisionCaptionV2 = {
      ...caption,
      accessories: {
        en: "black blindfold and sword",
        ru: "чёрная повязка и меч",
      },
    };
    const v2CaptionText = buildPetVisionCaptionText(
      PET_VISION_CAPTION_REVISION_V2,
      v2Caption,
    );
    const v2CaptionSourceHash = createPetVisionCaptionSourceHash({
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      modelUri: v2Config.visual!.modelUri,
      assetId: "asset-123",
      spritesheetSha256: "a".repeat(64),
    });
    let writtenCaption:
      | {
          captionRevision: string;
          slug: string;
          sourceHash: string;
          captionJson: string;
          captionText: string;
          updatedAt: string;
        }
      | undefined;
    const deps = dependencies({
      config: v2Config,
      getCaption: vi.fn(async () => ({
        slug: pet.slug,
        sourceHash: v2CaptionSourceHash,
        captionJson,
        captionText,
        updatedAt: "2026-07-22T11:00:00.000Z",
      })),
      visionClient: {
        createCaption: vi.fn(async () => v2Caption),
      },
      upsertCaption: vi.fn(async (input) => {
        writtenCaption = {
          captionRevision: input.captionRevision,
          slug: input.slug,
          sourceHash: input.sourceHash,
          captionJson: input.captionJson,
          captionText: input.captionText,
          updatedAt: input.updatedAt,
        };
      }),
    });
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(runtime.refresh(pet)).resolves.toBe("caption-and-vector");
    expect(deps.getCaption).toHaveBeenCalledWith(
      PET_VISION_CAPTION_REVISION_V2,
      pet.slug,
    );
    expect(writtenCaption).toMatchObject({
      slug: pet.slug,
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      sourceHash: v2CaptionSourceHash,
      captionText: v2CaptionText,
    });
    expect(JSON.parse(writtenCaption?.captionJson ?? "{}")).toMatchObject({
      schemaVersion: 2,
      caption: {
        accessories: v2Caption.accessories,
      },
    });

    const freshDeps = dependencies({
      config: v2Config,
      getCaption: vi.fn(async () => writtenCaption ?? null),
      getEmbeddingMetadata: vi.fn(async () => ({
        sourceHash: createPetVisualEmbeddingSourceHash({
          visualRevision: PET_VISUAL_MODEL_REVISION_V2,
          captionRevision: PET_VISION_CAPTION_REVISION_V2,
          captionSourceHash: v2CaptionSourceHash,
          captionText: v2CaptionText,
        }),
        dimensions: 256,
      })),
    });
    await expect(
      createPetVisionSearchRuntime(freshDeps).refresh(pet),
    ).resolves.toBe("unchanged");
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
});

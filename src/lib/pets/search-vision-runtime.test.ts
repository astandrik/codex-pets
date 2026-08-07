import { describe, expect, it, vi } from "vitest";

import type { PetSearchConfig } from "@/lib/pets/search-config";
import {
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
import type { PetVisionFramePolicy } from "@/lib/pets/search-vision-frames";

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

const captionV2: PetVisionCaptionV2 = {
  ...caption,
  accessories: { en: "red scarf", ru: "красный шарф" },
  distinctive_features: { en: "round ears", ru: "круглые уши" },
  pose_motion: { en: "waves and jumps", ru: "машет и прыгает" },
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
    upsertCaption: vi.fn<
      (input: { captionJson: string }) => Promise<void>
    >(async () => undefined),
    getEmbeddingMetadata: vi.fn(async () => null),
    upsertEmbedding: vi.fn(async () => undefined),
    now: () => new Date("2026-07-22T12:00:00.000Z"),
    ...overrides,
  };
}

describe("pet vision search indexing runtime", () => {
  it("reports successful visual indexing to an optional completion callback", async () => {
    const deps = dependencies({
      getCaption: vi.fn(async () => ({
        slug: pet.slug,
        sourceHash: captionSourceHash,
        captionJson,
        captionText,
        updatedAt: "2026-07-22T11:00:00.000Z",
      })),
    });
    const runtime = createPetVisionSearchRuntime(deps) as ReturnType<
      typeof createPetVisionSearchRuntime
    > & {
      refreshBestEffort: (
        target: typeof pet,
        options: {
          onSuccessfulRefresh: (
            result: Exclude<PetVisionRefreshResult, "skipped">,
          ) => Promise<void>;
        },
      ) => Promise<boolean>;
    };
    const onSuccessfulRefresh = vi.fn(async () => undefined);

    await expect(
      runtime.refreshBestEffort(pet, { onSuccessfulRefresh }),
    ).resolves.toBe(true);
    expect(onSuccessfulRefresh).toHaveBeenCalledWith("vector-only");
  });

  it("does not report skipped or failed indexing as successful", async () => {
    const onSuccessfulRefresh = vi.fn(async () => undefined);
    const skippedRuntime = createPetVisionSearchRuntime(
      dependencies({ config: { ...config, visual: null } }),
    ) as ReturnType<typeof createPetVisionSearchRuntime> & {
      refreshBestEffort: (
        target: typeof pet,
        options: { onSuccessfulRefresh: typeof onSuccessfulRefresh },
      ) => Promise<boolean>;
    };

    await expect(
      skippedRuntime.refreshBestEffort(pet, { onSuccessfulRefresh }),
    ).resolves.toBe(true);
    expect(onSuccessfulRefresh).not.toHaveBeenCalled();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failedRuntime = createPetVisionSearchRuntime(
      dependencies({
        readSpritesheet: vi.fn(async () => {
          throw new Error("private asset detail");
        }),
      }),
    ) as ReturnType<typeof createPetVisionSearchRuntime> & {
      refreshBestEffort: (
        target: typeof pet,
        options: { onSuccessfulRefresh: typeof onSuccessfulRefresh },
      ) => Promise<boolean>;
    };

    await expect(
      failedRuntime.refreshBestEffort(pet, { onSuccessfulRefresh }),
    ).resolves.toBe(false);
    expect(onSuccessfulRefresh).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[codex-pets][pet-vision-search]", {
      operation: "refresh",
      status: "failed",
      reason: "asset_error",
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "private asset detail",
    );
    warnSpy.mockRestore();
  });

  it("does not classify completion callback failures as vision indexing failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = createPetVisionSearchRuntime(dependencies()) as ReturnType<
      typeof createPetVisionSearchRuntime
    > & {
      refreshBestEffort: (
        target: typeof pet,
        options: {
          onSuccessfulRefresh: (
            result: Exclude<PetVisionRefreshResult, "skipped">,
          ) => Promise<void>;
        },
      ) => Promise<boolean>;
    };

    await expect(
      runtime.refreshBestEffort(pet, {
        onSuccessfulRefresh: async () => {
          throw new Error("rebuild failed");
        },
      }),
    ).rejects.toThrow("rebuild failed");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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

  it("uses the nine-frame policy and schemaVersion 2 for the V2 revision", async () => {
    const v2Config: PetSearchConfig = {
      ...config,
      visual: {
        ...config.visual!,
        captionRevision:
          "yandex-qwen3.6-35b-a3b-pet-caption-2026-08-v2",
        visualRevision:
          "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v2",
        embeddingModelId: "yandex-text-embeddings-v2-768",
        dimensions: 768,
      },
    };
    const extractFrames = vi.fn(async (
      _buffer: Buffer,
      policy: PetVisionFramePolicy,
    ) => ({
      spriteVersion: 2 as const,
      spritesheetSha256: "b".repeat(64),
      frames: policy.frames.map((frame) => ({
        ...frame,
        png: Buffer.from(frame.state),
        dataUrl: `data:image/png;base64,${frame.state}`,
      })),
    }));
    const deps = dependencies({
      config: v2Config,
      extractFrames,
      visionClient: { createCaption: vi.fn(async () => captionV2) },
      embeddingClient: {
        embedDocument: vi.fn(async () => Array(768).fill(0.25)),
      },
    });
    const runtime = createPetVisionSearchRuntime(deps);

    await expect(runtime.refresh(pet)).resolves.toBe("caption-and-vector");
    expect(extractFrames.mock.calls[0]?.[1]).toMatchObject({
      id: "pet-vision-nine-central-frames-v2",
      frames: expect.arrayContaining([
        expect.objectContaining({ state: "running-left", row: 2 }),
        expect.objectContaining({ state: "failed", row: 5 }),
      ]),
    });
    const captionWrite = deps.upsertCaption.mock.calls[0]?.[0];
    if (!captionWrite) throw new Error("Expected a V2 caption write.");
    expect(JSON.parse(captionWrite.captionJson)).toMatchObject({
      schemaVersion: 2,
      provenance: {
        origin: "provider",
        api: "responses",
        model: "qwen3.6-35b-a3b",
        framePolicy: "pet-vision-nine-central-frames-v2",
      },
    });
    expect(deps.upsertEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision:
          "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v2",
        dimensions: 768,
      }),
    );
  });
});

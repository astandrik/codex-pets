import { describe, expect, it, vi } from "vitest";

import { PET_SEARCH_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { createPetSearchSourceHash } from "@/lib/pets/search-embeddings";
import {
  createApprovedPetSearchRuntime,
  filterCurrentVisualMatches,
} from "@/lib/pets/search-runtime";
import {
  PET_VISION_CAPTION_REVISION,
  PET_VISION_CAPTION_REVISION_V2,
  PET_VISUAL_MODEL_REVISION,
  PET_VISUAL_MODEL_REVISION_V2,
  buildPetVisionCaptionText,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  type PetVisionCaption,
  type PetVisionCaptionV2,
} from "@/lib/pets/search-vision-contract";
import type { ApprovalStatus } from "@/lib/pets/types";

const revision = Object.keys(PET_SEARCH_MODEL_REVISIONS)[0] as keyof typeof PET_SEARCH_MODEL_REVISIONS;
const semanticConfig = {
  folderId: "folder-1",
  apiKey: "secret",
  revision,
  dimensions: 256,
  minSemanticScore: 0.55,
  timeoutMs: 800,
};
const catalog = [
  {
    slug: "velvet-byte",
    displayName: "Velvet Byte",
    description: "A confident gothic coding character",
    kind: "character" as const,
    tags: ["gothic", "night"],
    ownerName: "Alice",
    status: "approved" as ApprovalStatus,
    spritesheetUrl: "/api/assets/asset-velvet/spritesheet.webp",
  },
  {
    slug: "orbit-otter",
    displayName: "Orbit Otter",
    description: "A friendly space helper",
    kind: "creature" as const,
    tags: ["space", "friendly"],
    ownerName: "Bob",
    status: "approved" as ApprovalStatus,
    spritesheetUrl: "/api/assets/asset-orbit/spritesheet.webp",
  },
];

function dependencies(overrides = {}) {
  return {
    config: {
      mode: "hybrid" as const,
      semantic: semanticConfig,
      fallbackReason: null,
      visualMode: "off" as const,
      visual: null,
      visualFallbackReason: null,
    },
    listApprovedPets: async () => catalog,
    embeddingClient: {
      revision,
      dimensions: 256,
      embedQuery: vi.fn(async () => Array(256).fill(0.1)),
      embedDocument: vi.fn(async () => Array(256).fill(0.2)),
    },
    findSimilar: vi.fn(async () => []),
    listCaptions: vi.fn(async () => []),
    getMetadata: vi.fn(async () => null),
    upsert: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("approved pet search runtime", () => {
  it("validates stored visual rows with the configured caption revision", () => {
    const visualConfig = {
      folderId: "folder-1",
      apiKey: "secret",
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      visualRevision: PET_VISUAL_MODEL_REVISION_V2,
      dimensions: 256,
      profile: null,
      visionTimeoutMs: 30_000,
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
    } as const;
    const visualCaption: PetVisionCaptionV2 = {
      subject: { en: "woman", ru: "женщина" },
      appearance: { en: "silver hair", ru: "серебряные волосы" },
      clothing: { en: "black dress", ru: "чёрное платье" },
      accessories: {
        en: "black blindfold and sword",
        ru: "чёрная повязка и меч",
      },
      style: { en: "pixel art", ru: "пиксель-арт" },
      mood: { en: "confident", ru: "уверенная" },
      colors: { en: ["black"], ru: ["чёрный"] },
      search_terms_en: ["anime woman", "gothic", "elegant"],
      search_terms_ru: ["аниме девушка", "готика", "элегантная"],
    };
    const captionText = buildPetVisionCaptionText(
      PET_VISION_CAPTION_REVISION_V2,
      visualCaption,
    );
    const captionSourceHash = createPetVisionCaptionSourceHash({
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      modelUri: visualConfig.modelUri,
      assetId: "asset-velvet",
      spritesheetSha256: "a".repeat(64),
    });
    const visualSourceHash = createPetVisualEmbeddingSourceHash({
      visualRevision: PET_VISUAL_MODEL_REVISION_V2,
      captionRevision: PET_VISION_CAPTION_REVISION_V2,
      captionSourceHash,
      captionText,
    });

    expect(
      filterCurrentVisualMatches({
        candidates: new Map([[catalog[0].slug, catalog[0]]]),
        storedMatches: [
          {
            slug: catalog[0].slug,
            sourceHash: visualSourceHash,
            score: 0.95,
          },
        ],
        storedCaptions: [
          {
            slug: catalog[0].slug,
            sourceHash: captionSourceHash,
            captionJson: JSON.stringify(
              createPetVisionCaptionEnvelope({
                captionRevision: PET_VISION_CAPTION_REVISION_V2,
                assetId: "asset-velvet",
                spritesheetSha256: "a".repeat(64),
                caption: visualCaption,
              }),
            ),
            captionText,
            updatedAt: "2026-07-23T00:00:00.000Z",
          },
        ],
        visualConfig,
      }),
    ).toEqual([{ slug: catalog[0].slug, score: 0.95 }]);
  });

  it("returns semantic candidates only when they are current approved documents", async () => {
    const findSimilar = vi.fn(async () => [
      {
        slug: "orbit-otter",
        sourceHash: "stale",
        score: 0.99,
      },
      {
        slug: "velvet-byte",
        sourceHash: createPetSearchSourceHash(catalog[0], revision),
        score: 0.87,
      },
      {
        slug: "not-approved",
        sourceHash: "irrelevant",
        score: 0.95,
      },
    ]);
    const runtime = createApprovedPetSearchRuntime(
      dependencies({ findSimilar }),
    );

    const result = await runtime.searchApprovedPets({ q: "sexy" });

    expect(result.pets).toEqual([catalog[0]]);
    expect(result.mode).toBe("hybrid");
    expect(findSimilar).toHaveBeenCalledWith({
      modelRevision: revision,
      dimensions: 256,
      embedding: Array(256).fill(0.1),
    });
  });

  it("falls back cleanly when semantic configuration is unavailable", async () => {
    const runtime = createApprovedPetSearchRuntime(
      dependencies({
        config: {
          mode: "hybrid",
          semantic: null,
          fallbackReason: "configuration_missing",
          visualMode: "off",
          visual: null,
          visualFallbackReason: null,
        },
        embeddingClient: null,
      }),
    );

    const result = await runtime.searchApprovedPets({ q: "space" });

    expect(result.pets).toEqual([catalog[1]]);
    expect(result.mode).toBe("lexical_fallback");
    expect(result.fallbackReason).toBe("configuration_missing");
  });

  it("classifies provider and vector-store failures without raw query data", async () => {
    const providerRuntime = createApprovedPetSearchRuntime(
      dependencies({
        embeddingClient: {
          ...dependencies().embeddingClient,
          embedQuery: async () => {
            const error = new Error("timed out") as Error & {
              reason: "timeout";
            };
            error.reason = "timeout";
            throw error;
          },
        },
      }),
    );
    expect(await providerRuntime.searchApprovedPets({ q: "space" }))
      .toMatchObject({ mode: "lexical_fallback", fallbackReason: "timeout" });

    const vectorRuntime = createApprovedPetSearchRuntime(
      dependencies({
        findSimilar: async () => {
          throw new Error("table unavailable");
        },
      }),
    );
    expect(await vectorRuntime.searchApprovedPets({ q: "space" }))
      .toMatchObject({
        mode: "lexical_fallback",
        fallbackReason: "vector_search_error",
      });
  });

  it("refreshes only stale approved documents and supports force", async () => {
    const sourceHash = createPetSearchSourceHash(catalog[0], revision);
    const getMetadata = vi.fn(async () => ({
      sourceHash,
      dimensions: 256,
    }));
    const upsert = vi.fn(async () => undefined);
    const runtime = createApprovedPetSearchRuntime(
      dependencies({ getMetadata, upsert }),
    );

    expect(await runtime.refreshApprovedPetEmbedding(catalog[0])).toBe(
      "unchanged",
    );
    expect(upsert).not.toHaveBeenCalled();

    expect(
      await runtime.refreshApprovedPetEmbedding(catalog[0], { force: true }),
    ).toBe("updated");
    expect(upsert).toHaveBeenCalledWith({
      modelRevision: revision,
      slug: "velvet-byte",
      sourceHash,
      dimensions: 256,
      embedding: Array(256).fill(0.2),
      updatedAt: expect.any(String),
    });
  });

  it("never indexes non-approved records", async () => {
    const runtime = createApprovedPetSearchRuntime(dependencies());

    expect(
      await runtime.refreshApprovedPetEmbedding({
        ...catalog[0],
        status: "rejected",
      }),
    ).toBe("skipped");
  });

  it("does not read embeddings or captions in base lexical mode", async () => {
    const embedQuery = vi.fn(async () => Array(256).fill(0.1));
    const findSimilar = vi.fn(async () => []);
    const listCaptions = vi.fn(async () => []);
    const runtime = createApprovedPetSearchRuntime(
      dependencies({
        config: {
          mode: "lexical",
          semantic: semanticConfig,
          fallbackReason: null,
          visualMode: "hybrid",
          visual: {
            folderId: "folder-1",
            apiKey: "secret",
            captionRevision: PET_VISION_CAPTION_REVISION,
            visualRevision: PET_VISUAL_MODEL_REVISION,
            dimensions: 256,
            profile: { minSemanticScore: 0.9, weight: 0.5 },
            visionTimeoutMs: 30_000,
            modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
          },
          visualFallbackReason: null,
        },
        embeddingClient: {
          ...dependencies().embeddingClient,
          embedQuery,
        },
        findSimilar,
        listCaptions,
      }),
    );

    await expect(runtime.searchApprovedPets({ q: "unrelated" }))
      .resolves.toMatchObject({ pets: [], mode: "lexical" });
    expect(embedQuery).not.toHaveBeenCalled();
    expect(findSimilar).not.toHaveBeenCalled();
    expect(listCaptions).not.toHaveBeenCalled();
  });

  it("uses one query embedding for parallel text and visual ranks", async () => {
    const visualConfig = {
      folderId: "folder-1",
      apiKey: "secret",
      captionRevision: PET_VISION_CAPTION_REVISION,
      visualRevision: PET_VISUAL_MODEL_REVISION,
      dimensions: 256,
      profile: null,
      visionTimeoutMs: 30_000,
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
    } as const;
    const visualCaption: PetVisionCaption = {
      subject: { en: "woman", ru: "женщина" },
      appearance: { en: "silver hair", ru: "серебряные волосы" },
      clothing: { en: "black dress", ru: "чёрное платье" },
      style: { en: "pixel art", ru: "пиксель-арт" },
      mood: { en: "confident", ru: "уверенная" },
      colors: { en: ["black"], ru: ["чёрный"] },
      search_terms_en: ["anime woman", "gothic", "elegant"],
      search_terms_ru: ["аниме девушка", "готика", "элегантная"],
    };
    const captionText = buildPetVisionCaptionText(visualCaption);
    const captionSourceHash = createPetVisionCaptionSourceHash({
      captionRevision: visualConfig.captionRevision,
      modelUri: visualConfig.modelUri,
      assetId: "asset-velvet",
      spritesheetSha256: "a".repeat(64),
    });
    const queryEmbedding = vi.fn(async () => Array(256).fill(0.1));
    const findSimilar = vi.fn(async (input: { modelRevision: string }) =>
      input.modelRevision === revision
        ? [
            {
              slug: "orbit-otter",
              sourceHash: createPetSearchSourceHash(catalog[1], revision),
              score: 0.9,
            },
          ]
        : [
            {
              slug: "velvet-byte",
              sourceHash: createPetVisualEmbeddingSourceHash({
                visualRevision: visualConfig.visualRevision,
                captionRevision: visualConfig.captionRevision,
                captionSourceHash,
                captionText,
              }),
              score: 0.95,
            },
          ],
    );
    const runtime = createApprovedPetSearchRuntime(
      dependencies({
        config: {
          mode: "hybrid",
          semantic: semanticConfig,
          fallbackReason: null,
          visualMode: "shadow",
          visual: visualConfig,
          visualFallbackReason: null,
        },
        embeddingClient: {
          ...dependencies().embeddingClient,
          embedQuery: queryEmbedding,
        },
        findSimilar,
        listCaptions: vi.fn(async () => [
          {
            slug: "velvet-byte",
            sourceHash: captionSourceHash,
            captionJson: JSON.stringify(
              createPetVisionCaptionEnvelope({
                assetId: "asset-velvet",
                spritesheetSha256: "a".repeat(64),
                caption: visualCaption,
              }),
            ),
            captionText,
            updatedAt: "2026-07-22T12:00:00.000Z",
          },
        ]),
      }),
    );

    await expect(runtime.searchApprovedPets({ q: "unrelated" })).resolves.toMatchObject({
      pets: [catalog[1]],
      mode: "hybrid",
      visualMode: "shadow",
      visualFallbackReason: null,
      visualCandidateCount: 1,
    });
    expect(queryEmbedding).toHaveBeenCalledTimes(1);
    expect(findSimilar).toHaveBeenCalledTimes(2);
  });

  it("keeps text-hybrid results when visual storage fails", async () => {
    const runtime = createApprovedPetSearchRuntime(
      dependencies({
        config: {
          ...dependencies().config,
          visualMode: "hybrid",
          visual: {
            folderId: "folder-1",
            apiKey: "secret",
            captionRevision: PET_VISION_CAPTION_REVISION,
            visualRevision: PET_VISUAL_MODEL_REVISION,
            dimensions: 256,
            profile: { minSemanticScore: 0.9, weight: 0.5 },
            visionTimeoutMs: 30_000,
            modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
          },
        },
        findSimilar: async ({ modelRevision }: { modelRevision: string }) => {
          if (modelRevision === PET_VISUAL_MODEL_REVISION) {
            throw new Error("visual table unavailable");
          }
          return [
            {
              slug: "orbit-otter",
              sourceHash: createPetSearchSourceHash(catalog[1], revision),
              score: 0.9,
            },
          ];
        },
      }),
    );

    await expect(runtime.searchApprovedPets({ q: "unrelated" })).resolves.toMatchObject({
      pets: [catalog[1]],
      mode: "hybrid",
      fallbackReason: null,
      visualFallbackReason: "visual_vector_search_error",
    });
  });

  it("keeps text-hybrid results when caption lookup or parsing fails", async () => {
    const visual = {
      folderId: "folder-1",
      apiKey: "secret",
      captionRevision: PET_VISION_CAPTION_REVISION,
      visualRevision: PET_VISUAL_MODEL_REVISION,
      dimensions: 256,
      profile: { minSemanticScore: 0.9, weight: 0.5 },
      visionTimeoutMs: 30_000,
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
    } as const;
    const findSimilar = async ({ modelRevision }: { modelRevision: string }) =>
      modelRevision === revision
        ? [
            {
              slug: "orbit-otter",
              sourceHash: createPetSearchSourceHash(catalog[1], revision),
              score: 0.9,
            },
          ]
        : [
            {
              slug: "velvet-byte",
              sourceHash: "visual-source-hash",
              score: 0.95,
            },
          ];
    const config = {
      ...dependencies().config,
      visualMode: "hybrid" as const,
      visual,
    };
    const lookupRuntime = createApprovedPetSearchRuntime(
      dependencies({
        config,
        findSimilar,
        listCaptions: async () => {
          throw new Error("caption table unavailable");
        },
      }),
    );
    await expect(lookupRuntime.searchApprovedPets({ q: "unrelated" }))
      .resolves.toMatchObject({
        pets: [catalog[1]],
        mode: "hybrid",
        visualFallbackReason: "visual_caption_lookup_error",
      });

    const invalidRuntime = createApprovedPetSearchRuntime(
      dependencies({
        config,
        findSimilar,
        listCaptions: async () => [
          {
            slug: "velvet-byte",
            sourceHash: "caption-source-hash",
            captionJson: "{}",
            captionText: "not canonical",
            updatedAt: "2026-07-22T12:00:00.000Z",
          },
        ],
      }),
    );
    await expect(invalidRuntime.searchApprovedPets({ q: "unrelated" }))
      .resolves.toMatchObject({
        pets: [catalog[1]],
        mode: "hybrid",
        visualFallbackReason: "visual_caption_invalid",
      });
  });
});

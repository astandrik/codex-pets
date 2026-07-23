import { describe, expect, it, vi } from "vitest";

import { PET_SEARCH_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { createPetSearchSourceHash } from "@/lib/pets/search-embeddings";
import { createApprovedPetSearchRuntime } from "@/lib/pets/search-runtime";
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
  },
  {
    slug: "orbit-otter",
    displayName: "Orbit Otter",
    description: "A friendly space helper",
    kind: "creature" as const,
    tags: ["space", "friendly"],
    ownerName: "Bob",
    status: "approved" as ApprovalStatus,
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
    getMetadata: vi.fn(async () => null),
    upsert: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("approved pet search runtime", () => {
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
});

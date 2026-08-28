import { describe, expect, it, vi } from "vitest";

import {
  createPetSearchService,
  PetSearchFallbackError,
  type PetSearchCatalogItem,
} from "@/lib/pets/search-service";

const catalog: PetSearchCatalogItem[] = [
  {
    slug: "velvet-byte",
    displayName: "Velvet Byte",
    description: "A confident gothic coding character",
    kind: "character",
    tags: ["gothic", "night"],
    ownerName: "Alice",
  },
  {
    slug: "orbit-otter",
    displayName: "Orbit Otter",
    description: "A friendly space helper",
    kind: "creature",
    tags: ["space", "friendly"],
    ownerName: "Bob",
    publicAuthorEmail: "orbit+public@example.com",
  },
  {
    slug: "terminal-cube",
    displayName: "Terminal Cube",
    description: "A green shell companion",
    kind: "object",
    tags: ["terminal", "green"],
    ownerName: "Alice",
  },
];

describe("approved pet search service", () => {
  it("keeps newest-first order for an empty query and applies explicit filters", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "hybrid",
    });

    const result = await search({ kind: "character", tags: ["gothic"] });

    expect(result.pets).toEqual([catalog[0]]);
    expect(result.mode).toBe("lexical");
    expect(result.total).toBe(1);
  });

  it("returns an offset page while keeping the full filtered total", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "lexical",
    });

    const result = await search({ offset: 1, limit: 1 });

    expect(result.pets).toEqual([catalog[1]]);
    expect(result.total).toBe(3);
  });

  it("keeps one ranking version across offset slices", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "lexical",
    });

    const firstPage = await search({ offset: 0, limit: 1 });
    const secondPage = await search({ offset: 1, limit: 1 });

    expect(firstPage.pets).toEqual([catalog[0]]);
    expect(secondPage.pets).toEqual([catalog[1]]);
    expect(firstPage.rankingVersion).toBe(secondPage.rankingVersion);
    expect(firstPage.rankingVersion).toEqual(expect.any(String));
  });

  it("changes the ranking version when semantic search falls back", async () => {
    const hybridSearch = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [{ slug: "orbit-otter", score: 0.9 }],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "hybrid",
      minSemanticScore: 0.5,
    });
    const fallbackSearch = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => {
        throw new PetSearchFallbackError("timeout");
      },
      mode: "hybrid",
      minSemanticScore: 0.5,
    });

    const hybrid = await hybridSearch({ q: "space" });
    const fallback = await fallbackSearch({ q: "space" });

    expect(hybrid.pets).toEqual(fallback.pets);
    expect(hybrid.mode).toBe("hybrid");
    expect(fallback.mode).toBe("lexical_fallback");
    expect(hybrid.rankingVersion).not.toBe(fallback.rankingVersion);
  });

  it("uses a provided catalog without calling the default catalog loader", async () => {
    const listApprovedPets = vi.fn(async () => {
      throw new Error("default catalog loader should not run");
    });
    const search = createPetSearchService({
      listApprovedPets,
      semanticSearch: async () => ({
        text: [],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "lexical",
    });

    const result = await search({ q: "space" }, { catalog });

    expect(result.pets).toEqual([catalog[1]]);
    expect(listApprovedPets).not.toHaveBeenCalled();
  });

  it("uses lexical relevance and respects author and limit", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "lexical",
    });

    const result = await search({ q: "terminal", author: "ali", limit: 1 });

    expect(result.pets).toEqual([catalog[2]]);
    expect(result.total).toBe(1);
    expect(result.mode).toBe("lexical");
  });

  it("matches the verified public email in the explicit author filter", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "lexical",
    });

    const result = await search({ author: "orbit+public@example.com" });

    expect(result.pets).toEqual([catalog[1]]);
    expect(result.total).toBe(1);
  });

  it("adds semantic-only candidates in hybrid mode", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [
          { slug: "velvet-byte", score: 0.87 },
          { slug: "terminal-cube", score: 0.2 },
        ],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "hybrid",
      minSemanticScore: 0.5,
    });

    const result = await search({ q: "sexy" });

    expect(result.pets).toEqual([catalog[0]]);
    expect(result.mode).toBe("hybrid");
    expect(result.fallbackReason).toBeNull();
  });

  it("computes semantic candidates but returns lexical order in shadow mode", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [{ slug: "velvet-byte", score: 0.87 }],
        visual: [],
        visualFallbackReason: null,
      }),
      mode: "shadow",
    });

    const result = await search({ q: "space" });

    expect(result.pets).toEqual([catalog[1]]);
    expect(result.mode).toBe("shadow");
  });

  it("falls back to lexical results when semantic retrieval fails", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => {
        throw new Error("provider timeout");
      },
      mode: "hybrid",
    });

    const result = await search({ q: "space" });

    expect(result.pets).toEqual([catalog[1]]);
    expect(result.mode).toBe("lexical_fallback");
    expect(result.fallbackReason).toBe("semantic_error");
  });

  it("preserves aggregate semantic fallback reasons without exposing queries", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => {
        throw new PetSearchFallbackError("timeout");
      },
      mode: "hybrid",
    });

    const result = await search({ q: "space" });

    expect(result.mode).toBe("lexical_fallback");
    expect(result.fallbackReason).toBe("timeout");
  });

  it("does not call semantic retrieval for queries shorter than three characters", async () => {
    let semanticCalls = 0;
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => {
        semanticCalls += 1;
        return { text: [], visual: [], visualFallbackReason: null };
      },
      mode: "hybrid",
    });

    await search({ q: "ot" });

    expect(semanticCalls).toBe(0);
  });

  it("passes the hard-filtered catalog to semantic retrieval", async () => {
    let semanticCandidates: readonly PetSearchCatalogItem[] = [];
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async (_query, candidates) => {
        semanticCandidates = candidates;
        return { text: [], visual: [], visualFallbackReason: null };
      },
      mode: "hybrid",
    });

    await search({ q: "coding", kind: "object", author: "alice" });

    expect(semanticCandidates).toEqual([catalog[2]]);
  });

  it("applies visual ranks only when both base and visual modes are hybrid", async () => {
    const semanticSearch = async () => ({
      text: [{ slug: "orbit-otter", score: 0.9 }],
      visual: [{ slug: "velvet-byte", score: 0.95 }],
      visualFallbackReason: null,
    });
    const textOnly = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch,
      mode: "hybrid",
      minSemanticScore: 0.5,
      visualMode: "shadow",
      visualProfile: { minSemanticScore: 0.9, weight: 0.5 },
    });
    const combined = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch,
      mode: "hybrid",
      minSemanticScore: 0.5,
      visualMode: "hybrid",
      visualProfile: { minSemanticScore: 0.9, weight: 0.5 },
    });

    expect((await textOnly({ q: "unrelated" })).pets).toEqual([catalog[1]]);
    expect((await combined({ q: "unrelated" })).pets).toEqual([
      catalog[1],
      catalog[0],
    ]);
  });

  it("preserves text-hybrid order and diagnostics on visual failure or missing calibration", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => ({
        text: [{ slug: "orbit-otter", score: 0.9 }],
        visual: [],
        visualFallbackReason: "visual_caption_lookup_error",
      }),
      mode: "hybrid",
      minSemanticScore: 0.5,
      visualMode: "hybrid",
      visualProfile: null,
      configuredVisualFallbackReason: "visual_calibration_missing",
    });

    await expect(search({ q: "unrelated" })).resolves.toMatchObject({
      pets: [catalog[1]],
      mode: "hybrid",
      fallbackReason: null,
      visualMode: "hybrid",
      visualFallbackReason: "visual_caption_lookup_error",
      visualCandidateCount: 0,
    });
  });

  it.each([
    ["lexical", "off", []],
    ["lexical", "shadow", []],
    ["lexical", "hybrid", []],
    ["shadow", "off", []],
    ["shadow", "shadow", []],
    ["shadow", "hybrid", []],
    ["hybrid", "off", ["orbit-otter"]],
    ["hybrid", "shadow", ["orbit-otter"]],
    ["hybrid", "hybrid", ["orbit-otter", "velvet-byte"]],
  ] as const)(
    "keeps the %s × %s mode ordering contract",
    async (mode, visualMode, expectedSlugs) => {
      const search = createPetSearchService({
        listApprovedPets: async () => catalog,
        semanticSearch: async () => ({
          text: [{ slug: "orbit-otter", score: 0.9 }],
          visual: [{ slug: "velvet-byte", score: 0.95 }],
          visualFallbackReason: null,
        }),
        mode,
        minSemanticScore: 0.5,
        visualMode,
        visualProfile: { minSemanticScore: 0.9, weight: 0.5 },
      });

      const result = await search({ q: "unrelated" });

      expect(result.pets.map((pet) => pet.slug)).toEqual(expectedSlugs);
      expect(result.visualMode).toBe(visualMode);
    },
  );
});

import { describe, expect, it } from "vitest";

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
      semanticSearch: async () => [],
      mode: "hybrid",
    });

    const result = await search({ kind: "character", tags: ["gothic"] });

    expect(result.pets).toEqual([catalog[0]]);
    expect(result.mode).toBe("lexical");
    expect(result.total).toBe(1);
  });

  it("uses lexical relevance and respects author and limit", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => [],
      mode: "lexical",
    });

    const result = await search({ q: "terminal", author: "ali", limit: 1 });

    expect(result.pets).toEqual([catalog[2]]);
    expect(result.total).toBe(1);
    expect(result.mode).toBe("lexical");
  });

  it("adds semantic-only candidates in hybrid mode", async () => {
    const search = createPetSearchService({
      listApprovedPets: async () => catalog,
      semanticSearch: async () => [
        { slug: "velvet-byte", score: 0.87 },
        { slug: "terminal-cube", score: 0.2 },
      ],
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
      semanticSearch: async () => [{ slug: "velvet-byte", score: 0.87 }],
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
        return [];
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
        return [];
      },
      mode: "hybrid",
    });

    await search({ q: "coding", kind: "object", author: "alice" });

    expect(semanticCandidates).toEqual([catalog[2]]);
  });
});

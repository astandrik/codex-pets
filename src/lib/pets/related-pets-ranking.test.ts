import { describe, expect, it } from "vitest";

import { embeddingToBuffer } from "@/lib/pets/search-embeddings";
import {
  cosineSimilarity,
  decodeRelatedPetVector,
  fuseRelatedPetRankings,
  fuseRelatedPetRankingsWithDiagnostics,
  fuseRelatedPetTextMetadataBaseline,
  rankRelatedPetVectorMatches,
  rankRelatedPets,
  rankRelatedPetsWithDiagnostics,
  RELATED_PETS_SEMANTIC_FALLBACK_VISUAL_WEIGHT,
  type StoredRelatedPetVector,
} from "@/lib/pets/related-pets-ranking";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import {
  CURRENT_RELATED_PETS_RANKING_PROFILE,
  RELATED_PETS_V8_CALIBRATION_PROFILE,
  isCurrentRelatedPetsRankingRevision,
} from "@/lib/pets/related-pets-profile";

const EXPECTED_VECTOR = {
  modelRevision: "text-v2",
  dimensions: 2,
  sourceHash: "current-source",
} as const;

function storedVector(
  overrides: Partial<StoredRelatedPetVector> = {},
): StoredRelatedPetVector {
  return {
    slug: "pet-a",
    modelRevision: EXPECTED_VECTOR.modelRevision,
    dimensions: EXPECTED_VECTOR.dimensions,
    sourceHash: EXPECTED_VECTOR.sourceHash,
    embedding: embeddingToBuffer([3, 4]),
    ...overrides,
  };
}

describe("related pet vector validation", () => {
  it("decodes the existing little-endian FloatVector representation", () => {
    expect(decodeRelatedPetVector(storedVector(), EXPECTED_VECTOR)).toEqual([
      3, 4,
    ]);
  });

  it.each([
    ["row revision", { modelRevision: "stale-text" }],
    ["row dimensions", { dimensions: 3 }],
    ["source hash", { sourceHash: "stale-source" }],
  ])("rejects a vector with a stale %s", (_field, overrides) => {
    expect(
      decodeRelatedPetVector(storedVector(overrides), EXPECTED_VECTOR),
    ).toBeNull();
  });

  it.each([
    ["missing marker", Buffer.alloc(8)],
    [
      "wrong marker",
      Buffer.from([...embeddingToBuffer([3, 4]).subarray(0, -1), 0x02]),
    ],
    ["wrong byte length", embeddingToBuffer([3])],
    ["non-finite value", embeddingToBuffer([Number.NaN, 4])],
  ])("rejects a vector with %s", (_failure, embedding) => {
    expect(
      decodeRelatedPetVector(storedVector({ embedding }), EXPECTED_VECTOR),
    ).toBeNull();
  });

  it("rejects a finite zero-norm vector at the decoder boundary", () => {
    expect(
      decodeRelatedPetVector(
        storedVector({ embedding: embeddingToBuffer([0, 0]) }),
        EXPECTED_VECTOR,
      ),
    ).toBeNull();
  });

  it("rejects an empty vector at the decoder boundary", () => {
    const emptyVector = {
      ...EXPECTED_VECTOR,
      dimensions: 0,
    };

    expect(
      decodeRelatedPetVector(
        storedVector({
          dimensions: 0,
          embedding: Buffer.from([0x01]),
        }),
        emptyVector,
      ),
    ).toBeNull();
  });
});

describe("related pet cosine similarity", () => {
  it("computes cosine for compatible finite vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 1])).toBeCloseTo(
      1 / Math.sqrt(2),
    );
  });

  it("clamps Float32 rounding drift to the cosine range", () => {
    const left = Array.from({ length: 768 }, (_, index) =>
      Math.fround(((index % 17) - 8) / 7),
    );
    const scale = Math.fround(2.1);
    const parallel = left.map((value) => Math.fround(value * scale));
    const antiparallel = left.map((value) =>
      Math.fround(value * -scale),
    );

    expect(cosineSimilarity(left, parallel)).toBe(1);
    expect(cosineSimilarity(left, antiparallel)).toBe(-1);
  });

  it.each([
    [[0, 0], [1, 1]],
    [[1, 1], [0, 0]],
    [[Number.NaN, 1], [1, 1]],
    [[1, 1], [Number.POSITIVE_INFINITY, 1]],
    [[Number.MAX_VALUE, Number.MAX_VALUE], [Number.MAX_VALUE, 1]],
    [[1], [1, 1]],
  ])("omits unsafe similarity for %j and %j", (left, right) => {
    expect(cosineSimilarity(left, right)).toBeNull();
  });
});

function candidate(
  slug: string,
  overrides: Partial<RelatedPetCandidate> = {},
): RelatedPetCandidate {
  return {
    slug,
    displayName: slug,
    kind: "creature",
    tags: [],
    description: slug,
    approvedAt: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("related pet weighted RRF", () => {
  it("lets visual evidence boost a strong text peer above the text leader", () => {
    const ranked = fuseRelatedPetRankings({
      sourceSlug: "source",
      metadataSlugs: ["text-leader", "visual-boost", "fill-a", "fill-b"],
      textMatches: [
        { slug: "text-leader", score: 0.99 },
        { slug: "visual-boost", score: 0.98 },
      ],
      visualMatches: [{ slug: "visual-boost", score: 0.97 }],
      textMinSimilarity: 0.5,
      visualMinSimilarity: 0.5,
      visualWeight: 0.75,
    });

    expect(ranked.slice(0, 2)).toEqual(["visual-boost", "text-leader"]);
  });

  it("ignores missing modalities without changing metadata-only order", () => {
    expect(
      fuseRelatedPetRankings({
        sourceSlug: "source",
        metadataSlugs: ["third", "first", "second"],
        textMatches: [],
        visualMatches: [],
        textMinSimilarity: 0.5,
        visualMinSimilarity: 0.5,
        visualWeight: 0.5,
      }),
    ).toEqual(["third", "first", "second"]);
  });

  it("preserves metadata order when all semantic vectors are absent", () => {
    const result = fuseRelatedPetRankingsWithDiagnostics({
      sourceSlug: "source",
      metadataSlugs: ["metadata-first", "tagged-second"],
      sharedTagCounts: { "tagged-second": 1 },
      textMatches: [],
      visualMatches: [],
      textMinSimilarity: 0.5,
      visualMinSimilarity: 0.5,
      visualWeight: 0.5,
    });

    expect(result.slugs).toEqual(["metadata-first", "tagged-second"]);
    expect(result.diagnostics.map(({ tier }) => tier)).toEqual([
      "metadata_fallback",
      "qualified",
    ]);
  });

  it("rejects a text threshold outside the cosine range", () => {
    expect(() =>
      fuseRelatedPetRankings({
        sourceSlug: "source",
        metadataSlugs: ["peer"],
        textMatches: [{ slug: "peer", score: 1 }],
        textMinSimilarity: 1 + Number.EPSILON,
        visualMinSimilarity: null,
        visualWeight: 0,
      }),
    ).toThrow(/text.*similarity.*\[-1, 1\]/i);
  });

  it("skips visual contribution explicitly when its threshold is null", () => {
    expect(
      fuseRelatedPetRankings({
        sourceSlug: "source",
        metadataSlugs: ["metadata-first", "visual-peer"],
        textMatches: [],
        visualMatches: [{ slug: "visual-peer", score: 0.99 }],
        textMinSimilarity: 0.5,
        visualMinSimilarity: null,
        visualWeight: 0.75,
      }),
    ).toEqual(["metadata-first", "visual-peer"]);
  });

  it("removes duplicate, unknown, and self matches before fusion", () => {
    expect(
      fuseRelatedPetRankings({
        sourceSlug: "source",
        metadataSlugs: ["peer", "fill"],
        textMatches: [
          { slug: "source", score: 1 },
          { slug: "peer", score: 0.9 },
          { slug: "peer", score: 0.8 },
          { slug: "unknown", score: 0.99 },
        ],
        visualMatches: [],
        textMinSimilarity: 0.5,
        visualMinSimilarity: 0.5,
        visualWeight: 0.5,
      }),
    ).toEqual(["peer", "fill"]);
  });

  it("never returns more than eight candidates when a larger limit is requested", () => {
    expect(
      fuseRelatedPetRankings({
        sourceSlug: "source",
        metadataSlugs: [
          "one",
          "two",
          "three",
          "four",
          "five",
          "six",
          "seven",
          "eight",
          "nine",
        ],
        textMatches: [],
        visualMatches: [],
        textMinSimilarity: 0.5,
        visualMinSimilarity: 0.5,
        visualWeight: 0.25,
        limit: 9,
      }),
    ).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ]);
  });
});

describe("related pet ranking", () => {
  it("keeps visual-only look-alikes below thematic candidates in v8", () => {
    const input = {
      sourceSlug: "dracula",
      metadataSlugs: ["theme-peer", "visual-lookalike", "text-tail"],
      sharedTagCounts: { "theme-peer": 1 },
      textMatches: [
        { slug: "theme-peer", score: 0.49 },
        { slug: "text-tail", score: 0.48 },
        { slug: "visual-lookalike", score: 0.2 },
      ],
      visualMatches: [
        { slug: "visual-lookalike", score: 0.99 },
        { slug: "theme-peer", score: 0.4 },
      ],
      textMinSimilarity: 0.5,
      visualMinSimilarity: 0.8,
      visualWeight: 0.5,
    } as const;

    const legacy = fuseRelatedPetRankingsWithDiagnostics({
      ...input,
      strategy: "legacy-v7",
    });
    const themeFirst = fuseRelatedPetRankingsWithDiagnostics({
      ...input,
      strategy: "theme-first-v8",
    });

    expect(legacy.slugs[0]).toBe("visual-lookalike");
    expect(themeFirst.slugs).toEqual([
      "theme-peer",
      "text-tail",
      "visual-lookalike",
    ]);
    expect(themeFirst.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "theme-peer",
          tier: "qualified",
          sharedTagCount: 1,
          passesTextThreshold: false,
          passesVisualThreshold: false,
        }),
        expect.objectContaining({
          slug: "visual-lookalike",
          tier: "semantic_backfill",
          passesVisualThreshold: true,
          contributions: { metadata: 0, text: 1 / 63, visual: 0 },
        }),
      ]),
    );
  });

  it("ignores operational tags when v8 computes thematic overlap", () => {
    const source = candidate("source", {
      tags: ["gothic", "cc0", "source-github"],
    });
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates: [
        source,
        candidate("operational-peer", {
          tags: ["cc0", "source-github"],
          approvedAt: "2026-08-01T00:00:00.000Z",
        }),
        candidate("theme-peer", {
          tags: ["gothic", "license-mit", "v2"],
          approvedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      textQueryVectors: new Map([["source", [1, 0]]]),
      textDocumentVectors: new Map([
        ["operational-peer", [0, 1]],
        ["theme-peer", [0, 1]],
      ]),
      profile: {
        strategy: "theme-first-v8",
        textMinSimilarity: 0.5,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
    });

    expect(result.slugs).toEqual(["theme-peer", "operational-peer"]);
    expect(result.diagnostics.map(({ sharedTagCount }) => sharedTagCount)).toEqual([
      1, 0,
    ]);
  });

  it("uses kind and date only to break equal v8 tag scores", () => {
    const result = fuseRelatedPetRankingsWithDiagnostics({
      sourceSlug: "source",
      metadataSlugs: ["same-kind-newer", "other-kind-older"],
      sharedTagCounts: {
        "same-kind-newer": 1,
        "other-kind-older": 1,
      },
      textMatches: [],
      visualMatches: [],
      strategy: "theme-first-v8",
      textMinSimilarity: 0.5,
      visualMinSimilarity: null,
      visualWeight: 0,
    });

    expect(result.slugs).toEqual(["same-kind-newer", "other-kind-older"]);
    expect(result.diagnostics[0]).toMatchObject({
      sharedTagRank: 1,
      contributions: { metadata: 0.15 / 61, text: 0, visual: 0 },
    });
    expect(result.diagnostics[1]).toMatchObject({
      sharedTagRank: 1,
      contributions: { metadata: 0.15 / 61, text: 0, visual: 0 },
    });
  });

  it("omits self, zero-norm, and non-finite vector similarities", () => {
    expect(
      rankRelatedPetVectorMatches(
        "source",
        new Map([
          ["source", [1, 0]],
          ["good", [1, 1]],
          ["zero", [0, 0]],
          ["corrupt", [Number.NaN, 1]],
        ]),
      ),
    ).toEqual([{ slug: "good", score: 1 / Math.sqrt(2) }]);
  });

  it("ranks a source query vector against candidate document vectors", () => {
    expect(
      rankRelatedPetVectorMatches(
        "source",
        new Map([["source", [1, 0]]]),
        new Map([
          ["source", [0, 1]],
          ["semantic-peer", [1, 0]],
          ["other", [0, 1]],
        ]),
      ),
    ).toEqual([
      { slug: "semantic-peer", score: 1 },
      { slug: "other", score: 0 },
    ]);
  });

  it("keeps the text-plus-metadata evaluation baseline thresholded", () => {
    const input = {
      sourceSlug: "source",
      metadataSlugs: ["other", "peer"],
      textMatches: [{ slug: "peer", score: 0.8 }],
    } as const;

    expect(
      fuseRelatedPetTextMetadataBaseline({
        ...input,
        textMinSimilarity: 0.9,
      }),
    ).toEqual(["other", "peer"]);
    expect(
      fuseRelatedPetTextMetadataBaseline({
        ...input,
        textMinSimilarity: 0.8,
      }),
    ).toEqual(["peer", "other"]);
  });

  it("places semantic and shared-tag candidates before pure fallback", () => {
    const result = fuseRelatedPetRankingsWithDiagnostics({
      sourceSlug: "source",
      metadataSlugs: ["pure-fallback", "tag-peer", "semantic-peer"],
      sharedTagCounts: { "tag-peer": 1 },
      textMatches: [
        { slug: "semantic-peer", score: 0.9 },
        { slug: "pure-fallback", score: 0.4 },
      ],
      textMinSimilarity: 0.5,
      visualMinSimilarity: null,
      visualWeight: 0,
    });

    expect(result.slugs).toEqual([
      "semantic-peer",
      "tag-peer",
      "pure-fallback",
    ]);
    expect(result.diagnostics.map(({ tier }) => tier)).toEqual([
      "qualified",
      "qualified",
      "semantic_backfill",
    ]);
    expect(result.diagnostics[2]).toMatchObject({
      metadataRank: 1,
      textRank: 2,
      contributions: {
        metadata: 0,
        text: 1 / 62,
        visual: 0,
      },
    });
  });

  it("ranks a semantic near-miss above a fresh same-kind fallback", () => {
    const source = candidate("source", { tags: ["shared"] });
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates: [
        source,
        candidate("tag-peer", { tags: ["shared"] }),
        candidate("fresh-same-kind", {
          approvedAt: "2026-08-01T00:00:00.000Z",
        }),
        candidate("semantic-near-miss", {
          kind: "character",
          approvedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      textQueryVectors: new Map([["source", [1, 0]]]),
      textDocumentVectors: new Map([
        ["semantic-near-miss", [0.49, Math.sqrt(1 - 0.49 ** 2)]],
        ["fresh-same-kind", [-1, 0]],
      ]),
      profile: {
        textMinSimilarity: 0.5,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
    });

    expect(result.slugs).toEqual([
      "tag-peer",
      "semantic-near-miss",
      "fresh-same-kind",
    ]);
    expect(result.diagnostics.slice(1).map(({ tier }) => tier)).toEqual([
      "semantic_backfill",
      "semantic_backfill",
    ]);
  });

  it("breaks equal semantic fallback scores only by slug", () => {
    const rank = (metadataSlugs: string[]) =>
      fuseRelatedPetRankings({
        sourceSlug: "source",
        metadataSlugs,
        textMatches: [
          { slug: "zeta", score: 0.4 },
          { slug: "alpha", score: 0.4 },
        ],
        textMinSimilarity: 0.5,
        visualMinSimilarity: null,
        visualWeight: 0,
      });

    expect(rank(["zeta", "alpha"])).toEqual(["alpha", "zeta"]);
    expect(rank(["alpha", "zeta"])).toEqual(["alpha", "zeta"]);
  });

  it("uses the pinned visual weight for semantic fallback", () => {
    const result = fuseRelatedPetRankingsWithDiagnostics({
      sourceSlug: "source",
      metadataSlugs: ["visual-near-miss"],
      textMatches: [],
      visualMatches: [{ slug: "visual-near-miss", score: 0.4 }],
      textMinSimilarity: 0.5,
      visualMinSimilarity: 0.5,
      visualWeight: 0.75,
    });

    expect(RELATED_PETS_SEMANTIC_FALLBACK_VISUAL_WEIGHT).toBe(0.5);
    expect(result.diagnostics[0]).toMatchObject({
      tier: "semantic_backfill",
      contributions: {
        metadata: 0,
        text: 0,
        visual: 0.5 / 61,
      },
    });
  });

  it("handles text-only, visual-only, and missing modalities deterministically", () => {
    const base = {
      sourceSlug: "source",
      metadataSlugs: ["zeta", "alpha"],
      textMinSimilarity: 0.5,
      visualWeight: 0.5,
    } as const;

    expect(
      fuseRelatedPetRankings({
        ...base,
        textMatches: [{ slug: "zeta", score: 0.9 }],
        visualMinSimilarity: null,
      }),
    ).toEqual(["zeta", "alpha"]);
    expect(
      fuseRelatedPetRankings({
        ...base,
        textMatches: [],
        visualMatches: [{ slug: "alpha", score: 0.9 }],
        visualMinSimilarity: 0.5,
      }),
    ).toEqual(["alpha", "zeta"]);
    expect(
      fuseRelatedPetRankings({
        ...base,
        textMatches: [],
        visualMatches: [],
        visualMinSimilarity: 0.5,
      }),
    ).toEqual(["zeta", "alpha"]);
  });

  it("returns eight unique known candidates and excludes self and duplicate rows", () => {
    const source = candidate("source");
    const candidates = [
      source,
      ...Array.from({ length: 8 }, (_, index) => candidate(`peer-${index}`)),
      candidate("peer-0"),
    ];
    const ranked = rankRelatedPets({
      source,
      candidates,
      textQueryVectors: new Map([["source", [1, 0]]]),
      textDocumentVectors: new Map([
        ...candidates.map(({ slug }, index) => [
          slug,
          [1, index / 10 + 0.1],
        ] as const),
        ["deleted-or-unknown", [1, 0]] as const,
      ]),
      profile: {
        textMinSimilarity: 0.5,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
      limit: 8,
    });

    expect(ranked).toHaveLength(8);
    expect(new Set(ranked).size).toBe(8);
    expect(ranked).not.toContain("source");
    expect(ranked).not.toContain("deleted-or-unknown");
  });
});

describe("related pet ranking profile", () => {
  it("binds compatibility to the depth-8 v7 semantic-tail profile", () => {
    expect(CURRENT_RELATED_PETS_RANKING_PROFILE).toMatchObject({
      rankingRevision:
        "related-pets-rrf60-v7:depth=8:tail=semantic:cal=related-pets-eval-groups-v2:text=yandex-text-embeddings-v2-768-2026-07:text-query=yandex-text-embeddings-v2-768-related-tags-query-2026-08:visual=yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1",
      textRevision: "yandex-text-embeddings-v2-768-2026-07",
      textQueryRevision:
        "yandex-text-embeddings-v2-768-related-tags-query-2026-08",
      textDimensions: 768,
      textMinSimilarity: 0.4523258982119597,
      visualRevision:
        "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1",
      visualDimensions: 768,
      visualMinSimilarity: 0.7573239783550058,
      visualWeight: 0.5,
    });
    expect(
      isCurrentRelatedPetsRankingRevision(
        CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision,
      ),
    ).toBe(true);
    expect(isCurrentRelatedPetsRankingRevision("related-pets-stale")).toBe(
      false,
    );
    expect(RELATED_PETS_V8_CALIBRATION_PROFILE).toMatchObject({
      strategy: "theme-first-v8",
      textQueryRevision:
        "yandex-text-embeddings-v2-768-related-theme-query-2026-08-v2",
      textDimensions: 768,
      visualDimensions: 768,
      visualMinSimilarity: null,
      visualWeight: 0,
    });
    expect(
      isCurrentRelatedPetsRankingRevision(
        RELATED_PETS_V8_CALIBRATION_PROFILE.rankingRevision,
      ),
    ).toBe(false);
  });
});

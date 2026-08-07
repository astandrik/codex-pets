import { describe, expect, it } from "vitest";

import { embeddingToBuffer } from "@/lib/pets/search-embeddings";
import {
  cosineSimilarity,
  decodeRelatedPetVector,
  fuseRelatedPetRankings,
  rankRelatedPetVectorMatches,
  rankRelatedPets,
  sortRelatedPetScores,
  type StoredRelatedPetVector,
} from "@/lib/pets/related-pets-ranking";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import {
  CURRENT_RELATED_PETS_RANKING_PROFILE,
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

  it("breaks equal fused scores by metadata position and then slug", () => {
    expect(
      sortRelatedPetScores(
        [
          { slug: "zeta", score: 1 },
          { slug: "metadata-first", score: 1 },
          { slug: "alpha", score: 1 },
        ],
        ["metadata-first"],
      ).map(({ slug }) => slug),
    ).toEqual(["metadata-first", "alpha", "zeta"]);
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

  it("keeps the current top four unchanged when ranking eight", () => {
    const source = candidate("source", { tags: ["shared"] });
    const input = {
      source,
      candidates: [
        source,
        candidate("vector-peer"),
        candidate("tag-peer", { tags: ["shared"] }),
        candidate("newer"),
        candidate("older", {
          approvedAt: "2026-05-01T00:00:00.000Z",
        }),
        candidate("tag-peer", { tags: ["shared"] }),
        candidate("sixth", { approvedAt: "2026-04-04T00:00:00.000Z" }),
        candidate("seventh", { approvedAt: "2026-04-03T00:00:00.000Z" }),
        candidate("eighth", { approvedAt: "2026-04-02T00:00:00.000Z" }),
        candidate("ninth", { approvedAt: "2026-04-01T00:00:00.000Z" }),
      ],
      textQueryVectors: new Map([["source", [1, 0]]]),
      textDocumentVectors: new Map([
        ["source", [1, 0]],
        ["vector-peer", [1, 0]],
      ]),
      profile: {
        textMinSimilarity: 0.5,
        visualMinSimilarity: 0.5,
        visualWeight: 0.25,
      },
    };
    const top4 = rankRelatedPets({ ...input, limit: 4 });
    const top8 = rankRelatedPets({ ...input, limit: 8 });

    expect(top4).toEqual([
      "vector-peer",
      "tag-peer",
      "newer",
      "older",
    ]);
    expect(top8.slice(0, 4)).toEqual(top4);
    expect(top8).toHaveLength(8);
    expect(new Set(top8).size).toBe(8);
  });
});

describe("related pet ranking profile", () => {
  it("binds compatibility to the depth-8 v6 query, text, and visual revisions", () => {
    expect(CURRENT_RELATED_PETS_RANKING_PROFILE).toMatchObject({
      rankingRevision:
        "related-pets-rrf60-v6:depth=8:cal=related-pets-eval-groups-v2:text=yandex-text-embeddings-v2-768-2026-07:text-query=yandex-text-embeddings-v2-768-related-tags-query-2026-08:visual=yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1",
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
  });
});

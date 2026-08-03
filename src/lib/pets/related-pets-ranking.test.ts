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
});

describe("related pet cosine similarity", () => {
  it("computes cosine for compatible finite vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 1])).toBeCloseTo(
      1 / Math.sqrt(2),
    );
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

  it("reuses metadata ordering, removes duplicate candidates, and fills to four", () => {
    const source = candidate("source", { tags: ["shared"] });
    const ranked = rankRelatedPets({
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
      ],
      textVectors: new Map([
        ["source", [1, 0]],
        ["vector-peer", [1, 0]],
      ]),
      profile: {
        textMinSimilarity: 0.5,
        visualMinSimilarity: 0.5,
        visualWeight: 0.25,
      },
    });

    expect(ranked).toEqual([
      "vector-peer",
      "tag-peer",
      "newer",
      "older",
    ]);
    expect(new Set(ranked).size).toBe(4);
  });
});

describe("related pet ranking profile", () => {
  it("binds compatibility to the deployed v2 text and Qwen visual revisions", () => {
    expect(CURRENT_RELATED_PETS_RANKING_PROFILE).toMatchObject({
      textRevision: "yandex-text-embeddings-v2-768-2026-07",
      textDimensions: 768,
      textMinSimilarity: 0.28,
      visualRevision:
        "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1",
      visualDimensions: 768,
      visualMinSimilarity: 0.3574455678462982,
      visualWeight: 0.25,
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

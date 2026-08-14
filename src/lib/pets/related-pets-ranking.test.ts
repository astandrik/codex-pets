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
import { RELATED_PETS_V24_FALLBACK_POLICY_REVISION } from "@/lib/pets/related-pets-fallback-policy";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import {
  CURRENT_RELATED_PETS_RANKING_PROFILE,
  LEGACY_RELATED_PETS_V7_PROFILE,
  RELATED_PETS_V8_CALIBRATION_PROFILE,
  RELATED_PETS_V8_PROFILE,
  RELATED_PETS_V9_CALIBRATION_PROFILE,
  RELATED_PETS_V10_CALIBRATION_PROFILE,
  RELATED_PETS_V11_CALIBRATION_PROFILE,
  RELATED_PETS_V11_PROFILE,
  RELATED_PETS_V23_PROFILE,
  RELATED_PETS_V24_PROFILE,
  isCurrentRelatedPetsRankingRevision,
} from "@/lib/pets/related-pets-profile";
import { RELATED_PETS_V23_RELATION_POLICY_REVISION } from "@/lib/pets/related-pets-relation-policy";

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
  it("rejects a relation policy on a non-controlled strategy", () => {
    const source = candidate("source");
    expect(() => rankRelatedPetsWithDiagnostics({
      source,
      candidates: [source, candidate("peer")],
      profile: {
        strategy: "legacy-v7",
        relationPolicyRevision: RELATED_PETS_V23_RELATION_POLICY_REVISION,
        textMinSimilarity: 0.5,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
    })).toThrow(
      "Related-pets relation policies require the entity-controlled strategy.",
    );
  });

  it("rejects a fallback policy on a non-controlled strategy", () => {
    const source = candidate("source");
    expect(() => rankRelatedPetsWithDiagnostics({
      source,
      candidates: [source, candidate("peer")],
      profile: {
        strategy: "legacy-v7",
        fallbackPolicyRevision: RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
        textMinSimilarity: 0.5,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
    })).toThrow(
      "Related-pets fallback policies require the entity-controlled strategy.",
    );
  });

  it("promotes Primaris into the Warhammer franchise tier only under V23", () => {
    const source = candidate("master-of-terra");
    const candidates = [source, candidate("primaris")];
    const annotations = new Map([
      ["master-of-terra", annotation({ franchises: ["warhammer-40000"] })],
      ["primaris", annotation()],
    ]);
    const shared = {
      source,
      candidates,
      annotations,
      textQueryVectors: vectors({ "master-of-terra": [1, 0] }),
      textDocumentVectors: vectors({ primaris: [0, 1] }),
      annotationQueryVectors: vectors({ "master-of-terra": [1, 0] }),
      annotationDocumentVectors: vectors({ primaris: [0, 1] }),
      visualVectors: vectors({ "master-of-terra": [1, 0], primaris: [0, 1] }),
    };

    const v11 = rankRelatedPetsWithDiagnostics({
      ...shared,
      profile: v11Profile(),
    });
    const v23 = rankRelatedPetsWithDiagnostics({
      ...shared,
      profile: {
        ...v11Profile(),
        relationPolicyRevision: RELATED_PETS_V23_RELATION_POLICY_REVISION,
      },
    });

    expect(v11.diagnostics[0]).toMatchObject({
      slug: "primaris",
      tier: "controlled_fallback",
      matchedFacets: [],
    });
    expect(v23.diagnostics[0]).toMatchObject({
      slug: "primaris",
      tier: "franchise",
      matchedFacets: ["warhammer-40000"],
    });
  });

  it("applies the V23 franchise correction in both directions", () => {
    const source = candidate("primaris");
    const annotations = new Map([
      ["primaris", annotation()],
      ["master-of-terra", annotation({ franchises: ["warhammer-40000"] })],
      ["guardian", annotation({ franchises: ["destiny"] })],
    ]);
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates: [
        source,
        candidate("master-of-terra"),
        candidate("guardian"),
      ],
      textQueryVectors: vectors({ primaris: [1, 0] }),
      textDocumentVectors: vectors({
        "master-of-terra": [0, 1],
        guardian: [1, 0],
      }),
      annotationQueryVectors: vectors({ primaris: [1, 0] }),
      annotationDocumentVectors: vectors({
        "master-of-terra": [0, 1],
        guardian: [1, 0],
      }),
      visualVectors: vectors({
        primaris: [1, 0],
        "master-of-terra": [0, 1],
        guardian: [1, 0],
      }),
      annotations,
      profile: {
        ...v11Profile(),
        relationPolicyRevision: RELATED_PETS_V23_RELATION_POLICY_REVISION,
      },
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        slug: "master-of-terra",
        tier: "franchise",
        matchedFacets: ["warhammer-40000"],
      }),
      expect.objectContaining({
        slug: "guardian",
        tier: "conflict_fallback",
        franchiseConflict: true,
      }),
    ]);
  });

  it("orders V11 relation tiers before semantic and visual signals", () => {
    const source = candidate("vi");
    const peers = [
      source,
      candidate("arcane-peer"),
      candidate("semantic-peer"),
      candidate("visual-conflict"),
    ];
    const annotations = new Map([
      ["vi", annotation({ franchises: ["arcane"] })],
      ["arcane-peer", annotation({ franchises: ["arcane"] })],
      ["semantic-peer", annotation()],
      ["visual-conflict", annotation({ franchises: ["final-fantasy"] })],
    ]);
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates: peers,
      textQueryVectors: vectors({ vi: [1, 0] }),
      textDocumentVectors: vectors({
        "arcane-peer": [0.7, 0.3],
        "semantic-peer": [1, 0],
        "visual-conflict": [0, 1],
      }),
      annotationQueryVectors: vectors({ vi: [1, 0] }),
      annotationDocumentVectors: vectors({
        "arcane-peer": [0.7, 0.3],
        "semantic-peer": [1, 0],
        "visual-conflict": [0, 1],
      }),
      visualVectors: vectors({
        vi: [1, 0],
        "arcane-peer": [0, 1],
        "semantic-peer": [0.8, 0.2],
        "visual-conflict": [1, 0],
      }),
      annotations,
      profile: v11Profile(),
    });

    expect(result.slugs).toEqual([
      "arcane-peer",
      "semantic-peer",
      "visual-conflict",
    ]);
    expect(result.diagnostics.map(({ tier }) => tier)).toEqual([
      "franchise",
      "semantic_safe",
      "conflict_fallback",
    ]);
    expect(result.diagnostics[2]).toMatchObject({
      passesVisualThreshold: true,
      contributions: { visual: 0 },
      franchiseConflict: true,
      fallbackProvenance: "conflict_contract",
    });
  });

  it("uses V11 visual evidence only to reorder an existing tier", () => {
    const source = candidate("source");
    const annotations = new Map([
      ["source", annotation({ collections: ["soviet-animation"] })],
      ["text-first", annotation({ collections: ["soviet-animation"] })],
      ["visual-first", annotation({ collections: ["soviet-animation"] })],
    ]);
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates: [source, candidate("text-first"), candidate("visual-first")],
      textQueryVectors: vectors({ source: [1, 0] }),
      textDocumentVectors: vectors({
        "text-first": [1, 0],
        "visual-first": [0.9, 0.1],
      }),
      annotationQueryVectors: vectors({ source: [1, 0] }),
      annotationDocumentVectors: vectors({
        "text-first": [1, 0],
        "visual-first": [0.9, 0.1],
      }),
      visualVectors: vectors({
        source: [1, 0],
        "text-first": [0, 1],
        "visual-first": [1, 0],
      }),
      annotations,
      profile: { ...v11Profile(), visualWeight: 1 },
    });

    expect(result.slugs).toEqual(["visual-first", "text-first"]);
    expect(result.diagnostics.every(({ tier }) =>
      tier === "franchise_family_collection"
    )).toBe(true);
  });

  it("orders V11 fallback by description before annotation similarity", () => {
    const source = candidate("source");
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates: [
        source,
        candidate("description-first"),
        candidate("annotation-first"),
      ],
      textQueryVectors: vectors({ source: [1, 0] }),
      textDocumentVectors: vectors({
        "description-first": [0.8, 0.6],
        "annotation-first": [0.6, 0.8],
      }),
      annotationQueryVectors: vectors({ source: [1, 0] }),
      annotationDocumentVectors: vectors({
        "description-first": [0.6, 0.8],
        "annotation-first": [0.8, 0.6],
      }),
      annotations: new Map([
        ["source", annotation()],
        ["description-first", annotation()],
        ["annotation-first", annotation()],
      ]),
      profile: {
        ...v11Profile(),
        textMinSimilarity: 0.9,
        annotationMinSimilarity: 0.9,
      },
    });

    expect(result.slugs).toEqual(["description-first", "annotation-first"]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slug: "description-first",
        tier: "controlled_fallback",
        fallbackProvenance: "description_then_annotation",
      }),
    ]));
  });

  it("rescues a zero-qualified source by shared topic, kind, and visual order", () => {
    const source = candidate("source", {
      kind: "character",
      tags: ["man", "office", "chibi"],
    });
    const candidates = [
      source,
      candidate("text-only", { kind: "character" }),
      candidate("visual-only", { kind: "character" }),
      candidate("same-kind-low-visual", {
        kind: "character",
        tags: ["man"],
      }),
      candidate("same-kind-high-visual", {
        kind: "character",
        tags: ["man"],
      }),
      candidate("other-kind-high-visual", {
        kind: "creature",
        tags: ["man"],
      }),
    ];
    const shared = {
      source,
      candidates,
      annotations: new Map(candidates.map(({ slug }) => [slug, annotation()])),
      precomputedMatches: {
        text: [
          { slug: "text-only", score: 0.79 },
          { slug: "visual-only", score: 0.78 },
          { slug: "same-kind-low-visual", score: 0.3 },
          { slug: "same-kind-high-visual", score: 0.2 },
          { slug: "other-kind-high-visual", score: 0.1 },
        ],
        annotation: candidates.slice(1).map(({ slug }) => ({ slug, score: 0.2 })),
        visual: [
          { slug: "visual-only", score: 0.99 },
          { slug: "other-kind-high-visual", score: 0.98 },
          { slug: "same-kind-high-visual", score: 0.9 },
          { slug: "same-kind-low-visual", score: 0.4 },
          { slug: "text-only", score: 0.1 },
        ],
      },
    };

    const v23 = rankRelatedPetsWithDiagnostics({
      ...shared,
      profile: v11Profile(),
    });
    const v24 = rankRelatedPetsWithDiagnostics({
      ...shared,
      profile: {
        ...v11Profile(),
        fallbackPolicyRevision: RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
      },
    });

    expect(v23.slugs).toEqual([
      "text-only",
      "visual-only",
      "same-kind-low-visual",
      "same-kind-high-visual",
      "other-kind-high-visual",
    ]);
    expect(v24.slugs).toEqual([
      "same-kind-high-visual",
      "same-kind-low-visual",
      "other-kind-high-visual",
      "text-only",
      "visual-only",
    ]);
    expect(v24.diagnostics.slice(0, 3)).toEqual([
      expect.objectContaining({
        slug: "same-kind-high-visual",
        sharedTagCount: 1,
        fallbackProvenance: "shared_topics_kind_visual_description",
      }),
      expect.objectContaining({
        slug: "same-kind-low-visual",
        sharedTagCount: 1,
        fallbackProvenance: "shared_topics_kind_visual_description",
      }),
      expect.objectContaining({
        slug: "other-kind-high-visual",
        sharedTagCount: 1,
        fallbackProvenance: "shared_topics_kind_visual_description",
      }),
    ]);
  });

  it("fails closed for an unknown sparse fallback revision", () => {
    const source = candidate("source");
    expect(() => rankRelatedPetsWithDiagnostics({
      source,
      candidates: [source, candidate("peer")],
      annotations: new Map([
        ["source", annotation()],
        ["peer", annotation()],
      ]),
      profile: {
        ...v11Profile(),
        fallbackPolicyRevision: "related-pets-sparse-fallback-unknown",
      },
    })).toThrow("Unsupported related-pets fallback policy revision.");
  });

  it("does not rescue a zero-qualified source by generic topic tags", () => {
    const source = candidate("source", {
      tags: ["girl", "anime", "chibi", "detailed"],
    });
    const candidates = [
      source,
      candidate("text-first"),
      candidate("generic-tag", { tags: ["girl", "anime", "chibi"] }),
    ];
    const shared = {
      source,
      candidates,
      annotations: new Map(candidates.map(({ slug }) => [slug, annotation()])),
      precomputedMatches: {
        text: [
          { slug: "text-first", score: 0.79 },
          { slug: "generic-tag", score: 0.1 },
        ],
        annotation: [
          { slug: "text-first", score: 0.2 },
          { slug: "generic-tag", score: 0.2 },
        ],
        visual: [
          { slug: "generic-tag", score: 0.99 },
          { slug: "text-first", score: 0.1 },
        ],
      },
    };

    const v23 = rankRelatedPetsWithDiagnostics({
      ...shared,
      profile: v11Profile(),
    });
    const v24 = rankRelatedPetsWithDiagnostics({
      ...shared,
      profile: {
        ...v11Profile(),
        fallbackPolicyRevision: RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
      },
    });

    expect(v24).toEqual(v23);
    expect(v24.diagnostics.find(({ slug }) => slug === "generic-tag"))
      .toMatchObject({ sharedTagCount: 0 });
  });

  it("does not activate sparse rescue when any candidate qualifies", () => {
    const source = candidate("source", { tags: ["man"] });
    const candidates = [
      source,
      candidate("qualified"),
      candidate("shared-tag", { tags: ["man"] }),
    ];
    const shared = {
      source,
      candidates,
      annotations: new Map(candidates.map(({ slug }) => [slug, annotation()])),
      precomputedMatches: {
        text: [
          { slug: "qualified", score: 0.9 },
          { slug: "shared-tag", score: 0.2 },
        ],
        annotation: [
          { slug: "qualified", score: 0.9 },
          { slug: "shared-tag", score: 0.2 },
        ],
        visual: [
          { slug: "shared-tag", score: 0.99 },
          { slug: "qualified", score: 0.1 },
        ],
      },
    };
    const v23 = rankRelatedPetsWithDiagnostics({
      ...shared,
      profile: v11Profile(),
    });
    const v24 = rankRelatedPetsWithDiagnostics({
      ...shared,
      profile: {
        ...v11Profile(),
        fallbackPolicyRevision: RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
      },
    });

    expect(v24.slugs).toEqual(v23.slugs);
    expect(v24.diagnostics.find(({ slug }) => slug === "shared-tag"))
      .toMatchObject({
        sharedTagCount: 1,
        sharedTagRank: null,
        fallbackProvenance: "description_then_annotation",
      });
  });

  it("does not rescue a franchise-conflicting tag match", () => {
    const source = candidate("source", { tags: ["man"] });
    const candidates = [
      source,
      candidate("controlled-tail"),
      candidate("conflicting-tag", { tags: ["man"] }),
    ];
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates,
      annotations: new Map([
        ["source", annotation({ franchises: ["source-world"] })],
        ["controlled-tail", annotation()],
        ["conflicting-tag", annotation({ franchises: ["other-world"] })],
      ]),
      precomputedMatches: {
        text: [
          { slug: "conflicting-tag", score: 0.79 },
          { slug: "controlled-tail", score: 0.2 },
        ],
        annotation: candidates.slice(1).map(({ slug }) => ({ slug, score: 0.2 })),
        visual: [
          { slug: "conflicting-tag", score: 0.99 },
          { slug: "controlled-tail", score: 0.1 },
        ],
      },
      profile: {
        ...v11Profile(),
        fallbackPolicyRevision: RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
      },
    });

    expect(result.slugs).toEqual(["controlled-tail", "conflicting-tag"]);
    expect(result.diagnostics[1]).toMatchObject({
      tier: "conflict_fallback",
      sharedTagCount: 1,
      sharedTagRank: null,
      fallbackProvenance: "conflict_contract",
    });
  });

  it("lets only text similarity qualify v9 candidates", () => {
    const input = {
      sourceSlug: "source",
      metadataSlugs: [
        "tag-only",
        "visual-only",
        "qualified",
        "text-tail",
      ],
      sharedTagCounts: { "tag-only": 2, qualified: 1 },
      textMatches: [
        { slug: "qualified", score: 0.9 },
        { slug: "text-tail", score: 0.7 },
        { slug: "tag-only", score: 0.2 },
        { slug: "visual-only", score: 0.1 },
      ],
      visualMatches: [
        { slug: "visual-only", score: 0.99 },
        { slug: "qualified", score: 0.9 },
      ],
      textMinSimilarity: 0.8,
      visualMinSimilarity: 0.8,
      visualWeight: 0.5,
    } as const;

    const v8 = fuseRelatedPetRankingsWithDiagnostics({
      ...input,
      strategy: "theme-first-v8",
    });
    const v9 = fuseRelatedPetRankingsWithDiagnostics({
      ...input,
      strategy: "text-first-v9",
    });

    expect(v8.diagnostics.find(({ slug }) => slug === "tag-only")?.tier)
      .toBe("qualified");
    expect(v9.slugs).toEqual([
      "qualified",
      "text-tail",
      "tag-only",
      "visual-only",
    ]);
    expect(v9.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "qualified",
          tier: "qualified",
          textSimilarity: 0.9,
          visualSimilarity: 0.9,
          textMinSimilarity: 0.8,
          visualMinSimilarity: 0.8,
          passesTextThreshold: true,
          passesVisualThreshold: true,
          contributions: {
            metadata: 0.15 / 62,
            text: 1 / 61,
            visual: 0.5 / 62,
          },
        }),
        expect.objectContaining({
          slug: "tag-only",
          tier: "semantic_backfill",
          contributions: { metadata: 0, text: 1 / 63, visual: 0 },
        }),
        expect.objectContaining({
          slug: "visual-only",
          tier: "semantic_backfill",
          contributions: { metadata: 0, text: 1 / 64, visual: 0 },
        }),
      ]),
    );
  });

  it("requires both description and topic while keeping V10 fallback text-only", () => {
    const result = fuseRelatedPetRankingsWithDiagnostics({
      sourceSlug: "source",
      metadataSlugs: [
        "topic-only",
        "visual-only",
        "qualified",
        "description-only",
      ],
      sharedTagCounts: { "topic-only": 2, qualified: 1 },
      textMatches: [
        { slug: "qualified", score: 0.95 },
        { slug: "description-only", score: 0.9 },
        { slug: "topic-only", score: 0.2 },
        { slug: "visual-only", score: 0.1 },
      ],
      topicMatches: [
        { slug: "topic-only", score: 0.99 },
        { slug: "qualified", score: 0.9 },
        { slug: "description-only", score: 0.2 },
        { slug: "visual-only", score: 0.1 },
      ],
      visualMatches: [
        { slug: "visual-only", score: 0.99 },
        { slug: "qualified", score: 0.9 },
      ],
      strategy: "description-theme-v10",
      textMinSimilarity: 0.8,
      topicMinSimilarity: 0.8,
      topicWeight: 0.2,
      metadataWeight: 0.05,
      visualMinSimilarity: 0.8,
      visualWeight: 0.5,
    });

    expect(result.slugs).toEqual([
      "qualified",
      "description-only",
      "topic-only",
      "visual-only",
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "qualified",
          tier: "qualified",
          passesTextThreshold: true,
          passesTopicThreshold: true,
          passesVisualThreshold: true,
          contributions: {
            metadata: 0.05 / 62,
            text: 1 / 61,
            topic: 0.2 / 62,
            visual: 0.5 / 62,
          },
        }),
        expect.objectContaining({
          slug: "description-only",
          tier: "semantic_backfill",
          passesTextThreshold: true,
          passesTopicThreshold: false,
          contributions: { metadata: 0, text: 1 / 62, visual: 0 },
        }),
        expect.objectContaining({
          slug: "topic-only",
          tier: "semantic_backfill",
          passesTextThreshold: false,
          passesTopicThreshold: true,
          contributions: { metadata: 0, text: 1 / 63, visual: 0 },
        }),
        expect.objectContaining({
          slug: "visual-only",
          tier: "semantic_backfill",
          passesVisualThreshold: true,
          contributions: { metadata: 0, text: 1 / 64, visual: 0 },
        }),
      ]),
    );
  });

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

  it("keeps generic v9 tags as weak bonuses but removes detail markers", () => {
    const source = candidate("source", {
      tags: ["girl", "anime", "chibi", "detailed", "detaiiled"],
    });
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates: [
        source,
        candidate("detail-only", { tags: ["detailed", "detaiiled"] }),
        candidate("generic-peer", { tags: ["girl"] }),
      ],
      textQueryVectors: new Map([["source", [1, 0]]]),
      textDocumentVectors: new Map([
        ["detail-only", [0, 1]],
        ["generic-peer", [0, 1]],
      ]),
      profile: {
        strategy: "text-first-v9",
        textMinSimilarity: 0.5,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
    });

    expect(
      result.diagnostics.find(({ slug }) => slug === "detail-only"),
    ).toMatchObject({ sharedTagCount: 0, tier: "semantic_backfill" });
    expect(
      result.diagnostics.find(({ slug }) => slug === "generic-peer"),
    ).toMatchObject({ sharedTagCount: 1, tier: "semantic_backfill" });
  });

  it("uses only filtered topics for the V10 shared-tag bonus", () => {
    const source = candidate("source", {
      tags: ["girl", "anime", "chibi", "detailed", "gothic"],
    });
    const result = rankRelatedPetsWithDiagnostics({
      source,
      candidates: [
        source,
        candidate("generic-peer", { tags: ["girl", "anime", "chibi"] }),
        candidate("topic-peer", { tags: ["gothic"] }),
      ],
      textQueryVectors: new Map([["source", [1, 0]]]),
      textDocumentVectors: new Map([
        ["generic-peer", [1, 0]],
        ["topic-peer", [1, 0]],
      ]),
      topicQueryVectors: new Map([["source", [1, 0]]]),
      topicDocumentVectors: new Map([
        ["generic-peer", [1, 0]],
        ["topic-peer", [1, 0]],
      ]),
      profile: {
        strategy: "description-theme-v10",
        textMinSimilarity: 0.5,
        topicMinSimilarity: 0.5,
        topicWeight: 0.1,
        metadataWeight: 0.05,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
    });

    expect(result.slugs).toEqual(["topic-peer", "generic-peer"]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "topic-peer", sharedTagCount: 1 }),
        expect.objectContaining({ slug: "generic-peer", sharedTagCount: 0 }),
      ]),
    );
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

function annotation(overrides: Partial<{
  entity: string | null;
  franchises: string[];
  franchiseFamilies: string[];
  collections: string[];
  specificArchetypes: string[];
}> = {}) {
  return {
    schemaVersion: 1 as const,
    entity: null,
    aliases: [],
    franchises: [],
    franchiseFamilies: [],
    collections: [],
    specificArchetypes: [],
    themes: [],
    mediaOrigins: [],
    ...overrides,
  };
}

function vectors(values: Record<string, readonly number[]>) {
  return new Map(Object.entries(values));
}

function v11Profile() {
  return {
    strategy: "entity-controlled-v11" as const,
    textMinSimilarity: 0.8,
    annotationMinSimilarity: 0.8,
    annotationWeight: 0.5,
    visualMinSimilarity: 0.8,
    visualWeight: 0.5,
  };
}

describe("related pet ranking profile", () => {
  it("activates v23 while retaining the pinned v7, v8, and v11 profiles", () => {
    expect(LEGACY_RELATED_PETS_V7_PROFILE).toMatchObject({
      rankingRevision:
        "related-pets-rrf60-v7:depth=8:tail=semantic:cal=related-pets-eval-groups-v2:text=yandex-text-embeddings-v2-768-2026-07:text-query=yandex-text-embeddings-v2-768-related-tags-query-2026-08:visual=yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1",
      strategy: "legacy-v7",
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
    expect(RELATED_PETS_V8_PROFILE).toMatchObject({
      strategy: "theme-first-v8",
      textMinSimilarity: 0.45777065618272195,
      visualMinSimilarity: 0.7431592921968864,
      visualWeight: 0.75,
    });
    expect(
      isCurrentRelatedPetsRankingRevision(
        RELATED_PETS_V8_PROFILE.rankingRevision,
      ),
    ).toBe(false);
    expect(RELATED_PETS_V9_CALIBRATION_PROFILE).toMatchObject({
      strategy: "text-first-v9",
      embeddingRevision: "yandex-text-embeddings-v2-768-2026-07",
      textRevision:
        "yandex-text-embeddings-v2-768-related-description-document-2026-08-v1",
      textQueryRevision:
        "yandex-text-embeddings-v2-768-related-description-query-2026-08-v3",
      textDimensions: 768,
      visualMinSimilarity: null,
      visualWeight: 0,
    });
    expect(RELATED_PETS_V10_CALIBRATION_PROFILE).toMatchObject({
      strategy: "description-theme-v10",
      textRevision:
        "yandex-text-embeddings-v2-768-related-description-document-2026-08-v1",
      textQueryRevision:
        "yandex-text-embeddings-v2-768-related-description-query-2026-08-v3",
      topicRevision:
        "yandex-text-embeddings-v2-768-related-topic-document-2026-08-v10",
      topicQueryRevision:
        "yandex-text-embeddings-v2-768-related-topic-query-2026-08-v10",
      topicDimensions: 768,
      topicWeight: 0.1,
      metadataWeight: 0.05,
      visualMinSimilarity: null,
      visualWeight: 0,
    });
    expect(RELATED_PETS_V11_CALIBRATION_PROFILE).toMatchObject({
      strategy: "entity-controlled-v11",
      textMinSimilarity: 0,
      annotationMinSimilarity: 0,
      annotationWeight: 0.25,
      visualMinSimilarity: null,
      visualWeight: 0,
      rankingRevision: expect.stringContaining(":candidate"),
    });
    expect(RELATED_PETS_V11_PROFILE).toMatchObject({
      strategy: "entity-controlled-v11",
      textMinSimilarity: 0.6167421023517932,
      annotationMinSimilarity: 0.4133420129086638,
      annotationWeight: 1,
      visualMinSimilarity: 0.8178749331551675,
      visualWeight: 0.25,
    });
    expect(RELATED_PETS_V11_PROFILE.rankingRevision).not.toContain(
      ":candidate",
    );
    expect(RELATED_PETS_V23_PROFILE).toMatchObject({
      strategy: "entity-controlled-v11",
      relationPolicyRevision: RELATED_PETS_V23_RELATION_POLICY_REVISION,
    });
    expect(RELATED_PETS_V23_PROFILE.rankingRevision).not.toContain(
      ":candidate",
    );
    expect(RELATED_PETS_V23_PROFILE.rankingRevision).toContain(
      RELATED_PETS_V11_PROFILE.rankingRevision,
    );
    expect(RELATED_PETS_V24_PROFILE).toMatchObject({
      strategy: "entity-controlled-v11",
      relationPolicyRevision: RELATED_PETS_V23_RELATION_POLICY_REVISION,
      fallbackPolicyRevision: RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
    });
    expect(RELATED_PETS_V24_PROFILE.rankingRevision).toContain(
      RELATED_PETS_V23_PROFILE.rankingRevision,
    );
    expect(CURRENT_RELATED_PETS_RANKING_PROFILE).toBe(
      RELATED_PETS_V23_PROFILE,
    );
    expect(
      isCurrentRelatedPetsRankingRevision(
        CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision,
      ),
    ).toBe(true);
    expect(
      isCurrentRelatedPetsRankingRevision(
        LEGACY_RELATED_PETS_V7_PROFILE.rankingRevision,
      ),
    ).toBe(false);
  });
});

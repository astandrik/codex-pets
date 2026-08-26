import { describe, expect, it } from "vitest";

import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import { embeddingToBuffer } from "@/lib/pets/search-embeddings";
import { RELATED_PETS_V24_FALLBACK_POLICY_REVISION } from "@/lib/pets/related-pets-fallback-policy";
import {
  RELATED_PETS_V24_PROFILE,
  RELATED_PETS_V24_RANKING_REVISION,
} from "@/lib/pets/related-pets-profile";
import {
  cosineSimilarityV24,
  decodeRelatedPetV24Vector,
  rankRelatedPetV24VectorMatches,
  rankRelatedPetsV24,
  rankRelatedPetsV24WithDiagnostics,
  type RelatedPetsV24PrecomputedMatches,
  type RelatedPetsV24RankingProfile,
  type StoredRelatedPetV24Vector,
} from "@/lib/pets/related-pets-ranking";
import { RELATED_PETS_V24_RELATION_POLICY_REVISION } from "@/lib/pets/related-pets-relation-policy";

const PROFILE: RelatedPetsV24RankingProfile = {
  strategy: "sparse-fallback-v24",
  relationPolicyRevision: RELATED_PETS_V24_RELATION_POLICY_REVISION,
  fallbackPolicyRevision: RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
  textMinSimilarity: 0.8,
  annotationMinSimilarity: 0.8,
  annotationWeight: 0.5,
  visualMinSimilarity: 0.8,
  visualWeight: 0.5,
};

const EXPECTED_RANKING_REVISION =
  "related-pets-sparse-fallback-v24:depth=8:base=related-pets-franchise-coverage-v23:depth=8:base=related-pets-entity-controlled-v11-r3:depth=8:tail=description-first:gate=qualified-negatives:cal=related-pets-eval-v7:text-min=0.6167421023517932:annotation-min=0.4133420129086638:annotation-weight=1:visual-min=0.8178749331551675:visual-weight=0.25:description=yandex-text-embeddings-v2-768-related-description-document-2026-08-v1:description-query=yandex-text-embeddings-v2-768-related-description-query-2026-08-v3:annotation=yandex-qwen3.6-35b-a3b-related-annotation-2026-08-v11-r11:annotation-proposal=yandex-qwen3.6-35b-a3b-related-annotation-proposal-2026-08-v11-r1:annotation-document=yandex-text-embeddings-v2-768-related-annotation-document-2026-08-v11-r11:annotation-query=yandex-text-embeddings-v2-768-related-annotation-query-2026-08-v11-r11:visual=yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1:relation-policy=related-pets-relation-policy-2026-08-v23-r1:fallback-policy=related-pets-zero-qualified-empty-top4-shared-topic-visual-v24-r2";

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

function lowMatches(slugs: readonly string[]): RelatedPetsV24PrecomputedMatches {
  return {
    text: slugs.map((slug, index) => ({ slug, score: 0.7 - index / 100 })),
    annotation: slugs.map((slug, index) => ({
      slug,
      score: 0.7 - index / 100,
    })),
    visual: slugs.map((slug, index) => ({ slug, score: 0.9 - index / 100 })),
  };
}

function pollutedMatches(
  sourceSlug: string,
  duplicateSlug: string,
  invalidScore: number,
  matches: RelatedPetsV24PrecomputedMatches["text"],
): RelatedPetsV24PrecomputedMatches["text"] {
  return [
    { slug: "unknown", score: 1 },
    { slug: sourceSlug, score: 1 },
    { slug: duplicateSlug, score: invalidScore },
    ...matches,
    { slug: duplicateSlug, score: 0.1 },
  ];
}

describe("V24 vector helpers", () => {
  const expected = {
    modelRevision: "text-v2",
    dimensions: 2,
    sourceHash: "current-source",
  } as const;

  function storedVector(
    overrides: Partial<StoredRelatedPetV24Vector> = {},
  ): StoredRelatedPetV24Vector {
    return {
      slug: "pet-a",
      modelRevision: expected.modelRevision,
      dimensions: expected.dimensions,
      sourceHash: expected.sourceHash,
      embedding: embeddingToBuffer([3, 4]),
      ...overrides,
    };
  }

  it("decodes only current finite non-zero vectors", () => {
    expect(decodeRelatedPetV24Vector(storedVector(), expected)).toEqual([3, 4]);
    expect(decodeRelatedPetV24Vector(
      storedVector({ sourceHash: "stale" }),
      expected,
    )).toBeNull();
    expect(decodeRelatedPetV24Vector(
      storedVector({ embedding: embeddingToBuffer([0, 0]) }),
      expected,
    )).toBeNull();
  });

  it("computes bounded cosine similarity and independent query/document rank", () => {
    expect(cosineSimilarityV24([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarityV24([0, 0], [1, 0])).toBeNull();
    expect(rankRelatedPetV24VectorMatches(
      "source",
      new Map([["source", [1, 0]]]),
      new Map([["far", [0, 1]], ["near", [1, 0]]]),
    )).toEqual([{ slug: "near", score: 1 }, { slug: "far", score: 0 }]);
  });
});

describe("V24 related-pet ranking", () => {
  it("prioritizes entity, franchise, controlled relation, and semantic tiers", () => {
    const source = candidate("source");
    const candidates = [
      source,
      candidate("semantic"),
      candidate("archetype"),
      candidate("collection"),
      candidate("franchise"),
      candidate("entity"),
    ];
    const slugs = candidates.slice(1).map(({ slug }) => slug);
    const result = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations: new Map([
        ["source", annotation({
          entity: "hero",
          franchises: ["world"],
          collections: ["gothic"],
          specificArchetypes: ["warrior"],
        })],
        ["entity", annotation({ entity: "hero" })],
        ["franchise", annotation({ franchises: ["world"] })],
        ["collection", annotation({ collections: ["gothic"] })],
        ["archetype", annotation({ specificArchetypes: ["warrior"] })],
        ["semantic", annotation()],
      ]),
      precomputedMatches: {
        text: slugs.map((slug) => ({ slug, score: 0.9 })),
        annotation: slugs.map((slug) => ({ slug, score: 0.9 })),
        visual: slugs.map((slug) => ({ slug, score: 0.9 })),
      },
      profile: PROFILE,
    });

    expect(result.slugs).toEqual([
      "entity",
      "franchise",
      "collection",
      "archetype",
      "semantic",
    ]);
  });

  it("applies the current franchise relation override", () => {
    const source = candidate("primaris");
    const result = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates: [source, candidate("master-of-terra")],
      annotations: new Map([
        ["primaris", annotation()],
        ["master-of-terra", annotation({ franchises: ["warhammer-40000"] })],
      ]),
      precomputedMatches: lowMatches(["master-of-terra"]),
      profile: PROFILE,
    });

    expect(result.diagnostics[0]).toMatchObject({
      tier: "franchise",
      matchedFacets: ["warhammer-40000"],
    });
  });

  it("does not let visual-only similarity qualify a candidate", () => {
    const source = candidate("source");
    const result = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates: [source, candidate("semantic"), candidate("visual-only")],
      annotations: new Map([
        ["source", annotation()],
        ["semantic", annotation()],
        ["visual-only", annotation()],
      ]),
      precomputedMatches: {
        text: [
          { slug: "semantic", score: 0.9 },
          { slug: "visual-only", score: 0.1 },
        ],
        annotation: [
          { slug: "semantic", score: 0.9 },
          { slug: "visual-only", score: 0.1 },
        ],
        visual: [
          { slug: "visual-only", score: 1 },
          { slug: "semantic", score: 0.8 },
        ],
      },
      profile: PROFILE,
    });

    expect(result.slugs).toEqual(["semantic", "visual-only"]);
    expect(result.diagnostics[1]).toMatchObject({
      tier: "controlled_fallback",
      passesVisualThreshold: true,
    });
  });

  it("preserves Tigran's sparse-fallback top eight", () => {
    const source = candidate("tigran", { kind: "character", tags: ["man"] });
    const expected = [
      "leon",
      "johnny",
      "grey-pilgrim-3",
      "gordon-freeman",
      "ovi",
      "gigachad-2",
      "jedi-blue-lightsaber",
      "gandalf-the-white-2",
    ];
    const decoys = ["text-a", "text-b", "text-c", "text-d"];
    const candidates = [
      source,
      ...decoys.map((slug) => candidate(slug)),
      ...expected.map((slug) => candidate(slug, {
        kind: "character",
        tags: ["man"],
      })),
    ];
    const result = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations: new Map(candidates.map(({ slug }) => [slug, annotation()])),
      precomputedMatches: {
        text: [
          ...decoys.map((slug, index) => ({ slug, score: 0.79 - index / 100 })),
          ...expected.map((slug, index) => ({ slug, score: 0.3 - index / 100 })),
        ],
        annotation: candidates.slice(1).map(({ slug }) => ({ slug, score: 0.2 })),
        visual: [
          ...expected.map((slug, index) => ({ slug, score: 0.79 - index / 100 })),
          ...decoys.map((slug, index) => ({ slug, score: 0.1 - index / 100 })),
        ],
      },
      profile: PROFILE,
    });

    expect(result.slugs).toEqual(expected);
    expect(result.qualifiedCount).toBe(0);
    expect(result.diagnostics.every(({ fallbackProvenance }) =>
      fallbackProvenance === "shared_topics_kind_visual_description"
    )).toBe(true);
  });

  it("keeps eight unique known results without a self-link", () => {
    const source = candidate("source");
    const peers = Array.from({ length: 8 }, (_, index) => candidate(`peer-${index}`));
    const matches = peers.map(({ slug }, index) => ({
      slug,
      score: 0.95 - index / 100,
    }));
    const ranked = rankRelatedPetsV24({
      source,
      candidates: [source, ...peers, candidate("peer-0")],
      annotations: new Map(
        [source, ...peers].map(({ slug }) => [slug, annotation()]),
      ),
      precomputedMatches: {
        text: [...matches, { slug: "unknown", score: 1 }],
        annotation: matches,
        visual: matches,
      },
      profile: PROFILE,
    });

    expect(ranked).toHaveLength(8);
    expect(new Set(ranked).size).toBe(8);
    expect(ranked).not.toContain("source");
    expect(ranked).not.toContain("unknown");
  });

  it("normalizes modality matches to finite unique candidates before ranking", () => {
    const source = candidate("source");
    const candidates = [source, candidate("a"), candidate("b")];
    const annotations = new Map(candidates.map(({ slug }) => [
      slug,
      annotation({ entity: "same-entity" }),
    ]));
    const cleanMatches: RelatedPetsV24PrecomputedMatches = {
      text: [
        { slug: "a", score: 0.9 },
        { slug: "b", score: 0.9 },
      ],
      annotation: [
        { slug: "b", score: 0.9 },
        { slug: "a", score: 0.9 },
      ],
      visual: [
        { slug: "a", score: 0.9 },
        { slug: "b", score: 0.9 },
      ],
    };
    const profile = {
      ...PROFILE,
      annotationWeight: 0.9,
      visualMinSimilarity: null,
      visualWeight: 0,
    };
    const clean = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations,
      precomputedMatches: cleanMatches,
      profile,
    });
    const polluted = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations,
      precomputedMatches: {
        text: pollutedMatches("source", "a", Number.NaN, cleanMatches.text),
        annotation: pollutedMatches(
          "source",
          "b",
          Number.POSITIVE_INFINITY,
          cleanMatches.annotation,
        ),
        visual: pollutedMatches(
          "source",
          "a",
          Number.NEGATIVE_INFINITY,
          cleanMatches.visual,
        ),
      },
      profile,
    });

    expect(clean.slugs).toEqual(["a", "b"]);
    expect(polluted).toEqual(clean);
  });

  it("canonicalizes unsorted finite duplicates by their maximum score", () => {
    const source = candidate("source");
    const candidates = [source, candidate("a"), candidate("b")];
    const annotations = new Map(candidates.map(({ slug }) => [
      slug,
      annotation({ entity: "same-entity" }),
    ]));
    const canonical: RelatedPetsV24PrecomputedMatches = {
      text: [{ slug: "a", score: 0.9 }, { slug: "b", score: 0.8 }],
      annotation: [{ slug: "a", score: 0.9 }, { slug: "b", score: 0.8 }],
      visual: [{ slug: "a", score: 0.9 }, { slug: "b", score: 0.8 }],
    };
    const expected = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations,
      precomputedMatches: canonical,
      profile: PROFILE,
    });
    const actual = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations,
      precomputedMatches: {
        text: [
          { slug: "b", score: 0.8 },
          { slug: "a", score: 0.1 },
          { slug: "a", score: 0.9 },
        ],
        annotation: [
          { slug: "b", score: 0.8 },
          { slug: "a", score: 0.9 },
          { slug: "b", score: 0.2 },
        ],
        visual: [
          { slug: "a", score: 0.2 },
          { slug: "b", score: 0.8 },
          { slug: "a", score: 0.9 },
        ],
      },
      profile: PROFILE,
    });

    expect(actual).toEqual(expected);
  });

  it("rejects precomputed cosine scores outside the valid range", () => {
    const source = candidate("source");
    const candidates = [source, candidate("a"), candidate("b"), candidate("c")];
    const annotations = new Map(candidates.map(({ slug }) => [
      slug,
      annotation({ entity: "same-entity" }),
    ]));
    const cleanModality = [
      { slug: "b", score: 0.9 },
      { slug: "a", score: 0.85 },
    ];
    const clean = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations,
      precomputedMatches: {
        text: cleanModality,
        annotation: cleanModality,
        visual: cleanModality,
      },
      profile: PROFILE,
    });
    const pollutedModality = [
      { slug: "a", score: 2 },
      { slug: "c", score: -2.5 },
      ...cleanModality,
    ];
    const polluted = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations,
      precomputedMatches: {
        text: pollutedModality,
        annotation: pollutedModality,
        visual: pollutedModality,
      },
      profile: PROFILE,
    });

    expect(clean.slugs).toEqual(["b", "a", "c"]);
    expect(polluted).toEqual(clean);
  });

  it("ignores all visual input when visual ranking is disabled", () => {
    const source = candidate("source", { tags: ["shared"] });
    const candidates = [
      source,
      candidate("a", { tags: ["shared"] }),
      candidate("b", { tags: ["shared"] }),
    ];
    const annotations = new Map(candidates.map(({ slug }) => [slug, annotation()]));
    const baseMatches = {
      text: [{ slug: "a", score: 0.7 }, { slug: "b", score: 0.7 }],
      annotation: [{ slug: "a", score: 0.7 }, { slug: "b", score: 0.7 }],
    };
    const profile = { ...PROFILE, visualMinSimilarity: null };
    const left = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations,
      precomputedMatches: {
        ...baseMatches,
        visual: [{ slug: "a", score: 0.99 }, { slug: "b", score: 0.1 }],
      },
      profile,
    });
    const right = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates,
      annotations,
      precomputedMatches: {
        ...baseMatches,
        visual: [{ slug: "b", score: 0.99 }, { slug: "a", score: 0.1 }],
      },
      profile,
    });

    expect(right).toEqual(left);
    expect(left.diagnostics.every((entry) =>
      entry.visualRank === null && entry.visualSimilarity === null
    )).toBe(true);
  });

  it("does not activate sparse fallback when a qualified candidate exists", () => {
    const source = candidate("source", { tags: ["shared"] });
    const qualified = candidate("qualified");
    const sharedFallback = candidate("shared-fallback", { tags: ["shared"] });
    const result = rankRelatedPetsV24WithDiagnostics({
      source,
      candidates: [source, qualified, sharedFallback],
      annotations: new Map([
        [source.slug, annotation()],
        [qualified.slug, annotation()],
        [sharedFallback.slug, annotation()],
      ]),
      precomputedMatches: {
        text: [
          { slug: qualified.slug, score: 0.9 },
          { slug: sharedFallback.slug, score: 0.7 },
        ],
        annotation: [
          { slug: qualified.slug, score: 0.9 },
          { slug: sharedFallback.slug, score: 0.7 },
        ],
        visual: [
          { slug: sharedFallback.slug, score: 0.99 },
          { slug: qualified.slug, score: 0.8 },
        ],
      },
      profile: PROFILE,
    });

    expect(result.slugs).toEqual([qualified.slug, sharedFallback.slug]);
    expect(result.diagnostics[1]).toMatchObject({
      slug: sharedFallback.slug,
      tier: "controlled_fallback",
      sparseFallbackRank: null,
      fallbackProvenance: "description_then_annotation",
    });
  });
});

describe("V24 profile contract", () => {
  it("preserves every persisted revision byte-for-byte", () => {
    expect(RELATED_PETS_V24_RANKING_REVISION).toBe(EXPECTED_RANKING_REVISION);
    expect(RELATED_PETS_V24_PROFILE).toMatchObject({
      strategy: "sparse-fallback-v24",
      rankingRevision: EXPECTED_RANKING_REVISION,
      textRevision:
        "yandex-text-embeddings-v2-768-related-description-document-2026-08-v1",
      textQueryRevision:
        "yandex-text-embeddings-v2-768-related-description-query-2026-08-v3",
      annotationRevision:
        "yandex-qwen3.6-35b-a3b-related-annotation-2026-08-v11-r11",
      annotationProposalRevision:
        "yandex-qwen3.6-35b-a3b-related-annotation-proposal-2026-08-v11-r1",
      annotationDocumentRevision:
        "yandex-text-embeddings-v2-768-related-annotation-document-2026-08-v11-r11",
      annotationQueryRevision:
        "yandex-text-embeddings-v2-768-related-annotation-query-2026-08-v11-r11",
      visualRevision:
        "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1",
      relationPolicyRevision:
        "related-pets-relation-policy-2026-08-v23-r1",
      fallbackPolicyRevision:
        "related-pets-zero-qualified-empty-top4-shared-topic-visual-v24-r2",
    });
  });
});

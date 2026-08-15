import {
  rankRelatedPetsByMetadata,
  rankRelatedPetsByTextFirstMetadata,
  rankRelatedPetsByThemeMetadata,
  rankRelatedPetsByTopicMetadata,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";
import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";
import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  countSharedRelatedPetTopics,
  createRelatedPetTopicSet,
  RELATED_PETS_V24_FALLBACK_GUARD_DEPTH,
  RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
} from "@/lib/pets/related-pets-fallback-policy";
import { applyRelatedPetsRelationPolicy } from "@/lib/pets/related-pets-relation-policy";

export const RELATED_PETS_RRF_K = 60;
export const RELATED_PETS_TEXT_WEIGHT = 1;
export const RELATED_PETS_METADATA_WEIGHT = 0.15;
export const RELATED_PETS_V10_METADATA_WEIGHT = 0.05;
export const RELATED_PETS_SEMANTIC_FALLBACK_VISUAL_WEIGHT = 0.5;
export const RELATED_PETS_DEFAULT_LIMIT = RELATED_PETS_SNAPSHOT_DEPTH;

export type StoredRelatedPetVector = {
  slug: string;
  modelRevision: string;
  dimensions: number;
  sourceHash: string;
  embedding: Buffer;
};

export type RelatedPetSimilarity = {
  slug: string;
  score: number;
};

export type RelatedPetsRankingProfile = {
  strategy?: RelatedPetsRankingStrategy;
  relationPolicyRevision?: string;
  fallbackPolicyRevision?: string;
  textMinSimilarity: number;
  topicMinSimilarity?: number;
  topicWeight?: number;
  annotationMinSimilarity?: number;
  annotationWeight?: number;
  metadataWeight?: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
};

export type RelatedPetsRankingStrategy =
  | "legacy-v7"
  | "theme-first-v8"
  | "text-first-v9"
  | "description-theme-v10"
  | "entity-controlled-v11";

export type RelatedPetRankingTier =
  | "qualified"
  | "semantic_backfill"
  | "metadata_fallback"
  | "canonical_entity"
  | "franchise"
  | "franchise_family_collection"
  | "specific_archetype"
  | "semantic_safe"
  | "controlled_fallback"
  | "conflict_fallback";

export type RelatedPetRankingDiagnostic = {
  slug: string;
  tier: RelatedPetRankingTier;
  metadataRank: number;
  textRank: number | null;
  topicRank: number | null;
  visualRank: number | null;
  textSimilarity: number | null;
  topicSimilarity: number | null;
  visualSimilarity: number | null;
  sharedTagCount: number;
  sharedTagRank: number | null;
  textMinSimilarity: number;
  topicMinSimilarity: number | null;
  visualMinSimilarity: number | null;
  passesTextThreshold: boolean;
  passesTopicThreshold: boolean;
  passesVisualThreshold: boolean;
  score: number;
  contributions: {
    metadata: number;
    text: number;
    topic?: number;
    annotation?: number;
    visual: number;
  };
  matchedFacets?: string[];
  franchiseConflict?: boolean;
  annotationRank?: number | null;
  annotationSimilarity?: number | null;
  annotationMinSimilarity?: number;
  passesAnnotationThreshold?: boolean;
  fallbackProvenance?:
    | "description_then_annotation"
    | "shared_topics_kind_visual_description"
    | "conflict_contract"
    | null;
};

export type RelatedPetsRankingResult = {
  slugs: string[];
  diagnostics: RelatedPetRankingDiagnostic[];
  qualifiedCount: number;
  semanticBackfillCount: number;
};

export type RelatedPetsPrecomputedMatches = {
  text: readonly RelatedPetSimilarity[];
  annotation: readonly RelatedPetSimilarity[];
  visual: readonly RelatedPetSimilarity[];
};

export function decodeRelatedPetVector(
  row: StoredRelatedPetVector,
  expected: {
    modelRevision: string;
    dimensions: number;
    sourceHash: string;
  },
): number[] | null {
  const expectedByteLength =
    expected.dimensions * Float32Array.BYTES_PER_ELEMENT + 1;
  if (
    expected.dimensions <= 0 ||
    row.modelRevision !== expected.modelRevision ||
    row.dimensions !== expected.dimensions ||
    row.sourceHash !== expected.sourceHash ||
    row.embedding.length !== expectedByteLength ||
    row.embedding[row.embedding.length - 1] !== 0x01
  ) {
    return null;
  }

  const vector = Array.from({ length: expected.dimensions }, (_, index) =>
    row.embedding.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT),
  );
  return vector.every(Number.isFinite) &&
    vector.some((value) => value !== 0)
    ? vector
    : null;
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number | null {
  if (
    left.length === 0 ||
    left.length !== right.length ||
    left.some((value) => !Number.isFinite(value)) ||
    right.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }

  let dotProduct = 0;
  let leftSquaredNorm = 0;
  let rightSquaredNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftSquaredNorm += leftValue * leftValue;
    rightSquaredNorm += rightValue * rightValue;
  }
  if (leftSquaredNorm === 0 || rightSquaredNorm === 0) return null;

  const similarity =
    dotProduct / Math.sqrt(leftSquaredNorm * rightSquaredNorm);
  return Number.isFinite(similarity)
    ? Math.max(-1, Math.min(1, similarity))
    : null;
}

export function rankRelatedPetVectorMatches(
  sourceSlug: string,
  sourceVectors: ReadonlyMap<string, readonly number[]>,
  candidateVectors: ReadonlyMap<string, readonly number[]> = sourceVectors,
): RelatedPetSimilarity[] {
  const sourceVector = sourceVectors.get(sourceSlug);
  if (!sourceVector) return [];

  const matches: RelatedPetSimilarity[] = [];
  for (const [slug, vector] of candidateVectors) {
    if (slug === sourceSlug) continue;
    const score = cosineSimilarity(sourceVector, vector);
    if (score !== null) matches.push({ slug, score });
  }
  return matches.toSorted(
    (left, right) =>
      right.score - left.score || left.slug.localeCompare(right.slug),
  );
}

export function fuseRelatedPetRankings(input: {
  sourceSlug: string;
  metadataSlugs: readonly string[];
  textMatches?: readonly RelatedPetSimilarity[];
  topicMatches?: readonly RelatedPetSimilarity[];
  visualMatches?: readonly RelatedPetSimilarity[];
  textMinSimilarity: number;
  topicMinSimilarity?: number;
  topicWeight?: number;
  metadataWeight?: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
  strategy?: RelatedPetsRankingStrategy;
  sharedTagCounts?: Readonly<Record<string, number>>;
  limit?: number;
}): string[] {
  return fuseRelatedPetRankingsWithDiagnostics(input).slugs;
}

export function fuseRelatedPetRankingsWithDiagnostics(input: {
  sourceSlug: string;
  metadataSlugs: readonly string[];
  textMatches?: readonly RelatedPetSimilarity[];
  topicMatches?: readonly RelatedPetSimilarity[];
  visualMatches?: readonly RelatedPetSimilarity[];
  textMinSimilarity: number;
  topicMinSimilarity?: number;
  topicWeight?: number;
  metadataWeight?: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
  strategy?: RelatedPetsRankingStrategy;
  sharedTagCounts?: Readonly<Record<string, number>>;
  limit?: number;
}): RelatedPetsRankingResult {
  assertCosineThreshold("text", input.textMinSimilarity);
  if (input.topicMinSimilarity !== undefined) {
    assertCosineThreshold("topic", input.topicMinSimilarity);
  }
  if (input.visualMinSimilarity !== null) {
    assertCosineThreshold("visual", input.visualMinSimilarity);
  }

  const metadataSlugs = uniqueKnownSlugs(
    input.metadataSlugs,
    input.sourceSlug,
  );
  const metadataPosition = new Map(
    metadataSlugs.map((slug, index) => [slug, index + 1]),
  );
  const textMatches = knownMatches(
    input.textMatches ?? [],
    input.sourceSlug,
    metadataPosition,
  );
  const topicMatches = knownMatches(
    input.topicMatches ?? [],
    input.sourceSlug,
    metadataPosition,
  );
  const visualMatches = input.visualMinSimilarity === null
    ? []
    : knownMatches(
        input.visualMatches ?? [],
        input.sourceSlug,
        metadataPosition,
      );
  const textPositions = rankingPositions(textMatches);
  const topicPositions = rankingPositions(topicMatches);
  const visualPositions = rankingPositions(visualMatches);
  const textScores = new Map(
    textMatches.map(({ slug, score }) => [slug, score]),
  );
  const topicScores = new Map(
    topicMatches.map(({ slug, score }) => [slug, score]),
  );
  const visualScores = new Map(
    visualMatches.map(({ slug, score }) => [slug, score]),
  );
  const strategy = input.strategy ?? "legacy-v7";
  const sharedTagCounts = Object.fromEntries(
    metadataSlugs.map((slug) => [
      slug,
      normalizedSharedTagCount(input.sharedTagCounts?.[slug]),
    ]),
  );
  const sharedTagRanks = rankSharedTagCounts(sharedTagCounts);
  const semanticAvailable = strategy === "theme-first-v8"
    ? textPositions.size > 0 ||
      Object.values(sharedTagCounts).some((count) => count > 0)
    : strategy === "text-first-v9" || strategy === "description-theme-v10"
      ? textPositions.size > 0
      : textPositions.size > 0 || visualPositions.size > 0;
  const diagnostics = metadataSlugs.map((slug) =>
    createRankingDiagnostic({
      slug,
      metadataRank: metadataPosition.get(slug) ?? Number.MAX_SAFE_INTEGER,
      textRank: textPositions.get(slug) ?? null,
      topicRank: topicPositions.get(slug) ?? null,
      visualRank: visualPositions.get(slug) ?? null,
      textScore: textScores.get(slug) ?? null,
      topicScore: topicScores.get(slug) ?? null,
      visualScore: visualScores.get(slug) ?? null,
      sharedTagCount: sharedTagCounts[slug] ?? 0,
      sharedTagRank: sharedTagRanks.get(slug) ?? null,
      textMinSimilarity: input.textMinSimilarity,
      topicMinSimilarity: input.topicMinSimilarity ?? null,
      topicWeight: input.topicWeight ?? 0,
      metadataWeight:
        input.metadataWeight ??
        (strategy === "description-theme-v10"
          ? RELATED_PETS_V10_METADATA_WEIGHT
          : RELATED_PETS_METADATA_WEIGHT),
      visualMinSimilarity: input.visualMinSimilarity,
      visualWeight: input.visualWeight,
      semanticAvailable,
      strategy,
    }),
  );

  const limit = normalizedLimit(input.limit);
  const selected = semanticAvailable
    ? [
        ...diagnostics
          .filter(({ tier }) => tier === "qualified")
          .toSorted(compareQualifiedDiagnostics),
        ...diagnostics
          .filter(({ tier }) => tier === "semantic_backfill")
          .filter(({ textRank }) =>
            strategy === "text-first-v9" ||
              strategy === "description-theme-v10"
              ? textRank !== null
              : true,
          )
          .toSorted(
            isThemeAwareStrategy(strategy)
              ? compareThemeFirstBackfillDiagnostics
              : compareSemanticBackfillDiagnostics,
          ),
      ].slice(0, limit)
    : diagnostics.slice(0, limit);

  return {
    slugs: selected.map(({ slug }) => slug),
    diagnostics: selected,
    qualifiedCount: selected.filter(({ tier }) => tier === "qualified")
      .length,
    semanticBackfillCount: selected.filter(
      ({ tier }) => tier === "semantic_backfill",
    ).length,
  };
}

export function fuseRelatedPetTextMetadataBaseline(input: {
  sourceSlug: string;
  metadataSlugs: readonly string[];
  textMatches?: readonly RelatedPetSimilarity[];
  textMinSimilarity: number;
  strategy?: RelatedPetsRankingStrategy;
  sharedTagCounts?: Readonly<Record<string, number>>;
  limit?: number;
}): string[] {
  if (isThemeAwareStrategy(input.strategy)) {
    return fuseRelatedPetRankingsWithDiagnostics({
      ...input,
      visualMinSimilarity: null,
      visualWeight: 0,
    }).slugs;
  }
  assertCosineThreshold("text", input.textMinSimilarity);
  const metadataSlugs = uniqueKnownSlugs(
    input.metadataSlugs,
    input.sourceSlug,
  );
  const metadataPosition = new Map(
    metadataSlugs.map((slug, index) => [slug, index + 1]),
  );
  const textMatches = knownMatches(
    input.textMatches ?? [],
    input.sourceSlug,
    metadataPosition,
  );
  const textPositions = rankingPositions(textMatches);
  const scores = new Map(
    metadataSlugs.map((slug) => [
      slug,
      rrfContribution(
        metadataPosition.get(slug) ?? Number.MAX_SAFE_INTEGER,
        RELATED_PETS_METADATA_WEIGHT,
      ),
    ]),
  );
  for (const { slug, score } of textMatches) {
    if (score < input.textMinSimilarity) continue;
    scores.set(
      slug,
      (scores.get(slug) ?? 0) +
        rrfContribution(
          textPositions.get(slug) ?? null,
          RELATED_PETS_TEXT_WEIGHT,
        ),
    );
  }

  return Array.from(scores, ([slug, score]) => ({ slug, score }))
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        (metadataPosition.get(left.slug) ?? Number.MAX_SAFE_INTEGER) -
          (metadataPosition.get(right.slug) ?? Number.MAX_SAFE_INTEGER) ||
        left.slug.localeCompare(right.slug),
    )
    .slice(0, normalizedLimit(input.limit))
    .map(({ slug }) => slug);
}

export function rankRelatedPets(input: {
  source: Pick<RelatedPetCandidate, "slug" | "kind" | "tags">;
  candidates: readonly RelatedPetCandidate[];
  textQueryVectors?: ReadonlyMap<string, readonly number[]>;
  textDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  topicQueryVectors?: ReadonlyMap<string, readonly number[]>;
  topicDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  visualVectors?: ReadonlyMap<string, readonly number[]>;
  annotationQueryVectors?: ReadonlyMap<string, readonly number[]>;
  annotationDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  annotations?: ReadonlyMap<string, ResolvedRelatedPetAnnotation>;
  precomputedMatches?: RelatedPetsPrecomputedMatches;
  profile: RelatedPetsRankingProfile;
  limit?: number;
}): string[] {
  return rankRelatedPetsWithDiagnostics(input).slugs;
}

export function rankRelatedPetsWithDiagnostics(input: {
  source: Pick<RelatedPetCandidate, "slug" | "kind" | "tags">;
  candidates: readonly RelatedPetCandidate[];
  textQueryVectors?: ReadonlyMap<string, readonly number[]>;
  textDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  topicQueryVectors?: ReadonlyMap<string, readonly number[]>;
  topicDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  visualVectors?: ReadonlyMap<string, readonly number[]>;
  annotationQueryVectors?: ReadonlyMap<string, readonly number[]>;
  annotationDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  annotations?: ReadonlyMap<string, ResolvedRelatedPetAnnotation>;
  precomputedMatches?: RelatedPetsPrecomputedMatches;
  profile: RelatedPetsRankingProfile;
  limit?: number;
}): RelatedPetsRankingResult {
  const candidatesBySlug = new Map<string, RelatedPetCandidate>();
  for (const candidate of input.candidates) {
    if (!candidatesBySlug.has(candidate.slug)) {
      candidatesBySlug.set(candidate.slug, candidate);
    }
  }
  const strategy = input.profile.strategy ?? "legacy-v7";
  if (
    input.profile.relationPolicyRevision &&
    strategy !== "entity-controlled-v11"
  ) {
    throw new Error(
      "Related-pets relation policies require the entity-controlled strategy.",
    );
  }
  if (
    input.profile.fallbackPolicyRevision &&
    strategy !== "entity-controlled-v11"
  ) {
    throw new Error(
      "Related-pets fallback policies require the entity-controlled strategy.",
    );
  }
  if (strategy === "entity-controlled-v11") {
    return rankEntityControlledRelatedPets({
      ...input,
      candidates: Array.from(candidatesBySlug.values()),
    });
  }
  const metadataRanking = strategy === "description-theme-v10"
    ? rankRelatedPetsByTopicMetadata(
        Array.from(candidatesBySlug.values()),
        input.source,
      )
    : strategy === "text-first-v9"
    ? rankRelatedPetsByTextFirstMetadata(
        Array.from(candidatesBySlug.values()),
        input.source,
      )
    : strategy === "theme-first-v8"
      ? rankRelatedPetsByThemeMetadata(
        Array.from(candidatesBySlug.values()),
        input.source,
      )
      : rankRelatedPetsByMetadata(
        Array.from(candidatesBySlug.values()),
        input.source,
      );
  const metadataSlugs = metadataRanking.map(({ candidate }) => candidate.slug);
  const sharedTagCounts = Object.fromEntries(
    metadataRanking.map(({ candidate, sharedTagCount }) => [
      candidate.slug,
      sharedTagCount,
    ]),
  );

  return fuseRelatedPetRankingsWithDiagnostics({
    sourceSlug: input.source.slug,
    metadataSlugs,
    sharedTagCounts,
    textMatches:
      input.textQueryVectors && input.textDocumentVectors
      ? rankRelatedPetVectorMatches(
          input.source.slug,
          input.textQueryVectors,
          input.textDocumentVectors,
        )
      : [],
    topicMatches:
      input.topicQueryVectors && input.topicDocumentVectors
      ? rankRelatedPetVectorMatches(
          input.source.slug,
          input.topicQueryVectors,
          input.topicDocumentVectors,
        )
      : [],
    visualMatches: input.visualVectors
      ? rankRelatedPetVectorMatches(input.source.slug, input.visualVectors)
      : [],
    ...input.profile,
    limit: input.limit,
  });
}

type V11Tier = Extract<
  RelatedPetRankingTier,
  | "canonical_entity"
  | "franchise"
  | "franchise_family_collection"
  | "specific_archetype"
  | "semantic_safe"
  | "controlled_fallback"
  | "conflict_fallback"
>;

const V11_TIER_ORDER: Readonly<Record<V11Tier, number>> = {
  canonical_entity: 1,
  franchise: 2,
  franchise_family_collection: 3,
  specific_archetype: 4,
  semantic_safe: 5,
  controlled_fallback: 6,
  conflict_fallback: 7,
};

function rankEntityControlledRelatedPets(input: {
  source: Pick<RelatedPetCandidate, "slug" | "kind" | "tags">;
  candidates: readonly RelatedPetCandidate[];
  textQueryVectors?: ReadonlyMap<string, readonly number[]>;
  textDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  visualVectors?: ReadonlyMap<string, readonly number[]>;
  annotationQueryVectors?: ReadonlyMap<string, readonly number[]>;
  annotationDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  annotations?: ReadonlyMap<string, ResolvedRelatedPetAnnotation>;
  precomputedMatches?: RelatedPetsPrecomputedMatches;
  profile: RelatedPetsRankingProfile;
  limit?: number;
}): RelatedPetsRankingResult {
  const annotationMinSimilarity = input.profile.annotationMinSimilarity;
  if (annotationMinSimilarity === undefined) {
    throw new Error("V11 requires annotationMinSimilarity.");
  }
  assertCosineThreshold("annotation", annotationMinSimilarity);
  assertCosineThreshold("text", input.profile.textMinSimilarity);
  if (input.profile.visualMinSimilarity !== null) {
    assertCosineThreshold("visual", input.profile.visualMinSimilarity);
  }
  const sparseFallbackEnabled = input.profile.fallbackPolicyRevision !==
      undefined;
  if (
    sparseFallbackEnabled &&
    input.profile.fallbackPolicyRevision !==
      RELATED_PETS_V24_FALLBACK_POLICY_REVISION
  ) {
    throw new Error("Unsupported related-pets fallback policy revision.");
  }

  const candidateSlugs = uniqueKnownSlugs(
    input.candidates.map(({ slug }) => slug),
    input.source.slug,
  );
  const textMatches = input.precomputedMatches?.text ??
    (input.textQueryVectors && input.textDocumentVectors
    ? rankRelatedPetVectorMatches(
        input.source.slug,
        input.textQueryVectors,
        input.textDocumentVectors,
      )
    : []);
  const annotationMatches = input.precomputedMatches?.annotation ??
    (input.annotationQueryVectors && input.annotationDocumentVectors
      ? rankRelatedPetVectorMatches(
          input.source.slug,
          input.annotationQueryVectors,
          input.annotationDocumentVectors,
        )
      : []);
  const visualMatches = input.precomputedMatches?.visual ??
    (input.visualVectors
    ? rankRelatedPetVectorMatches(input.source.slug, input.visualVectors)
    : []);
  const textRanks = rankingPositions(textMatches);
  const annotationRanks = rankingPositions(annotationMatches);
  const visualRanks = rankingPositions(visualMatches);
  const textScores = new Map(textMatches.map(({ slug, score }) => [slug, score]));
  const annotationScores = new Map(
    annotationMatches.map(({ slug, score }) => [slug, score]),
  );
  const visualScores = new Map(
    visualMatches.map(({ slug, score }) => [slug, score]),
  );
  const sourceAnnotation = applyRelatedPetsRelationPolicy({
    slug: input.source.slug,
    annotation: input.annotations?.get(input.source.slug) ?? null,
    revision: input.profile.relationPolicyRevision,
  });
  const candidatesBySlug = new Map(
    input.candidates.map((candidate) => [candidate.slug, candidate]),
  );
  const sourceTopics = sparseFallbackEnabled
    ? createRelatedPetTopicSet(input.source.tags)
    : new Set<string>();
  const diagnostics = candidateSlugs.map((slug, metadataIndex) => {
    const candidate = candidatesBySlug.get(slug);
    const candidateAnnotation = applyRelatedPetsRelationPolicy({
      slug,
      annotation: input.annotations?.get(slug) ?? null,
      revision: input.profile.relationPolicyRevision,
    });
    const textSimilarity = textScores.get(slug) ?? null;
    const annotationSimilarity = annotationScores.get(slug) ?? null;
    const visualSimilarity = visualScores.get(slug) ?? null;
    const passesText = textSimilarity !== null &&
      textSimilarity >= input.profile.textMinSimilarity;
    const passesAnnotation = annotationSimilarity !== null &&
      annotationSimilarity >= annotationMinSimilarity;
    const passesVisual = input.profile.visualMinSimilarity !== null &&
      visualSimilarity !== null &&
      visualSimilarity >= input.profile.visualMinSimilarity;
    const relation = classifyV11Relation(
      sourceAnnotation,
      candidateAnnotation,
      passesText,
      passesAnnotation,
    );
    const qualified = isQualifiedV11Tier(relation.tier);
    const contributions = qualified
      ? {
          metadata: 0,
          text: rrfContribution(textRanks.get(slug) ?? null, 1),
          annotation: rrfContribution(
            annotationRanks.get(slug) ?? null,
            input.profile.annotationWeight ?? 0,
          ),
          visual: passesVisual
            ? rrfContribution(
                visualRanks.get(slug) ?? null,
                input.profile.visualWeight,
              )
            : 0,
        }
      : { metadata: 0, text: 0, annotation: 0, visual: 0 };
    return {
      slug,
      tier: relation.tier,
      metadataRank: metadataIndex + 1,
      textRank: textRanks.get(slug) ?? null,
      topicRank: null,
      annotationRank: annotationRanks.get(slug) ?? null,
      visualRank: visualRanks.get(slug) ?? null,
      textSimilarity,
      topicSimilarity: null,
      annotationSimilarity,
      visualSimilarity,
      sharedTagCount: sparseFallbackEnabled && candidate
        ? countSharedRelatedPetTopics(sourceTopics, candidate.tags)
        : 0,
      sharedTagRank: null,
      textMinSimilarity: input.profile.textMinSimilarity,
      topicMinSimilarity: null,
      annotationMinSimilarity,
      visualMinSimilarity: input.profile.visualMinSimilarity,
      passesTextThreshold: passesText,
      passesTopicThreshold: false,
      passesAnnotationThreshold: passesAnnotation,
      passesVisualThreshold: passesVisual,
      matchedFacets: relation.matchedFacets,
      franchiseConflict: relation.franchiseConflict,
      fallbackProvenance: relation.tier === "controlled_fallback"
        ? "description_then_annotation" as const
        : relation.tier === "conflict_fallback"
          ? "conflict_contract" as const
          : null,
      contributions,
      score:
        contributions.text + contributions.annotation + contributions.visual,
    } satisfies RelatedPetRankingDiagnostic;
  });
  const rankedDiagnostics = applyV24SparseFallback({
    diagnostics,
    enabled: sparseFallbackEnabled,
    sourceKind: input.source.kind,
    candidatesBySlug,
  });
  const selected = rankedDiagnostics.slice(0, normalizedLimit(input.limit));
  return {
    slugs: selected.map(({ slug }) => slug),
    diagnostics: selected,
    qualifiedCount: selected.filter(({ tier }) => isQualifiedV11Tier(tier)).length,
    semanticBackfillCount: selected.filter(({ tier }) =>
      tier === "controlled_fallback" || tier === "conflict_fallback"
    ).length,
  };
}

function isQualifiedV11Tier(tier: RelatedPetRankingTier): boolean {
  return tier === "canonical_entity" ||
    tier === "franchise" ||
    tier === "franchise_family_collection" ||
    tier === "specific_archetype" ||
    tier === "semantic_safe";
}

function applyV24SparseFallback(input: {
  diagnostics: readonly RelatedPetRankingDiagnostic[];
  enabled: boolean;
  sourceKind: RelatedPetCandidate["kind"];
  candidatesBySlug: ReadonlyMap<string, RelatedPetCandidate>;
}): RelatedPetRankingDiagnostic[] {
  const baseline = input.diagnostics.toSorted(compareV11Diagnostics);
  const useSparseFallback = input.enabled &&
    !input.diagnostics.some(({ tier }) => isQualifiedV11Tier(tier)) &&
    !baseline
      .slice(0, RELATED_PETS_V24_FALLBACK_GUARD_DEPTH)
      .some(isV24SparseFallbackCandidate);
  if (!useSparseFallback) return baseline;

  const compareFallback = (
    left: RelatedPetRankingDiagnostic,
    right: RelatedPetRankingDiagnostic,
  ) => compareV24SparseFallbackCandidates(
    left,
    right,
    input.sourceKind,
    input.candidatesBySlug,
  );
  const sparseFallbackRanks = new Map(
    input.diagnostics
      .filter(isV24SparseFallbackCandidate)
      .toSorted(compareFallback)
      .map(({ slug }, index) => [slug, index + 1]),
  );
  return input.diagnostics.map((diagnostic) => {
    const sharedTagRank = sparseFallbackRanks.get(diagnostic.slug) ?? null;
    return sharedTagRank === null
      ? diagnostic
      : {
          ...diagnostic,
          sharedTagRank,
          fallbackProvenance:
            "shared_topics_kind_visual_description" as const,
        };
  }).toSorted(compareFallback);
}

function isV24SparseFallbackCandidate(
  diagnostic: RelatedPetRankingDiagnostic,
): boolean {
  return diagnostic.tier === "controlled_fallback" &&
    diagnostic.sharedTagCount > 0;
}

function compareV24SparseFallbackCandidates(
  left: RelatedPetRankingDiagnostic,
  right: RelatedPetRankingDiagnostic,
  sourceKind: RelatedPetCandidate["kind"],
  candidatesBySlug: ReadonlyMap<string, RelatedPetCandidate>,
): number {
  const leftRescued = isV24SparseFallbackCandidate(left);
  const rightRescued = isV24SparseFallbackCandidate(right);
  if (leftRescued !== rightRescued) return leftRescued ? -1 : 1;
  if (!leftRescued) return compareV11Diagnostics(left, right);

  const leftSameKind = candidatesBySlug.get(left.slug)?.kind === sourceKind;
  const rightSameKind = candidatesBySlug.get(right.slug)?.kind === sourceKind;
  return right.sharedTagCount - left.sharedTagCount ||
    Number(rightSameKind) - Number(leftSameKind) ||
    (right.visualSimilarity ?? -2) - (left.visualSimilarity ?? -2) ||
    (right.textSimilarity ?? -2) - (left.textSimilarity ?? -2) ||
    (right.annotationSimilarity ?? -2) -
      (left.annotationSimilarity ?? -2) ||
    left.slug.localeCompare(right.slug);
}

function classifyV11Relation(
  source: ResolvedRelatedPetAnnotation | null,
  candidate: ResolvedRelatedPetAnnotation | null,
  passesText: boolean,
  passesAnnotation: boolean,
): { tier: V11Tier; matchedFacets: string[]; franchiseConflict: boolean } {
  const entity = source?.entity && source.entity === candidate?.entity
    ? [source.entity]
    : [];
  const franchises = intersection(source?.franchises, candidate?.franchises);
  const families = intersection(
    source?.franchiseFamilies,
    candidate?.franchiseFamilies,
  );
  const collections = intersection(source?.collections, candidate?.collections);
  const archetypes = intersection(
    source?.specificArchetypes,
    candidate?.specificArchetypes,
  );
  const franchiseConflict = hasV11FranchiseConflict(
    source,
    candidate,
    collections,
    archetypes,
  );
  if (entity.length > 0) {
    return { tier: "canonical_entity", matchedFacets: entity, franchiseConflict };
  }
  if (franchises.length > 0) {
    return { tier: "franchise", matchedFacets: franchises, franchiseConflict };
  }
  if (families.length > 0 || collections.length > 0) {
    return {
      tier: "franchise_family_collection",
      matchedFacets: [...families, ...collections],
      franchiseConflict,
    };
  }
  if (archetypes.length > 0 && passesText && passesAnnotation) {
    return { tier: "specific_archetype", matchedFacets: archetypes, franchiseConflict };
  }
  if (passesText && passesAnnotation && !franchiseConflict) {
    return { tier: "semantic_safe", matchedFacets: [], franchiseConflict };
  }
  return {
    tier: franchiseConflict ? "conflict_fallback" : "controlled_fallback",
    matchedFacets: [],
    franchiseConflict,
  };
}

function hasV11FranchiseConflict(
  source: ResolvedRelatedPetAnnotation | null,
  candidate: ResolvedRelatedPetAnnotation | null,
  sharedCollections: readonly string[],
  sharedArchetypes: readonly string[],
): boolean {
  if (!source || !candidate || sharedCollections.length > 0 || sharedArchetypes.length > 0) {
    return false;
  }
  const sourceKeys = [...source.franchises, ...source.franchiseFamilies];
  const candidateKeys = [...candidate.franchises, ...candidate.franchiseFamilies];
  return sourceKeys.length > 0 &&
    candidateKeys.length > 0 &&
    intersection(sourceKeys, candidateKeys).length === 0;
}

function intersection(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] {
  const rightSet = new Set(right ?? []);
  return (left ?? []).filter((value) => rightSet.has(value)).toSorted();
}

function compareV11Diagnostics(
  left: RelatedPetRankingDiagnostic,
  right: RelatedPetRankingDiagnostic,
): number {
  const tierDelta = V11_TIER_ORDER[left.tier as V11Tier] -
    V11_TIER_ORDER[right.tier as V11Tier];
  if (tierDelta !== 0) return tierDelta;
  if (left.tier === "controlled_fallback" || left.tier === "conflict_fallback") {
    return (right.textSimilarity ?? -2) - (left.textSimilarity ?? -2) ||
      (right.annotationSimilarity ?? -2) -
        (left.annotationSimilarity ?? -2) ||
      left.slug.localeCompare(right.slug);
  }
  return right.score - left.score ||
    (right.matchedFacets?.length ?? 0) - (left.matchedFacets?.length ?? 0) ||
    (right.annotationSimilarity ?? -2) - (left.annotationSimilarity ?? -2) ||
    (right.textSimilarity ?? -2) - (left.textSimilarity ?? -2) ||
    left.slug.localeCompare(right.slug);
}

function knownMatches(
  matches: readonly RelatedPetSimilarity[],
  sourceSlug: string,
  metadataPosition: ReadonlyMap<string, number>,
): RelatedPetSimilarity[] {
  const unique = new Map<string, RelatedPetSimilarity>();
  for (const match of matches.toSorted(
    (left, right) =>
      right.score - left.score || left.slug.localeCompare(right.slug),
  )) {
    if (
      match.slug === sourceSlug ||
      !metadataPosition.has(match.slug) ||
      !Number.isFinite(match.score) ||
      unique.has(match.slug)
    ) {
      continue;
    }
    unique.set(match.slug, match);
  }
  return Array.from(unique.values());
}

function rankingPositions(
  matches: readonly RelatedPetSimilarity[],
): Map<string, number> {
  return new Map(matches.map(({ slug }, index) => [slug, index + 1]));
}

function createRankingDiagnostic(input: {
  slug: string;
  metadataRank: number;
  textRank: number | null;
  topicRank: number | null;
  visualRank: number | null;
  textScore: number | null;
  topicScore: number | null;
  visualScore: number | null;
  sharedTagCount: number;
  sharedTagRank: number | null;
  textMinSimilarity: number;
  topicMinSimilarity: number | null;
  topicWeight: number;
  metadataWeight: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
  semanticAvailable: boolean;
  strategy: RelatedPetsRankingStrategy;
}): RelatedPetRankingDiagnostic {
  const passesText =
    input.textScore !== null && input.textScore >= input.textMinSimilarity;
  const passesTopic =
    input.topicMinSimilarity !== null &&
    input.topicScore !== null &&
    input.topicScore >= input.topicMinSimilarity;
  const passesVisual =
    input.visualMinSimilarity !== null &&
    input.visualScore !== null &&
    input.visualScore >= input.visualMinSimilarity;
  const qualified = input.strategy === "description-theme-v10"
    ? passesText && passesTopic
    : input.strategy === "text-first-v9"
    ? passesText
    : input.strategy === "theme-first-v8"
      ? input.sharedTagCount > 0 || passesText
      : input.sharedTagCount > 0 || passesText || passesVisual;
  const metadata = rrfContribution(
    isThemeAwareStrategy(input.strategy)
      ? input.sharedTagRank
      : input.metadataRank,
    input.metadataWeight,
  );
  const qualifiedText = passesText
    ? rrfContribution(input.textRank, RELATED_PETS_TEXT_WEIGHT)
    : 0;
  const qualifiedTopic = passesTopic
    ? rrfContribution(input.topicRank, input.topicWeight)
    : 0;
  const qualifiedVisual = passesVisual
    ? rrfContribution(input.visualRank, input.visualWeight)
    : 0;
  const fallbackText = rrfContribution(
    input.textRank,
    RELATED_PETS_TEXT_WEIGHT,
  );
  const fallbackVisual = rrfContribution(
    input.visualRank,
    RELATED_PETS_SEMANTIC_FALLBACK_VISUAL_WEIGHT,
  );
  const diagnosticContext = {
    slug: input.slug,
    metadataRank: input.metadataRank,
    textRank: input.textRank,
    topicRank: input.topicRank,
    visualRank: input.visualRank,
    textSimilarity: input.textScore,
    topicSimilarity: input.topicScore,
    visualSimilarity: input.visualScore,
    sharedTagCount: input.sharedTagCount,
    sharedTagRank: input.sharedTagRank,
    textMinSimilarity: input.textMinSimilarity,
    topicMinSimilarity: input.topicMinSimilarity,
    visualMinSimilarity: input.visualMinSimilarity,
    passesTextThreshold: passesText,
    passesTopicThreshold: passesTopic,
    passesVisualThreshold: passesVisual,
  };

  if (!input.semanticAvailable) {
    const contributions = input.strategy === "description-theme-v10"
      ? { metadata, text: 0, topic: 0, visual: 0 }
      : { metadata, text: 0, visual: 0 };
    return {
      ...diagnosticContext,
      tier: qualified ? "qualified" : "metadata_fallback",
      score: metadata,
      contributions,
    };
  }

  const contributions = qualified
    ? input.strategy === "description-theme-v10"
      ? {
          metadata,
          text: qualifiedText,
          topic: qualifiedTopic,
          visual: qualifiedVisual,
        }
      : { metadata, text: qualifiedText, visual: qualifiedVisual }
    : {
        metadata: 0,
        text: fallbackText,
        visual:
          isThemeAwareStrategy(input.strategy)
            ? 0
            : fallbackVisual,
      };
  return {
    ...diagnosticContext,
    tier: qualified ? "qualified" : "semantic_backfill",
    score:
      contributions.metadata +
      contributions.text +
      (contributions.topic ?? 0) +
      contributions.visual,
    contributions,
  };
}

function compareQualifiedDiagnostics(
  left: RelatedPetRankingDiagnostic,
  right: RelatedPetRankingDiagnostic,
): number {
  return right.score - left.score ||
    left.metadataRank - right.metadataRank ||
    left.slug.localeCompare(right.slug);
}

function compareSemanticBackfillDiagnostics(
  left: RelatedPetRankingDiagnostic,
  right: RelatedPetRankingDiagnostic,
): number {
  return right.score - left.score || left.slug.localeCompare(right.slug);
}

function compareThemeFirstBackfillDiagnostics(
  left: RelatedPetRankingDiagnostic,
  right: RelatedPetRankingDiagnostic,
): number {
  const leftTextRank = left.textRank ?? Number.MAX_SAFE_INTEGER;
  const rightTextRank = right.textRank ?? Number.MAX_SAFE_INTEGER;
  return leftTextRank - rightTextRank ||
    left.metadataRank - right.metadataRank ||
    left.slug.localeCompare(right.slug);
}

function isThemeAwareStrategy(
  strategy: RelatedPetsRankingStrategy | undefined,
): boolean {
  return strategy === "theme-first-v8" ||
    strategy === "text-first-v9" ||
    strategy === "description-theme-v10";
}

function rrfContribution(rank: number | null, weight: number): number {
  return rank !== null && Number.isFinite(weight) && weight > 0
    ? weight / (RELATED_PETS_RRF_K + rank)
    : 0;
}

function normalizedSharedTagCount(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    return 0;
  }
  return value;
}

function rankSharedTagCounts(
  counts: Readonly<Record<string, number>>,
): Map<string, number> {
  const countRanks = new Map(
    Array.from(new Set(Object.values(counts).filter((count) => count > 0)))
      .toSorted((left, right) => right - left)
      .map((count, index) => [count, index + 1]),
  );
  return new Map(
    Object.entries(counts).flatMap(([slug, count]) => {
      const rank = countRanks.get(count);
      return rank === undefined ? [] : [[slug, rank] as const];
    }),
  );
}

function assertCosineThreshold(
  modality: "text" | "topic" | "annotation" | "visual",
  value: number,
): void {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError(
      `Related-pet ${modality} minimum similarity must be finite and within [-1, 1].`,
    );
  }
}

function uniqueKnownSlugs(
  slugs: readonly string[],
  sourceSlug: string,
): string[] {
  return Array.from(
    new Set(slugs.filter((slug) => slug !== sourceSlug && slug.length > 0)),
  );
}

function normalizedLimit(limit: number | undefined): number {
  return Number.isFinite(limit)
    ? Math.min(
        RELATED_PETS_DEFAULT_LIMIT,
        Math.max(0, Math.trunc(limit ?? RELATED_PETS_DEFAULT_LIMIT)),
      )
    : RELATED_PETS_DEFAULT_LIMIT;
}

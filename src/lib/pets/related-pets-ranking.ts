import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
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
  strategy: "sparse-fallback-v24";
  relationPolicyRevision: string;
  fallbackPolicyRevision: string;
  textMinSimilarity: number;
  annotationMinSimilarity: number;
  annotationWeight: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
};

export type RelatedPetRankingTier =
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
  candidateRank: number;
  textRank: number | null;
  annotationRank: number | null;
  visualRank: number | null;
  textSimilarity: number | null;
  annotationSimilarity: number | null;
  visualSimilarity: number | null;
  sharedTopicCount: number;
  sparseFallbackRank: number | null;
  textMinSimilarity: number;
  annotationMinSimilarity: number;
  visualMinSimilarity: number | null;
  passesTextThreshold: boolean;
  passesAnnotationThreshold: boolean;
  passesVisualThreshold: boolean;
  score: number;
  contributions: {
    text: number;
    annotation: number;
    visual: number;
  };
  matchedFacets: string[];
  franchiseConflict: boolean;
  fallbackProvenance:
    | "description_then_annotation"
    | "shared_topics_kind_visual_description"
    | "conflict_contract"
    | null;
};

export type RelatedPetsRankingResult = {
  slugs: string[];
  diagnostics: RelatedPetRankingDiagnostic[];
  qualifiedCount: number;
  fallbackCount: number;
};

export type RelatedPetsPrecomputedMatches = {
  text: readonly RelatedPetSimilarity[];
  annotation: readonly RelatedPetSimilarity[];
  visual: readonly RelatedPetSimilarity[];
};

export type RelatedPetsRankingInput = {
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

export function rankRelatedPets(input: RelatedPetsRankingInput): string[] {
  return rankRelatedPetsWithDiagnostics(input).slugs;
}

export function rankRelatedPetsWithDiagnostics(
  input: RelatedPetsRankingInput,
): RelatedPetsRankingResult {
  const candidatesBySlug = new Map<string, RelatedPetCandidate>();
  for (const candidate of input.candidates) {
    if (!candidatesBySlug.has(candidate.slug)) {
      candidatesBySlug.set(candidate.slug, candidate);
    }
  }
  if (input.profile.strategy !== "sparse-fallback-v24") {
    throw new Error("Unsupported related-pets ranking strategy.");
  }
  return rankSparseFallbackRelatedPets({
    ...input,
    candidates: Array.from(candidatesBySlug.values()),
  });
}

const V24_TIER_ORDER: Readonly<Record<RelatedPetRankingTier, number>> = {
  canonical_entity: 1,
  franchise: 2,
  franchise_family_collection: 3,
  specific_archetype: 4,
  semantic_safe: 5,
  controlled_fallback: 6,
  conflict_fallback: 7,
};

function rankSparseFallbackRelatedPets(
  input: RelatedPetsRankingInput,
): RelatedPetsRankingResult {
  const annotationMinSimilarity = input.profile.annotationMinSimilarity;
  assertCosineThreshold("annotation", annotationMinSimilarity);
  assertCosineThreshold("text", input.profile.textMinSimilarity);
  if (input.profile.visualMinSimilarity !== null) {
    assertCosineThreshold("visual", input.profile.visualMinSimilarity);
  }
  if (
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
  const sourceTopics = createRelatedPetTopicSet(input.source.tags);
  const diagnostics = candidateSlugs.map((slug, candidateIndex) => {
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
    const relation = classifyV24Relation(
      sourceAnnotation,
      candidateAnnotation,
      passesText,
      passesAnnotation,
    );
    const qualified = isQualifiedV24Tier(relation.tier);
    const contributions = qualified
      ? {
          text: rrfContribution(textRanks.get(slug) ?? null, 1),
          annotation: rrfContribution(
            annotationRanks.get(slug) ?? null,
            input.profile.annotationWeight,
          ),
          visual: passesVisual
            ? rrfContribution(
                visualRanks.get(slug) ?? null,
                input.profile.visualWeight,
              )
            : 0,
        }
      : { text: 0, annotation: 0, visual: 0 };
    return {
      slug,
      tier: relation.tier,
      candidateRank: candidateIndex + 1,
      textRank: textRanks.get(slug) ?? null,
      annotationRank: annotationRanks.get(slug) ?? null,
      visualRank: visualRanks.get(slug) ?? null,
      textSimilarity,
      annotationSimilarity,
      visualSimilarity,
      sharedTopicCount: candidate
        ? countSharedRelatedPetTopics(sourceTopics, candidate.tags)
        : 0,
      sparseFallbackRank: null,
      textMinSimilarity: input.profile.textMinSimilarity,
      annotationMinSimilarity,
      visualMinSimilarity: input.profile.visualMinSimilarity,
      passesTextThreshold: passesText,
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
    sourceKind: input.source.kind,
    candidatesBySlug,
  });
  const selected = rankedDiagnostics.slice(0, normalizedLimit(input.limit));
  return {
    slugs: selected.map(({ slug }) => slug),
    diagnostics: selected,
    qualifiedCount: selected.filter(({ tier }) => isQualifiedV24Tier(tier)).length,
    fallbackCount: selected.filter(({ tier }) =>
      tier === "controlled_fallback" || tier === "conflict_fallback"
    ).length,
  };
}

function isQualifiedV24Tier(tier: RelatedPetRankingTier): boolean {
  return tier === "canonical_entity" ||
    tier === "franchise" ||
    tier === "franchise_family_collection" ||
    tier === "specific_archetype" ||
    tier === "semantic_safe";
}

function applyV24SparseFallback(input: {
  diagnostics: readonly RelatedPetRankingDiagnostic[];
  sourceKind: RelatedPetCandidate["kind"];
  candidatesBySlug: ReadonlyMap<string, RelatedPetCandidate>;
}): RelatedPetRankingDiagnostic[] {
  const baseline = input.diagnostics.toSorted(compareV24Diagnostics);
  const useSparseFallback =
    !input.diagnostics.some(({ tier }) => isQualifiedV24Tier(tier)) &&
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
    const sparseFallbackRank = sparseFallbackRanks.get(diagnostic.slug) ?? null;
    return sparseFallbackRank === null
      ? diagnostic
      : {
          ...diagnostic,
          sparseFallbackRank,
          fallbackProvenance:
            "shared_topics_kind_visual_description" as const,
        };
  }).toSorted(compareFallback);
}

function isV24SparseFallbackCandidate(
  diagnostic: RelatedPetRankingDiagnostic,
): boolean {
  return diagnostic.tier === "controlled_fallback" &&
    diagnostic.sharedTopicCount > 0;
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
  if (!leftRescued) return compareV24Diagnostics(left, right);

  const leftSameKind = candidatesBySlug.get(left.slug)?.kind === sourceKind;
  const rightSameKind = candidatesBySlug.get(right.slug)?.kind === sourceKind;
  return right.sharedTopicCount - left.sharedTopicCount ||
    Number(rightSameKind) - Number(leftSameKind) ||
    (right.visualSimilarity ?? -2) - (left.visualSimilarity ?? -2) ||
    (right.textSimilarity ?? -2) - (left.textSimilarity ?? -2) ||
    (right.annotationSimilarity ?? -2) -
      (left.annotationSimilarity ?? -2) ||
    left.slug.localeCompare(right.slug);
}

function classifyV24Relation(
  source: ResolvedRelatedPetAnnotation | null,
  candidate: ResolvedRelatedPetAnnotation | null,
  passesText: boolean,
  passesAnnotation: boolean,
): {
  tier: RelatedPetRankingTier;
  matchedFacets: string[];
  franchiseConflict: boolean;
} {
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
  const franchiseConflict = hasV24FranchiseConflict(
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

function hasV24FranchiseConflict(
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

function compareV24Diagnostics(
  left: RelatedPetRankingDiagnostic,
  right: RelatedPetRankingDiagnostic,
): number {
  const tierDelta = V24_TIER_ORDER[left.tier] - V24_TIER_ORDER[right.tier];
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

function rankingPositions(
  matches: readonly RelatedPetSimilarity[],
): Map<string, number> {
  return new Map(matches.map(({ slug }, index) => [slug, index + 1]));
}

function rrfContribution(rank: number | null, weight: number): number {
  return rank !== null && Number.isFinite(weight) && weight > 0
    ? weight / (RELATED_PETS_RRF_K + rank)
    : 0;
}

function assertCosineThreshold(
  modality: "text" | "annotation" | "visual",
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

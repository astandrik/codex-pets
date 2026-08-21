import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";
import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  countSharedRelatedPetFallbackTags,
  createRelatedPetFallbackTagSet,
  RELATED_PETS_V24_FALLBACK_GUARD_DEPTH,
  RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
} from "@/lib/pets/related-pets-v24-fallback-policy";
import { applyRelatedPetsRelationPolicy } from "@/lib/pets/related-pets-v24-relation-policy";

export const RELATED_PETS_V24_RRF_K = 60;

export type StoredRelatedPetV24Vector = {
  slug: string;
  modelRevision: string;
  dimensions: number;
  sourceHash: string;
  embedding: Buffer;
};

export type RelatedPetV24Similarity = {
  slug: string;
  score: number;
};

export type RelatedPetsV24RankingProfile = {
  strategy: "sparse-fallback-v24";
  relationPolicyRevision: string;
  fallbackPolicyRevision: string;
  textMinSimilarity: number;
  annotationMinSimilarity: number;
  annotationWeight: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
};

export type RelatedPetV24RankingTier =
  | "canonical_entity"
  | "franchise"
  | "franchise_family_collection"
  | "specific_archetype"
  | "semantic_safe"
  | "controlled_fallback"
  | "conflict_fallback";

export type RelatedPetV24RankingDiagnostic = {
  slug: string;
  tier: RelatedPetV24RankingTier;
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

export type RelatedPetsV24RankingResult = {
  slugs: string[];
  diagnostics: RelatedPetV24RankingDiagnostic[];
  qualifiedCount: number;
  fallbackCount: number;
};

export type RelatedPetsV24PrecomputedMatches = {
  text: readonly RelatedPetV24Similarity[];
  annotation: readonly RelatedPetV24Similarity[];
  visual: readonly RelatedPetV24Similarity[];
};

export type RelatedPetsV24RankingInput = {
  source: Pick<RelatedPetCandidate, "slug" | "kind" | "tags">;
  candidates: readonly RelatedPetCandidate[];
  textQueryVectors?: ReadonlyMap<string, readonly number[]>;
  textDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  visualVectors?: ReadonlyMap<string, readonly number[]>;
  annotationQueryVectors?: ReadonlyMap<string, readonly number[]>;
  annotationDocumentVectors?: ReadonlyMap<string, readonly number[]>;
  annotations?: ReadonlyMap<string, ResolvedRelatedPetAnnotation>;
  precomputedMatches?: RelatedPetsV24PrecomputedMatches;
  profile: RelatedPetsV24RankingProfile;
  limit?: number;
};

export function decodeRelatedPetV24Vector(
  row: StoredRelatedPetV24Vector,
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
  return vector.every(Number.isFinite) && vector.some((value) => value !== 0)
    ? vector
    : null;
}

export function cosineSimilarityV24(
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

  const similarity = dotProduct / Math.sqrt(leftSquaredNorm * rightSquaredNorm);
  return Number.isFinite(similarity)
    ? Math.max(-1, Math.min(1, similarity))
    : null;
}

export function rankRelatedPetV24VectorMatches(
  sourceSlug: string,
  sourceVectors: ReadonlyMap<string, readonly number[]>,
  candidateVectors: ReadonlyMap<string, readonly number[]> = sourceVectors,
): RelatedPetV24Similarity[] {
  const sourceVector = sourceVectors.get(sourceSlug);
  if (!sourceVector) return [];

  const matches: RelatedPetV24Similarity[] = [];
  for (const [slug, vector] of candidateVectors) {
    if (slug === sourceSlug) continue;
    const score = cosineSimilarityV24(sourceVector, vector);
    if (score !== null) matches.push({ slug, score });
  }
  return matches.toSorted(
    (left, right) =>
      right.score - left.score || left.slug.localeCompare(right.slug),
  );
}

export function rankRelatedPetsV24(input: RelatedPetsV24RankingInput): string[] {
  return rankRelatedPetsV24WithDiagnostics(input).slugs;
}

export function rankRelatedPetsV24WithDiagnostics(
  input: RelatedPetsV24RankingInput,
): RelatedPetsV24RankingResult {
  if (input.profile.strategy !== "sparse-fallback-v24") {
    throw new Error("Unsupported related-pets ranking strategy.");
  }
  const candidatesBySlug = new Map<string, RelatedPetCandidate>();
  for (const candidate of input.candidates) {
    if (!candidatesBySlug.has(candidate.slug)) {
      candidatesBySlug.set(candidate.slug, candidate);
    }
  }
  return rankSparseFallback({
    ...input,
    candidates: Array.from(candidatesBySlug.values()),
  });
}

const TIER_ORDER: Readonly<Record<RelatedPetV24RankingTier, number>> = {
  canonical_entity: 1,
  franchise: 2,
  franchise_family_collection: 3,
  specific_archetype: 4,
  semantic_safe: 5,
  controlled_fallback: 6,
  conflict_fallback: 7,
};

function rankSparseFallback(
  input: RelatedPetsV24RankingInput,
): RelatedPetsV24RankingResult {
  assertCosineThreshold("annotation", input.profile.annotationMinSimilarity);
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

  const candidateSlugs = uniqueCandidateSlugs(input.candidates, input.source.slug);
  const candidateSlugSet = new Set(candidateSlugs);
  const textMatches = normalizeCandidateMatches(
    input.precomputedMatches?.text ??
    (input.textQueryVectors && input.textDocumentVectors
      ? rankRelatedPetV24VectorMatches(
          input.source.slug,
          input.textQueryVectors,
          input.textDocumentVectors,
        )
      : []),
    candidateSlugSet,
  );
  const annotationMatches = normalizeCandidateMatches(
    input.precomputedMatches?.annotation ??
    (input.annotationQueryVectors && input.annotationDocumentVectors
      ? rankRelatedPetV24VectorMatches(
          input.source.slug,
          input.annotationQueryVectors,
          input.annotationDocumentVectors,
        )
      : []),
    candidateSlugSet,
  );
  const visualMatches = input.profile.visualMinSimilarity === null
    ? []
    : normalizeCandidateMatches(
        input.precomputedMatches?.visual ??
        (input.visualVectors
          ? rankRelatedPetV24VectorMatches(input.source.slug, input.visualVectors)
          : []),
        candidateSlugSet,
      );
  const textRanks = rankingPositions(textMatches);
  const annotationRanks = rankingPositions(annotationMatches);
  const visualRanks = rankingPositions(visualMatches);
  const textScores = scoreMap(textMatches);
  const annotationScores = scoreMap(annotationMatches);
  const visualScores = scoreMap(visualMatches);
  const sourceAnnotation = applyRelatedPetsRelationPolicy({
    slug: input.source.slug,
    annotation: input.annotations?.get(input.source.slug) ?? null,
    revision: input.profile.relationPolicyRevision,
  });
  const candidatesBySlug = new Map(
    input.candidates.map((candidate) => [candidate.slug, candidate]),
  );
  const sourceTags = createRelatedPetFallbackTagSet(input.source.tags);
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
      annotationSimilarity >= input.profile.annotationMinSimilarity;
    const passesVisual = input.profile.visualMinSimilarity !== null &&
      visualSimilarity !== null &&
      visualSimilarity >= input.profile.visualMinSimilarity;
    const relation = classifyRelation(
      sourceAnnotation,
      candidateAnnotation,
      passesText,
      passesAnnotation,
    );
    const qualified = isQualifiedTier(relation.tier);
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
        ? countSharedRelatedPetFallbackTags(sourceTags, candidate.tags)
        : 0,
      sparseFallbackRank: null,
      textMinSimilarity: input.profile.textMinSimilarity,
      annotationMinSimilarity: input.profile.annotationMinSimilarity,
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
      score: contributions.text + contributions.annotation + contributions.visual,
    } satisfies RelatedPetV24RankingDiagnostic;
  });
  const selected = applySparseFallback({
    diagnostics,
    sourceKind: input.source.kind,
    candidatesBySlug,
  }).slice(0, normalizedLimit(input.limit));
  return {
    slugs: selected.map(({ slug }) => slug),
    diagnostics: selected,
    qualifiedCount: selected.filter(({ tier }) => isQualifiedTier(tier)).length,
    fallbackCount: selected.filter(({ tier }) =>
      tier === "controlled_fallback" || tier === "conflict_fallback"
    ).length,
  };
}

function isQualifiedTier(tier: RelatedPetV24RankingTier): boolean {
  return tier === "canonical_entity" ||
    tier === "franchise" ||
    tier === "franchise_family_collection" ||
    tier === "specific_archetype" ||
    tier === "semantic_safe";
}

function applySparseFallback(input: {
  diagnostics: readonly RelatedPetV24RankingDiagnostic[];
  sourceKind: RelatedPetCandidate["kind"];
  candidatesBySlug: ReadonlyMap<string, RelatedPetCandidate>;
}): RelatedPetV24RankingDiagnostic[] {
  const baseline = input.diagnostics.toSorted(compareDiagnostics);
  const useSparseFallback =
    !input.diagnostics.some(({ tier }) => isQualifiedTier(tier)) &&
    !baseline
      .slice(0, RELATED_PETS_V24_FALLBACK_GUARD_DEPTH)
      .some(isSparseFallbackCandidate);
  if (!useSparseFallback) return baseline;

  const compareFallback = (
    left: RelatedPetV24RankingDiagnostic,
    right: RelatedPetV24RankingDiagnostic,
  ) => compareSparseFallbackCandidates(
    left,
    right,
    input.sourceKind,
    input.candidatesBySlug,
  );
  const sparseRanks = new Map(
    input.diagnostics
      .filter(isSparseFallbackCandidate)
      .toSorted(compareFallback)
      .map(({ slug }, index) => [slug, index + 1]),
  );
  return input.diagnostics.map((diagnostic) => {
    const sparseFallbackRank = sparseRanks.get(diagnostic.slug) ?? null;
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

function isSparseFallbackCandidate(
  diagnostic: RelatedPetV24RankingDiagnostic,
): boolean {
  return diagnostic.tier === "controlled_fallback" &&
    diagnostic.sharedTopicCount > 0;
}

function compareSparseFallbackCandidates(
  left: RelatedPetV24RankingDiagnostic,
  right: RelatedPetV24RankingDiagnostic,
  sourceKind: RelatedPetCandidate["kind"],
  candidatesBySlug: ReadonlyMap<string, RelatedPetCandidate>,
): number {
  const leftRescued = isSparseFallbackCandidate(left);
  const rightRescued = isSparseFallbackCandidate(right);
  if (leftRescued !== rightRescued) return leftRescued ? -1 : 1;
  if (!leftRescued) return compareDiagnostics(left, right);

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

function classifyRelation(
  source: ResolvedRelatedPetAnnotation | null,
  candidate: ResolvedRelatedPetAnnotation | null,
  passesText: boolean,
  passesAnnotation: boolean,
): {
  tier: RelatedPetV24RankingTier;
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
  const franchiseConflict = hasFranchiseConflict(
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
    return {
      tier: "specific_archetype",
      matchedFacets: archetypes,
      franchiseConflict,
    };
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

function hasFranchiseConflict(
  source: ResolvedRelatedPetAnnotation | null,
  candidate: ResolvedRelatedPetAnnotation | null,
  sharedCollections: readonly string[],
  sharedArchetypes: readonly string[],
): boolean {
  if (
    !source ||
    !candidate ||
    sharedCollections.length > 0 ||
    sharedArchetypes.length > 0
  ) {
    return false;
  }
  const sourceKeys = [...source.franchises, ...source.franchiseFamilies];
  const candidateKeys = [
    ...candidate.franchises,
    ...candidate.franchiseFamilies,
  ];
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

function compareDiagnostics(
  left: RelatedPetV24RankingDiagnostic,
  right: RelatedPetV24RankingDiagnostic,
): number {
  const tierDelta = TIER_ORDER[left.tier] - TIER_ORDER[right.tier];
  if (tierDelta !== 0) return tierDelta;
  if (left.tier === "controlled_fallback" || left.tier === "conflict_fallback") {
    return (right.textSimilarity ?? -2) - (left.textSimilarity ?? -2) ||
      (right.annotationSimilarity ?? -2) -
        (left.annotationSimilarity ?? -2) ||
      left.slug.localeCompare(right.slug);
  }
  return right.score - left.score ||
    right.matchedFacets.length - left.matchedFacets.length ||
    (right.annotationSimilarity ?? -2) - (left.annotationSimilarity ?? -2) ||
    (right.textSimilarity ?? -2) - (left.textSimilarity ?? -2) ||
    left.slug.localeCompare(right.slug);
}

function scoreMap(
  matches: readonly RelatedPetV24Similarity[],
): Map<string, number> {
  return new Map(matches.map(({ slug, score }) => [slug, score]));
}

function rankingPositions(
  matches: readonly RelatedPetV24Similarity[],
): Map<string, number> {
  return new Map(matches.map(({ slug }, index) => [slug, index + 1]));
}

function normalizeCandidateMatches(
  matches: readonly RelatedPetV24Similarity[],
  candidateSlugs: ReadonlySet<string>,
): RelatedPetV24Similarity[] {
  const scoresBySlug = new Map<string, number>();
  for (const match of matches) {
    if (
      !candidateSlugs.has(match.slug) ||
      !Number.isFinite(match.score) ||
      match.score < -1 ||
      match.score > 1
    ) {
      continue;
    }
    const current = scoresBySlug.get(match.slug);
    if (current === undefined || match.score > current) {
      scoresBySlug.set(match.slug, match.score);
    }
  }
  return Array.from(scoresBySlug, ([slug, score]) => ({ slug, score }))
    .toSorted((left, right) =>
      right.score - left.score || left.slug.localeCompare(right.slug)
    );
}

function rrfContribution(rank: number | null, weight: number): number {
  return rank !== null && Number.isFinite(weight) && weight > 0
    ? weight / (RELATED_PETS_V24_RRF_K + rank)
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

function uniqueCandidateSlugs(
  candidates: readonly RelatedPetCandidate[],
  sourceSlug: string,
): string[] {
  return Array.from(new Set(candidates
    .map(({ slug }) => slug)
    .filter((slug) => slug !== sourceSlug && slug.length > 0)));
}

function normalizedLimit(limit: number | undefined): number {
  return Number.isFinite(limit)
    ? Math.min(
        RELATED_PETS_SNAPSHOT_DEPTH,
        Math.max(0, Math.trunc(limit ?? RELATED_PETS_SNAPSHOT_DEPTH)),
      )
    : RELATED_PETS_SNAPSHOT_DEPTH;
}

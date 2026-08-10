import {
  rankRelatedPetsByMetadata,
  rankRelatedPetsByTextFirstMetadata,
  rankRelatedPetsByThemeMetadata,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";
import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";

export const RELATED_PETS_RRF_K = 60;
export const RELATED_PETS_TEXT_WEIGHT = 1;
export const RELATED_PETS_METADATA_WEIGHT = 0.15;
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
  textMinSimilarity: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
};

export type RelatedPetsRankingStrategy =
  | "legacy-v7"
  | "theme-first-v8"
  | "text-first-v9";

export type RelatedPetRankingTier =
  | "qualified"
  | "semantic_backfill"
  | "metadata_fallback";

export type RelatedPetRankingDiagnostic = {
  slug: string;
  tier: RelatedPetRankingTier;
  metadataRank: number;
  textRank: number | null;
  visualRank: number | null;
  textSimilarity: number | null;
  visualSimilarity: number | null;
  sharedTagCount: number;
  sharedTagRank: number | null;
  textMinSimilarity: number;
  visualMinSimilarity: number | null;
  passesTextThreshold: boolean;
  passesVisualThreshold: boolean;
  score: number;
  contributions: {
    metadata: number;
    text: number;
    visual: number;
  };
};

export type RelatedPetsRankingResult = {
  slugs: string[];
  diagnostics: RelatedPetRankingDiagnostic[];
  qualifiedCount: number;
  semanticBackfillCount: number;
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
  visualMatches?: readonly RelatedPetSimilarity[];
  textMinSimilarity: number;
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
  visualMatches?: readonly RelatedPetSimilarity[];
  textMinSimilarity: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
  strategy?: RelatedPetsRankingStrategy;
  sharedTagCounts?: Readonly<Record<string, number>>;
  limit?: number;
}): RelatedPetsRankingResult {
  assertCosineThreshold("text", input.textMinSimilarity);
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
  const visualMatches = input.visualMinSimilarity === null
    ? []
    : knownMatches(
        input.visualMatches ?? [],
        input.sourceSlug,
        metadataPosition,
      );
  const textPositions = rankingPositions(textMatches);
  const visualPositions = rankingPositions(visualMatches);
  const textScores = new Map(
    textMatches.map(({ slug, score }) => [slug, score]),
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
    : strategy === "text-first-v9"
      ? textPositions.size > 0
      : textPositions.size > 0 || visualPositions.size > 0;
  const diagnostics = metadataSlugs.map((slug) =>
    createRankingDiagnostic({
      slug,
      metadataRank: metadataPosition.get(slug) ?? Number.MAX_SAFE_INTEGER,
      textRank: textPositions.get(slug) ?? null,
      visualRank: visualPositions.get(slug) ?? null,
      textScore: textScores.get(slug) ?? null,
      visualScore: visualScores.get(slug) ?? null,
      sharedTagCount: sharedTagCounts[slug] ?? 0,
      sharedTagRank: sharedTagRanks.get(slug) ?? null,
      textMinSimilarity: input.textMinSimilarity,
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
            strategy === "text-first-v9" ? textRank !== null : true,
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
  visualVectors?: ReadonlyMap<string, readonly number[]>;
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
  visualVectors?: ReadonlyMap<string, readonly number[]>;
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
  const metadataRanking = strategy === "text-first-v9"
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
    visualMatches: input.visualVectors
      ? rankRelatedPetVectorMatches(input.source.slug, input.visualVectors)
      : [],
    ...input.profile,
    limit: input.limit,
  });
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
  visualRank: number | null;
  textScore: number | null;
  visualScore: number | null;
  sharedTagCount: number;
  sharedTagRank: number | null;
  textMinSimilarity: number;
  visualMinSimilarity: number | null;
  visualWeight: number;
  semanticAvailable: boolean;
  strategy: RelatedPetsRankingStrategy;
}): RelatedPetRankingDiagnostic {
  const passesText =
    input.textScore !== null && input.textScore >= input.textMinSimilarity;
  const passesVisual =
    input.visualMinSimilarity !== null &&
    input.visualScore !== null &&
    input.visualScore >= input.visualMinSimilarity;
  const qualified = input.strategy === "text-first-v9"
    ? passesText
    : input.strategy === "theme-first-v8"
      ? input.sharedTagCount > 0 || passesText
      : input.sharedTagCount > 0 || passesText || passesVisual;
  const metadata = rrfContribution(
    isThemeAwareStrategy(input.strategy)
      ? input.sharedTagRank
      : input.metadataRank,
    RELATED_PETS_METADATA_WEIGHT,
  );
  const qualifiedText = passesText
    ? rrfContribution(input.textRank, RELATED_PETS_TEXT_WEIGHT)
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
    visualRank: input.visualRank,
    textSimilarity: input.textScore,
    visualSimilarity: input.visualScore,
    sharedTagCount: input.sharedTagCount,
    sharedTagRank: input.sharedTagRank,
    textMinSimilarity: input.textMinSimilarity,
    visualMinSimilarity: input.visualMinSimilarity,
    passesTextThreshold: passesText,
    passesVisualThreshold: passesVisual,
  };

  if (!input.semanticAvailable) {
    return {
      ...diagnosticContext,
      tier: qualified ? "qualified" : "metadata_fallback",
      score: metadata,
      contributions: { metadata, text: 0, visual: 0 },
    };
  }

  const contributions = qualified
    ? { metadata, text: qualifiedText, visual: qualifiedVisual }
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
      contributions.metadata + contributions.text + contributions.visual,
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
  return strategy === "theme-first-v8" || strategy === "text-first-v9";
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
  modality: "text" | "visual",
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

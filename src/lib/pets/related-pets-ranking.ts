import {
  selectRelatedPets,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";

export const RELATED_PETS_RRF_K = 60;
export const RELATED_PETS_TEXT_WEIGHT = 1;
export const RELATED_PETS_METADATA_WEIGHT = 0.15;
export const RELATED_PETS_DEFAULT_LIMIT = 4;

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
  textMinSimilarity: number;
  visualMinSimilarity: number;
  visualWeight: number;
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
  return Number.isFinite(similarity) ? similarity : null;
}

export function rankRelatedPetVectorMatches(
  sourceSlug: string,
  vectors: ReadonlyMap<string, readonly number[]>,
): RelatedPetSimilarity[] {
  const sourceVector = vectors.get(sourceSlug);
  if (!sourceVector) return [];

  const matches: RelatedPetSimilarity[] = [];
  for (const [slug, vector] of vectors) {
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
  visualMinSimilarity: number;
  visualWeight: number;
  limit?: number;
}): string[] {
  const metadataSlugs = uniqueKnownSlugs(
    input.metadataSlugs,
    input.sourceSlug,
  );
  const metadataPosition = new Map(
    metadataSlugs.map((slug, index) => [slug, index]),
  );
  const scores = new Map<string, number>();

  addRankScores(
    scores,
    metadataSlugs.map((slug) => ({ slug, score: 1 })),
    RELATED_PETS_METADATA_WEIGHT,
  );
  addRankScores(
    scores,
    acceptedMatches(
      input.textMatches ?? [],
      input.textMinSimilarity,
      input.sourceSlug,
      metadataPosition,
    ),
    RELATED_PETS_TEXT_WEIGHT,
  );
  addRankScores(
    scores,
    acceptedMatches(
      input.visualMatches ?? [],
      input.visualMinSimilarity,
      input.sourceSlug,
      metadataPosition,
    ),
    input.visualWeight,
  );

  const limit = normalizedLimit(input.limit);
  return sortRelatedPetScores(
    Array.from(scores, ([slug, score]) => ({ slug, score })),
    metadataSlugs,
  )
    .slice(0, limit)
    .map(({ slug }) => slug);
}

export function sortRelatedPetScores(
  scores: readonly RelatedPetSimilarity[],
  metadataSlugs: readonly string[],
): RelatedPetSimilarity[] {
  const metadataPosition = new Map(
    metadataSlugs.map((slug, index) => [slug, index]),
  );
  return scores.toSorted(
    (left, right) =>
      right.score - left.score ||
      (metadataPosition.get(left.slug) ?? Number.MAX_SAFE_INTEGER) -
        (metadataPosition.get(right.slug) ?? Number.MAX_SAFE_INTEGER) ||
      left.slug.localeCompare(right.slug),
  );
}

export function rankRelatedPets(input: {
  source: Pick<RelatedPetCandidate, "slug" | "kind" | "tags">;
  candidates: readonly RelatedPetCandidate[];
  textVectors?: ReadonlyMap<string, readonly number[]>;
  visualVectors?: ReadonlyMap<string, readonly number[]>;
  profile: RelatedPetsRankingProfile;
  limit?: number;
}): string[] {
  const candidatesBySlug = new Map<string, RelatedPetCandidate>();
  for (const candidate of input.candidates) {
    if (!candidatesBySlug.has(candidate.slug)) {
      candidatesBySlug.set(candidate.slug, candidate);
    }
  }
  const metadataSlugs = selectRelatedPets(
    Array.from(candidatesBySlug.values()),
    input.source,
    candidatesBySlug.size,
  ).map(({ slug }) => slug);

  return fuseRelatedPetRankings({
    sourceSlug: input.source.slug,
    metadataSlugs,
    textMatches: input.textVectors
      ? rankRelatedPetVectorMatches(input.source.slug, input.textVectors)
      : [],
    visualMatches: input.visualVectors
      ? rankRelatedPetVectorMatches(input.source.slug, input.visualVectors)
      : [],
    ...input.profile,
    limit: input.limit,
  });
}

function acceptedMatches(
  matches: readonly RelatedPetSimilarity[],
  minSimilarity: number,
  sourceSlug: string,
  metadataPosition: ReadonlyMap<string, number>,
): RelatedPetSimilarity[] {
  const accepted = new Map<string, RelatedPetSimilarity>();
  for (const match of matches.toSorted(
    (left, right) =>
      right.score - left.score || left.slug.localeCompare(right.slug),
  )) {
    if (
      match.slug === sourceSlug ||
      !metadataPosition.has(match.slug) ||
      !Number.isFinite(match.score) ||
      match.score < minSimilarity ||
      accepted.has(match.slug)
    ) {
      continue;
    }
    accepted.set(match.slug, match);
  }
  return Array.from(accepted.values());
}

function addRankScores(
  scores: Map<string, number>,
  matches: readonly RelatedPetSimilarity[],
  weight: number,
): void {
  if (!Number.isFinite(weight) || weight <= 0) return;
  matches.forEach(({ slug }, index) => {
    scores.set(
      slug,
      (scores.get(slug) ?? 0) +
        weight / (RELATED_PETS_RRF_K + index + 1),
    );
  });
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

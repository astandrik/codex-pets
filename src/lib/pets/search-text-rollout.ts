import {
  evaluateSearchRolloutGate,
  type RankedSearchObservation,
  type SearchQualityReport,
} from "@/lib/pets/search-eval";
import {
  fuseRankedPets,
  type LexicalPetMatch,
  type SearchablePet,
  type SemanticPetMatch,
} from "@/lib/pets/search-ranking";

export function resolveTextEvaluationThreshold(
  split: "calibration" | "holdout",
  committedThreshold: number,
  recalibrate: () => number,
): number {
  return split === "holdout" ? committedThreshold : recalibrate();
}

export async function collectSequentially<T, TResult>(
  items: readonly T[],
  collect: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  for (const item of items) {
    results.push(await collect(item));
  }
  return results;
}

export function toTextSearchObservation<T extends SearchablePet>(input: {
  category: string;
  query: string;
  relevantSlugs: string[];
  pets: readonly T[];
  lexical: readonly LexicalPetMatch<T>[];
  textMatches: readonly SemanticPetMatch[];
  threshold: number;
  durationMs: number;
  reviewedBy?: string;
}): RankedSearchObservation {
  const lexicalSlugs = input.lexical.map((match) => match.pet.slug);
  const hybridSlugs = fuseRankedPets({
    pets: input.pets,
    lexical: input.lexical,
    semanticRanks: [
      {
        matches: input.textMatches,
        minScore: input.threshold,
        weight: 1,
      },
    ],
  }).map((pet) => pet.slug);
  const lexicalSlugSet = new Set(lexicalSlugs);
  const semanticOnlySlugs = input.textMatches
    .filter(
      (match) =>
        match.score >= input.threshold && !lexicalSlugSet.has(match.slug),
    )
    .toSorted((left, right) => right.score - left.score)
    .map((match) => match.slug);

  return {
    category: input.category,
    query: input.query,
    relevantSlugs: input.relevantSlugs,
    lexicalSlugs,
    hybridSlugs,
    semanticOnlySlugs,
    durationMs: input.durationMs,
    reviewedBy: input.reviewedBy ?? null,
  };
}

export function evaluateTextSearchRolloutGate(
  report: SearchQualityReport,
  evidence: {
    reviewedBy: string;
    providerFallbackHttpStatuses: readonly number[];
  },
) {
  const rolloutGate = evaluateSearchRolloutGate(
    report,
    evidence.providerFallbackHttpStatuses,
  );
  const checks = {
    ...rolloutGate.checks,
    humanReviewIdentity: Boolean(evidence.reviewedBy.trim()),
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

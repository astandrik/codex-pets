import type { PetVisualCalibrationProfile } from "@/lib/pets/search-config";
import {
  fuseRankedPets,
  type LexicalPetMatch,
  type SearchablePet,
  type SemanticPetMatch,
} from "@/lib/pets/search-ranking";

export const VISUAL_SEARCH_CALIBRATION_WEIGHTS = [
  0.25,
  0.5,
  0.75,
  1,
] as const;

export type SemanticThresholdFixture = {
  relevantSlugs: string[];
  negative: boolean;
  matches: Array<{ slug: string; score: number }>;
};

export type RankedSearchObservation = {
  category: string;
  query: string;
  relevantSlugs: string[];
  lexicalSlugs: string[];
  hybridSlugs: string[];
  semanticOnlySlugs: string[];
  durationMs: number;
  reviewedBy?: string | null;
};

export type SearchQualityReport = {
  exactNameMrrAt5: number;
  lexicalNdcgAt5: number;
  hybridNdcgAt5: number;
  hybridNdcgLift: number;
  sexyHasRelevantTop5: boolean;
  sexyHumanReviewedTop5: boolean;
  negativeSemanticOnlySafe: boolean;
  p95DurationMs: number;
};

export type VisualSearchObservation<T extends SearchablePet> = {
  category: string;
  query: string;
  relevantSlugs: string[];
  visualSubset: boolean;
  pets: readonly T[];
  lexical: readonly LexicalPetMatch<T>[];
  textMatches: readonly SemanticPetMatch[];
  visualMatches: readonly SemanticPetMatch[];
  durationMs: number;
};

export type VisualSearchProfileReport = {
  exactNameMrrAt5: number;
  textHybridNdcgAt5: number;
  combinedNdcgAt5: number;
  visualSubsetTextHybridNdcgAt5: number;
  visualSubsetCombinedNdcgAt5: number;
  visualSubsetLift: number;
  sexyHasRelevantTop5: boolean;
  negativeVisualOnlySafe: boolean;
  p95DurationMs: number;
  rankings: Array<{
    query: string;
    textHybridSlugs: string[];
    combinedSlugs: string[];
    visualOnlySlugs: string[];
  }>;
};

export function calibrateVisualSearchProfile<T extends SearchablePet>(
  observations: readonly VisualSearchObservation<T>[],
  textMinSemanticScore: number,
): {
  profile: PetVisualCalibrationProfile;
  report: VisualSearchProfileReport;
  evaluatedProfileCount: number;
} {
  const thresholds = Array.from(
    new Set(
      observations.flatMap((observation) =>
        observation.visualMatches
          .map((match) => match.score)
          .filter(Number.isFinite),
      ),
    ),
  ).sort((left, right) => right - left);
  if (thresholds.length === 0) {
    throw new Error("Visual calibration needs observed visual scores.");
  }

  let selected:
    | {
        profile: PetVisualCalibrationProfile;
        report: VisualSearchProfileReport;
      }
    | undefined;
  for (const minSemanticScore of thresholds) {
    for (const weight of VISUAL_SEARCH_CALIBRATION_WEIGHTS) {
      const profile = { minSemanticScore, weight };
      const report = evaluateVisualSearchProfile(
        observations,
        textMinSemanticScore,
        profile,
      );
      if (!passesVisualCalibrationSafety(report)) continue;
      if (!selected || isBetterVisualProfile(profile, report, selected)) {
        selected = { profile, report };
      }
    }
  }
  if (!selected) {
    throw new Error("No visual calibration profile passes safety gates.");
  }

  return {
    ...selected,
    evaluatedProfileCount:
      thresholds.length * VISUAL_SEARCH_CALIBRATION_WEIGHTS.length,
  };
}

export function evaluateVisualSearchProfile<T extends SearchablePet>(
  observations: readonly VisualSearchObservation<T>[],
  textMinSemanticScore: number,
  profile: PetVisualCalibrationProfile,
): VisualSearchProfileReport {
  const rankings = observations.map((observation) => {
    const textHybridSlugs = fuseRankedPets({
      pets: observation.pets,
      lexical: observation.lexical,
      semanticRanks: [
        {
          matches: observation.textMatches,
          minScore: textMinSemanticScore,
          weight: 1,
        },
      ],
    }).map((pet) => pet.slug);
    const combinedSlugs = fuseRankedPets({
      pets: observation.pets,
      lexical: observation.lexical,
      semanticRanks: [
        {
          matches: observation.textMatches,
          minScore: textMinSemanticScore,
          weight: 1,
        },
        {
          matches: observation.visualMatches,
          minScore: profile.minSemanticScore,
          weight: profile.weight,
        },
      ],
    }).map((pet) => pet.slug);
    const textHybrid = new Set(textHybridSlugs);
    return {
      query: observation.query,
      textHybridSlugs,
      combinedSlugs,
      visualOnlySlugs: combinedSlugs
        .slice(0, 5)
        .filter((slug) => !textHybrid.has(slug)),
    };
  });
  const positives = observations
    .map((observation, index) => ({ observation, ranking: rankings[index] }))
    .filter(({ observation }) => observation.relevantSlugs.length > 0);
  const exact = positives.filter(
    ({ observation }) => observation.category === "exact",
  );
  const visualSubset = positives.filter(
    ({ observation }) => observation.visualSubset,
  );
  const negatives = observations
    .map((observation, index) => ({ observation, ranking: rankings[index] }))
    .filter(({ observation }) => observation.category === "negative");
  const textHybridNdcgAt5 = mean(
    positives.map(({ observation, ranking }) =>
      ndcgAtFive(
        ranking?.textHybridSlugs ?? [],
        observation.relevantSlugs,
      ),
    ),
  );
  const combinedNdcgAt5 = mean(
    positives.map(({ observation, ranking }) =>
      ndcgAtFive(
        ranking?.combinedSlugs ?? [],
        observation.relevantSlugs,
      ),
    ),
  );
  const visualSubsetTextHybridNdcgAt5 = mean(
    visualSubset.map(({ observation, ranking }) =>
      ndcgAtFive(
        ranking?.textHybridSlugs ?? [],
        observation.relevantSlugs,
      ),
    ),
  );
  const visualSubsetCombinedNdcgAt5 = mean(
    visualSubset.map(({ observation, ranking }) =>
      ndcgAtFive(
        ranking?.combinedSlugs ?? [],
        observation.relevantSlugs,
      ),
    ),
  );

  return {
    exactNameMrrAt5: mean(
      exact.map(({ observation, ranking }) =>
        reciprocalRankAtFive(
          ranking?.combinedSlugs ?? [],
          observation.relevantSlugs,
        ),
      ),
    ),
    textHybridNdcgAt5,
    combinedNdcgAt5,
    visualSubsetTextHybridNdcgAt5,
    visualSubsetCombinedNdcgAt5,
    visualSubsetLift: relativeLift(
      visualSubsetTextHybridNdcgAt5,
      visualSubsetCombinedNdcgAt5,
    ),
    sexyHasRelevantTop5: positives
      .filter(
        ({ observation }) => observation.query.toLowerCase() === "sexy",
      )
      .some(({ observation, ranking }) =>
        reciprocalRankAtFive(
          ranking?.combinedSlugs ?? [],
          observation.relevantSlugs,
        ) > 0
      ),
    negativeVisualOnlySafe:
      negatives.length > 0 &&
      negatives.every(
        ({ ranking }) => (ranking?.visualOnlySlugs.length ?? 0) === 0,
      ),
    p95DurationMs: percentile95(
      observations.map((observation) => observation.durationMs),
    ),
    rankings,
  };
}

export function evaluateVisualSearchRolloutGate(
  report: VisualSearchProfileReport,
  textReport: SearchQualityReport,
  evidence: {
    providerFallbackHttpStatuses: readonly number[];
    visualFallbackHttpStatuses: readonly number[];
    captionsAbsentFromPublicContracts: boolean;
    sexyHasRelevantTop5?: boolean;
  },
) {
  const checks = {
    exactNameMrrAt5: report.exactNameMrrAt5 === 1,
    textHybridNdcgLift: textReport.hybridNdcgLift >= 0.2,
    textNegativeSemanticOnlySafe:
      textReport.negativeSemanticOnlySafe,
    combinedOverallNonRegression:
      report.combinedNdcgAt5 >= report.textHybridNdcgAt5,
    visualSubsetNdcgLift: report.visualSubsetLift >= 0.15,
    sexyHasRelevantTop5:
      evidence.sexyHasRelevantTop5 ?? report.sexyHasRelevantTop5,
    negativeVisualOnlySafe: report.negativeVisualOnlySafe,
    p95Duration: report.p95DurationMs < 1_000,
    providerFallbackHttp200:
      evidence.providerFallbackHttpStatuses.length >= 3 &&
      evidence.providerFallbackHttpStatuses.every(
        (status) => status === 200,
      ),
    visualFallbackHttp200:
      evidence.visualFallbackHttpStatuses.length >= 2 &&
      evidence.visualFallbackHttpStatuses.every(
        (status) => status === 200,
      ),
    captionsAbsentFromPublicContracts:
      evidence.captionsAbsentFromPublicContracts,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

export function selectSemanticThreshold(
  fixtures: readonly SemanticThresholdFixture[],
): number {
  const positives = fixtures.filter((fixture) => !fixture.negative);
  if (positives.length === 0) {
    throw new Error("Semantic threshold selection needs positive fixtures.");
  }
  const negatives = fixtures.filter((fixture) => fixture.negative);
  if (negatives.length === 0) {
    throw new Error("Semantic threshold selection needs negative fixtures.");
  }

  let selected: number | null = null;
  let selectedRecall = -1;
  for (let percent = 0; percent <= 100; percent += 1) {
    const threshold = percent / 100;
    const negativesAreSafe = negatives.every(
      (fixture) => acceptedMatches(fixture.matches, threshold).length === 0,
    );
    if (!negativesAreSafe) continue;

    const recall = mean(
      positives.map((fixture) =>
        recallAtFive(
          acceptedMatches(fixture.matches, threshold).map(
            (match) => match.slug,
          ),
          fixture.relevantSlugs,
        ),
      ),
    );
    if (recall > selectedRecall) {
      selected = threshold;
      selectedRecall = recall;
    }
  }

  if (selected === null) {
    throw new Error("No semantic threshold satisfies negative fixtures.");
  }
  return selected;
}

function passesVisualCalibrationSafety(
  report: VisualSearchProfileReport,
): boolean {
  return (
    report.exactNameMrrAt5 === 1 &&
    report.negativeVisualOnlySafe &&
    report.combinedNdcgAt5 >= report.textHybridNdcgAt5 &&
    report.sexyHasRelevantTop5
  );
}

function isBetterVisualProfile(
  profile: PetVisualCalibrationProfile,
  report: VisualSearchProfileReport,
  selected: {
    profile: PetVisualCalibrationProfile;
    report: VisualSearchProfileReport;
  },
): boolean {
  if (
    report.visualSubsetCombinedNdcgAt5 !==
    selected.report.visualSubsetCombinedNdcgAt5
  ) {
    return (
      report.visualSubsetCombinedNdcgAt5 >
      selected.report.visualSubsetCombinedNdcgAt5
    );
  }
  if (profile.weight !== selected.profile.weight) {
    return profile.weight < selected.profile.weight;
  }
  return profile.minSemanticScore > selected.profile.minSemanticScore;
}

function relativeLift(baseline: number, candidate: number): number {
  if (baseline > 0) return (candidate - baseline) / baseline;
  return candidate > 0 ? Number.POSITIVE_INFINITY : 0;
}

export function evaluateSearchQuality(
  observations: readonly RankedSearchObservation[],
): SearchQualityReport {
  const positive = observations.filter(
    (observation) => observation.relevantSlugs.length > 0,
  );
  const exact = positive.filter(
    (observation) => observation.category === "exact",
  );
  const negative = observations.filter(
    (observation) => observation.category === "negative",
  );
  const lexicalNdcgAt5 = mean(
    positive.map((observation) =>
      ndcgAtFive(observation.lexicalSlugs, observation.relevantSlugs),
    ),
  );
  const hybridNdcgAt5 = mean(
    positive.map((observation) =>
      ndcgAtFive(observation.hybridSlugs, observation.relevantSlugs),
    ),
  );

  return {
    exactNameMrrAt5: mean(
      exact.map((observation) =>
        reciprocalRankAtFive(
          observation.hybridSlugs,
          observation.relevantSlugs,
        ),
      ),
    ),
    lexicalNdcgAt5,
    hybridNdcgAt5,
    hybridNdcgLift:
      lexicalNdcgAt5 > 0
        ? (hybridNdcgAt5 - lexicalNdcgAt5) / lexicalNdcgAt5
        : hybridNdcgAt5 > 0
          ? Number.POSITIVE_INFINITY
          : 0,
    sexyHasRelevantTop5: observations
      .filter((observation) => observation.query.toLowerCase() === "sexy")
      .some(
        (observation) =>
          reciprocalRankAtFive(
            observation.hybridSlugs,
            observation.relevantSlugs,
          ) > 0,
      ),
    sexyHumanReviewedTop5: observations
      .filter(
        (observation) =>
          observation.query.toLowerCase() === "sexy" &&
          Boolean(observation.reviewedBy),
      )
      .some(
        (observation) =>
          reciprocalRankAtFive(
            observation.hybridSlugs,
            observation.relevantSlugs,
          ) > 0,
      ),
    negativeSemanticOnlySafe:
      negative.length > 0 &&
      negative.every(
        (observation) => observation.semanticOnlySlugs.length === 0,
      ),
    p95DurationMs: percentile95(
      observations.map((observation) => observation.durationMs),
    ),
  };
}

export function evaluateSearchRolloutGate(
  report: SearchQualityReport,
  providerFallbackHttpStatuses: readonly number[],
) {
  const checks = {
    exactNameMrrAt5: report.exactNameMrrAt5 === 1,
    hybridNdcgLift: report.hybridNdcgLift >= 0.2,
    sexyHumanReviewedTop5: report.sexyHumanReviewedTop5,
    negativeSemanticOnlySafe: report.negativeSemanticOnlySafe,
    p95Duration: report.p95DurationMs < 1_000,
    providerFallbackHttp200:
      providerFallbackHttpStatuses.length >= 3 &&
      providerFallbackHttpStatuses.every((status) => status === 200),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

function acceptedMatches(
  matches: readonly { slug: string; score: number }[],
  threshold: number,
) {
  return matches
    .filter((match) => match.score >= threshold)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, 5);
}

function recallAtFive(ranked: readonly string[], relevant: readonly string[]) {
  if (relevant.length === 0) return 1;
  const relevantSet = new Set(relevant);
  const matches = ranked.slice(0, 5).filter((slug) => relevantSet.has(slug));
  return new Set(matches).size / relevantSet.size;
}

function reciprocalRankAtFive(
  ranked: readonly string[],
  relevant: readonly string[],
): number {
  const relevantSet = new Set(relevant);
  const index = ranked.slice(0, 5).findIndex((slug) => relevantSet.has(slug));
  return index === -1 ? 0 : 1 / (index + 1);
}

function ndcgAtFive(
  ranked: readonly string[],
  relevant: readonly string[],
): number {
  if (relevant.length === 0) return 1;
  const relevantSet = new Set(relevant);
  const dcg = ranked.slice(0, 5).reduce(
    (sum, slug, index) =>
      sum + (relevantSet.has(slug) ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const idealCount = Math.min(5, relevantSet.size);
  const idealDcg = Array.from(
    { length: idealCount },
    (_, index) => 1 / Math.log2(index + 2),
  ).reduce((sum, value) => sum + value, 0);
  return idealDcg === 0 ? 0 : dcg / idealDcg;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

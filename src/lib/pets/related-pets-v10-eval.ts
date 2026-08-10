import {
  evaluateRelatedPetsAcceptance,
  type RelatedPetAcceptanceFixture,
  type RelatedPetAcceptanceRankingCase,
} from "@/lib/pets/related-pets-acceptance";
import {
  evaluateRelatedPetsProfile,
  RELATED_PETS_TOPIC_WEIGHT_CANDIDATES,
  RELATED_PETS_V10_VISUAL_WEIGHT_CANDIDATES,
  type RelatedPetCalibrationObservation,
} from "@/lib/pets/related-pets-calibration";
import {
  RELATED_PETS_V10_METADATA_WEIGHT,
  type RelatedPetsRankingProfile,
} from "@/lib/pets/related-pets-ranking";

const MAX_THRESHOLD_CANDIDATES = 64;
const EPSILON = 1e-12;

type RelatedPetsEvaluationReport = ReturnType<
  typeof evaluateRelatedPetsProfile
>;

export type RelatedPetsV10Profile = RelatedPetsRankingProfile & {
  strategy: "description-theme-v10";
  topicMinSimilarity: number;
  topicWeight: number;
  metadataWeight: number;
};

export function selectRelatedPetsV10Profile(input: {
  fixtures: readonly RelatedPetAcceptanceFixture[];
  observations: readonly RelatedPetCalibrationObservation[];
  descriptionThresholds?: readonly number[];
  topicThresholds?: readonly number[];
  visualThresholds?: readonly number[];
}) {
  assertCalibrationObservations(input.observations);
  const descriptionThresholds = thresholdCandidates(
    input.descriptionThresholds ??
      input.observations.flatMap(({ textMatches }) =>
        textMatches.map(({ score }) => score),
      ),
  );
  const topicThresholds = thresholdCandidates(
    input.topicThresholds ??
      input.observations.flatMap(({ topicMatches = [] }) =>
        topicMatches.map(({ score }) => score),
      ),
  );
  const visualThresholds = thresholdCandidates(
    input.visualThresholds ??
      input.observations.flatMap(({ visualMatches }) =>
        visualMatches.map(({ score }) => score),
      ),
  );

  let topicSelection:
    | {
        profile: RelatedPetsV10Profile;
        report: RelatedPetsEvaluationReport;
        descriptionReport: RelatedPetsEvaluationReport;
        acceptance: ReturnType<typeof evaluateRelatedPetsAcceptance>;
      }
    | undefined;

  for (const textMinSimilarity of descriptionThresholds) {
    const descriptionReport = evaluateRelatedPetsProfile(
      input.observations,
      {
        strategy: "text-first-v9",
        textMinSimilarity,
        metadataWeight: 0,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
    );
    for (const topicMinSimilarity of topicThresholds) {
      for (const topicWeight of RELATED_PETS_TOPIC_WEIGHT_CANDIDATES) {
        const profile: RelatedPetsV10Profile = {
          strategy: "description-theme-v10",
          textMinSimilarity,
          topicMinSimilarity,
          topicWeight,
          metadataWeight: RELATED_PETS_V10_METADATA_WEIGHT,
          visualMinSimilarity: null,
          visualWeight: 0,
        };
        const report = evaluateRelatedPetsProfile(
          input.observations,
          profile,
        );
        const acceptance = evaluateCandidate({
          fixtures: input.fixtures,
          candidate: report,
          noVisual: descriptionReport,
        });
        if (!safeTopicCandidate(acceptance)) continue;
        if (
          !topicSelection ||
          betterTopicSelection(
            { profile, acceptance },
            topicSelection,
          )
        ) {
          topicSelection = {
            profile,
            report,
            descriptionReport,
            acceptance,
          };
        }
      }
    }
  }
  if (!topicSelection) {
    throw new Error(
      "Related-pet V10 calibration found no safe, improving topic profile.",
    );
  }

  let visualSelection:
    | {
        profile: RelatedPetsV10Profile;
        report: RelatedPetsEvaluationReport;
        acceptance: ReturnType<typeof evaluateRelatedPetsAcceptance>;
      }
    | undefined;
  for (const visualMinSimilarity of visualThresholds) {
    for (const visualWeight of RELATED_PETS_V10_VISUAL_WEIGHT_CANDIDATES) {
      const profile: RelatedPetsV10Profile = {
        ...topicSelection.profile,
        visualMinSimilarity,
        visualWeight,
      };
      const report = evaluateRelatedPetsProfile(input.observations, profile);
      const acceptance = evaluateCandidate({
        fixtures: input.fixtures,
        candidate: report,
        noVisual: topicSelection.report,
      });
      if (!safeVisualCandidate(acceptance)) continue;
      if (
        !visualSelection ||
        betterVisualSelection(
          { profile, acceptance },
          visualSelection,
        )
      ) {
        visualSelection = { profile, report, acceptance };
      }
    }
  }
  if (!visualSelection) {
    throw new Error(
      "Related-pet V10 calibration found no safe, improving non-zero visual profile.",
    );
  }

  return {
    selectedProfile: visualSelection.profile,
    descriptionReport: topicSelection.descriptionReport,
    noVisualReport: topicSelection.report,
    report: visualSelection.report,
    topicAcceptance: topicSelection.acceptance,
    acceptance: visualSelection.acceptance,
    descriptionThresholdCount: descriptionThresholds.length,
    topicProfileCount:
      descriptionThresholds.length *
      topicThresholds.length *
      RELATED_PETS_TOPIC_WEIGHT_CANDIDATES.length,
    visualProfileCount:
      visualThresholds.length *
      RELATED_PETS_V10_VISUAL_WEIGHT_CANDIDATES.length,
  };
}

export function createV10AcceptanceRankings(input: {
  fixtures: readonly RelatedPetAcceptanceFixture[];
  description: RelatedPetsEvaluationReport;
  noVisual: RelatedPetsEvaluationReport;
  candidate: RelatedPetsEvaluationReport;
  v8?: RelatedPetsEvaluationReport;
  v7?: RelatedPetsEvaluationReport;
}): RelatedPetAcceptanceRankingCase[] {
  const descriptionBySource = casesBySource(input.description);
  const noVisualBySource = casesBySource(input.noVisual);
  const candidateBySource = casesBySource(input.candidate);
  const v8BySource = casesBySource(input.v8 ?? input.candidate);
  const v7BySource = casesBySource(input.v7 ?? input.candidate);

  return input.fixtures.map((fixture) => {
    const description = requiredCase(descriptionBySource, fixture.sourceSlug);
    const noVisual = requiredCase(noVisualBySource, fixture.sourceSlug);
    const candidate = requiredCase(candidateBySource, fixture.sourceSlug);
    return {
      sourceSlug: fixture.sourceSlug,
      metadataSlugs: candidate.metadataSlugs,
      textSlugs: description.textOnlySlugs,
      noVisualSlugs: noVisual.hybridSlugs,
      candidateSlugs: candidate.hybridSlugs,
      v8Slugs: requiredCase(v8BySource, fixture.sourceSlug).hybridSlugs,
      v7Slugs: requiredCase(v7BySource, fixture.sourceSlug).hybridSlugs,
    };
  });
}

function evaluateCandidate(input: {
  fixtures: readonly RelatedPetAcceptanceFixture[];
  candidate: RelatedPetsEvaluationReport;
  noVisual: RelatedPetsEvaluationReport;
}) {
  return evaluateRelatedPetsAcceptance({
    fixtures: input.fixtures,
    rankings: createV10AcceptanceRankings({
      fixtures: input.fixtures,
      description: input.noVisual,
      noVisual: input.noVisual,
      candidate: input.candidate,
    }),
  });
}

function safeTopicCandidate(
  report: ReturnType<typeof evaluateRelatedPetsAcceptance>,
): boolean {
  return commonSafetyChecks(report) &&
    report.checks.candidateNoWorseThanNoVisualAt4 &&
    report.checks.candidateNoWorseThanNoVisualAt8 &&
    report.cases.some(
      ({ metrics }) =>
        metrics.candidateNdcgAt4 > metrics.noVisualNdcgAt4 + EPSILON ||
        metrics.candidateNdcgAt8 > metrics.noVisualNdcgAt8 + EPSILON,
    );
}

function safeVisualCandidate(
  report: ReturnType<typeof evaluateRelatedPetsAcceptance>,
): boolean {
  return safeTopicCandidate(report) &&
    report.checks.noSevereTextRegressionAt8;
}

function commonSafetyChecks(
  report: ReturnType<typeof evaluateRelatedPetsAcceptance>,
): boolean {
  return report.checks.rankingIntegrity &&
    report.checks.allRequiredNeighborsInTop4 &&
    report.checks.allExplicitTop4NeighborsPresent &&
    report.checks.allExplicitTop8NeighborsPresent &&
    report.checks.allOrderingConstraintsSatisfied &&
    report.checks.noExplicitNegativeInTop8;
}

function betterTopicSelection(
  candidate: {
    profile: RelatedPetsV10Profile;
    acceptance: ReturnType<typeof evaluateRelatedPetsAcceptance>;
  },
  current: {
    profile: RelatedPetsV10Profile;
    acceptance: ReturnType<typeof evaluateRelatedPetsAcceptance>;
  },
): boolean {
  return compareAggregate(candidate.acceptance, current.acceptance) ||
    (sameAggregate(candidate.acceptance, current.acceptance) &&
      (candidate.profile.topicWeight < current.profile.topicWeight ||
        (candidate.profile.topicWeight === current.profile.topicWeight &&
          (candidate.profile.textMinSimilarity >
            current.profile.textMinSimilarity ||
            (candidate.profile.textMinSimilarity ===
              current.profile.textMinSimilarity &&
              candidate.profile.topicMinSimilarity >
                current.profile.topicMinSimilarity)))));
}

function betterVisualSelection(
  candidate: {
    profile: RelatedPetsV10Profile;
    acceptance: ReturnType<typeof evaluateRelatedPetsAcceptance>;
  },
  current: {
    profile: RelatedPetsV10Profile;
    acceptance: ReturnType<typeof evaluateRelatedPetsAcceptance>;
  },
): boolean {
  return compareAggregate(candidate.acceptance, current.acceptance) ||
    (sameAggregate(candidate.acceptance, current.acceptance) &&
      (candidate.profile.visualWeight < current.profile.visualWeight ||
        (candidate.profile.visualWeight === current.profile.visualWeight &&
          (candidate.profile.visualMinSimilarity ?? -1) >
            (current.profile.visualMinSimilarity ?? -1))));
}

function compareAggregate(
  candidate: ReturnType<typeof evaluateRelatedPetsAcceptance>,
  current: ReturnType<typeof evaluateRelatedPetsAcceptance>,
): boolean {
  return candidate.aggregate.candidateNdcgAt4 >
      current.aggregate.candidateNdcgAt4 + EPSILON ||
    (Math.abs(
      candidate.aggregate.candidateNdcgAt4 -
        current.aggregate.candidateNdcgAt4,
    ) <= EPSILON &&
      candidate.aggregate.candidateNdcgAt8 >
        current.aggregate.candidateNdcgAt8 + EPSILON);
}

function sameAggregate(
  left: ReturnType<typeof evaluateRelatedPetsAcceptance>,
  right: ReturnType<typeof evaluateRelatedPetsAcceptance>,
): boolean {
  return Math.abs(
    left.aggregate.candidateNdcgAt4 - right.aggregate.candidateNdcgAt4,
  ) <= EPSILON &&
    Math.abs(
      left.aggregate.candidateNdcgAt8 - right.aggregate.candidateNdcgAt8,
    ) <= EPSILON;
}

function thresholdCandidates(values: readonly number[]): number[] {
  const sorted = Array.from(new Set(values)).toSorted(
    (left, right) => right - left,
  );
  if (
    sorted.length === 0 ||
    sorted.some(
      (value) => !Number.isFinite(value) || value < -1 || value > 1,
    )
  ) {
    throw new Error(
      "Related-pet V10 calibration needs finite cosine similarities.",
    );
  }
  if (sorted.length <= MAX_THRESHOLD_CANDIDATES) return sorted;
  return Array.from(
    new Set(
      Array.from({ length: MAX_THRESHOLD_CANDIDATES }, (_, index) =>
        sorted[
          Math.round(
            (index * (sorted.length - 1)) /
              (MAX_THRESHOLD_CANDIDATES - 1),
          )
        ],
      ),
    ),
  ).filter((value): value is number => value !== undefined);
}

function assertCalibrationObservations(
  observations: readonly RelatedPetCalibrationObservation[],
): void {
  if (
    observations.length === 0 ||
    observations.some(({ split }) => split !== "calibration")
  ) {
    throw new Error("Related-pet V10 selection accepts calibration only.");
  }
}

function casesBySource(report: RelatedPetsEvaluationReport) {
  return new Map(report.cases.map((item) => [item.sourceSlug, item]));
}

function requiredCase(
  cases: ReturnType<typeof casesBySource>,
  sourceSlug: string,
) {
  const item = cases.get(sourceSlug);
  if (!item) {
    throw new Error(`Related-pet V10 ranking is missing for ${sourceSlug}.`);
  }
  return item;
}

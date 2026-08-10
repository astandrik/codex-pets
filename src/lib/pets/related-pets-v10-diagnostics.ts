import {
  evaluateRelatedPetsAcceptance,
  type RelatedPetAcceptanceFixture,
} from "@/lib/pets/related-pets-acceptance";
import {
  evaluateRelatedPetsProfile,
  type RelatedPetCalibrationObservation,
} from "@/lib/pets/related-pets-calibration";
import { RELATED_PETS_V10_METADATA_WEIGHT } from "@/lib/pets/related-pets-ranking";
import {
  createRelatedPetsV10TopicProfileScan,
  createV10AcceptanceRankings,
  type RelatedPetsV10Profile,
  type RelatedPetsV10TopicProfileEvaluation,
} from "@/lib/pets/related-pets-v10-eval";

const COMPARISON_EPSILON = 1e-12;
const FRONTIER_LIMIT = 4;
const TOP_8 = 8;

const ROOT_GATE_NAMES = [
  "hasCaseLift",
  "aggregateNoRegressionAt4",
  "aggregateNoRegressionAt8",
  "rankingIntegrity",
  "requiredNeighborTop4",
  "explicitTop4",
  "explicitTop8",
  "ordering",
  "noHardNegative",
] as const;

export type RelatedPetsV10TopicGateName = typeof ROOT_GATE_NAMES[number];

type AcceptanceReport = ReturnType<typeof evaluateRelatedPetsAcceptance>;
type TopicGateStatus = Record<RelatedPetsV10TopicGateName, boolean> & {
  safeAndImproving: boolean;
};

type CandidateState = {
  evaluation: RelatedPetsV10TopicProfileEvaluation;
  gates: TopicGateStatus;
  failedGates: RelatedPetsV10TopicGateName[];
  totalPositiveDelta: number;
};

export type RelatedPetsV10DiagnosticCoverage = {
  approvedPets: number;
  descriptionQuery: number;
  descriptionDocument: number;
  topicQuery: number;
  topicDocument: number;
  visual: number;
};

export function assertRelatedPetsV10DiagnosticCoverage(
  coverage: RelatedPetsV10DiagnosticCoverage,
): void {
  const expected = coverage.approvedPets;
  const incomplete = Object.entries(coverage)
    .filter(([name, count]) => name !== "approvedPets" && count !== expected)
    .map(([name, count]) => `${name}=${count}`);
  if (!Number.isSafeInteger(expected) || expected < 1 || incomplete.length > 0) {
    throw new Error(
      `Related-pet V10 diagnostic coverage is incomplete: approvedPets=${expected}` +
        (incomplete.length > 0 ? `, ${incomplete.join(", ")}` : ""),
    );
  }
}

export function classifyRelatedPetsV10TopicAcceptance(
  report: AcceptanceReport,
): TopicGateStatus {
  const gates = {
    hasCaseLift: report.cases.some(
      ({ metrics }) =>
        metrics.candidateNdcgAt4 >
          metrics.noVisualNdcgAt4 + COMPARISON_EPSILON ||
        metrics.candidateNdcgAt8 >
          metrics.noVisualNdcgAt8 + COMPARISON_EPSILON,
    ),
    aggregateNoRegressionAt4:
      report.checks.candidateNoWorseThanNoVisualAt4,
    aggregateNoRegressionAt8:
      report.checks.candidateNoWorseThanNoVisualAt8,
    rankingIntegrity: report.checks.rankingIntegrity,
    requiredNeighborTop4: report.checks.allRequiredNeighborsInTop4,
    explicitTop4: report.checks.allExplicitTop4NeighborsPresent,
    explicitTop8: report.checks.allExplicitTop8NeighborsPresent,
    ordering: report.checks.allOrderingConstraintsSatisfied,
    noHardNegative: report.checks.noExplicitNegativeInTop8,
  } satisfies Record<RelatedPetsV10TopicGateName, boolean>;
  return {
    ...gates,
    safeAndImproving: Object.values(gates).every(Boolean),
  };
}

export function diagnoseRelatedPetsV10TopicProfiles(input: {
  fixtures: readonly RelatedPetAcceptanceFixture[];
  observations: readonly RelatedPetCalibrationObservation[];
  descriptionThresholds?: readonly number[];
  topicThresholds?: readonly number[];
}) {
  const scan = createRelatedPetsV10TopicProfileScan(input);
  const gatePassCounts = Object.fromEntries(
    [...ROOT_GATE_NAMES, "safeAndImproving"].map((name) => [name, 0]),
  ) as Record<RelatedPetsV10TopicGateName | "safeAndImproving", number>;
  let evaluatedProfileCount = 0;
  let bestOverall: CandidateState | undefined;
  let bestNonRegressing: CandidateState | undefined;
  let closestToSafe: CandidateState | undefined;
  let bestLift: CandidateState | undefined;

  for (const evaluation of scan.evaluations) {
    evaluatedProfileCount += 1;
    const state = createCandidateState(evaluation);
    for (const gateName of ROOT_GATE_NAMES) {
      if (state.gates[gateName]) gatePassCounts[gateName] += 1;
    }
    if (state.gates.safeAndImproving) {
      gatePassCounts.safeAndImproving += 1;
    }

    if (!bestOverall || betterOverall(state, bestOverall)) {
      bestOverall = state;
    }
    if (
      state.gates.aggregateNoRegressionAt4 &&
      state.gates.aggregateNoRegressionAt8 &&
      (!bestNonRegressing || betterOverall(state, bestNonRegressing))
    ) {
      bestNonRegressing = state;
    }
    if (!closestToSafe || closerToSafe(state, closestToSafe)) {
      closestToSafe = state;
    }
    if (
      state.gates.hasCaseLift &&
      (!bestLift || betterLift(state, bestLift))
    ) {
      bestLift = state;
    }
  }

  if (
    evaluatedProfileCount !== scan.profileCount ||
    !bestOverall ||
    !closestToSafe
  ) {
    throw new Error("Related-pet V10 diagnostic profile scan is incomplete.");
  }

  const frontierStates = {
    bestOverall,
    bestNonRegressing,
    closestToSafe,
    bestLift,
  };
  const ablationStates = uniqueFrontierStates(frontierStates);

  return {
    version: 1,
    split: "calibration" as const,
    caseCount: input.fixtures.length,
    thresholds: {
      description: scan.descriptionThresholds,
      topic: scan.topicThresholds,
      topicWeights: scan.topicWeights,
    },
    profileCount: scan.profileCount,
    evaluatedProfileCount,
    gatePassCounts,
    selectorSafeImprovingCount: gatePassCounts.safeAndImproving,
    topicEvidence: createTopicEvidence(input.fixtures, input.observations),
    frontier: {
      bestOverall: createCandidateDigest(bestOverall),
      bestNonRegressing: bestNonRegressing
        ? createCandidateDigest(bestNonRegressing)
        : null,
      closestToSafe: createCandidateDigest(closestToSafe),
      bestLift: bestLift ? createCandidateDigest(bestLift) : null,
    },
    ablations: ablationStates.map((state) =>
      createAblationReport(input.fixtures, input.observations, state)
    ),
    frontierLimit: FRONTIER_LIMIT,
  };
}

function createCandidateState(
  evaluation: RelatedPetsV10TopicProfileEvaluation,
): CandidateState {
  const gates = classifyRelatedPetsV10TopicAcceptance(evaluation.acceptance);
  return {
    evaluation,
    gates,
    failedGates: ROOT_GATE_NAMES.filter((name) => !gates[name]),
    totalPositiveDelta: evaluation.acceptance.cases.reduce(
      (sum, { metrics }) =>
        sum +
        Math.max(0, metrics.candidateNdcgAt4 - metrics.noVisualNdcgAt4) +
        Math.max(0, metrics.candidateNdcgAt8 - metrics.noVisualNdcgAt8),
      0,
    ),
  };
}

function betterOverall(candidate: CandidateState, current: CandidateState) {
  const candidateAggregate = candidate.evaluation.acceptance.aggregate;
  const currentAggregate = current.evaluation.acceptance.aggregate;
  return candidateAggregate.candidateNdcgAt4 >
      currentAggregate.candidateNdcgAt4 + COMPARISON_EPSILON ||
    (approximatelyEqual(
      candidateAggregate.candidateNdcgAt4,
      currentAggregate.candidateNdcgAt4,
    ) &&
      (candidateAggregate.candidateNdcgAt8 >
          currentAggregate.candidateNdcgAt8 + COMPARISON_EPSILON ||
        (approximatelyEqual(
          candidateAggregate.candidateNdcgAt8,
          currentAggregate.candidateNdcgAt8,
        ) && preferProfile(candidate, current))));
}

function closerToSafe(candidate: CandidateState, current: CandidateState) {
  return candidate.failedGates.length < current.failedGates.length ||
    (candidate.failedGates.length === current.failedGates.length &&
      (candidate.evaluation.acceptance.improvedCaseCount >
          current.evaluation.acceptance.improvedCaseCount ||
        (candidate.evaluation.acceptance.improvedCaseCount ===
            current.evaluation.acceptance.improvedCaseCount &&
          betterOverall(candidate, current))));
}

function betterLift(candidate: CandidateState, current: CandidateState) {
  return candidate.evaluation.acceptance.improvedCaseCount >
      current.evaluation.acceptance.improvedCaseCount ||
    (candidate.evaluation.acceptance.improvedCaseCount ===
        current.evaluation.acceptance.improvedCaseCount &&
      (candidate.totalPositiveDelta >
          current.totalPositiveDelta + COMPARISON_EPSILON ||
        (approximatelyEqual(
          candidate.totalPositiveDelta,
          current.totalPositiveDelta,
        ) && betterOverall(candidate, current))));
}

function preferProfile(candidate: CandidateState, current: CandidateState) {
  const left = candidate.evaluation.profile;
  const right = current.evaluation.profile;
  return left.topicWeight < right.topicWeight ||
    (left.topicWeight === right.topicWeight &&
      (left.textMinSimilarity > right.textMinSimilarity ||
        (left.textMinSimilarity === right.textMinSimilarity &&
          left.topicMinSimilarity > right.topicMinSimilarity)));
}

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) <= COMPARISON_EPSILON;
}

function uniqueFrontierStates(frontier: {
  bestOverall: CandidateState;
  bestNonRegressing?: CandidateState;
  closestToSafe: CandidateState;
  bestLift?: CandidateState;
}) {
  const unique = new Map<string, CandidateState>();
  for (const state of [
    frontier.bestOverall,
    frontier.bestNonRegressing,
    frontier.closestToSafe,
    frontier.bestLift,
  ]) {
    if (!state) continue;
    unique.set(profileKey(state.evaluation.profile), state);
  }
  return Array.from(unique.values()).slice(0, FRONTIER_LIMIT);
}

function createCandidateDigest(state: CandidateState) {
  const { acceptance, report } = state.evaluation;
  const reportCases = new Map(
    report.cases.map((item) => [item.sourceSlug, item]),
  );
  return {
    profile: serializeProfile(state.evaluation.profile),
    aggregate: createAggregateDigest(acceptance),
    improvedCaseCount: acceptance.improvedCaseCount,
    qualifiedCount: report.qualifiedCount,
    semanticBackfillCount: report.semanticBackfillCount,
    gates: state.gates,
    failedGates: state.failedGates,
    cases: acceptance.cases.map((item) => {
      const reportCase = reportCases.get(item.sourceSlug);
      if (!reportCase) {
        throw new Error(
          `Related-pet V10 diagnostic ranking is missing for ${item.sourceSlug}.`,
        );
      }
      return {
        id: item.id,
        sourceSlug: item.sourceSlug,
        baselineTop8: item.noVisualSlugs.slice(0, TOP_8),
        candidateTop8: item.candidateSlugs.slice(0, TOP_8),
        ndcgAt4: {
          baseline: roundMetric(item.metrics.noVisualNdcgAt4),
          candidate: roundMetric(item.metrics.candidateNdcgAt4),
          delta: roundMetric(
            item.metrics.candidateNdcgAt4 - item.metrics.noVisualNdcgAt4,
          ),
        },
        ndcgAt8: {
          baseline: roundMetric(item.metrics.noVisualNdcgAt8),
          candidate: roundMetric(item.metrics.candidateNdcgAt8),
          delta: roundMetric(
            item.metrics.candidateNdcgAt8 - item.metrics.noVisualNdcgAt8,
          ),
        },
        requiredNeighborTop4: item.mustIncludeTop4Satisfied,
        explicitTop4: item.mustIncludeAllTop4Satisfied,
        explicitTop8: item.mustIncludeAllTop8Satisfied,
        ordering: item.orderingConstraintsSatisfied,
        hardNegativeTop8: item.negativeTop8Slugs,
        rankingIntegrity: item.rankingIntegrity,
        qualifiedCount: reportCase.qualifiedCount,
        semanticBackfillCount: reportCase.semanticBackfillCount,
      };
    }),
  };
}

function createAblationReport(
  fixtures: readonly RelatedPetAcceptanceFixture[],
  observations: readonly RelatedPetCalibrationObservation[],
  state: CandidateState,
) {
  const { profile, descriptionReport } = state.evaluation;
  const variants = [
    {
      name: "qualification_only",
      profile: { ...profile, topicWeight: 0, metadataWeight: 0 },
    },
    {
      name: "topic_rrf",
      profile: { ...profile, metadataWeight: 0 },
    },
    {
      name: "shared_topic",
      profile: {
        ...profile,
        topicWeight: 0,
        metadataWeight: RELATED_PETS_V10_METADATA_WEIGHT,
      },
    },
    { name: "full_v10", profile },
  ] as const;

  return {
    sourceProfile: serializeProfile(profile),
    variants: variants.map(({ name, profile: variantProfile }) => {
      const report = name === "full_v10"
        ? state.evaluation.report
        : evaluateRelatedPetsProfile(observations, variantProfile);
      const acceptance = evaluateRelatedPetsAcceptance({
        fixtures,
        rankings: createV10AcceptanceRankings({
          fixtures,
          description: descriptionReport,
          noVisual: descriptionReport,
          candidate: report,
        }),
      });
      const gates = classifyRelatedPetsV10TopicAcceptance(acceptance);
      return {
        name,
        profile: serializeProfile(variantProfile),
        aggregate: createAggregateDigest(acceptance),
        improvedCaseCount: acceptance.improvedCaseCount,
        qualifiedCount: report.qualifiedCount,
        semanticBackfillCount: report.semanticBackfillCount,
        gates,
        failedGates: ROOT_GATE_NAMES.filter((gateName) => !gates[gateName]),
        cases: acceptance.cases.map((item) => ({
          id: item.id,
          sourceSlug: item.sourceSlug,
          ndcgAt4Delta: roundMetric(
            item.metrics.candidateNdcgAt4 - item.metrics.noVisualNdcgAt4,
          ),
          ndcgAt8Delta: roundMetric(
            item.metrics.candidateNdcgAt8 - item.metrics.noVisualNdcgAt8,
          ),
          hardNegativeTop8: item.negativeTop8Slugs,
          requiredNeighborTop4: item.mustIncludeTop4Satisfied,
          explicitTop4: item.mustIncludeAllTop4Satisfied,
          explicitTop8: item.mustIncludeAllTop8Satisfied,
          ordering: item.orderingConstraintsSatisfied,
        })),
      };
    }),
  };
}

function createAggregateDigest(report: AcceptanceReport) {
  return {
    baselineNdcgAt4: roundMetric(report.aggregate.noVisualNdcgAt4),
    candidateNdcgAt4: roundMetric(report.aggregate.candidateNdcgAt4),
    deltaNdcgAt4: roundMetric(
      report.aggregate.candidateNdcgAt4 - report.aggregate.noVisualNdcgAt4,
    ),
    baselineNdcgAt8: roundMetric(report.aggregate.noVisualNdcgAt8),
    candidateNdcgAt8: roundMetric(report.aggregate.candidateNdcgAt8),
    deltaNdcgAt8: roundMetric(
      report.aggregate.candidateNdcgAt8 - report.aggregate.noVisualNdcgAt8,
    ),
  };
}

function createTopicEvidence(
  fixtures: readonly RelatedPetAcceptanceFixture[],
  observations: readonly RelatedPetCalibrationObservation[],
) {
  const observationsBySource = new Map(
    observations.map((observation) => [observation.sourceSlug, observation]),
  );
  return fixtures.toSorted((left, right) => left.id.localeCompare(right.id)).map(
    (fixture) => {
      const observation = observationsBySource.get(fixture.sourceSlug);
      if (!observation?.topicMatches) {
        throw new Error(
          `Related-pet V10 diagnostic topic ranking is missing for ${fixture.sourceSlug}.`,
        );
      }
      const topicMatches = new Map(
        observation.topicMatches.map((match, index) => [
          match.slug,
          { rank: index + 1, score: roundMetric(match.score) },
        ]),
      );
      const relevant = Object.entries(fixture.relevance)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([slug, grade]) => ({
          slug,
          grade,
          ...(topicMatches.get(slug) ?? { rank: null, score: null }),
        }));
      const negatives = fixture.negativeSlugs.toSorted().map((slug) => ({
        slug,
        ...(topicMatches.get(slug) ?? { rank: null, score: null }),
      }));
      const relevantScores = relevant.flatMap(({ score }) =>
        score === null ? [] : [score]
      );
      const negativeScores = negatives.flatMap(({ score }) =>
        score === null ? [] : [score]
      );
      return {
        id: fixture.id,
        sourceSlug: fixture.sourceSlug,
        relevant,
        negatives,
        relevantNegativeMargin:
          relevantScores.length > 0 && negativeScores.length > 0
            ? roundMetric(
                Math.min(...relevantScores) - Math.max(...negativeScores),
              )
            : null,
      };
    },
  );
}

function serializeProfile(profile: RelatedPetsV10Profile) {
  return {
    strategy: profile.strategy,
    textMinSimilarity: roundMetric(profile.textMinSimilarity),
    topicMinSimilarity: roundMetric(profile.topicMinSimilarity),
    topicWeight: profile.topicWeight,
    metadataWeight: profile.metadataWeight,
    visualMinSimilarity: profile.visualMinSimilarity,
    visualWeight: profile.visualWeight,
  };
}

function profileKey(profile: RelatedPetsV10Profile) {
  return [
    profile.textMinSimilarity,
    profile.topicMinSimilarity,
    profile.topicWeight,
    profile.metadataWeight,
  ].join(":");
}

function roundMetric(value: number) {
  return Number(value.toFixed(12));
}

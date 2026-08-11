import {
  gradedNdcgAtK,
  type RelatedPetAcceptanceFixture,
} from "@/lib/pets/related-pets-acceptance";
import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import {
  rankRelatedPetVectorMatches,
  rankRelatedPetsWithDiagnostics,
  type RelatedPetsPrecomputedMatches,
  type RelatedPetsRankingProfile,
} from "@/lib/pets/related-pets-ranking";

const ANNOTATION_WEIGHTS = [0.25, 0.5, 1] as const;
const VISUAL_WEIGHTS = [0.1, 0.25, 0.5] as const;
const MAX_THRESHOLD_CANDIDATES = 64;
const DIAGNOSTIC_FRONTIER_LIMIT = 8;
const EPSILON = 1e-12;
const DIAGNOSTIC_GATE_NAMES = [
  "hasCaseLift",
  "noQualifiedHardNegatives",
  "mandatorySatisfied",
  "orderingSatisfied",
  "integritySatisfied",
  "noConflictFallback",
  "noWorseThanDescription",
  "noWorseThanV7V8",
  "withinV10Tolerance",
] as const;

export type RelatedPetsV11Dataset = {
  fixtures: readonly RelatedPetAcceptanceFixture[];
  candidates: readonly RelatedPetCandidate[];
  textQueryVectors: ReadonlyMap<string, readonly number[]>;
  textDocumentVectors: ReadonlyMap<string, readonly number[]>;
  annotationQueryVectors: ReadonlyMap<string, readonly number[]>;
  annotationDocumentVectors: ReadonlyMap<string, readonly number[]>;
  visualVectors: ReadonlyMap<string, readonly number[]>;
  annotations: ReadonlyMap<string, ResolvedRelatedPetAnnotation>;
};

export type RelatedPetsV11ComparisonRankings = {
  description: ReadonlyMap<string, readonly string[]>;
  v7: ReadonlyMap<string, readonly string[]>;
  v8: ReadonlyMap<string, readonly string[]>;
  v10Best: ReadonlyMap<string, readonly string[]>;
};

export type RelatedPetsV11Profile = RelatedPetsRankingProfile & {
  strategy: "entity-controlled-v11";
  annotationMinSimilarity: number;
  annotationWeight: number;
};

export type RelatedPetsV11SimilarityCache = ReadonlyMap<
  string,
  RelatedPetsPrecomputedMatches
>;

export function createRelatedPetsV11SimilarityCache(
  dataset: RelatedPetsV11Dataset,
): RelatedPetsV11SimilarityCache {
  return new Map(dataset.candidates.map(({ slug }) => [slug, {
    text: rankRelatedPetVectorMatches(
      slug,
      dataset.textQueryVectors,
      dataset.textDocumentVectors,
    ),
    annotation: rankRelatedPetVectorMatches(
      slug,
      dataset.annotationQueryVectors,
      dataset.annotationDocumentVectors,
    ),
    visual: rankRelatedPetVectorMatches(slug, dataset.visualVectors),
  }]));
}

export function evaluateRelatedPetsV11Profile(input: {
  dataset: RelatedPetsV11Dataset;
  profile: RelatedPetsV11Profile;
  comparisons: RelatedPetsV11ComparisonRankings;
  similarityCache?: RelatedPetsV11SimilarityCache;
  catalogIntegrityScope?: "all" | "fixture-sources";
}) {
  const candidatesBySlug = new Map(
    input.dataset.candidates.map((candidate) => [candidate.slug, candidate]),
  );
  const cases = input.dataset.fixtures.map((fixture) => {
    const source = candidatesBySlug.get(fixture.sourceSlug);
    if (!source) throw new Error(`Missing V11 source ${fixture.sourceSlug}.`);
    const ranking = rankRelatedPetsWithDiagnostics({
      source,
      candidates: input.dataset.candidates,
      textQueryVectors: input.dataset.textQueryVectors,
      textDocumentVectors: input.dataset.textDocumentVectors,
      annotationQueryVectors: input.dataset.annotationQueryVectors,
      annotationDocumentVectors: input.dataset.annotationDocumentVectors,
      visualVectors: input.dataset.visualVectors,
      annotations: input.dataset.annotations,
      precomputedMatches: input.similarityCache?.get(fixture.sourceSlug),
      profile: input.profile,
      limit: 8,
    });
    const slugs = ranking.slugs;
    const top4 = slugs.slice(0, 4);
    const top8 = slugs.slice(0, 8);
    const negativeSlugsPresent = fixture.negativeSlugs.filter((slug) =>
      top8.includes(slug)
    );
    const qualifiedNegativeSlugsPresent = ranking.diagnostics
      .filter(({ slug, tier }) =>
        negativeSlugsPresent.includes(slug) &&
        tier !== "controlled_fallback" &&
        tier !== "conflict_fallback"
      )
      .map(({ slug }) => slug);
    const missingAllTop4 = fixture.mustIncludeAllTop4.filter((slug) =>
      !top4.includes(slug)
    );
    const missingAllTop8 = fixture.mustIncludeAllTop8.filter((slug) =>
      !top8.includes(slug)
    );
    const oneOfTop4Satisfied = fixture.mustIncludeOneOfTop4.length === 0 ||
      fixture.mustIncludeOneOfTop4.some((slug) => top4.includes(slug));
    const orderingViolations = (fixture.mustRankBefore ?? []).filter(
      ({ higherSlug, lowerSlug }) =>
        rankingIndex(slugs, higherSlug) >= rankingIndex(slugs, lowerSlug),
    );
    const comparisonCases = Object.fromEntries(
      Object.entries(input.comparisons).map(([name, rankings]) => {
        const comparisonSlugs = requiredRanking(rankings, fixture.sourceSlug);
        return [name, {
          slugs: comparisonSlugs,
          ndcgAt4: gradedNdcgAtK(comparisonSlugs, fixture.relevance, 4),
          ndcgAt8: gradedNdcgAtK(comparisonSlugs, fixture.relevance, 8),
        }];
      }),
    ) as Record<keyof RelatedPetsV11ComparisonRankings, {
      slugs: readonly string[];
      ndcgAt4: number;
      ndcgAt8: number;
    }>;
    return {
      sourceSlug: fixture.sourceSlug,
      slugs,
      diagnostics: ranking.diagnostics,
      ndcgAt4: gradedNdcgAtK(slugs, fixture.relevance, 4),
      ndcgAt8: gradedNdcgAtK(slugs, fixture.relevance, 8),
      descriptionNdcgAt4: gradedNdcgAtK(
        requiredRanking(input.comparisons.description, fixture.sourceSlug),
        fixture.relevance,
        4,
      ),
      descriptionNdcgAt8: gradedNdcgAtK(
        requiredRanking(input.comparisons.description, fixture.sourceSlug),
        fixture.relevance,
        8,
      ),
      comparisons: comparisonCases,
      negativeCount: negativeSlugsPresent.length,
      negativeSlugsPresent,
      qualifiedNegativeCount: qualifiedNegativeSlugsPresent.length,
      qualifiedNegativeSlugsPresent,
      mandatory: {
        oneOfTop4: fixture.mustIncludeOneOfTop4,
        oneOfTop4Satisfied,
        missingAllTop4,
        missingAllTop8,
      },
      mandatorySatisfied:
        oneOfTop4Satisfied &&
        missingAllTop4.length === 0 &&
        missingAllTop8.length === 0,
      orderingViolations,
      orderingSatisfied: orderingViolations.length === 0,
      integritySatisfied:
        slugs.length === Math.min(8, input.dataset.candidates.length - 1) &&
        new Set(slugs).size === slugs.length &&
        !slugs.includes(fixture.sourceSlug),
    };
  });
  const catalogIntegrityScope = input.catalogIntegrityScope ?? "all";
  const allCatalogConflictFallbackCount = catalogIntegrityScope ===
      "fixture-sources"
    ? cases.reduce(
        (count, item) => count + item.diagnostics.filter(
          ({ tier }) => tier === "conflict_fallback",
        ).length,
        0,
      )
    : input.dataset.candidates.reduce(
        (count, source) => count + rankRelatedPetsWithDiagnostics({
          source,
          candidates: input.dataset.candidates,
          textQueryVectors: input.dataset.textQueryVectors,
          textDocumentVectors: input.dataset.textDocumentVectors,
          annotationQueryVectors: input.dataset.annotationQueryVectors,
          annotationDocumentVectors: input.dataset.annotationDocumentVectors,
          visualVectors: input.dataset.visualVectors,
          annotations: input.dataset.annotations,
          precomputedMatches: input.similarityCache?.get(source.slug),
          profile: input.profile,
          limit: 8,
        }).diagnostics.filter(({ tier }) => tier === "conflict_fallback").length,
        0,
      );
  const aggregate = aggregateCases(cases);
  const baselines = Object.fromEntries(
    Object.entries(input.comparisons).map(([name, rankings]) => [
      name,
      aggregateFixtures(input.dataset.fixtures, rankings),
    ]),
  ) as Record<keyof RelatedPetsV11ComparisonRankings, { ndcgAt4: number; ndcgAt8: number }>;
  return {
    profile: input.profile,
    cases,
    ...aggregate,
    baselines,
    catalogIntegrityScope,
    allCatalogConflictFallbackCount,
    checks: {
      noQualifiedHardNegatives: cases.every(
        ({ qualifiedNegativeCount }) => qualifiedNegativeCount === 0,
      ),
      mandatorySatisfied: cases.every(({ mandatorySatisfied }) => mandatorySatisfied),
      orderingSatisfied: cases.every(({ orderingSatisfied }) => orderingSatisfied),
      integritySatisfied: cases.every(({ integritySatisfied }) => integritySatisfied),
      noConflictFallback: allCatalogConflictFallbackCount === 0,
      noWorseThanDescription:
        aggregate.ndcgAt4 + EPSILON >= baselines.description.ndcgAt4 &&
        aggregate.ndcgAt8 + EPSILON >= baselines.description.ndcgAt8,
      noWorseThanV7V8:
        aggregate.ndcgAt4 + EPSILON >= Math.max(baselines.v7.ndcgAt4, baselines.v8.ndcgAt4) &&
        aggregate.ndcgAt8 + EPSILON >= Math.max(baselines.v7.ndcgAt8, baselines.v8.ndcgAt8),
      withinV10Tolerance:
        aggregate.ndcgAt4 + 0.02 + EPSILON >= baselines.v10Best.ndcgAt4 &&
        aggregate.ndcgAt8 + 0.02 + EPSILON >= baselines.v10Best.ndcgAt8,
    },
  };
}

export function selectRelatedPetsV11Profile(input: {
  dataset: RelatedPetsV11Dataset;
  comparisons: RelatedPetsV11ComparisonRankings;
  descriptionThresholds?: readonly number[];
  annotationThresholds?: readonly number[];
  visualThresholds?: readonly number[];
}) {
  const similarityCache = createRelatedPetsV11SimilarityCache(input.dataset);
  const descriptionThresholds = thresholdCandidates(
    input.descriptionThresholds ?? similarities(input.dataset, "description"),
  );
  const annotationThresholds = thresholdCandidates(
    input.annotationThresholds ?? similarities(input.dataset, "annotation"),
  );
  let noVisual: ReturnType<typeof evaluateRelatedPetsV11Profile> | null = null;
  for (const textMinSimilarity of descriptionThresholds) {
    for (const annotationMinSimilarity of annotationThresholds) {
      for (const annotationWeight of ANNOTATION_WEIGHTS) {
        const screeningReport = evaluateRelatedPetsV11Profile({
          dataset: input.dataset,
          comparisons: input.comparisons,
          similarityCache,
          catalogIntegrityScope: "fixture-sources",
          profile: {
            strategy: "entity-controlled-v11",
            textMinSimilarity,
            annotationMinSimilarity,
            annotationWeight,
            visualMinSimilarity: null,
            visualWeight: 0,
          },
        });
        if (
          !passesSafety(screeningReport) ||
          !improvesDescriptionCase(screeningReport)
        ) continue;
        const report = evaluateRelatedPetsV11Profile({
          dataset: input.dataset,
          comparisons: input.comparisons,
          similarityCache,
          profile: screeningReport.profile,
        });
        if (!passesSafety(report)) continue;
        if (!noVisual || betterReport(report, noVisual, annotationWeight, noVisual.profile.annotationWeight)) {
          noVisual = report;
        }
      }
    }
  }
  if (!noVisual) {
    throw new Error("Related-pet V11 calibration found no safe annotation profile.");
  }

  const visualThresholds = thresholdCandidates(
    input.visualThresholds ?? similarities(input.dataset, "visual"),
  );
  let selected: ReturnType<typeof evaluateRelatedPetsV11Profile> | null = null;
  for (const visualMinSimilarity of visualThresholds) {
    for (const visualWeight of VISUAL_WEIGHTS) {
      const screeningReport = evaluateRelatedPetsV11Profile({
        dataset: input.dataset,
        comparisons: input.comparisons,
        similarityCache,
        catalogIntegrityScope: "fixture-sources",
        profile: { ...noVisual.profile, visualMinSimilarity, visualWeight },
      });
      if (
        !passesSafety(screeningReport) ||
        screeningReport.ndcgAt4 + EPSILON < noVisual.ndcgAt4 ||
        screeningReport.ndcgAt8 + EPSILON < noVisual.ndcgAt8 ||
        screeningReport.cases.some((item, index) =>
          item.ndcgAt8 + 0.1 + EPSILON < (noVisual?.cases[index]?.ndcgAt8 ?? 0)
        ) ||
        !screeningReport.cases.some((item, index) =>
          item.ndcgAt4 > (noVisual?.cases[index]?.ndcgAt4 ?? 0) + EPSILON ||
          item.ndcgAt8 > (noVisual?.cases[index]?.ndcgAt8 ?? 0) + EPSILON
        )
      ) {
        continue;
      }
      const report = evaluateRelatedPetsV11Profile({
        dataset: input.dataset,
        comparisons: input.comparisons,
        similarityCache,
        profile: screeningReport.profile,
      });
      if (!passesSafety(report)) continue;
      if (!selected || betterReport(report, selected, visualWeight, selected.profile.visualWeight)) {
        selected = report;
      }
    }
  }
  if (!selected) {
    throw new Error("Related-pet V11 calibration found no safe visual profile.");
  }
  return {
    selectedProfile: selected.profile,
    noVisualReport: noVisual,
    report: selected,
    evaluatedAnnotationProfileCount:
      descriptionThresholds.length * annotationThresholds.length * ANNOTATION_WEIGHTS.length,
    evaluatedVisualProfileCount: visualThresholds.length * VISUAL_WEIGHTS.length,
  };
}

export function diagnoseRelatedPetsV11AnnotationProfiles(input: {
  dataset: RelatedPetsV11Dataset;
  comparisons: RelatedPetsV11ComparisonRankings;
  descriptionThresholds?: readonly number[];
  annotationThresholds?: readonly number[];
}) {
  const similarityCache = createRelatedPetsV11SimilarityCache(input.dataset);
  const descriptionThresholds = thresholdCandidates(
    input.descriptionThresholds ?? similarities(input.dataset, "description"),
  );
  const annotationThresholds = thresholdCandidates(
    input.annotationThresholds ?? similarities(input.dataset, "annotation"),
  );
  const gatePassCounts = Object.fromEntries(
    DIAGNOSTIC_GATE_NAMES.map((name) => [name, 0]),
  ) as Record<(typeof DIAGNOSTIC_GATE_NAMES)[number], number>;
  const frontier: ReturnType<typeof createDiagnosticDigest>[] = [];
  let evaluatedProfileCount = 0;
  let screeningSafeAndImprovingCount = 0;
  let fullSafeAndImprovingCount = 0;

  for (const textMinSimilarity of descriptionThresholds) {
    for (const annotationMinSimilarity of annotationThresholds) {
      for (const annotationWeight of ANNOTATION_WEIGHTS) {
        evaluatedProfileCount += 1;
        const profile = {
          strategy: "entity-controlled-v11" as const,
          textMinSimilarity,
          annotationMinSimilarity,
          annotationWeight,
          visualMinSimilarity: null,
          visualWeight: 0,
        };
        const screeningReport = evaluateRelatedPetsV11Profile({
          dataset: input.dataset,
          comparisons: input.comparisons,
          similarityCache,
          catalogIntegrityScope: "fixture-sources",
          profile,
        });
        const screeningGates = diagnosticGates(screeningReport);
        for (const name of DIAGNOSTIC_GATE_NAMES) {
          if (screeningGates[name]) gatePassCounts[name] += 1;
        }

        let report = screeningReport;
        let scope: "fixture-sources" | "all" = "fixture-sources";
        if (Object.values(screeningGates).every(Boolean)) {
          screeningSafeAndImprovingCount += 1;
          report = evaluateRelatedPetsV11Profile({
            dataset: input.dataset,
            comparisons: input.comparisons,
            similarityCache,
            profile,
          });
          scope = "all";
          if (Object.values(diagnosticGates(report)).every(Boolean)) {
            fullSafeAndImprovingCount += 1;
          }
        }
        addDiagnosticFrontier(
          frontier,
          createDiagnosticDigest(report, scope),
        );
      }
    }
  }

  return {
    version: 1,
    split: "calibration" as const,
    caseCount: input.dataset.fixtures.length,
    thresholds: {
      descriptionCount: descriptionThresholds.length,
      annotationCount: annotationThresholds.length,
      annotationWeights: ANNOTATION_WEIGHTS,
    },
    profileCount:
      descriptionThresholds.length * annotationThresholds.length *
      ANNOTATION_WEIGHTS.length,
    evaluatedProfileCount,
    gatePassCounts,
    screeningSafeAndImprovingCount,
    fullSafeAndImprovingCount,
    frontierLimit: DIAGNOSTIC_FRONTIER_LIMIT,
    frontier,
  };
}

function diagnosticGates(
  report: ReturnType<typeof evaluateRelatedPetsV11Profile>,
) {
  return {
    hasCaseLift: improvesDescriptionCase(report),
    ...report.checks,
  };
}

function createDiagnosticDigest(
  report: ReturnType<typeof evaluateRelatedPetsV11Profile>,
  scope: "fixture-sources" | "all",
) {
  const gates = diagnosticGates(report);
  return {
    profile: report.profile,
    scope,
    failedGates: DIAGNOSTIC_GATE_NAMES.filter((name) => !gates[name]),
    ndcgAt4: report.ndcgAt4,
    ndcgAt8: report.ndcgAt8,
    baselines: report.baselines,
    allCatalogConflictFallbackCount: report.allCatalogConflictFallbackCount,
    cases: report.cases.map((item) => ({
      sourceSlug: item.sourceSlug,
      slugs: item.slugs,
      ndcgAt4: item.ndcgAt4,
      ndcgAt8: item.ndcgAt8,
      negativeSlugsPresent: item.negativeSlugsPresent,
      negativeDiagnostics: item.diagnostics
        .filter(({ slug }) => item.negativeSlugsPresent.includes(slug))
        .map((diagnostic) => ({
          slug: diagnostic.slug,
          tier: diagnostic.tier,
          textRank: diagnostic.textRank,
          annotationRank: diagnostic.annotationRank,
          textSimilarity: diagnostic.textSimilarity,
          annotationSimilarity: diagnostic.annotationSimilarity,
          passesTextThreshold: diagnostic.passesTextThreshold,
          passesAnnotationThreshold: diagnostic.passesAnnotationThreshold,
          matchedFacets: diagnostic.matchedFacets,
          franchiseConflict: diagnostic.franchiseConflict,
          fallbackProvenance: diagnostic.fallbackProvenance,
          contributions: diagnostic.contributions,
        })),
      mandatorySatisfied: item.mandatorySatisfied,
      orderingSatisfied: item.orderingSatisfied,
      conflictFallbackCount: item.diagnostics.filter(
        ({ tier }) => tier === "conflict_fallback",
      ).length,
    })),
  };
}

function addDiagnosticFrontier(
  frontier: ReturnType<typeof createDiagnosticDigest>[],
  candidate: ReturnType<typeof createDiagnosticDigest>,
) {
  frontier.push(candidate);
  frontier.sort(compareDiagnosticDigests);
  if (frontier.length > DIAGNOSTIC_FRONTIER_LIMIT) frontier.pop();
}

function compareDiagnosticDigests(
  left: ReturnType<typeof createDiagnosticDigest>,
  right: ReturnType<typeof createDiagnosticDigest>,
) {
  return left.failedGates.length - right.failedGates.length ||
    right.ndcgAt4 - left.ndcgAt4 ||
    right.ndcgAt8 - left.ndcgAt8 ||
    left.profile.annotationWeight - right.profile.annotationWeight ||
    right.profile.annotationMinSimilarity -
      left.profile.annotationMinSimilarity ||
    right.profile.textMinSimilarity - left.profile.textMinSimilarity;
}

function passesSafety(report: ReturnType<typeof evaluateRelatedPetsV11Profile>): boolean {
  return Object.values(report.checks).every(Boolean);
}

function improvesDescriptionCase(report: ReturnType<typeof evaluateRelatedPetsV11Profile>): boolean {
  return report.cases.some((item) =>
    item.ndcgAt4 > item.descriptionNdcgAt4 + EPSILON ||
    item.ndcgAt8 > item.descriptionNdcgAt8 + EPSILON
  );
}

function betterReport(
  left: ReturnType<typeof evaluateRelatedPetsV11Profile>,
  right: ReturnType<typeof evaluateRelatedPetsV11Profile>,
  leftWeight: number,
  rightWeight: number,
): boolean {
  return left.ndcgAt4 > right.ndcgAt4 + EPSILON ||
    (Math.abs(left.ndcgAt4 - right.ndcgAt4) <= EPSILON &&
      (left.ndcgAt8 > right.ndcgAt8 + EPSILON ||
        (Math.abs(left.ndcgAt8 - right.ndcgAt8) <= EPSILON &&
          (leftWeight < rightWeight ||
            (leftWeight === rightWeight &&
              (left.profile.annotationMinSimilarity > right.profile.annotationMinSimilarity ||
                (left.profile.annotationMinSimilarity === right.profile.annotationMinSimilarity &&
                  left.profile.textMinSimilarity > right.profile.textMinSimilarity)))))));
}

function similarities(
  dataset: RelatedPetsV11Dataset,
  kind: "description" | "annotation" | "visual",
): number[] {
  const query = kind === "description"
    ? dataset.textQueryVectors
    : kind === "annotation"
      ? dataset.annotationQueryVectors
      : dataset.visualVectors;
  const document = kind === "description"
    ? dataset.textDocumentVectors
    : kind === "annotation"
      ? dataset.annotationDocumentVectors
      : dataset.visualVectors;
  return dataset.fixtures.flatMap(({ sourceSlug }) =>
    rankRelatedPetVectorMatches(sourceSlug, query, document).map(({ score }) => score)
  );
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
      "Related-pet V11 calibration needs finite cosine similarities.",
    );
  }
  if (sorted.length <= MAX_THRESHOLD_CANDIDATES) return sorted;
  return Array.from(new Set(
    Array.from({ length: MAX_THRESHOLD_CANDIDATES }, (_, index) =>
      sorted[Math.round(
        (index * (sorted.length - 1)) / (MAX_THRESHOLD_CANDIDATES - 1),
      )]
    ),
  )).filter((value): value is number => value !== undefined);
}

function requiredRanking(
  rankings: ReadonlyMap<string, readonly string[]>,
  sourceSlug: string,
): readonly string[] {
  const ranking = rankings.get(sourceSlug);
  if (!ranking) throw new Error(`Missing comparison ranking for ${sourceSlug}.`);
  return ranking;
}

function aggregateFixtures(
  fixtures: readonly RelatedPetAcceptanceFixture[],
  rankings: ReadonlyMap<string, readonly string[]>,
) {
  return aggregateCases(fixtures.map((fixture) => {
    const ranking = requiredRanking(rankings, fixture.sourceSlug);
    return {
      ndcgAt4: gradedNdcgAtK(ranking, fixture.relevance, 4),
      ndcgAt8: gradedNdcgAtK(ranking, fixture.relevance, 8),
    };
  }));
}

function aggregateCases(cases: readonly { ndcgAt4: number; ndcgAt8: number }[]) {
  return {
    ndcgAt4: cases.reduce((sum, item) => sum + item.ndcgAt4, 0) / cases.length,
    ndcgAt8: cases.reduce((sum, item) => sum + item.ndcgAt8, 0) / cases.length,
  };
}

function rankingIndex(ranking: readonly string[], slug: string): number {
  const index = ranking.indexOf(slug);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

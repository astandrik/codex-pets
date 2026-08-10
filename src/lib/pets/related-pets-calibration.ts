import {
  fuseRelatedPetRankingsWithDiagnostics,
  fuseRelatedPetTextMetadataBaseline,
  rankRelatedPetVectorMatches,
  type RelatedPetSimilarity,
  type RelatedPetsRankingProfile,
  type RelatedPetsRankingStrategy,
} from "@/lib/pets/related-pets-ranking";
import {
  rankRelatedPetsByMetadata,
  rankRelatedPetsByTextFirstMetadata,
  rankRelatedPetsByThemeMetadata,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";
import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";

export const RELATED_PETS_VISUAL_WEIGHT_CANDIDATES = [
  0.25,
  0.5,
  0.75,
] as const;

export type RelatedPetCalibrationObservation = {
  groupId: string;
  split: "calibration" | "holdout";
  sourceSlug: string;
  relevantSlugs: readonly string[];
  negativeSlugs: readonly string[];
  metadataSlugs: readonly string[];
  sharedTagCounts: Readonly<Record<string, number>>;
  textMatches: readonly RelatedPetSimilarity[];
  visualMatches: readonly RelatedPetSimilarity[];
};

export type RelatedPetCalibrationCase = {
  groupId: string;
  split: "calibration" | "holdout";
  sourceSlug: string;
  relevantSlugs: string[];
  negativeSlugs?: string[];
};

type RelatedPetEvalCaseFixture = {
  sourceSlug: string;
  relevantSlugs: readonly string[];
  negativeSlugs?: readonly string[];
};

type RelatedPetEvalFixture = {
  id: string;
  split: string;
  relevantSlugs?: readonly string[];
  cases?: readonly RelatedPetEvalCaseFixture[];
};

export function createRelatedPetsCalibrationCases(
  fixtures: readonly RelatedPetEvalFixture[],
): {
  calibration: RelatedPetCalibrationCase[];
  holdout: RelatedPetCalibrationCase[];
} {
  const cases = {
    calibration: [] as RelatedPetCalibrationCase[],
    holdout: [] as RelatedPetCalibrationCase[],
  };

  const groupIds = new Set<string>();
  for (const fixture of fixtures) {
    if (
      fixture.id.length === 0 ||
      groupIds.has(fixture.id) ||
      (fixture.split !== "calibration" && fixture.split !== "holdout") ||
      (fixture.relevantSlugs === undefined) ===
        (fixture.cases === undefined)
    ) {
      throw new Error(
        `Related-pet calibration fixture ${fixture.id || "<unnamed>"} is incompatible.`,
      );
    }
    groupIds.add(fixture.id);
    const split = fixture.split;
    const splitCases = cases[split];
    if (fixture.relevantSlugs) {
      assertFixtureSlugs(fixture.id, fixture.relevantSlugs, 2);
      for (const sourceSlug of fixture.relevantSlugs) {
        splitCases.push({
          groupId: fixture.id,
          split,
          sourceSlug,
          relevantSlugs: fixture.relevantSlugs.filter(
            (slug) => slug !== sourceSlug,
          ),
          negativeSlugs: [],
        });
      }
      continue;
    }

    if (!fixture.cases || fixture.cases.length === 0) {
      throw incompatibleFixture(fixture.id);
    }
    const sourceSlugs = new Set<string>();
    for (const fixtureCase of fixture.cases) {
      const negativeSlugs = fixtureCase.negativeSlugs ?? [];
      assertFixtureSlugs(fixture.id, fixtureCase.relevantSlugs, 1);
      assertFixtureSlugs(fixture.id, negativeSlugs, 0);
      if (
        fixtureCase.sourceSlug.length === 0 ||
        sourceSlugs.has(fixtureCase.sourceSlug) ||
        fixtureCase.relevantSlugs.includes(fixtureCase.sourceSlug) ||
        negativeSlugs.includes(fixtureCase.sourceSlug) ||
        negativeSlugs.some((slug) =>
          fixtureCase.relevantSlugs.includes(slug)
        )
      ) {
        throw incompatibleFixture(fixture.id);
      }
      sourceSlugs.add(fixtureCase.sourceSlug);
      splitCases.push({
        groupId: fixture.id,
        split,
        sourceSlug: fixtureCase.sourceSlug,
        relevantSlugs: [...fixtureCase.relevantSlugs],
        negativeSlugs: [...negativeSlugs],
      });
    }
  }

  return cases;
}

export function createRelatedPetsCalibrationObservations(input: {
  cases: readonly RelatedPetCalibrationCase[];
  candidates: readonly RelatedPetCandidate[];
  textQueryVectors: ReadonlyMap<string, readonly number[]>;
  textDocumentVectors: ReadonlyMap<string, readonly number[]>;
  visualVectors: ReadonlyMap<string, readonly number[]>;
  strategy?: RelatedPetsRankingStrategy;
}): RelatedPetCalibrationObservation[] {
  const candidatesBySlug = new Map(
    input.candidates.map((candidate) => [candidate.slug, candidate]),
  );

  return input.cases.map((calibrationCase) => {
    const source = candidatesBySlug.get(calibrationCase.sourceSlug);
    if (!source) {
      throw new Error(
        `Related-pet calibration source ${calibrationCase.sourceSlug} is missing from the approved catalog.`,
      );
    }
    const metadataRanking = input.strategy === "text-first-v9"
      ? rankRelatedPetsByTextFirstMetadata(
          Array.from(candidatesBySlug.values()),
          source,
        )
      : input.strategy === "theme-first-v8"
        ? rankRelatedPetsByThemeMetadata(
          Array.from(candidatesBySlug.values()),
          source,
        )
        : rankRelatedPetsByMetadata(
          Array.from(candidatesBySlug.values()),
          source,
        );
    return {
      ...calibrationCase,
      negativeSlugs: calibrationCase.negativeSlugs ?? [],
      metadataSlugs: metadataRanking.map(({ candidate }) => candidate.slug),
      sharedTagCounts: Object.fromEntries(
        metadataRanking.map(({ candidate, sharedTagCount }) => [
          candidate.slug,
          sharedTagCount,
        ]),
      ),
      textMatches: rankRelatedPetVectorMatches(
        source.slug,
        input.textQueryVectors,
        input.textDocumentVectors,
      ),
      visualMatches: rankRelatedPetVectorMatches(
        source.slug,
        input.visualVectors,
      ),
    };
  });
}

export function ndcgAtK(
  ranked: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  if (!Number.isSafeInteger(k) || k < 1) {
    throw new Error("Related-pet nDCG cutoff must be a positive integer.");
  }
  if (relevant.length === 0) return 1;
  const relevantSet = new Set(relevant);
  const seenRelevant = new Set<string>();
  const dcg = ranked.slice(0, k).reduce((sum, slug, index) => {
    if (!relevantSet.has(slug) || seenRelevant.has(slug)) return sum;
    seenRelevant.add(slug);
    return sum + 1 / Math.log2(index + 2);
  }, 0);
  const idealCount = Math.min(k, relevantSet.size);
  const idealDcg = Array.from(
    { length: idealCount },
    (_, index) => 1 / Math.log2(index + 2),
  ).reduce((sum, value) => sum + value, 0);
  return dcg / idealDcg;
}

export function ndcgAt4(
  ranked: readonly string[],
  relevant: readonly string[],
): number {
  return ndcgAtK(ranked, relevant, 4);
}

export function ndcgAt8(
  ranked: readonly string[],
  relevant: readonly string[],
): number {
  return ndcgAtK(ranked, relevant, 8);
}

export function selectRelatedTextThreshold(
  observations: readonly RelatedPetCalibrationObservation[],
  thresholds?: readonly number[],
  strategy: RelatedPetsRankingStrategy = "theme-first-v8",
) {
  assertObservationSplit(observations, "calibration");
  const candidates = thresholdCandidates(
    thresholds ??
      observations.flatMap(({ textMatches }) =>
        textMatches.map(({ score }) => score),
      ),
    "text",
  );
  let selected:
    | {
        textMinSimilarity: number;
        ndcgAt4: number;
        ndcgAt8: number;
      }
    | undefined;

  for (const textMinSimilarity of candidates) {
    const report = evaluateRelatedPetsProfile(observations, {
      strategy,
      textMinSimilarity,
      visualMinSimilarity: null,
      visualWeight: 0,
    });
    if (
      !report.textContribution.aggregateNoWorseThanMetadata ||
      report.textContribution.improvedCaseCount === 0 ||
      report.textContribution.changedTop4CaseCount === 0
    ) {
      continue;
    }
    if (
      !selected ||
      report.textMetadataNdcgAt4 > selected.ndcgAt4 ||
      (report.textMetadataNdcgAt4 === selected.ndcgAt4 &&
        (report.textMetadataNdcgAt8 > selected.ndcgAt8 ||
          (report.textMetadataNdcgAt8 === selected.ndcgAt8 &&
            textMinSimilarity > selected.textMinSimilarity)))
    ) {
      selected = {
        textMinSimilarity,
        ndcgAt4: report.textMetadataNdcgAt4,
        ndcgAt8: report.textMetadataNdcgAt8,
      };
    }
  }
  if (!selected) {
    throw new Error(
      "Related-pet calibration found no safe, contributing text profile.",
    );
  }

  return {
    ...selected,
    evaluatedThresholdCount: candidates.length,
  };
}

export function selectRelatedVisualProfile(
  observations: readonly RelatedPetCalibrationObservation[],
  textMinSimilarity: number,
  thresholds?: readonly number[],
  strategy: RelatedPetsRankingStrategy = "theme-first-v8",
) {
  assertObservationSplit(observations, "calibration");
  const candidates = thresholdCandidates(
    thresholds ??
      observations.flatMap(({ visualMatches }) =>
        visualMatches.map(({ score }) => score),
      ),
    "visual",
  );
  const baseline = evaluateRelatedPetsProfile(observations, {
    strategy,
    textMinSimilarity,
    visualMinSimilarity: null,
    visualWeight: 0,
  });
  let selected:
    | {
        visualMinSimilarity: number;
        visualWeight: (typeof RELATED_PETS_VISUAL_WEIGHT_CANDIDATES)[number];
        ndcgAt4: number;
        ndcgAt8: number;
      }
    | undefined;

  for (const visualMinSimilarity of candidates) {
    for (const visualWeight of RELATED_PETS_VISUAL_WEIGHT_CANDIDATES) {
      const report = evaluateRelatedPetsProfile(observations, {
        strategy,
        textMinSimilarity,
        visualMinSimilarity,
        visualWeight,
      });
      if (
        report.hybridNdcgAt4 < baseline.hybridNdcgAt4 ||
        report.hybridNdcgAt8 < baseline.hybridNdcgAt8 ||
        report.visualContribution.improvedCaseCount === 0 ||
        report.negativeTop8Count > 0
      ) {
        continue;
      }
      if (
        !selected ||
        report.hybridNdcgAt4 > selected.ndcgAt4 ||
        (report.hybridNdcgAt4 === selected.ndcgAt4 &&
          (report.hybridNdcgAt8 > selected.ndcgAt8 ||
            (report.hybridNdcgAt8 === selected.ndcgAt8 &&
              (visualWeight < selected.visualWeight ||
                (visualWeight === selected.visualWeight &&
                  visualMinSimilarity > selected.visualMinSimilarity)))))
      ) {
        selected = {
          visualMinSimilarity,
          visualWeight,
          ndcgAt4: report.hybridNdcgAt4,
          ndcgAt8: report.hybridNdcgAt8,
        };
      }
    }
  }
  if (!selected) {
    throw new Error(
      "Related-pet calibration found no safe, improving non-zero visual profile.",
    );
  }

  return {
    ...selected,
    evaluatedProfileCount:
      candidates.length * RELATED_PETS_VISUAL_WEIGHT_CANDIDATES.length +
      1,
  };
}

export function evaluateRelatedPetsCalibration(
  observations: readonly RelatedPetCalibrationObservation[],
  pinnedProfile: RelatedPetsRankingProfile,
) {
  const strategy = pinnedProfile.strategy ?? "legacy-v7";
  const textSelection = selectRelatedTextThreshold(
    observations,
    undefined,
    strategy,
  );
  const visualSelection = selectRelatedVisualProfile(
    observations,
    textSelection.textMinSimilarity,
    undefined,
    strategy,
  );
  const selectedProfile = {
    strategy,
    textMinSimilarity: textSelection.textMinSimilarity,
    visualMinSimilarity: visualSelection.visualMinSimilarity,
    visualWeight: visualSelection.visualWeight,
  };
  const profileMatches =
    pinnedProfile.strategy === strategy &&
    selectedProfile.textMinSimilarity ===
      pinnedProfile.textMinSimilarity &&
    selectedProfile.visualMinSimilarity ===
      pinnedProfile.visualMinSimilarity &&
    selectedProfile.visualWeight === pinnedProfile.visualWeight;

  const report = evaluateRelatedPetsProfile(observations, selectedProfile);
  const comparisons = {
    textMetadataNoWorseThanMetadata:
      report.textContribution.aggregateNoWorseThanMetadata,
    textImprovesAtLeastOneCase:
      report.textContribution.improvedCaseCount > 0,
    textChangesAtLeastOneTop4:
      report.textContribution.changedTop4CaseCount > 0,
    hybridNoWorseThanMetadataAt4:
      report.hybridNdcgAt4 >= report.metadataNdcgAt4,
    hybridNoWorseThanTextMetadataAt4:
      report.hybridNdcgAt4 >= report.textMetadataNdcgAt4,
    hybridNoWorseThanMetadataAt8:
      report.hybridNdcgAt8 >= report.metadataNdcgAt8,
    hybridNoWorseThanTextMetadataAt8:
      report.hybridNdcgAt8 >= report.textMetadataNdcgAt8,
    visualImprovesAtLeastOneCase:
      report.visualContribution.improvedCaseCount > 0,
    noExplicitNegativeInTop8: report.negativeTop8Count === 0,
  };

  return {
    selectedProfile,
    pinnedProfile: {
      strategy: pinnedProfile.strategy,
      textMinSimilarity: pinnedProfile.textMinSimilarity,
      visualMinSimilarity: pinnedProfile.visualMinSimilarity,
      visualWeight: pinnedProfile.visualWeight,
    },
    profileMatches,
    comparisons,
    passed: profileMatches && Object.values(comparisons).every(Boolean),
    textEvaluatedThresholdCount:
      textSelection.evaluatedThresholdCount,
    visualEvaluatedProfileCount:
      visualSelection.evaluatedProfileCount,
    report,
  };
}

export function evaluateRelatedPetsHoldout(
  observations: readonly RelatedPetCalibrationObservation[],
  profile: RelatedPetsRankingProfile,
) {
  assertObservationSplit(observations, "holdout");
  const report = evaluateRelatedPetsProfile(observations, profile);
  const comparisons = {
    hybridNoWorseThanMetadataAt4:
      report.hybridNdcgAt4 >= report.metadataNdcgAt4,
    hybridNoWorseThanTextMetadataAt4:
      report.hybridNdcgAt4 >= report.textMetadataNdcgAt4,
    hybridNoWorseThanMetadataAt8:
      report.hybridNdcgAt8 >= report.metadataNdcgAt8,
    hybridNoWorseThanTextMetadataAt8:
      report.hybridNdcgAt8 >= report.textMetadataNdcgAt8,
  };
  return {
    ...report,
    comparisons,
    passed: Object.values(comparisons).every(Boolean),
  };
}

export function evaluateRelatedPetsProfile(
  observations: readonly RelatedPetCalibrationObservation[],
  profile: RelatedPetsRankingProfile,
) {
  const cases = observations.map((observation) => {
    const metadataSlugs = uniqueSlugs(
      observation.metadataSlugs,
      observation.sourceSlug,
    ).slice(0, RELATED_PETS_SNAPSHOT_DEPTH);
    const textMetadataSlugs = fuseRelatedPetTextMetadataBaseline({
      sourceSlug: observation.sourceSlug,
      metadataSlugs: observation.metadataSlugs,
      sharedTagCounts: observation.sharedTagCounts,
      textMatches: observation.textMatches,
      textMinSimilarity: profile.textMinSimilarity,
      strategy: profile.strategy,
    });
    const textOnlySlugs = uniqueSlugs(
      observation.textMatches.map(({ slug }) => slug),
      observation.sourceSlug,
    ).slice(0, RELATED_PETS_SNAPSHOT_DEPTH);
    const hybridRanking = fuseRelatedPetRankingsWithDiagnostics({
      sourceSlug: observation.sourceSlug,
      metadataSlugs: observation.metadataSlugs,
      sharedTagCounts: observation.sharedTagCounts,
      textMatches: observation.textMatches,
      visualMatches: observation.visualMatches,
      ...profile,
    });
    const hybridSlugs = hybridRanking.slugs;
    const negativeSlugs = observation.negativeSlugs ?? [];
    const negativeTop8Slugs = hybridSlugs.filter((slug) =>
      negativeSlugs.includes(slug)
    );
    return {
      groupId: observation.groupId,
      sourceSlug: observation.sourceSlug,
      metadataSlugs,
      textOnlySlugs,
      textMetadataSlugs,
      hybridSlugs,
      negativeTop8Slugs,
      hybridDiagnostics: hybridRanking.diagnostics,
      qualifiedCount: hybridRanking.qualifiedCount,
      semanticBackfillCount: hybridRanking.semanticBackfillCount,
      metadataNdcgAt4: ndcgAt4(
        metadataSlugs,
        observation.relevantSlugs,
      ),
      textMetadataNdcgAt4: ndcgAt4(
        textMetadataSlugs,
        observation.relevantSlugs,
      ),
      hybridNdcgAt4: ndcgAt4(
        hybridSlugs,
        observation.relevantSlugs,
      ),
      metadataNdcgAt8: ndcgAt8(
        metadataSlugs,
        observation.relevantSlugs,
      ),
      textMetadataNdcgAt8: ndcgAt8(
        textMetadataSlugs,
        observation.relevantSlugs,
      ),
      hybridNdcgAt8: ndcgAt8(
        hybridSlugs,
        observation.relevantSlugs,
      ),
    };
  });

  const metadataNdcgAt4 = mean(
    cases.map((item) => item.metadataNdcgAt4),
  );
  const textMetadataNdcgAt4 = mean(
    cases.map((item) => item.textMetadataNdcgAt4),
  );
  const metadataNdcgAt8 = mean(
    cases.map((item) => item.metadataNdcgAt8),
  );
  const textMetadataNdcgAt8 = mean(
    cases.map((item) => item.textMetadataNdcgAt8),
  );
  return {
    metadataNdcgAt4,
    textMetadataNdcgAt4,
    hybridNdcgAt4: mean(cases.map((item) => item.hybridNdcgAt4)),
    metadataNdcgAt8,
    textMetadataNdcgAt8,
    hybridNdcgAt8: mean(cases.map((item) => item.hybridNdcgAt8)),
    qualifiedCount: sum(cases.map((item) => item.qualifiedCount)),
    semanticBackfillCount: sum(
      cases.map((item) => item.semanticBackfillCount),
    ),
    negativeTop8Count: sum(
      cases.map((item) => item.negativeTop8Slugs.length),
    ),
    textContribution: {
      aggregateNoWorseThanMetadata:
        textMetadataNdcgAt4 >= metadataNdcgAt4 &&
        textMetadataNdcgAt8 >= metadataNdcgAt8,
      aggregateNoWorseThanMetadataAt4:
        textMetadataNdcgAt4 >= metadataNdcgAt4,
      aggregateNoWorseThanMetadataAt8:
        textMetadataNdcgAt8 >= metadataNdcgAt8,
      improvedCaseCount: cases.filter(
        (item) => item.textMetadataNdcgAt4 > item.metadataNdcgAt4,
      ).length,
      changedTop4CaseCount: cases.filter(
        (item) =>
          !sameTopK(item.textMetadataSlugs, item.metadataSlugs, 4),
      ).length,
    },
    visualContribution: {
      improvedCaseCount: cases.filter(
        (item) =>
          item.hybridNdcgAt4 > item.textMetadataNdcgAt4 ||
          item.hybridNdcgAt8 > item.textMetadataNdcgAt8,
      ).length,
    },
    cases,
  };
}

function thresholdCandidates(
  values: readonly number[],
  modality: "text" | "visual",
): number[] {
  if (
    values.length === 0 ||
    values.some(
      (value) => !Number.isFinite(value) || value < -1 || value > 1,
    )
  ) {
    throw new Error(
      `Related-pet ${modality} calibration needs finite similarity scores inside the supported cosine range [-1, 1].`,
    );
  }
  return Array.from(new Set(values)).sort(
    (left, right) => right - left,
  );
}

function assertFixtureSlugs(
  fixtureId: string,
  slugs: readonly string[],
  minimumLength: number,
): void {
  if (
    slugs.length < minimumLength ||
    new Set(slugs).size !== slugs.length ||
    slugs.some((slug) => slug.length === 0)
  ) {
    throw incompatibleFixture(fixtureId);
  }
}

function incompatibleFixture(fixtureId: string): Error {
  return new Error(
    `Related-pet calibration fixture ${fixtureId || "<unnamed>"} is incompatible.`,
  );
}

function assertObservationSplit(
  observations: readonly RelatedPetCalibrationObservation[],
  split: RelatedPetCalibrationObservation["split"],
): void {
  if (
    observations.length === 0 ||
    observations.some((observation) => observation.split !== split)
  ) {
    throw new Error(
      `Related-pet evaluation requires ${split} observations only.`,
    );
  }
}

function uniqueSlugs(
  slugs: readonly string[],
  sourceSlug: string,
): string[] {
  return Array.from(new Set(slugs.filter((slug) => slug !== sourceSlug)));
}

function sameTopK(
  left: readonly string[],
  right: readonly string[],
  k: number,
): boolean {
  const leftTopK = left.slice(0, k);
  const rightTopK = right.slice(0, k);
  return leftTopK.length === rightTopK.length &&
    leftTopK.every((slug, index) => slug === rightTopK[index]);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

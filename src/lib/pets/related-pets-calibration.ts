import {
  fuseRelatedPetRankings,
  rankRelatedPetVectorMatches,
  type RelatedPetSimilarity,
  type RelatedPetsRankingProfile,
} from "@/lib/pets/related-pets-ranking";
import {
  selectRelatedPets,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";

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
  metadataSlugs: readonly string[];
  textMatches: readonly RelatedPetSimilarity[];
  visualMatches: readonly RelatedPetSimilarity[];
};

export type RelatedPetCalibrationCase = {
  groupId: string;
  split: "calibration" | "holdout";
  sourceSlug: string;
  relevantSlugs: string[];
};

type RelatedPetEvalFixture = {
  id: string;
  split: string;
  relevantSlugs: readonly string[];
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
      fixture.relevantSlugs.length < 2 ||
      new Set(fixture.relevantSlugs).size !== fixture.relevantSlugs.length ||
      fixture.relevantSlugs.some((slug) => slug.length === 0)
    ) {
      throw new Error(
        `Related-pet calibration fixture ${fixture.id || "<unnamed>"} is incompatible.`,
      );
    }
    groupIds.add(fixture.id);
    const split = fixture.split;
    const splitCases = cases[split];
    for (const sourceSlug of fixture.relevantSlugs) {
      splitCases.push({
        groupId: fixture.id,
        split,
        sourceSlug,
        relevantSlugs: fixture.relevantSlugs.filter(
          (slug) => slug !== sourceSlug,
        ),
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
    return {
      ...calibrationCase,
      metadataSlugs: selectRelatedPets(
        Array.from(candidatesBySlug.values()),
        source,
        candidatesBySlug.size,
      ).map(({ slug }) => slug),
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

export function ndcgAt4(
  ranked: readonly string[],
  relevant: readonly string[],
): number {
  if (relevant.length === 0) return 1;
  const relevantSet = new Set(relevant);
  const seenRelevant = new Set<string>();
  const dcg = ranked.slice(0, 4).reduce((sum, slug, index) => {
    if (!relevantSet.has(slug) || seenRelevant.has(slug)) return sum;
    seenRelevant.add(slug);
    return sum + 1 / Math.log2(index + 2);
  }, 0);
  const idealCount = Math.min(4, relevantSet.size);
  const idealDcg = Array.from(
    { length: idealCount },
    (_, index) => 1 / Math.log2(index + 2),
  ).reduce((sum, value) => sum + value, 0);
  return dcg / idealDcg;
}

export function selectRelatedTextThreshold(
  observations: readonly RelatedPetCalibrationObservation[],
  thresholds?: readonly number[],
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
      }
    | undefined;

  for (const textMinSimilarity of candidates) {
    const report = evaluateRelatedPetsProfile(observations, {
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
        textMinSimilarity > selected.textMinSimilarity)
    ) {
      selected = {
        textMinSimilarity,
        ndcgAt4: report.textMetadataNdcgAt4,
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
    textMinSimilarity,
    visualMinSimilarity: null,
    visualWeight: 0,
  });
  let selected:
    | {
        visualMinSimilarity: number;
        visualWeight: (typeof RELATED_PETS_VISUAL_WEIGHT_CANDIDATES)[number];
        ndcgAt4: number;
      }
    | undefined;

  for (const visualMinSimilarity of candidates) {
    for (const visualWeight of RELATED_PETS_VISUAL_WEIGHT_CANDIDATES) {
      const report = evaluateRelatedPetsProfile(observations, {
        textMinSimilarity,
        visualMinSimilarity,
        visualWeight,
      });
      if (report.hybridNdcgAt4 < report.textMetadataNdcgAt4) {
        continue;
      }
      if (
        !selected ||
        report.hybridNdcgAt4 > selected.ndcgAt4 ||
        (report.hybridNdcgAt4 === selected.ndcgAt4 &&
          (visualWeight < selected.visualWeight ||
            (visualWeight === selected.visualWeight &&
              visualMinSimilarity > selected.visualMinSimilarity)))
      ) {
        selected = {
          visualMinSimilarity,
          visualWeight,
          ndcgAt4: report.hybridNdcgAt4,
        };
      }
    }
  }
  if (!selected) {
    return {
      visualMinSimilarity: null,
      visualWeight: 0,
      ndcgAt4: baseline.textMetadataNdcgAt4,
      evaluatedProfileCount:
        candidates.length * RELATED_PETS_VISUAL_WEIGHT_CANDIDATES.length +
        1,
    };
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
  const textSelection = selectRelatedTextThreshold(observations);
  const visualSelection = selectRelatedVisualProfile(
    observations,
    textSelection.textMinSimilarity,
  );
  const selectedProfile = {
    textMinSimilarity: textSelection.textMinSimilarity,
    visualMinSimilarity: visualSelection.visualMinSimilarity,
    visualWeight: visualSelection.visualWeight,
  };
  const profileMatches =
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
  };

  return {
    selectedProfile,
    pinnedProfile: {
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
    hybridNoWorseThanMetadata:
      report.hybridNdcgAt4 >= report.metadataNdcgAt4,
    hybridNoWorseThanTextMetadata:
      report.hybridNdcgAt4 >= report.textMetadataNdcgAt4,
  };
  return {
    ...report,
    comparisons,
    passed: Object.values(comparisons).every(Boolean),
  };
}

export function evaluateRelatedPetsRevisionComparison(
  candidate: ReturnType<typeof evaluateRelatedPetsProfile>,
  baseline: ReturnType<typeof evaluateRelatedPetsProfile>,
) {
  const checks = {
    hybridNdcgAt4NonRegression:
      candidate.hybridNdcgAt4 >= baseline.hybridNdcgAt4,
    noWorseThanMetadata:
      candidate.hybridNdcgAt4 >= candidate.metadataNdcgAt4,
    noWorseThanTextMetadata:
      candidate.hybridNdcgAt4 >= candidate.textMetadataNdcgAt4,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
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
    ).slice(0, 4);
    const textMetadataSlugs = fuseRelatedPetRankings({
      sourceSlug: observation.sourceSlug,
      metadataSlugs: observation.metadataSlugs,
      textMatches: observation.textMatches,
      textMinSimilarity: profile.textMinSimilarity,
      visualMinSimilarity: null,
      visualWeight: 0,
    });
    const hybridSlugs = fuseRelatedPetRankings({
      sourceSlug: observation.sourceSlug,
      metadataSlugs: observation.metadataSlugs,
      textMatches: observation.textMatches,
      visualMatches: observation.visualMatches,
      ...profile,
    });
    return {
      groupId: observation.groupId,
      sourceSlug: observation.sourceSlug,
      metadataSlugs,
      textMetadataSlugs,
      hybridSlugs,
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
    };
  });

  const metadataNdcgAt4 = mean(
    cases.map((item) => item.metadataNdcgAt4),
  );
  const textMetadataNdcgAt4 = mean(
    cases.map((item) => item.textMetadataNdcgAt4),
  );
  return {
    metadataNdcgAt4,
    textMetadataNdcgAt4,
    hybridNdcgAt4: mean(cases.map((item) => item.hybridNdcgAt4)),
    textContribution: {
      aggregateNoWorseThanMetadata:
        textMetadataNdcgAt4 >= metadataNdcgAt4,
      improvedCaseCount: cases.filter(
        (item) => item.textMetadataNdcgAt4 > item.metadataNdcgAt4,
      ).length,
      changedTop4CaseCount: cases.filter(
        (item) =>
          !sameRanking(item.textMetadataSlugs, item.metadataSlugs),
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

function sameRanking(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((slug, index) => slug === right[index])
  );
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

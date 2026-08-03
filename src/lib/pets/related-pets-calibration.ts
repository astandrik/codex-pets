import {
  fuseRelatedPetRankings,
  type RelatedPetSimilarity,
  type RelatedPetsRankingProfile,
} from "@/lib/pets/related-pets-ranking";

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

type SearchEvalFixture = {
  id: string;
  split: string;
  relevantSlugs: readonly string[];
};

const RELATED_GROUPS = [
  {
    id: "multi-token-gothic-anime",
    split: "calibration",
    size: 3,
  },
  { id: "style-cute", split: "calibration", size: 3 },
  { id: "style-sexy", split: "calibration", size: 4 },
  { id: "style-badass", split: "holdout", size: 4 },
] as const;

export function createRelatedPetsCalibrationCases(
  fixtures: readonly SearchEvalFixture[],
): {
  calibration: RelatedPetCalibrationCase[];
  holdout: RelatedPetCalibrationCase[];
} {
  const cases = {
    calibration: [] as RelatedPetCalibrationCase[],
    holdout: [] as RelatedPetCalibrationCase[],
  };

  for (const requiredGroup of RELATED_GROUPS) {
    const fixture = fixtures.find(({ id }) => id === requiredGroup.id);
    if (
      !fixture ||
      fixture.split !== requiredGroup.split ||
      fixture.relevantSlugs.length !== requiredGroup.size
    ) {
      throw new Error(
        `Related-pet calibration fixture ${requiredGroup.id} is missing or incompatible.`,
      );
    }
    const splitCases = cases[requiredGroup.split];
    for (const sourceSlug of fixture.relevantSlugs) {
      splitCases.push({
        groupId: fixture.id,
        split: requiredGroup.split,
        sourceSlug,
        relevantSlugs: fixture.relevantSlugs.filter(
          (slug) => slug !== sourceSlug,
        ),
      });
    }
  }

  return cases;
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
      visualMinSimilarity: Number.POSITIVE_INFINITY,
      visualWeight: RELATED_PETS_VISUAL_WEIGHT_CANDIDATES[0],
    });
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
    throw new Error("Related-pet text calibration selected no profile.");
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
    throw new Error("Related-pet visual calibration selected no profile.");
  }

  return {
    ...selected,
    evaluatedProfileCount:
      candidates.length * RELATED_PETS_VISUAL_WEIGHT_CANDIDATES.length,
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
      visualMinSimilarity: profile.visualMinSimilarity,
      visualWeight: profile.visualWeight,
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

  return {
    metadataNdcgAt4: mean(cases.map((item) => item.metadataNdcgAt4)),
    textMetadataNdcgAt4: mean(
      cases.map((item) => item.textMetadataNdcgAt4),
    ),
    hybridNdcgAt4: mean(cases.map((item) => item.hybridNdcgAt4)),
    cases,
  };
}

function thresholdCandidates(
  values: readonly number[],
  modality: "text" | "visual",
): number[] {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    throw new Error(
      `Related-pet ${modality} calibration needs finite similarity scores.`,
    );
  }
  const maximum = finiteValues.reduce(
    (currentMaximum, value) => Math.max(currentMaximum, value),
    Number.NEGATIVE_INFINITY,
  );
  const upperBound = Math.max(1, maximum);
  const rejectAllThreshold =
    upperBound +
    Number.EPSILON * Math.max(1, Math.abs(upperBound));
  if (
    !Number.isFinite(rejectAllThreshold) ||
    rejectAllThreshold <= maximum
  ) {
    throw new Error(
      `Related-pet ${modality} calibration similarity scores are outside the supported cosine range.`,
    );
  }
  return Array.from(
    new Set([...finiteValues, rejectAllThreshold]),
  ).sort((left, right) => right - left);
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

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

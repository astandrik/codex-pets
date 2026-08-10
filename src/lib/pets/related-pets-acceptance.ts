import type { RelatedPetCalibrationCase } from "@/lib/pets/related-pets-calibration";

export const RELATED_PETS_ACCEPTANCE_MIN_CASES = 12;
export const RELATED_PETS_ACCEPTANCE_MAX_TEXT_NDCG_AT_8_DROP = 0.1;

const COMPARISON_EPSILON = 1e-12;
const TOP_4 = 4;
const TOP_8 = 8;

export type RelatedPetAcceptanceGrade = 1 | 2 | 3;

export type RelatedPetAcceptanceOrdering = {
  higherSlug: string;
  lowerSlug: string;
};

export type RelatedPetAcceptanceFixture = {
  id: string;
  sourceSlug: string;
  relevance: Record<string, RelatedPetAcceptanceGrade>;
  mustIncludeOneOfTop4: string[];
  mustIncludeAllTop4: string[];
  mustIncludeAllTop8: string[];
  mustRankBefore?: RelatedPetAcceptanceOrdering[];
  negativeSlugs: string[];
};

export type RelatedPetAcceptanceRankingCase = {
  sourceSlug: string;
  metadataSlugs: readonly string[];
  textSlugs: readonly string[];
  noVisualSlugs: readonly string[];
  candidateSlugs: readonly string[];
  v8Slugs: readonly string[];
  v7Slugs: readonly string[];
};

export function parseRelatedPetsAcceptanceFixtures(
  value: unknown,
): RelatedPetAcceptanceFixture[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Related-pet acceptance fixtures must be a non-empty array.");
  }

  const ids = new Set<string>();
  const sourceSlugs = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw incompatibleFixture("<unknown>");
    const id = normalizedSlug(item.id);
    const sourceSlug = normalizedSlug(item.sourceSlug);
    if (!id || !sourceSlug || ids.has(id) || sourceSlugs.has(sourceSlug)) {
      throw incompatibleFixture(id || "<unnamed>");
    }
    ids.add(id);
    sourceSlugs.add(sourceSlug);

    if (!isRecord(item.relevance)) throw incompatibleFixture(id);
    const normalizedRelevanceSlugs = new Set<string>();
    const relevance = Object.fromEntries(
      Object.entries(item.relevance).map(([slug, grade]) => {
        const normalized = normalizedSlug(slug);
        if (
          !normalized ||
          normalized === sourceSlug ||
          normalizedRelevanceSlugs.has(normalized) ||
          (grade !== 1 && grade !== 2 && grade !== 3)
        ) {
          throw incompatibleFixture(id);
        }
        normalizedRelevanceSlugs.add(normalized);
        return [normalized, grade];
      }),
    ) as Record<string, RelatedPetAcceptanceGrade>;
    if (Object.keys(relevance).length === 0) throw incompatibleFixture(id);

    const mustIncludeOneOfTop4 = optionalUniqueSlugs(
      item.mustIncludeOneOfTop4,
      id,
    );
    const mustIncludeAllTop4 = optionalUniqueSlugs(
      item.mustIncludeAllTop4,
      id,
    );
    const mustIncludeAllTop8 = optionalUniqueSlugs(
      item.mustIncludeAllTop8,
      id,
    );
    const mustRankBefore = optionalOrderings(item.mustRankBefore, id);
    const negativeSlugs = optionalUniqueSlugs(item.negativeSlugs, id);
    if (
      [
        ...mustIncludeOneOfTop4,
        ...mustIncludeAllTop4,
        ...mustIncludeAllTop8,
      ].some((slug) => relevance[slug] === undefined) ||
      mustRankBefore.some(
        ({ higherSlug, lowerSlug }) =>
          relevance[higherSlug] === undefined ||
          relevance[lowerSlug] === undefined,
      ) ||
      negativeSlugs.some(
        (slug) => slug === sourceSlug || relevance[slug] !== undefined,
      )
    ) {
      throw incompatibleFixture(id);
    }

    return {
      id,
      sourceSlug,
      relevance,
      mustIncludeOneOfTop4,
      mustIncludeAllTop4,
      mustIncludeAllTop8,
      mustRankBefore,
      negativeSlugs,
    };
  });
}

export function createRelatedPetsAcceptanceCases(
  fixtures: readonly RelatedPetAcceptanceFixture[],
  split: "calibration" | "holdout" = "holdout",
): RelatedPetCalibrationCase[] {
  return fixtures.map((fixture) => ({
    groupId: `acceptance:${fixture.id}`,
    split,
    sourceSlug: fixture.sourceSlug,
    relevantSlugs: Object.keys(fixture.relevance),
    negativeSlugs: fixture.negativeSlugs,
  }));
}

export function evaluateRelatedPetsAcceptance(input: {
  fixtures: readonly RelatedPetAcceptanceFixture[];
  rankings: readonly RelatedPetAcceptanceRankingCase[];
  minimumCaseCount?: number;
}) {
  const rankingsBySource = new Map(
    input.rankings.map((ranking) => [ranking.sourceSlug, ranking]),
  );
  if (
    input.rankings.length !== input.fixtures.length ||
    rankingsBySource.size !== input.rankings.length ||
    input.fixtures.some((fixture) => !rankingsBySource.has(fixture.sourceSlug))
  ) {
    throw new Error("Related-pet acceptance rankings are incomplete.");
  }

  const cases = input.fixtures.map((fixture) => {
    const ranking = rankingsBySource.get(fixture.sourceSlug);
    if (!ranking) throw new Error("Related-pet acceptance rankings are incomplete.");
    const metrics = {
      metadataNdcgAt4: gradedNdcgAtK(
        ranking.metadataSlugs,
        fixture.relevance,
        TOP_4,
      ),
      textNdcgAt4: gradedNdcgAtK(
        ranking.textSlugs,
        fixture.relevance,
        TOP_4,
      ),
      noVisualNdcgAt4: gradedNdcgAtK(
        ranking.noVisualSlugs,
        fixture.relevance,
        TOP_4,
      ),
      candidateNdcgAt4: gradedNdcgAtK(
        ranking.candidateSlugs,
        fixture.relevance,
        TOP_4,
      ),
      v8NdcgAt4: gradedNdcgAtK(
        ranking.v8Slugs,
        fixture.relevance,
        TOP_4,
      ),
      v7NdcgAt4: gradedNdcgAtK(
        ranking.v7Slugs,
        fixture.relevance,
        TOP_4,
      ),
      metadataNdcgAt8: gradedNdcgAtK(
        ranking.metadataSlugs,
        fixture.relevance,
        TOP_8,
      ),
      textNdcgAt8: gradedNdcgAtK(
        ranking.textSlugs,
        fixture.relevance,
        TOP_8,
      ),
      noVisualNdcgAt8: gradedNdcgAtK(
        ranking.noVisualSlugs,
        fixture.relevance,
        TOP_8,
      ),
      candidateNdcgAt8: gradedNdcgAtK(
        ranking.candidateSlugs,
        fixture.relevance,
        TOP_8,
      ),
      v8NdcgAt8: gradedNdcgAtK(
        ranking.v8Slugs,
        fixture.relevance,
        TOP_8,
      ),
      v7NdcgAt8: gradedNdcgAtK(
        ranking.v7Slugs,
        fixture.relevance,
        TOP_8,
      ),
    };
    const negativeTop8Slugs = ranking.candidateSlugs
      .slice(0, TOP_8)
      .filter((slug) => fixture.negativeSlugs.includes(slug));
    const mustIncludeTop4Satisfied =
      fixture.mustIncludeOneOfTop4.length === 0 ||
      ranking.candidateSlugs
        .slice(0, TOP_4)
        .some((slug) => fixture.mustIncludeOneOfTop4.includes(slug));
    const mustIncludeAllTop4Satisfied = fixture.mustIncludeAllTop4.every(
      (slug) => ranking.candidateSlugs.slice(0, TOP_4).includes(slug),
    );
    const mustIncludeAllTop8Satisfied = fixture.mustIncludeAllTop8.every(
      (slug) => ranking.candidateSlugs.slice(0, TOP_8).includes(slug),
    );
    const orderingConstraintsSatisfied = (fixture.mustRankBefore ?? []).every(
      ({ higherSlug, lowerSlug }) => {
        const top8 = ranking.candidateSlugs.slice(0, TOP_8);
        const higherIndex = top8.indexOf(higherSlug);
        const lowerIndex = top8.indexOf(lowerSlug);
        return higherIndex >= 0 &&
          (lowerIndex < 0 || higherIndex < lowerIndex);
      },
    );

    return {
      id: fixture.id,
      ...ranking,
      metrics,
      mustIncludeTop4Satisfied,
      mustIncludeAllTop4Satisfied,
      mustIncludeAllTop8Satisfied,
      orderingConstraintsSatisfied,
      negativeTop8Slugs,
      textNdcgAt8Delta:
        metrics.candidateNdcgAt8 - metrics.noVisualNdcgAt8,
      visualImproved:
        metrics.candidateNdcgAt4 >
          metrics.noVisualNdcgAt4 + COMPARISON_EPSILON ||
        metrics.candidateNdcgAt8 >
          metrics.noVisualNdcgAt8 + COMPARISON_EPSILON,
      rankingIntegrity: [
        ranking.metadataSlugs,
        ranking.textSlugs,
        ranking.noVisualSlugs,
        ranking.candidateSlugs,
        ranking.v8Slugs,
        ranking.v7Slugs,
      ].every((slugs) => validTop8(slugs, fixture.sourceSlug)),
    };
  });

  const aggregate = {
    metadataNdcgAt4: mean(cases.map(({ metrics }) => metrics.metadataNdcgAt4)),
    textNdcgAt4: mean(cases.map(({ metrics }) => metrics.textNdcgAt4)),
    noVisualNdcgAt4: mean(
      cases.map(({ metrics }) => metrics.noVisualNdcgAt4),
    ),
    candidateNdcgAt4: mean(
      cases.map(({ metrics }) => metrics.candidateNdcgAt4),
    ),
    v8NdcgAt4: mean(cases.map(({ metrics }) => metrics.v8NdcgAt4)),
    v7NdcgAt4: mean(cases.map(({ metrics }) => metrics.v7NdcgAt4)),
    metadataNdcgAt8: mean(cases.map(({ metrics }) => metrics.metadataNdcgAt8)),
    textNdcgAt8: mean(cases.map(({ metrics }) => metrics.textNdcgAt8)),
    noVisualNdcgAt8: mean(
      cases.map(({ metrics }) => metrics.noVisualNdcgAt8),
    ),
    candidateNdcgAt8: mean(
      cases.map(({ metrics }) => metrics.candidateNdcgAt8),
    ),
    v8NdcgAt8: mean(cases.map(({ metrics }) => metrics.v8NdcgAt8)),
    v7NdcgAt8: mean(cases.map(({ metrics }) => metrics.v7NdcgAt8)),
  };
  const checks = {
    minimumCaseCount:
      cases.length >=
      (input.minimumCaseCount ?? RELATED_PETS_ACCEPTANCE_MIN_CASES),
    rankingIntegrity: cases.every((item) => item.rankingIntegrity),
    candidateNoWorseThanTextAt4:
      aggregate.candidateNdcgAt4 + COMPARISON_EPSILON >=
      aggregate.textNdcgAt4,
    candidateNoWorseThanTextAt8:
      aggregate.candidateNdcgAt8 + COMPARISON_EPSILON >=
      aggregate.textNdcgAt8,
    candidateNoWorseThanNoVisualAt4:
      aggregate.candidateNdcgAt4 + COMPARISON_EPSILON >=
      aggregate.noVisualNdcgAt4,
    candidateNoWorseThanNoVisualAt8:
      aggregate.candidateNdcgAt8 + COMPARISON_EPSILON >=
      aggregate.noVisualNdcgAt8,
    candidateNoWorseThanV8At4:
      aggregate.candidateNdcgAt4 + COMPARISON_EPSILON >=
      aggregate.v8NdcgAt4,
    candidateNoWorseThanV8At8:
      aggregate.candidateNdcgAt8 + COMPARISON_EPSILON >=
      aggregate.v8NdcgAt8,
    candidateNoWorseThanV7At4:
      aggregate.candidateNdcgAt4 + COMPARISON_EPSILON >=
      aggregate.v7NdcgAt4,
    candidateNoWorseThanV7At8:
      aggregate.candidateNdcgAt8 + COMPARISON_EPSILON >=
      aggregate.v7NdcgAt8,
    noSevereTextRegressionAt8: cases.every(
      ({ textNdcgAt8Delta }) =>
        textNdcgAt8Delta + COMPARISON_EPSILON >=
        -RELATED_PETS_ACCEPTANCE_MAX_TEXT_NDCG_AT_8_DROP,
    ),
    allRequiredNeighborsInTop4: cases.every(
      (item) => item.mustIncludeTop4Satisfied,
    ),
    allExplicitTop4NeighborsPresent: cases.every(
      (item) => item.mustIncludeAllTop4Satisfied,
    ),
    allExplicitTop8NeighborsPresent: cases.every(
      (item) => item.mustIncludeAllTop8Satisfied,
    ),
    allOrderingConstraintsSatisfied: cases.every(
      (item) => item.orderingConstraintsSatisfied,
    ),
    noExplicitNegativeInTop8: cases.every(
      (item) => item.negativeTop8Slugs.length === 0,
    ),
    visualImprovesAtLeastOneCase: cases.some((item) => item.visualImproved),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    aggregate,
    improvedCaseCount: cases.filter((item) => item.visualImproved).length,
    cases,
  };
}

export function gradedNdcgAtK(
  rankedSlugs: readonly string[],
  relevance: Readonly<Record<string, RelatedPetAcceptanceGrade>>,
  k: number,
): number {
  const limit = Math.max(0, Math.trunc(k));
  const seen = new Set<string>();
  const dcg = rankedSlugs.slice(0, limit).reduce((total, slug, index) => {
    if (seen.has(slug)) return total;
    seen.add(slug);
    return total + discountedGain(relevance[slug] ?? 0, index);
  }, 0);
  const idealDcg = Object.values(relevance)
    .toSorted((left, right) => right - left)
    .slice(0, limit)
    .reduce(
      (total, grade, index) => total + discountedGain(grade, index),
      0,
    );
  return idealDcg === 0 ? 0 : dcg / idealDcg;
}

function discountedGain(grade: number, index: number): number {
  return (2 ** grade - 1) / Math.log2(index + 2);
}

function optionalUniqueSlugs(value: unknown, fixtureId: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw incompatibleFixture(fixtureId);
  const slugs = value.map(normalizedSlug);
  if (
    slugs.some((slug) => !slug) ||
    new Set(slugs).size !== slugs.length
  ) {
    throw incompatibleFixture(fixtureId);
  }
  return slugs;
}

function optionalOrderings(
  value: unknown,
  fixtureId: string,
): RelatedPetAcceptanceOrdering[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw incompatibleFixture(fixtureId);
  const keys = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw incompatibleFixture(fixtureId);
    const higherSlug = normalizedSlug(item.higherSlug);
    const lowerSlug = normalizedSlug(item.lowerSlug);
    const key = `${higherSlug}\n${lowerSlug}`;
    if (
      !higherSlug ||
      !lowerSlug ||
      higherSlug === lowerSlug ||
      keys.has(key)
    ) {
      throw incompatibleFixture(fixtureId);
    }
    keys.add(key);
    return { higherSlug, lowerSlug };
  });
}

function validTop8(slugs: readonly string[], sourceSlug: string): boolean {
  const top8 = slugs.slice(0, TOP_8);
  return top8.length === TOP_8 &&
    new Set(top8).size === TOP_8 &&
    !top8.includes(sourceSlug);
}

function normalizedSlug(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function incompatibleFixture(id: string): Error {
  return new Error(`Related-pet acceptance fixture ${id} is incompatible.`);
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

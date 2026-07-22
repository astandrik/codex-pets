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

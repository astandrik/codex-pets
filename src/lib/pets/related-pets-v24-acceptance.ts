import type {
  RelatedPetsV24JudgeConfidence,
  RelatedPetsV24JudgePreference,
} from "@/lib/pets/related-pets-v24-judge-contract.mjs";

export const RELATED_PETS_V24_ACCEPTANCE_REVISION =
  "related-pets-sparse-fallback-acceptance-v24-r1";
export const RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS = [
  "sviborg-ball",
  "kesha",
  "iris",
  "otets-potets",
  "velvet-crowe",
  "pyramid-head",
  "gordon-freeman",
  "kitsune-chibi-2",
  "neko-samurai-5",
  "gorshok-2",
  "curator",
  "johnny",
  "tigran",
  "auron",
  "crawlstack-polished",
] as const;
export const RELATED_PETS_V24_ACCEPTANCE_GATE = Object.freeze({
  expectedSourceCount: 15,
  minimumMeanGradeAt4LiftExclusive: 0,
  maximumSourceGradeAt4Loss: 0.5,
});

export type RelatedPetsV24AcceptanceReport = {
  sourceSlug: string;
  baselineTop8: string[];
  candidateTop8: string[];
  parsed: boolean;
  failureReason?: string;
  requests: number;
  orderConsistent?: boolean;
  confidence?: RelatedPetsV24JudgeConfidence;
  decision?: {
    preference: RelatedPetsV24JudgePreference | null;
    top4: RelatedPetsV24JudgePreference | null;
    top8: RelatedPetsV24JudgePreference | null;
  };
  baselineGrades?: number[];
  candidateGrades?: number[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
};

export type RelatedPetsV24ManualDecision = {
  sourceSlug: string;
  preference: RelatedPetsV24JudgePreference;
  top4: RelatedPetsV24JudgePreference;
  top8: RelatedPetsV24JudgePreference;
  noteCode:
    | "visual_supports_candidate"
    | "text_and_visual_tie"
    | "baseline_clearer"
    | "judge_order_noise";
};

export function evaluateRelatedPetsV24Acceptance(input: {
  reports: readonly RelatedPetsV24AcceptanceReport[];
  manualDecisions?: readonly RelatedPetsV24ManualDecision[];
}) {
  const reports = validateReports(input.reports);
  const manualBySlug = validateManualDecisions(input.manualDecisions ?? []);
  const incompleteSources = reports.filter(({ parsed }) => !parsed)
    .map(({ sourceSlug }) => sourceSlug);
  const evaluated = reports.flatMap((report) => {
    if (!report.parsed) return [];
    const validated = validateCompleteReport(report);
    const manual = manualBySlug.get(report.sourceSlug);
    const needsManualReview = !validated.orderConsistent ||
      validated.confidence === "low";
    const decision = needsManualReview ? manual ?? null : completeDecision(
      validated.decision,
    );
    const baselineGradeAt4 = average(validated.baselineGrades.slice(0, 4));
    const candidateGradeAt4 = average(validated.candidateGrades.slice(0, 4));
    const baselineGradeAt8 = average(validated.baselineGrades);
    const candidateGradeAt8 = average(validated.candidateGrades);
    return [{
      ...validated,
      needsManualReview,
      manualDecision: manual,
      finalDecision: decision,
      baselineGradeAt4,
      candidateGradeAt4,
      gradeAt4Delta: candidateGradeAt4 - baselineGradeAt4,
      baselineGradeAt8,
      candidateGradeAt8,
      gradeAt8Delta: candidateGradeAt8 - baselineGradeAt8,
    }];
  });
  const unresolvedSources = evaluated.filter(({ finalDecision }) => !finalDecision)
    .map(({ sourceSlug }) => sourceSlug);
  const manualReviewSources = evaluated.filter(({ needsManualReview }) =>
    needsManualReview).map(({ sourceSlug }) => sourceSlug);
  const unexpectedManualSources = Array.from(manualBySlug.keys()).filter((slug) =>
    !manualReviewSources.includes(slug));
  if (unexpectedManualSources.length > 0) {
    throw new Error("V24 manual decisions may resolve flagged sources only.");
  }
  const resolved = evaluated.filter((report): report is typeof report & {
    finalDecision: RelatedPetsV24ManualDecision | {
      preference: RelatedPetsV24JudgePreference;
      top4: RelatedPetsV24JudgePreference;
      top8: RelatedPetsV24JudgePreference;
    };
  } => report.finalDecision !== null);
  const candidateWins = resolved.filter(({ finalDecision }) =>
    finalDecision.preference === "B").length;
  const baselineWins = resolved.filter(({ finalDecision }) =>
    finalDecision.preference === "A").length;
  const meanGradeAt4Lift = averageOrNull(evaluated.map(({ gradeAt4Delta }) =>
    gradeAt4Delta));
  const meanGradeAt8Lift = averageOrNull(evaluated.map(({ gradeAt8Delta }) =>
    gradeAt8Delta));
  const severeRegressionSources = evaluated.filter(({ gradeAt4Delta }) =>
    gradeAt4Delta < -RELATED_PETS_V24_ACCEPTANCE_GATE.maximumSourceGradeAt4Loss)
    .map(({ sourceSlug }) => sourceSlug);
  const tigran = evaluated.find(({ sourceSlug }) => sourceSlug === "tigran");
  const tigranClearlyBetter = tigran?.finalDecision?.preference === "B" &&
    tigran.finalDecision.top4 === "B" && tigran.gradeAt4Delta >= 0;
  const failures = [
    incompleteSources.length > 0 ? "incomplete_judge_coverage" : null,
    unresolvedSources.length > 0 ? "manual_review_unresolved" : null,
    meanGradeAt4Lift === null ||
      meanGradeAt4Lift <= RELATED_PETS_V24_ACCEPTANCE_GATE.minimumMeanGradeAt4LiftExclusive
      ? "non_positive_mean_grade4_lift"
      : null,
    candidateWins <= baselineWins ? "wins_not_greater_than_losses" : null,
    severeRegressionSources.length > 0 ? "severe_source_regression" : null,
    !tigranClearlyBetter ? "tigran_not_clearly_better" : null,
  ].filter((value): value is string => value !== null);

  return {
    revision: RELATED_PETS_V24_ACCEPTANCE_REVISION,
    passed: failures.length === 0,
    status: incompleteSources.length > 0 || unresolvedSources.length > 0
      ? "needs-review" as const
      : failures.length === 0
        ? "passed" as const
        : "failed" as const,
    failures,
    thresholds: RELATED_PETS_V24_ACCEPTANCE_GATE,
    sourceCount: reports.length,
    incompleteSources,
    unresolvedSources,
    manualReviewSources,
    candidateWins,
    baselineWins,
    ties: resolved.length - candidateWins - baselineWins,
    meanGradeAt4Lift,
    meanGradeAt8Lift,
    severeRegressionSources,
    tigranClearlyBetter,
    reports: evaluated,
  };
}

function validateReports(input: readonly RelatedPetsV24AcceptanceReport[]) {
  const bySlug = new Map(input.map((report) => [report.sourceSlug, report]));
  if (input.length !== RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS.length ||
      bySlug.size !== input.length || RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS.some(
        (slug) => !bySlug.has(slug),
      )) {
    throw new Error("V24 acceptance reports must match the frozen 15-source manifest.");
  }
  return RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS.map((slug) => bySlug.get(slug)!);
}

function validateCompleteReport(report: RelatedPetsV24AcceptanceReport) {
  validateRanking(report.baselineTop8, report.sourceSlug);
  validateRanking(report.candidateTop8, report.sourceSlug);
  if (report.requests !== 2 || report.orderConsistent === undefined ||
      !report.confidence || !report.decision ||
      !validGrades(report.baselineGrades) || !validGrades(report.candidateGrades)) {
    throw new Error("V24 complete acceptance report is invalid.");
  }
  return {
    ...report,
    parsed: true as const,
    requests: 2 as const,
    orderConsistent: report.orderConsistent,
    confidence: report.confidence,
    decision: report.decision,
    baselineGrades: report.baselineGrades,
    candidateGrades: report.candidateGrades,
  };
}

function completeDecision(report: RelatedPetsV24AcceptanceReport["decision"]) {
  if (!report || !report.preference || !report.top4 || !report.top8) return null;
  return { preference: report.preference, top4: report.top4, top8: report.top8 };
}

function validateManualDecisions(input: readonly RelatedPetsV24ManualDecision[]) {
  const result = new Map<string, RelatedPetsV24ManualDecision>();
  for (const decision of input) {
    if (!RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS.includes(
      decision.sourceSlug as typeof RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS[number],
    ) || result.has(decision.sourceSlug)) {
      throw new Error("V24 manual decisions are outside the frozen manifest or duplicated.");
    }
    result.set(decision.sourceSlug, decision);
  }
  return result;
}

function validateRanking(ranking: readonly string[], sourceSlug: string) {
  if (ranking.length !== 8 || new Set(ranking).size !== 8 ||
      ranking.includes(sourceSlug) || ranking.some((slug) => !slug)) {
    throw new Error("V24 acceptance ranking is invalid.");
  }
}

function validGrades(input: number[] | undefined): input is number[] {
  return Array.isArray(input) && input.length === 8 && input.every((grade) =>
    Number.isFinite(grade) && grade >= 0 && grade <= 3);
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageOrNull(values: readonly number[]) {
  return values.length === 0 ? null : average(values);
}

import queries from "@/lib/pets/search-eval-queries-v2.json";
import {
  PET_SEARCH_LABEL_POOL_VERSION,
  createPetSearchLabelPoolHash,
  type PetSearchLabelPoolJudgmentRecord,
} from "@/lib/pets/search-eval-label-pool";

export type PetSearchEvalSuite =
  | "diagnostic-v1"
  | "text-regression-v2"
  | "visual-calibration-v2"
  | "visual-holdout-v2";

export type PetSearchJudgment = "relevant" | "irrelevant" | "uncertain";
export type JudgmentMode = "deterministic" | "pooled";

export type PetSearchEvalCategory =
  | "exact"
  | "multi-token"
  | "typo"
  | "style"
  | "russian"
  | "negative";

export type PetSearchVisualAspect =
  | "appearance"
  | "clothing"
  | "accessory"
  | "color"
  | "mood"
  | "subject"
  | "style";

export type PetSearchEvalQuery = {
  id: string;
  suite: Exclude<PetSearchEvalSuite, "diagnostic-v1">;
  category: PetSearchEvalCategory;
  query: string;
  judgmentMode: JudgmentMode;
  relevantSlugs?: string[];
  visualSubset: boolean;
  visualAspects: PetSearchVisualAspect[];
};

export type PetSearchEvalJudgmentRecord =
  PetSearchLabelPoolJudgmentRecord;

export type FrozenPetSearchEvalFixture = PetSearchEvalQuery & {
  relevantSlugs: string[];
  judgedSlugs: string[];
  reviewedBy: string | null;
};

const ALL_SUITES = new Set<PetSearchEvalSuite>([
  "diagnostic-v1",
  "text-regression-v2",
  "visual-calibration-v2",
  "visual-holdout-v2",
]);
const V2_SUITES = new Set<PetSearchEvalQuery["suite"]>([
  "text-regression-v2",
  "visual-calibration-v2",
  "visual-holdout-v2",
]);
const CATEGORIES = new Set<PetSearchEvalCategory>([
  "exact",
  "multi-token",
  "typo",
  "style",
  "russian",
  "negative",
]);
const VISUAL_ASPECTS = new Set<PetSearchVisualAspect>([
  "appearance",
  "clothing",
  "accessory",
  "color",
  "mood",
  "subject",
  "style",
]);
const JUDGMENTS = new Set<PetSearchJudgment>([
  "relevant",
  "irrelevant",
  "uncertain",
]);
const REQUIRED_TEXT_CATEGORIES = [
  "exact",
  "multi-token",
  "typo",
  "style",
  "russian",
  "negative",
] as const;
const REQUIRED_VISUAL_ASPECTS = [
  "appearance",
  "clothing",
  "accessory",
  "color",
  "mood",
  "subject",
  "style",
] as const;

export const PET_SEARCH_EVAL_QUERIES_V2 =
  queries as PetSearchEvalQuery[];

export function validatePetSearchEvalQueryManifest(
  manifest: readonly PetSearchEvalQuery[],
): void {
  const ids = new Set<string>();
  const normalizedQueries = new Map<string, PetSearchEvalQuery>();

  for (const entry of manifest) {
    if (!entry || typeof entry !== "object") {
      throw new Error("V2 eval query manifest contains an invalid entry.");
    }
    if (!entry.id || ids.has(entry.id)) {
      throw new Error(`V2 eval query id is missing or duplicated: ${entry.id}`);
    }
    ids.add(entry.id);
    if (!V2_SUITES.has(entry.suite)) {
      throw new Error(`V2 eval query has an invalid suite: ${entry.id}`);
    }
    if (!CATEGORIES.has(entry.category)) {
      throw new Error(`V2 eval query has an invalid category: ${entry.id}`);
    }
    if (!entry.query || entry.query !== entry.query.trim()) {
      throw new Error(`V2 eval query text is invalid: ${entry.id}`);
    }
    if (
      entry.judgmentMode !== "deterministic" &&
      entry.judgmentMode !== "pooled"
    ) {
      throw new Error(`V2 eval judgment mode is invalid: ${entry.id}`);
    }
    if (
      !Array.isArray(entry.visualAspects) ||
      entry.visualAspects.some((aspect) => !VISUAL_ASPECTS.has(aspect))
    ) {
      throw new Error(`V2 eval visual aspects are invalid: ${entry.id}`);
    }
    if (
      entry.judgmentMode === "deterministic" &&
      !Array.isArray(entry.relevantSlugs)
    ) {
      throw new Error(
        `Deterministic eval query is missing relevant slugs: ${entry.id}`,
      );
    }
    if (
      entry.judgmentMode === "pooled" &&
      entry.relevantSlugs !== undefined
    ) {
      throw new Error(
        `Pooled eval query must not prefill relevant slugs: ${entry.id}`,
      );
    }

    const normalizedQuery = normalizeEvalQuery(entry.query);
    const duplicate = normalizedQueries.get(normalizedQuery);
    if (
      duplicate &&
      (duplicate.suite === "visual-calibration-v2" ||
        duplicate.suite === "visual-holdout-v2") &&
      (entry.suite === "visual-calibration-v2" ||
        entry.suite === "visual-holdout-v2")
    ) {
      throw new Error(
        `Query is duplicated in calibration or holdout: ${entry.query}`,
      );
    }
    normalizedQueries.set(normalizedQuery, entry);
  }

  validateTextRegressionSuite(manifest);
  validateVisualSuite(manifest, "visual-calibration-v2", 12);
  validateVisualSuite(manifest, "visual-holdout-v2", 8);
}

export function joinPetSearchEvalJudgments(
  manifest: readonly PetSearchEvalQuery[],
  judgmentRecords: readonly PetSearchEvalJudgmentRecord[],
  suite: PetSearchEvalSuite,
): FrozenPetSearchEvalFixture[] {
  if (!ALL_SUITES.has(suite) || suite === "diagnostic-v1") {
    throw new Error(`V2 pooled judgments cannot load suite: ${suite}`);
  }
  validatePetSearchEvalQueryManifest(manifest);
  const selected = manifest.filter((entry) => entry.suite === suite);
  const recordsByQuery = new Map<string, PetSearchEvalJudgmentRecord>();

  for (const record of judgmentRecords) {
    if (recordsByQuery.has(record.queryId)) {
      throw new Error(
        `Frozen pooled judgments contain duplicate query: ${record.queryId}`,
      );
    }
    recordsByQuery.set(record.queryId, record);
  }

  return selected.map((entry) => {
    if (entry.judgmentMode === "deterministic") {
      return {
        ...entry,
        relevantSlugs: [...(entry.relevantSlugs ?? [])],
        judgedSlugs: [],
        reviewedBy: "deterministic",
      };
    }

    const record = recordsByQuery.get(entry.id);
    if (!record) {
      throw new Error(
        `Frozen pooled judgments are missing for query: ${entry.id}`,
      );
    }
    validateJudgmentRecord(entry, record);
    return {
      ...entry,
      relevantSlugs: record.judgments
        .filter((judgment) => judgment.judgment === "relevant")
        .map((judgment) => judgment.slug),
      judgedSlugs: record.judgments
        .filter((judgment) => judgment.judgment !== "uncertain")
        .map((judgment) => judgment.slug),
      reviewedBy: record.reviewer,
    };
  });
}

function validateTextRegressionSuite(
  manifest: readonly PetSearchEvalQuery[],
): void {
  const suite = manifest.filter(
    (entry) => entry.suite === "text-regression-v2",
  );
  const positives = suite.filter((entry) => entry.category !== "negative");
  const negatives = suite.filter((entry) => entry.category === "negative");
  if (positives.length < 12) {
    throw new Error(
      "text-regression-v2 requires at least 12 positive queries.",
    );
  }
  if (negatives.length < 3) {
    throw new Error(
      "text-regression-v2 requires at least 3 negative queries.",
    );
  }
  for (const category of REQUIRED_TEXT_CATEGORIES) {
    if (!suite.some((entry) => entry.category === category)) {
      throw new Error(
        `text-regression-v2 is missing required category: ${category}`,
      );
    }
  }
}

function validateVisualSuite(
  manifest: readonly PetSearchEvalQuery[],
  suiteName: "visual-calibration-v2" | "visual-holdout-v2",
  minimumVisualPositives: number,
): void {
  const suite = manifest.filter((entry) => entry.suite === suiteName);
  const visualPositives = suite.filter(
    (entry) =>
      entry.category !== "negative" &&
      entry.category !== "exact" &&
      entry.visualSubset,
  );
  const exact = suite.filter((entry) => entry.category === "exact");
  const negatives = suite.filter((entry) => entry.category === "negative");
  if (visualPositives.length < minimumVisualPositives) {
    throw new Error(
      `${suiteName} requires at least ${minimumVisualPositives} positive visual queries.`,
    );
  }
  if (exact.length < 2) {
    throw new Error(`${suiteName} requires at least 2 exact controls.`);
  }
  if (negatives.length < 3) {
    throw new Error(`${suiteName} requires at least 3 negative controls.`);
  }
  if (suiteName === "visual-calibration-v2") {
    const observedAspects = new Set(
      visualPositives.flatMap((entry) => entry.visualAspects),
    );
    for (const aspect of REQUIRED_VISUAL_ASPECTS) {
      if (!observedAspects.has(aspect)) {
        throw new Error(
          `${suiteName} is missing required visual aspect: ${aspect}`,
        );
      }
    }
  }
}

function validateJudgmentRecord(
  entry: PetSearchEvalQuery,
  record: PetSearchEvalJudgmentRecord,
): void {
  if (
    record.poolVersion !== PET_SEARCH_LABEL_POOL_VERSION ||
    record.suite !== entry.suite ||
    record.query !== entry.query
  ) {
    throw new Error(
      `Frozen pooled judgments have a contract mismatch: ${entry.id}`,
    );
  }
  if (
    !/^[a-f0-9]{64}$/.test(record.candidatePoolHash) ||
    record.candidateRecords.length === 0
  ) {
    throw new Error(
      `Frozen pooled judgments have an invalid pool hash: ${entry.id}`,
    );
  }
  const candidates = new Set<string>();
  for (const candidate of record.candidateRecords) {
    if (
      !candidate.slug ||
      candidates.has(candidate.slug) ||
      !/^[a-f0-9]{64}$/.test(candidate.spritesheetSha256)
    ) {
      throw new Error(
        `Frozen pooled judgments have invalid candidate records: ${entry.id}`,
      );
    }
    candidates.add(candidate.slug);
  }
  const expectedPoolHash = createPetSearchLabelPoolHash({
    poolVersion: record.poolVersion,
    suite: record.suite,
    query: record.query,
    candidateRecords: record.candidateRecords,
  });
  if (expectedPoolHash !== record.candidatePoolHash) {
    throw new Error(
      `Frozen pooled judgment pool hash mismatch: ${entry.id}`,
    );
  }
  if (!record.reviewer.trim()) {
    throw new Error(
      `Frozen pooled judgments have no reviewer: ${entry.id}`,
    );
  }
  if (
    !record.reviewedAt ||
    !Number.isFinite(Date.parse(record.reviewedAt)) ||
    new Date(Date.parse(record.reviewedAt)).toISOString() !==
      record.reviewedAt
  ) {
    throw new Error(
      `Frozen pooled judgments have an invalid timestamp: ${entry.id}`,
    );
  }
  if (record.judgments.length === 0) {
    throw new Error(
      `Frozen pooled judgments are incomplete: ${entry.id}`,
    );
  }

  const slugs = new Set<string>();
  for (const judgment of record.judgments) {
    if (
      !judgment.slug ||
      !candidates.has(judgment.slug) ||
      slugs.has(judgment.slug) ||
      !JUDGMENTS.has(judgment.judgment)
    ) {
      throw new Error(
        `Frozen pooled judgments are invalid or duplicated: ${entry.id}`,
      );
    }
    slugs.add(judgment.slug);
  }
  if (
    slugs.size !== candidates.size ||
    [...candidates].some((slug) => !slugs.has(slug))
  ) {
    throw new Error(
      `Frozen pooled judgments are incomplete: ${entry.id}`,
    );
  }
  if (
    entry.category !== "negative" &&
    !record.judgments.some(
      (judgment) => judgment.judgment === "relevant",
    )
  ) {
    throw new Error(
      `Frozen pooled judgments have no relevant candidate: ${entry.id}`,
    );
  }
}

function normalizeEvalQuery(query: string): string {
  return query.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

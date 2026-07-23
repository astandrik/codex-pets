import { describe, expect, it } from "vitest";

import fixtures from "@/lib/pets/search-eval-fixtures.json";
import {
  PET_SEARCH_EVAL_QUERIES_V2,
  joinPetSearchEvalJudgments,
  validatePetSearchEvalQueryManifest,
} from "@/lib/pets/search-eval-fixtures";
import {
  PET_SEARCH_LABEL_POOL_VERSION,
  createPetSearchLabelPoolHash,
  type PetSearchLabelPoolJudgmentRecord,
} from "@/lib/pets/search-eval-label-pool";
import {
  calibrateVisualSearchProfile,
  condenseRankedSlugs,
  evaluateSearchRolloutGate,
  evaluateSearchQuality,
  evaluateVisualSearchRolloutGate,
  isVisualCalibrationReportEligible,
  resolveVisualSearchEvalSplit,
  selectSemanticThreshold,
} from "@/lib/pets/search-eval";
import { PET_SEARCH_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { rankPetsLexically } from "@/lib/pets/search-ranking";

describe("pet search evaluation", () => {
  it("maps live commands to distinct frozen v2 suites", () => {
    expect(resolveVisualSearchEvalSplit("calibrate")).toBe(
      "visual-calibration-v2",
    );
    expect(resolveVisualSearchEvalSplit("holdout")).toBe(
      "visual-holdout-v2",
    );
    expect(resolveVisualSearchEvalSplit("text-regression")).toBe(
      "text-regression-v2",
    );
    expect(resolveVisualSearchEvalSplit("diagnostic-v1")).toBe(
      "diagnostic-v1",
    );
    expect(resolveVisualSearchEvalSplit(undefined)).toBeNull();
  });

  it("preserves all exposed v1 fixtures as diagnostic-only labels", () => {
    expect(new Set(fixtures.map((fixture) => fixture.category))).toEqual(
      new Set(["exact", "multi-token", "typo", "style", "russian", "negative"]),
    );
    expect(fixtures.map((fixture) => fixture.query)).toEqual(
      expect.arrayContaining(["cute", "badass", "sexy"]),
    );
    expect(
      fixtures.find((fixture) => fixture.query === "sexy")?.reviewedBy,
    ).toBeNull();
    expect(new Set(fixtures.map((fixture) => fixture.suite))).toEqual(
      new Set(["diagnostic-v1"]),
    );
    expect(fixtures.every((fixture) => fixture.labelsFrozenBy.length > 0))
      .toBe(true);
    expect(
      fixtures.filter((fixture) => fixture.visualSubset).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      new Set(
        fixtures.flatMap((fixture) => fixture.visualAspects),
      ),
    ).toEqual(
      new Set(["appearance", "clothing", "accessory", "color", "mood", "style"]),
    );
  });

  it("validates the frozen v2 suite sizes and calibration/holdout isolation", () => {
    expect(() =>
      validatePetSearchEvalQueryManifest(PET_SEARCH_EVAL_QUERIES_V2),
    ).not.toThrow();

    const firstCalibration = PET_SEARCH_EVAL_QUERIES_V2.find(
      (query) => query.suite === "visual-calibration-v2",
    );
    const duplicate = PET_SEARCH_EVAL_QUERIES_V2.map((query) =>
      query.suite === "visual-holdout-v2"
        ? { ...query, query: firstCalibration?.query ?? "sexy" }
        : query,
    );
    expect(() => validatePetSearchEvalQueryManifest(duplicate)).toThrow(
      /duplicated.*calibration.*holdout/i,
    );

    const undersized = PET_SEARCH_EVAL_QUERIES_V2.filter(
      (query) =>
        query.suite !== "visual-holdout-v2" ||
        query.category === "negative",
    );
    expect(() => validatePetSearchEvalQueryManifest(undersized)).toThrow(
      /visual-holdout-v2.*positive/i,
    );
  });

  it("refuses pooled evaluation until complete frozen judgments exist", () => {
    expect(() =>
      joinPetSearchEvalJudgments(
        PET_SEARCH_EVAL_QUERIES_V2,
        [],
        "visual-calibration-v2",
      ),
    ).toThrow(/frozen pooled judgments.*missing/i);
  });

  it("binds frozen judgments to complete candidate pools", () => {
    const judgments = completeJudgments("visual-calibration-v2");
    const joined = joinPetSearchEvalJudgments(
      PET_SEARCH_EVAL_QUERIES_V2,
      judgments,
      "visual-calibration-v2",
    );
    const firstPooled = joined.find(
      (fixture) => fixture.judgmentMode === "pooled",
    );
    expect(firstPooled).toMatchObject({
      relevantSlugs: [expect.stringMatching(/-relevant$/)],
      judgedSlugs: [
        expect.stringMatching(/-relevant$/),
        expect.stringMatching(/-irrelevant$/),
      ],
      reviewedBy: "reviewer",
    });

    expect(() =>
      joinPetSearchEvalJudgments(
        PET_SEARCH_EVAL_QUERIES_V2,
        judgments.map((record, index) =>
          index === 0
            ? { ...record, candidatePoolHash: "b".repeat(64) }
            : record,
        ),
        "visual-calibration-v2",
      ),
    ).toThrow(/pool hash.*mismatch/i);
    expect(() =>
      joinPetSearchEvalJudgments(
        PET_SEARCH_EVAL_QUERIES_V2,
        judgments.map((record, index) =>
          index === 0
            ? { ...record, judgments: record.judgments.slice(0, 1) }
            : record,
        ),
        "visual-calibration-v2",
      ),
    ).toThrow(/incomplete/i);
  });

  it("condenses pooled rankings to relevant and irrelevant judgments", () => {
    expect(
      condenseRankedSlugs(
        ["unjudged", "relevant", "uncertain", "irrelevant"],
        "pooled",
        ["relevant", "irrelevant"],
      ),
    ).toEqual(["relevant", "irrelevant"]);
    expect(
      condenseRankedSlugs(
        ["unjudged", "relevant", "irrelevant"],
        "deterministic",
        [],
      ),
    ).toEqual(["unjudged", "relevant", "irrelevant"]);
  });

  it("selects the fixed model threshold from labeled semantic scores", () => {
    const threshold = selectSemanticThreshold([
      {
        relevantSlugs: ["nozomi-2"],
        negative: false,
        matches: [
          { slug: "nozomi-2", score: 0.78 },
          { slug: "unrelated", score: 0.48 },
        ],
      },
      {
        relevantSlugs: ["crawlstack-polished"],
        negative: false,
        matches: [{ slug: "crawlstack-polished", score: 0.66 }],
      },
      {
        relevantSlugs: [],
        negative: true,
        matches: [{ slug: "unrelated", score: 0.3 }],
      },
    ]);

    expect(threshold).toBe(0.31);
    expect(
      PET_SEARCH_MODEL_REVISIONS["yandex-text-search-2026-07"]
      .minSemanticScore,
    ).toBe(threshold);
  });

  it("refuses to calibrate or pass safety without negative fixtures", () => {
    expect(() =>
      selectSemanticThreshold([
        {
          relevantSlugs: ["nozomi-2"],
          negative: false,
          matches: [{ slug: "nozomi-2", score: 0.78 }],
        },
      ]),
    ).toThrow(/negative fixtures/i);

    expect(
      evaluateSearchQuality([
        {
          category: "exact",
          query: "Zero Two",
          relevantSlugs: ["zero-two"],
          lexicalSlugs: ["zero-two"],
          hybridSlugs: ["zero-two"],
          semanticOnlySlugs: [],
          durationMs: 100,
        },
      ]).negativeSemanticOnlySafe,
    ).toBe(false);
  });

  it("computes rollout gates from ranked observations", () => {
    const report = evaluateSearchQuality([
      {
        category: "exact",
        query: "Zero Two",
        relevantSlugs: ["zero-two"],
        lexicalSlugs: ["zero-two"],
        hybridSlugs: ["zero-two"],
        semanticOnlySlugs: [],
        durationMs: 700,
      },
      {
        category: "style",
        query: "sexy",
        relevantSlugs: ["nozomi-2"],
        lexicalSlugs: [],
        hybridSlugs: ["nozomi-2"],
        semanticOnlySlugs: ["nozomi-2"],
        durationMs: 850,
        reviewedBy: "human-reviewer",
      },
      {
        category: "multi-token",
        query: "gothic anime",
        relevantSlugs: ["velvet-luma", "nightshade-2"],
        lexicalSlugs: ["velvet-luma"],
        hybridSlugs: ["velvet-luma", "nightshade-2"],
        semanticOnlySlugs: ["nightshade-2"],
        durationMs: 900,
      },
      {
        category: "negative",
        query: "quantum banana compiler",
        relevantSlugs: [],
        lexicalSlugs: [],
        hybridSlugs: [],
        semanticOnlySlugs: [],
        durationMs: 600,
      },
    ]);

    expect(report.exactNameMrrAt5).toBe(1);
    expect(report.hybridNdcgAt5).toBeGreaterThan(
      report.lexicalNdcgAt5 * 1.2,
    );
    expect(report.sexyHasRelevantTop5).toBe(true);
    expect(report.negativeSemanticOnlySafe).toBe(true);
    expect(report.p95DurationMs).toBeLessThan(1_000);
    expect(
      evaluateSearchRolloutGate(report, [200, 200, 200]),
    ).toMatchObject({ passed: true });
  });

  it("calibrates visual threshold and weight deterministically with safety gates", () => {
    const exactPet = searchablePet("zero-two", "Zero Two");
    const relevantPet = searchablePet("nozomi-2", "Nozomi");
    const unrelatedPet = searchablePet("unrelated", "Unrelated");
    const catalog = [exactPet, relevantPet, unrelatedPet];

    const result = calibrateVisualSearchProfile(
      [
        {
          category: "exact",
          query: "Zero Two",
          relevantSlugs: ["zero-two"],
          visualSubset: false,
          pets: catalog,
          lexical: rankPetsLexically(catalog, "Zero Two"),
          textMatches: [],
          visualMatches: [],
          durationMs: 100,
        },
        {
          category: "style",
          query: "sexy",
          relevantSlugs: ["nozomi-2"],
          visualSubset: true,
          pets: catalog,
          lexical: [],
          textMatches: [],
          visualMatches: [{ slug: "nozomi-2", score: 0.9 }],
          durationMs: 120,
        },
        {
          category: "negative",
          query: "quantum banana compiler",
          relevantSlugs: [],
          visualSubset: false,
          pets: catalog,
          lexical: [],
          textMatches: [],
          visualMatches: [{ slug: "unrelated", score: 0.7 }],
          durationMs: 80,
        },
      ],
      0.31,
    );

    expect(result.profile).toEqual({
      minSemanticScore: 0.9,
      weight: 0.25,
    });
    expect(result.report.exactNameMrrAt5).toBe(1);
    expect(result.report.negativeVisualOnlySafe).toBe(true);
    expect(result.report.visualSubsetCombinedNdcgAt5).toBe(1);
    expect(result.evaluatedProfileCount).toBe(8);
  });

  it("requires the full 15 percent visual calibration lift", () => {
    const safeReport = {
      exactNameMrrAt5: 1,
      textHybridNdcgAt5: 0.7,
      combinedNdcgAt5: 0.8,
      visualSubsetTextHybridNdcgAt5: 0.6,
      visualSubsetCombinedNdcgAt5: 0.69,
      visualSubsetLift: 0.15,
      sexyHasRelevantTop5: true,
      negativeVisualOnlySafe: true,
      p95DurationMs: 900,
      rankings: [],
    };
    expect(
      isVisualCalibrationReportEligible({
        ...safeReport,
        visualSubsetLift: 0.1499,
      }),
    ).toBe(false);
    expect(isVisualCalibrationReportEligible(safeReport)).toBe(true);
    expect(
      isVisualCalibrationReportEligible({
        ...safeReport,
        negativeVisualOnlySafe: false,
      }),
    ).toBe(false);
  });

  it("evaluates combined holdout gates independently from calibration", () => {
    const gate = evaluateVisualSearchRolloutGate(
        {
          exactNameMrrAt5: 1,
          textHybridNdcgAt5: 0.7,
          combinedNdcgAt5: 0.8,
          visualSubsetTextHybridNdcgAt5: 0.6,
          visualSubsetCombinedNdcgAt5: 0.72,
          visualSubsetLift: 0.2,
          sexyHasRelevantTop5: true,
          negativeVisualOnlySafe: true,
          p95DurationMs: 900,
          rankings: [],
        },
        {
          exactNameMrrAt5: 1,
          lexicalNdcgAt5: 0.5,
          hybridNdcgAt5: 0.7,
          hybridNdcgLift: 0.4,
          sexyHasRelevantTop5: true,
          sexyHumanReviewedTop5: false,
          negativeSemanticOnlySafe: true,
          p95DurationMs: 900,
        },
        {
          providerFallbackHttpStatuses: [200, 200, 200],
          visualFallbackHttpStatuses: [200, 200],
          captionsAbsentFromPublicContracts: true,
        },
      );

    expect(gate).toMatchObject({
      passed: true,
      checks: { textNegativeSemanticOnlySafe: true },
    });
  });
});

function searchablePet(slug: string, displayName: string) {
  return {
    slug,
    displayName,
    description: "",
    tags: [],
  };
}

function completeJudgments(
  suite: "text-regression-v2" | "visual-calibration-v2" | "visual-holdout-v2",
): PetSearchLabelPoolJudgmentRecord[] {
  return PET_SEARCH_EVAL_QUERIES_V2
    .filter(
      (query) =>
        query.suite === suite && query.judgmentMode === "pooled",
    )
    .map((query) => {
      const candidateRecords = [
        {
          slug: `${query.id}-relevant`,
          spritesheetSha256: "1".repeat(64),
        },
        {
          slug: `${query.id}-irrelevant`,
          spritesheetSha256: "2".repeat(64),
        },
      ];
      return {
        poolVersion: PET_SEARCH_LABEL_POOL_VERSION,
        queryId: query.id,
        suite: query.suite,
        query: query.query,
        candidatePoolHash: createPetSearchLabelPoolHash({
          poolVersion: PET_SEARCH_LABEL_POOL_VERSION,
          suite: query.suite,
          query: query.query,
          candidateRecords,
        }),
        candidateRecords,
        reviewer: "reviewer",
        reviewedAt: "2026-07-23T12:00:00.000Z",
        judgments: [
          {
            slug: `${query.id}-relevant`,
            judgment: "relevant" as const,
          },
          {
            slug: `${query.id}-irrelevant`,
            judgment: "irrelevant" as const,
          },
        ],
      };
    });
}

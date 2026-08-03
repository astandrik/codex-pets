import { describe, expect, it } from "vitest";

import fixtures from "@/lib/pets/search-eval-fixtures.json";
import {
  calibrateVisualSearchProfile,
  evaluatePetCaptionCandidate,
  evaluateSearchRolloutGate,
  evaluateSearchQuality,
  evaluateVisualSearchQualityGate,
  evaluateVisualSearchRolloutGate,
  resolveVisualSearchEvalSplit,
  selectPetCaptionWinner,
  selectSemanticThreshold,
} from "@/lib/pets/search-eval";
import { PET_SEARCH_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { rankPetsLexically } from "@/lib/pets/search-ranking";

describe("pet search evaluation", () => {
  it("maps the calibrate command to the frozen calibration split", () => {
    expect(resolveVisualSearchEvalSplit("calibrate")).toBe("calibration");
    expect(resolveVisualSearchEvalSplit("holdout")).toBe("holdout");
    expect(resolveVisualSearchEvalSplit(undefined)).toBeNull();
  });

  it("covers every required query family without claiming unfinished human review", () => {
    expect(new Set(fixtures.map((fixture) => fixture.category))).toEqual(
      new Set(["exact", "multi-token", "typo", "style", "russian", "negative"]),
    );
    expect(fixtures.map((fixture) => fixture.query)).toEqual(
      expect.arrayContaining(["cute", "badass", "sexy"]),
    );
    expect(
      fixtures.find((fixture) => fixture.query === "sexy")?.reviewedBy,
    ).toBeNull();
    expect(new Set(fixtures.map((fixture) => fixture.split))).toEqual(
      new Set(["calibration", "holdout"]),
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

  it("rejects unsafe or incomplete caption candidates before ranking", () => {
    const report = visualReport({
      visualSubsetCombinedNdcgAt5: 0.9,
      combinedNdcgAt5: 0.8,
    });
    const textReport = searchReport({ hybridNdcgAt5: 0.75 });
    const result = evaluatePetCaptionCandidate({
      captionRevision: "candidate-a",
      visualRevision: "visual-a",
      approvedPetSlugs: ["a", "b"],
      reviews: [
        humanReview("a", "candidate-a"),
        {
          ...humanReview("b", "candidate-a"),
          unsupportedFact: true,
        },
      ],
      schemaFailureSlugs: [],
      missingCaptionSlugs: [],
      textReport,
      visualReport: report,
      freshV1TextNdcgAt5: 0.74,
    });

    expect(result.passed).toBe(false);
    expect(result.checks).toMatchObject({
      completeHumanReview: true,
      noUnsupportedFacts: false,
      noBilingualContradictions: true,
      noSchemaFailures: true,
      noMissingCaptions: true,
      textV2NonRegression: true,
    });
  });

  it("selects the best passing caption with an exact Qwen tie-break", () => {
    const qwen = evaluatePetCaptionCandidate({
      captionRevision: "qwen",
      visualRevision: "visual-qwen",
      approvedPetSlugs: ["a"],
      reviews: [humanReview("a", "qwen", 4, 4)],
      schemaFailureSlugs: [],
      missingCaptionSlugs: [],
      textReport: searchReport(),
      visualReport: visualReport({
        visualSubsetCombinedNdcgAt5: 0.9,
        combinedNdcgAt5: 0.8,
      }),
      freshV1TextNdcgAt5: 0.7,
    });
    const deepseek = evaluatePetCaptionCandidate({
      captionRevision: "deepseek",
      visualRevision: "visual-deepseek",
      approvedPetSlugs: ["a"],
      reviews: [humanReview("a", "deepseek", 5, 5)],
      schemaFailureSlugs: [],
      missingCaptionSlugs: [],
      textReport: searchReport(),
      visualReport: visualReport({
        visualSubsetCombinedNdcgAt5: 0.9,
        combinedNdcgAt5: 0.8,
      }),
      freshV1TextNdcgAt5: 0.7,
    });

    expect(qwen.passed).toBe(true);
    expect(deepseek.passed).toBe(true);
    expect(
      selectPetCaptionWinner([deepseek, qwen], "qwen").captionRevision,
    ).toBe("deepseek");
    const exactTie = {
      ...deepseek,
      meanHumanScore: qwen.meanHumanScore,
    };
    expect(
      selectPetCaptionWinner([exactTie, qwen], "qwen").captionRevision,
    ).toBe("qwen");
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

  it("keeps live quality checks separate from operational contract evidence", () => {
    const visualReport = {
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
    };
    const textReport = {
      exactNameMrrAt5: 1,
      lexicalNdcgAt5: 0.5,
      hybridNdcgAt5: 0.7,
      hybridNdcgLift: 0.2,
      sexyHasRelevantTop5: true,
      sexyHumanReviewedTop5: false,
      negativeSemanticOnlySafe: true,
      p95DurationMs: 900,
    };

    const gate = evaluateVisualSearchQualityGate(
      visualReport,
      textReport,
      { sexyHasRelevantTop5: true },
    );

    expect(gate.passed).toBe(true);
    expect(gate.checks).not.toHaveProperty("providerFallbackHttp200");
    expect(gate.checks).not.toHaveProperty("visualFallbackHttp200");
    expect(gate.checks).not.toHaveProperty(
      "captionsAbsentFromPublicContracts",
    );
    expect(
      evaluateVisualSearchQualityGate(
        visualReport,
        { ...textReport, hybridNdcgLift: 0.199 },
        { sexyHasRelevantTop5: true },
      ).checks.textHybridNdcgLift,
    ).toBe(false);
  });
});

function humanReview(
  petSlug: string,
  captionRevision: string,
  coverage = 5,
  searchUtility = 5,
) {
  return {
    petSlug,
    captionRevision,
    unsupportedFact: false,
    bilingualContradiction: false,
    coverage,
    searchUtility,
  };
}

function searchReport(
  overrides: Partial<ReturnType<typeof evaluateSearchQuality>> = {},
) {
  return {
    exactNameMrrAt5: 1,
    lexicalNdcgAt5: 0.5,
    hybridNdcgAt5: 0.7,
    hybridNdcgLift: 0.4,
    sexyHasRelevantTop5: true,
    sexyHumanReviewedTop5: true,
    negativeSemanticOnlySafe: true,
    p95DurationMs: 500,
    ...overrides,
  };
}

function visualReport(
  overrides: Partial<
    ReturnType<typeof calibrateVisualSearchProfile>["report"]
  > = {},
) {
  return {
    exactNameMrrAt5: 1,
    textHybridNdcgAt5: 0.7,
    combinedNdcgAt5: 0.8,
    visualSubsetTextHybridNdcgAt5: 0.6,
    visualSubsetCombinedNdcgAt5: 0.9,
    visualSubsetLift: 0.5,
    sexyHasRelevantTop5: true,
    negativeVisualOnlySafe: true,
    p95DurationMs: 500,
    rankings: [],
    ...overrides,
  };
}

function searchablePet(slug: string, displayName: string) {
  return {
    slug,
    displayName,
    description: "",
    tags: [],
  };
}

import { describe, expect, it } from "vitest";

import searchFixtures from "@/lib/pets/search-eval-fixtures.json";
import {
  RELATED_PETS_VISUAL_WEIGHT_CANDIDATES,
  createRelatedPetsCalibrationCases,
  evaluateRelatedPetsHoldout,
  ndcgAt4,
  selectRelatedTextThreshold,
  selectRelatedVisualProfile,
  type RelatedPetCalibrationObservation,
} from "@/lib/pets/related-pets-calibration";

describe("related pet calibration fixtures", () => {
  it("derives exactly 10 calibration and 4 untouched holdout source cases", () => {
    const cases = createRelatedPetsCalibrationCases(searchFixtures);

    expect(cases.calibration).toHaveLength(10);
    expect(cases.holdout).toHaveLength(4);
    expect(cases.calibration[0]).toEqual({
      groupId: "multi-token-gothic-anime",
      sourceSlug: "velvet-luma",
      relevantSlugs: ["nightshade-2", "fischl-detailed"],
      split: "calibration",
    });
    expect(cases.holdout.map(({ sourceSlug }) => sourceSlug)).toEqual([
      "vi",
      "jinx-2",
      "master-of-terra",
      "primaris",
    ]);
    expect(
      new Set(cases.calibration.map(({ groupId }) => groupId)),
    ).toEqual(
      new Set([
        "multi-token-gothic-anime",
        "style-cute",
        "style-sexy",
      ]),
    );
    expect(new Set(cases.holdout.map(({ groupId }) => groupId))).toEqual(
      new Set(["style-badass"]),
    );
  });
});

describe("related pet nDCG@4", () => {
  it("scores binary relevance at four without counting duplicate hits twice", () => {
    const idealDcg = 1 + 1 / Math.log2(3);
    const expectedDcg = 1 + 1 / Math.log2(4);

    expect(ndcgAt4(["a", "x", "b"], ["a", "b"])).toBeCloseTo(
      expectedDcg / idealDcg,
    );
    expect(ndcgAt4(["a", "a", "x", "b"], ["a", "b"])).toBeCloseTo(
      (1 + 1 / Math.log2(5)) / idealDcg,
    );
  });
});

function observation(
  overrides: Partial<RelatedPetCalibrationObservation> = {},
): RelatedPetCalibrationObservation {
  return {
    groupId: "group",
    split: "calibration",
    sourceSlug: "source",
    relevantSlugs: ["peer"],
    metadataSlugs: ["peer", "other"],
    textMatches: [{ slug: "peer", score: 0.9 }],
    visualMatches: [{ slug: "peer", score: 0.9 }],
    ...overrides,
  };
}

describe("related pet profile selection", () => {
  it("selects the higher text threshold when calibration nDCG ties", () => {
    expect(
      selectRelatedTextThreshold([observation()], [0.4, 0.9]),
    ).toMatchObject({
      textMinSimilarity: 0.9,
      evaluatedThresholdCount: 2,
    });
  });

  it("uses only approved visual weights and breaks ties by lower weight then higher threshold", () => {
    expect(RELATED_PETS_VISUAL_WEIGHT_CANDIDATES).toEqual([
      0.25, 0.5, 0.75,
    ]);
    expect(
      selectRelatedVisualProfile([observation()], 0.9, [0.4, 0.9]),
    ).toMatchObject({
      visualMinSimilarity: 0.9,
      visualWeight: 0.25,
      evaluatedProfileCount: 6,
    });
  });

  it("rejects holdout observations during profile selection", () => {
    const holdout = observation({ split: "holdout" });

    expect(() =>
      selectRelatedTextThreshold([holdout], [0.9]),
    ).toThrow(/calibration observations/i);
    expect(() =>
      selectRelatedVisualProfile([holdout], 0.9, [0.9]),
    ).toThrow(/calibration observations/i);
  });
});

describe("related pet holdout reporting", () => {
  it("reports full hybrid comparisons against both untouched baselines", () => {
    const report = evaluateRelatedPetsHoldout(
      [
        observation({
          split: "holdout",
          metadataSlugs: ["other", "peer"],
          textMatches: [{ slug: "peer", score: 0.9 }],
          visualMatches: [{ slug: "peer", score: 0.95 }],
        }),
      ],
      {
        textMinSimilarity: 0.8,
        visualMinSimilarity: 0.9,
        visualWeight: 0.25,
      },
    );

    expect(report.hybridNdcgAt4).toBeGreaterThanOrEqual(
      report.metadataNdcgAt4,
    );
    expect(report.hybridNdcgAt4).toBeGreaterThanOrEqual(
      report.textMetadataNdcgAt4,
    );
    expect(report.comparisons).toEqual({
      hybridNoWorseThanMetadata: true,
      hybridNoWorseThanTextMetadata: true,
    });
    expect(report.passed).toBe(true);
  });

  it("rejects calibration observations from holdout reporting", () => {
    expect(() =>
      evaluateRelatedPetsHoldout([observation()], {
        textMinSimilarity: 0.8,
        visualMinSimilarity: 0.9,
        visualWeight: 0.25,
      }),
    ).toThrow(/holdout observations/i);
  });
});

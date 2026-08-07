import { describe, expect, it } from "vitest";

import relatedFixtures from "@/lib/pets/related-pets-eval-fixtures.json";
import searchFixtures from "@/lib/pets/search-eval-fixtures.json";
import {
  RELATED_PETS_VISUAL_WEIGHT_CANDIDATES,
  createRelatedPetsCalibrationCases,
  createRelatedPetsCalibrationObservations,
  evaluateRelatedPetsCalibration,
  evaluateRelatedPetsHoldout,
  evaluateRelatedPetsProfile,
  ndcgAt4,
  ndcgAt8,
  ndcgAtK,
  selectRelatedTextThreshold,
  selectRelatedVisualProfile,
  type RelatedPetCalibrationObservation,
} from "@/lib/pets/related-pets-calibration";

describe("related pet calibration fixtures", () => {
  it("derives exactly 12 calibration and 4 untouched holdout source cases", () => {
    const cases = createRelatedPetsCalibrationCases(relatedFixtures);

    expect(cases.calibration).toHaveLength(12);
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
        "concept-skeleton-pixel-art",
      ]),
    );
    expect(new Set(cases.holdout.map(({ groupId }) => groupId))).toEqual(
      new Set(["style-badass"]),
    );
    expect(
      cases.calibration.filter(
        ({ groupId }) => groupId === "concept-skeleton-pixel-art",
      ),
    ).toEqual([
      {
        groupId: "concept-skeleton-pixel-art",
        sourceSlug: "sans",
        relevantSlugs: ["fire-skull"],
        split: "calibration",
      },
      {
        groupId: "concept-skeleton-pixel-art",
        sourceSlug: "fire-skull",
        relevantSlugs: ["sans"],
        split: "calibration",
      },
    ]);
    expect(searchFixtures.some(({ id }) => id === "concept-skeleton-pixel-art")).toBe(
      false,
    );
  });
});

describe("related pet calibration observations", () => {
  it("derives complete metadata and pairwise modality ranks from stored vectors", () => {
    const candidates = [
      calibrationCandidate("source", ["night"]),
      calibrationCandidate("peer", ["night"]),
      calibrationCandidate("other", []),
    ];

    expect(
      createRelatedPetsCalibrationObservations({
        cases: [
          {
            groupId: "group",
            split: "calibration",
            sourceSlug: "source",
            relevantSlugs: ["peer"],
          },
        ],
        candidates,
        textQueryVectors: new Map([["source", [1, 0]]]),
        textDocumentVectors: new Map([
          ["source", [1, 0]],
          ["peer", [1, 0]],
          ["other", [0, 1]],
        ]),
        visualVectors: new Map([
          ["source", [0, 1]],
          ["peer", [1, 0]],
          ["other", [0, 1]],
        ]),
      }),
    ).toEqual([
      {
        groupId: "group",
        split: "calibration",
        sourceSlug: "source",
        relevantSlugs: ["peer"],
        metadataSlugs: ["peer", "other"],
        textMatches: [
          { slug: "peer", score: 1 },
          { slug: "other", score: 0 },
        ],
        visualMatches: [
          { slug: "other", score: 1 },
          { slug: "peer", score: 0 },
        ],
      },
    ]);
  });

  it("rejects calibration cases whose source pet is unavailable", () => {
    expect(() =>
      createRelatedPetsCalibrationObservations({
        cases: [
          {
            groupId: "group",
            split: "holdout",
            sourceSlug: "missing",
            relevantSlugs: ["peer"],
          },
        ],
        candidates: [calibrationCandidate("peer", ["night"])],
        textQueryVectors: new Map(),
        textDocumentVectors: new Map(),
        visualVectors: new Map(),
      }),
    ).toThrow(/missing.*approved catalog/i);
  });
});

describe("related pet nDCG@K", () => {
  it("scores binary relevance without counting duplicate hits twice", () => {
    const idealDcg = 1 + 1 / Math.log2(3);
    const expectedDcg = 1 + 1 / Math.log2(4);

    expect(ndcgAt4(["a", "x", "b"], ["a", "b"])).toBeCloseTo(
      expectedDcg / idealDcg,
    );
    expect(ndcgAt4(["a", "a", "x", "b"], ["a", "b"])).toBeCloseTo(
      (1 + 1 / Math.log2(5)) / idealDcg,
    );
    expect(
      ndcgAt8(["x1", "x2", "x3", "x4", "x5", "x6", "x7", "a"], ["a"]),
    ).toBeCloseTo(1 / Math.log2(9));
  });

  it("rejects invalid cutoffs", () => {
    expect(() => ndcgAtK(["a"], ["a"], 0)).toThrow(/positive integer/i);
    expect(() => ndcgAtK(["a"], ["a"], 1.5)).toThrow(/positive integer/i);
  });
});

function calibrationCandidate(slug: string, tags: string[]) {
  return {
    slug,
    displayName: slug,
    kind: "character" as const,
    tags,
    description: slug,
    approvedAt: "2026-08-03T00:00:00.000Z",
    createdAt: "2026-08-03T00:00:00.000Z",
  };
}

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
  it("selects a later text threshold when it strictly improves nDCG@4", () => {
    expect(
      selectRelatedTextThreshold(
        [
          observation({
            metadataSlugs: ["other", "peer"],
            textMatches: [{ slug: "peer", score: 0.8 }],
            visualMatches: [],
          }),
        ],
        [0.8, 0.9],
      ),
    ).toMatchObject({
      textMinSimilarity: 0.8,
      ndcgAt4: 1,
      evaluatedThresholdCount: 2,
    });
  });

  it("selects the higher text threshold when calibration nDCG ties", () => {
    const report = selectRelatedTextThreshold(
      [
        observation({
          metadataSlugs: ["other", "peer"],
          textMatches: [{ slug: "peer", score: 0.9 }],
        }),
      ],
      [0.4, 0.9],
    );

    expect(report.textMinSimilarity).toBe(0.9);
    expect(report).toMatchObject({
      evaluatedThresholdCount: 2,
    });
  });

  it("fails when every real text profile degrades metadata nDCG@4", () => {
    expect(() =>
      selectRelatedTextThreshold([
        observation({
          metadataSlugs: ["peer", "other"],
          textMatches: [{ slug: "other", score: 0.9 }],
          visualMatches: [],
        }),
      ]),
    ).toThrow(/safe.*contributing text profile/i);
  });

  it("fails when text is a no-op for the final top four", () => {
    expect(() => selectRelatedTextThreshold([observation()])).toThrow(
      /safe.*contributing text profile/i,
    );
  });

  it("rejects text threshold candidates outside the cosine range", () => {
    expect(() =>
      selectRelatedTextThreshold(
        [
          observation({
            metadataSlugs: ["other", "peer"],
            textMatches: [{ slug: "peer", score: 0.9 }],
          }),
        ],
        [1 + Number.EPSILON],
      ),
    ).toThrow(/cosine range/i);
  });

  it("passes calibration only when the selected profile is pinned exactly", () => {
    const observations = [
      observation({
        sourceSlug: "text-source",
        metadataSlugs: ["other", "peer"],
        textMatches: [{ slug: "peer", score: 0.8 }],
        visualMatches: [],
      }),
      observation({
        sourceSlug: "visual-source",
        metadataSlugs: ["other", "peer"],
        textMatches: [],
        visualMatches: [{ slug: "peer", score: 0.85 }],
      }),
    ];
    const pinnedProfile = {
      textMinSimilarity: 0.8,
      visualMinSimilarity: 0.85,
      visualWeight: 0.25,
    } as const;

    expect(
      evaluateRelatedPetsCalibration(observations, pinnedProfile),
    ).toMatchObject({
      selectedProfile: pinnedProfile,
      pinnedProfile,
      profileMatches: true,
      passed: true,
    });
    expect(
      evaluateRelatedPetsCalibration(observations, {
        ...pinnedProfile,
        textMinSimilarity: 0.81,
      }),
    ).toMatchObject({
      selectedProfile: pinnedProfile,
      profileMatches: false,
      passed: false,
    });
  });

  it("selects a later visual profile when it strictly improves nDCG@4", () => {
    expect(
      selectRelatedVisualProfile(
        [
          observation({
            metadataSlugs: ["other", "peer"],
            textMatches: [],
            visualMatches: [{ slug: "peer", score: 0.8 }],
          }),
        ],
        1,
        [0.8, 0.9],
      ),
    ).toMatchObject({
      visualMinSimilarity: 0.8,
      visualWeight: 0.25,
      ndcgAt4: 1,
      evaluatedProfileCount: 7,
    });
  });

  it("uses only approved visual weights and prefers enabled visual on a tie", () => {
    expect(RELATED_PETS_VISUAL_WEIGHT_CANDIDATES).toEqual([
      0.25, 0.5, 0.75,
    ]);
    const report = selectRelatedVisualProfile(
      [observation()],
      0.9,
      [0.9],
    );
    expect(report.visualMinSimilarity).toBe(0.9);
    expect(report).toMatchObject({
      visualWeight: 0.25,
      evaluatedProfileCount: 4,
    });
  });

  it("breaks remaining visual profile ties by higher threshold", () => {
    const report = selectRelatedVisualProfile(
      [observation()],
      0.9,
      [0.4, 0.9],
    );

    expect(report.visualMinSimilarity).toBe(0.9);
    expect(report).toMatchObject({
      visualWeight: 0.25,
      evaluatedProfileCount: 7,
    });
  });

  it("uses explicit visual-off only when every enabled profile degrades the baseline", () => {
    const report = selectRelatedVisualProfile(
      [
        observation({
          metadataSlugs: ["peer", "other"],
          textMatches: [],
          visualMatches: [{ slug: "other", score: 0.9 }],
        }),
      ],
      1,
    );

    expect(report.visualMinSimilarity).toBeNull();
    expect(report.visualWeight).toBe(0);
    expect(report.ndcgAt4).toBe(1);
    expect(report.evaluatedProfileCount).toBe(4);
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

describe("related pet semantic regressions", () => {
  it("puts Fire Skull in Sans top four only through text semantics", () => {
    const report = evaluateRelatedPetsProfile(
      [
        observation({
          groupId: "concept-skeleton-pixel-art",
          sourceSlug: "sans",
          relevantSlugs: ["fire-skull"],
          metadataSlugs: [
            "new-a",
            "new-b",
            "new-c",
            "new-d",
            "fire-skull",
          ],
          textMatches: [{ slug: "fire-skull", score: 0.9 }],
          visualMatches: [],
        }),
      ],
      {
        textMinSimilarity: 0.9,
        visualMinSimilarity: null,
        visualWeight: 0,
      },
    );

    expect(report.cases[0]?.metadataSlugs.slice(0, 4)).not.toContain(
      "fire-skull",
    );
    expect(report.cases[0]?.textMetadataSlugs.slice(0, 4)).toContain(
      "fire-skull",
    );
    expect(report.textContribution).toEqual({
      aggregateNoWorseThanMetadata: true,
      improvedCaseCount: 1,
      changedTop4CaseCount: 1,
    });
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
    expect(report.hybridNdcgAt8).toBeGreaterThanOrEqual(
      report.metadataNdcgAt8,
    );
    expect(report.hybridNdcgAt8).toBeGreaterThanOrEqual(
      report.textMetadataNdcgAt8,
    );
    expect(report.comparisons).toEqual({
      hybridNoWorseThanMetadataAt4: true,
      hybridNoWorseThanTextMetadataAt4: true,
      hybridNoWorseThanMetadataAt8: true,
      hybridNoWorseThanTextMetadataAt8: true,
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

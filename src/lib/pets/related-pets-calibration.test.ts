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
  it("derives grouped and explicit calibration and holdout cases", () => {
    const cases = createRelatedPetsCalibrationCases(relatedFixtures);

    expect(cases.calibration).toHaveLength(13);
    expect(cases.holdout).toHaveLength(5);
    expect(cases.calibration[0]).toEqual({
      groupId: "multi-token-gothic-anime",
      sourceSlug: "velvet-luma",
      relevantSlugs: ["nightshade-2", "fischl-detailed"],
      negativeSlugs: [],
      split: "calibration",
    });
    expect(cases.holdout.map(({ sourceSlug }) => sourceSlug)).toEqual([
      "vi",
      "jinx-2",
      "master-of-terra",
      "primaris",
      "yuna",
    ]);
    expect(
      new Set(cases.calibration.map(({ groupId }) => groupId)),
    ).toEqual(
      new Set([
        "multi-token-gothic-anime",
        "style-cute",
        "style-sexy",
        "concept-skeleton-pixel-art",
        "dracula-theme-first",
      ]),
    );
    expect(new Set(cases.holdout.map(({ groupId }) => groupId))).toEqual(
      new Set(["style-badass", "ffx-yuna"]),
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
        negativeSlugs: [],
        split: "calibration",
      },
      {
        groupId: "concept-skeleton-pixel-art",
        sourceSlug: "fire-skull",
        relevantSlugs: ["sans"],
        negativeSlugs: [],
        split: "calibration",
      },
    ]);
    expect(
      cases.calibration.find(({ sourceSlug }) => sourceSlug === "dracula"),
    ).toMatchObject({
      relevantSlugs: [
        "lady-d-2",
        "fire-skull",
        "tallulah",
        "gothic-flying-demon",
        "glamorous-succubus",
        "nightmare-creature",
      ],
      negativeSlugs: expect.arrayContaining(["burnice", "daenerys"]),
    });
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
        negativeSlugs: [],
        metadataSlugs: ["peer", "other"],
        sharedTagCounts: { peer: 1, other: 0 },
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
    negativeSlugs: [],
    metadataSlugs: ["peer", "other"],
    sharedTagCounts: {},
    textMatches: [{ slug: "peer", score: 0.9 }],
    visualMatches: [{ slug: "peer", score: 0.9 }],
    ...overrides,
  };
}

describe("related pet profile selection", () => {
  it("selects visual reranking only inside the v9 text-qualified tier", () => {
    const report = selectRelatedVisualProfile(
      [
        observation({
          metadataSlugs: ["other", "peer"],
          textMatches: [
            { slug: "other", score: 0.95 },
            { slug: "peer", score: 0.9 },
          ],
          visualMatches: [{ slug: "peer", score: 0.95 }],
        }),
      ],
      0.9,
      [0.95],
      "text-first-v9",
    );

    expect(report).toMatchObject({
      visualMinSimilarity: 0.95,
      visualWeight: 0.25,
      ndcgAt4: 1,
      ndcgAt8: 1,
    });
  });

  it("selects a later text threshold when it strictly improves nDCG@4", () => {
    expect(
      selectRelatedTextThreshold(
        [
          observation({
            metadataSlugs: ["other", "peer"],
            sharedTagCounts: { other: 1 },
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
        sharedTagCounts: { other: 1, peer: 1 },
        textMatches: [],
        visualMatches: [{ slug: "peer", score: 0.85 }],
      }),
    ];
    const pinnedProfile = {
      strategy: "theme-first-v8" as const,
      textMinSimilarity: 0.8,
      visualMinSimilarity: 0.85,
      visualWeight: 0.25,
    } as const;

    const matchingReport = evaluateRelatedPetsCalibration(
      observations,
      pinnedProfile,
    );
    expect(matchingReport).toMatchObject({
      selectedProfile: pinnedProfile,
      pinnedProfile,
      profileMatches: true,
      passed: true,
    });
    expect(matchingReport.comparisons).toEqual({
      textMetadataNoWorseThanMetadata: true,
      textImprovesAtLeastOneCase: true,
      textChangesAtLeastOneTop4: true,
      hybridNoWorseThanMetadataAt4: true,
      hybridNoWorseThanTextMetadataAt4: true,
      hybridNoWorseThanMetadataAt8: true,
      hybridNoWorseThanTextMetadataAt8: true,
      visualImprovesAtLeastOneCase: true,
      noExplicitNegativeInTop8: true,
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
            sharedTagCounts: { other: 1, peer: 1 },
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

  it("uses only approved non-zero visual weights", () => {
    expect(RELATED_PETS_VISUAL_WEIGHT_CANDIDATES).toEqual([
      0.25, 0.5, 0.75,
    ]);
    const report = selectRelatedVisualProfile([
      observation({
        metadataSlugs: ["other", "peer"],
        sharedTagCounts: { other: 1, peer: 1 },
        textMatches: [],
        visualMatches: [{ slug: "peer", score: 0.9 }],
      }),
    ], 1, [0.9]);
    expect(report.visualMinSimilarity).toBe(0.9);
    expect(report).toMatchObject({
      visualWeight: 0.25,
      evaluatedProfileCount: 4,
    });
  });

  it("breaks remaining visual profile ties by higher threshold", () => {
    const report = selectRelatedVisualProfile(
      [
        observation({
          metadataSlugs: ["other", "peer"],
          sharedTagCounts: { other: 1, peer: 1 },
          textMatches: [],
          visualMatches: [{ slug: "peer", score: 0.9 }],
        }),
      ],
      1,
      [0.4, 0.9],
    );

    expect(report.visualMinSimilarity).toBe(0.9);
    expect(report).toMatchObject({
      visualWeight: 0.25,
      evaluatedProfileCount: 7,
    });
  });

  it("blocks rollout when no non-zero visual profile improves safely", () => {
    expect(() =>
      selectRelatedVisualProfile(
        [
          observation({
            metadataSlugs: ["peer", "other"],
            sharedTagCounts: { peer: 1, other: 1 },
            textMatches: [],
            visualMatches: [{ slug: "other", score: 0.9 }],
          }),
        ],
        1,
      )
    ).toThrow(/no safe.*non-zero visual profile/i);
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
        strategy: "theme-first-v8",
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
    expect(report.textContribution).toMatchObject({
      aggregateNoWorseThanMetadata: true,
      improvedCaseCount: 1,
      changedTop4CaseCount: 1,
    });
    expect(report.cases[0]).toMatchObject({
      qualifiedCount: 1,
      semanticBackfillCount: 4,
    });
    expect(report.cases[0]?.hybridDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "fire-skull",
          tier: "qualified",
        }),
      ]),
    );
    expect(report).toMatchObject({
      qualifiedCount: 1,
      semanticBackfillCount: 4,
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
        strategy: "theme-first-v8",
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
        strategy: "theme-first-v8",
        textMinSimilarity: 0.8,
        visualMinSimilarity: 0.9,
        visualWeight: 0.25,
      }),
    ).toThrow(/holdout observations/i);
  });

  it("blocks rollout when hybrid degrades only at nDCG@8", () => {
    const metadataSlugs = [
      "irrelevant-1",
      "irrelevant-2",
      "irrelevant-3",
      "irrelevant-4",
      "irrelevant-5",
      "irrelevant-6",
      "peer",
      "irrelevant-7",
      "irrelevant-8",
    ];
    const report = evaluateRelatedPetsHoldout(
      [
        observation({
          split: "holdout",
          metadataSlugs,
          sharedTagCounts: Object.fromEntries(
            metadataSlugs.map((slug) => [slug, 1]),
          ),
          textMatches: metadataSlugs.map((slug, index) => ({
            slug,
            score: 0.95 - index / 100,
          })),
          visualMatches: metadataSlugs
            .filter((slug) => slug !== "peer")
            .slice(4)
            .map((slug) => ({ slug, score: 0.9 })),
        }),
      ],
      {
        strategy: "theme-first-v8",
        textMinSimilarity: 0.5,
        visualMinSimilarity: 0.5,
        visualWeight: 0.75,
      },
    );

    expect(report.hybridNdcgAt4).toBe(report.textMetadataNdcgAt4);
    expect(report.hybridNdcgAt8).toBeLessThan(
      report.textMetadataNdcgAt8,
    );
    expect(report.comparisons.hybridNoWorseThanTextMetadataAt8).toBe(false);
    expect(report.passed).toBe(false);
  });
});

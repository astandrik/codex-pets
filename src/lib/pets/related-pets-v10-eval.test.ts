import { describe, expect, it } from "vitest";

import type { RelatedPetAcceptanceFixture } from "@/lib/pets/related-pets-acceptance";
import type { RelatedPetCalibrationObservation } from "@/lib/pets/related-pets-calibration";
import { selectRelatedPetsV10Profile } from "@/lib/pets/related-pets-v10-eval";

const fillers = ["fill-a", "fill-b", "fill-c", "fill-d", "fill-e", "fill-f"];

describe("related pets V10 profile selection", () => {
  it("selects non-zero topic and visual contributions in separate stages", () => {
    const fixtures = [
      fixture("topic", "source-topic", "topic-peer"),
      fixture("visual", "source-visual", "visual-peer"),
    ];
    const observations = [
      observation({
        sourceSlug: "source-topic",
        relevantSlug: "topic-peer",
        wrongSlug: "topic-wrong",
        sharedTagCounts: { "topic-peer": 1 },
        topicMatches: [
          { slug: "topic-peer", score: 0.95 },
          { slug: "topic-wrong", score: 0.9 },
        ],
      }),
      observation({
        sourceSlug: "source-visual",
        relevantSlug: "visual-peer",
        wrongSlug: "visual-wrong",
        topicMatches: [
          { slug: "visual-peer", score: 0.95 },
          { slug: "visual-wrong", score: 0.9 },
        ],
        visualMatches: [{ slug: "visual-peer", score: 0.95 }],
      }),
    ];

    const result = selectRelatedPetsV10Profile({
      fixtures,
      observations,
      descriptionThresholds: [0.8],
      topicThresholds: [0.8],
      visualThresholds: [0.8],
    });

    expect(result.selectedProfile).toMatchObject({
      strategy: "description-theme-v10",
      textMinSimilarity: 0.8,
      topicMinSimilarity: 0.8,
      topicWeight: 0.1,
      metadataWeight: 0.05,
      visualMinSimilarity: 0.8,
      visualWeight: 0.1,
    });
    expect(result.topicAcceptance.improvedCaseCount).toBeGreaterThan(0);
    expect(result.acceptance.improvedCaseCount).toBeGreaterThan(0);
    expect(result.topicProfileCount).toBe(3);
    expect(result.visualProfileCount).toBe(3);
  });

  it("rejects calibration without a safe topic improvement", () => {
    const fixtures = [fixture("flat", "source", "peer")];
    const observations = [
      observation({
        sourceSlug: "source",
        relevantSlug: "peer",
        wrongSlug: "wrong",
        topicMatches: [
          { slug: "wrong", score: 0.95 },
          { slug: "peer", score: 0.9 },
        ],
      }),
    ];

    expect(() =>
      selectRelatedPetsV10Profile({
        fixtures,
        observations,
        descriptionThresholds: [0.8],
        topicThresholds: [0.8],
        visualThresholds: [0.8],
      }),
    ).toThrow(/no safe, improving topic profile/i);
  });
});

function fixture(
  id: string,
  sourceSlug: string,
  relevantSlug: string,
): RelatedPetAcceptanceFixture {
  return {
    id,
    sourceSlug,
    relevance: { [relevantSlug]: 3 },
    mustIncludeOneOfTop4: [],
    mustIncludeAllTop4: [],
    mustIncludeAllTop8: [],
    mustRankBefore: [],
    negativeSlugs: [],
  };
}

function observation(input: {
  sourceSlug: string;
  relevantSlug: string;
  wrongSlug: string;
  sharedTagCounts?: Record<string, number>;
  topicMatches: RelatedPetCalibrationObservation["topicMatches"];
  visualMatches?: RelatedPetCalibrationObservation["visualMatches"];
}): RelatedPetCalibrationObservation {
  const metadataSlugs = [input.wrongSlug, input.relevantSlug, ...fillers];
  return {
    groupId: input.sourceSlug,
    split: "calibration",
    sourceSlug: input.sourceSlug,
    relevantSlugs: [input.relevantSlug],
    negativeSlugs: [],
    metadataSlugs,
    sharedTagCounts: input.sharedTagCounts ?? {},
    textMatches: [
      { slug: input.wrongSlug, score: 0.95 },
      { slug: input.relevantSlug, score: 0.9 },
      ...fillers.map((slug, index) => ({
        slug,
        score: 0.7 - index * 0.01,
      })),
    ],
    topicMatches: [
      ...(input.topicMatches ?? []),
      ...fillers.map((slug, index) => ({
        slug,
        score: 0.7 - index * 0.01,
      })),
    ],
    visualMatches: input.visualMatches ?? [],
  };
}

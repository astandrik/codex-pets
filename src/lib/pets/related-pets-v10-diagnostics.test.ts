import { describe, expect, it } from "vitest";

import {
  evaluateRelatedPetsAcceptance,
  type RelatedPetAcceptanceFixture,
  type RelatedPetAcceptanceRankingCase,
} from "@/lib/pets/related-pets-acceptance";
import type { RelatedPetCalibrationObservation } from "@/lib/pets/related-pets-calibration";
import {
  assertRelatedPetsV10DiagnosticCoverage,
  classifyRelatedPetsV10TopicAcceptance,
  diagnoseRelatedPetsV10TopicProfiles,
} from "@/lib/pets/related-pets-v10-diagnostics";

const fillers = ["fill-a", "fill-b", "fill-c", "fill-d", "fill-e", "fill-f"];
const completeTop8 = ["peer", "lower", "negative", ...fillers.slice(0, 5)];

describe("related pets V10 topic diagnostics", () => {
  it("reports the frozen profile grid, bounded frontier and ablations", () => {
    const fixtures = [
      fixture("topic", "source-topic", "topic-peer"),
      fixture("second", "source-second", "second-peer"),
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
        sourceSlug: "source-second",
        relevantSlug: "second-peer",
        wrongSlug: "second-wrong",
        topicMatches: [
          { slug: "second-peer", score: 0.95 },
          { slug: "second-wrong", score: 0.9 },
        ],
      }),
    ];
    const input = {
      fixtures,
      observations,
      descriptionThresholds: [0.8],
      topicThresholds: [0.8],
    };

    const report = diagnoseRelatedPetsV10TopicProfiles(input);

    expect(report).toEqual(diagnoseRelatedPetsV10TopicProfiles(input));
    expect(report.profileCount).toBe(3);
    expect(report.evaluatedProfileCount).toBe(3);
    expect(report.gatePassCounts.safeAndImproving).toBeGreaterThan(0);
    expect(report.frontier.bestOverall.cases[0]?.candidateTop8).toBeInstanceOf(
      Array,
    );
    expect(report.ablations.length).toBeLessThanOrEqual(report.frontierLimit);
    expect(report.ablations[0]?.variants.map(({ name }) => name)).toEqual([
      "qualification_only",
      "topic_rrf",
      "shared_topic",
      "full_v10",
    ]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("[Array]");
    expect(collectKeys(report)).not.toEqual(
      expect.arrayContaining([
        "embedding",
        "descriptionText",
        "tags",
        "prompt",
        "secret",
        "apiKey",
      ]),
    );
  });

  it("rejects holdout observations", () => {
    const fixtureValue = fixture("case", "source", "peer");
    const holdout = observation({
      sourceSlug: "source",
      relevantSlug: "peer",
      wrongSlug: "wrong",
      topicMatches: [{ slug: "peer", score: 0.9 }],
    });
    holdout.split = "holdout";

    expect(() =>
      diagnoseRelatedPetsV10TopicProfiles({
        fixtures: [fixtureValue],
        observations: [holdout],
        descriptionThresholds: [0.8],
        topicThresholds: [0.8],
      })
    ).toThrow(/accepts calibration only/i);
  });

  it("rejects incomplete live coverage", () => {
    expect(() =>
      assertRelatedPetsV10DiagnosticCoverage({
        approvedPets: 155,
        descriptionQuery: 155,
        descriptionDocument: 155,
        topicQuery: 155,
        topicDocument: 154,
        visual: 155,
      })
    ).toThrow(/topicDocument=154/i);
  });
});

describe("related pets V10 topic gate classification", () => {
  it("distinguishes no lift and aggregate regression", () => {
    const noLift = classifyRelatedPetsV10TopicAcceptance(
      acceptance({ baseline: completeTop8, candidate: completeTop8 }),
    );
    expect(noLift.hasCaseLift).toBe(false);
    expect(noLift.aggregateNoRegressionAt4).toBe(true);
    expect(noLift.aggregateNoRegressionAt8).toBe(true);

    const regressed = classifyRelatedPetsV10TopicAcceptance(
      acceptance({
        baseline: completeTop8,
        candidate: ["lower", "negative", ...fillers.slice(0, 5), "peer"],
      }),
    );
    expect(regressed.aggregateNoRegressionAt4).toBe(false);
    expect(regressed.aggregateNoRegressionAt8).toBe(false);
  });

  it("distinguishes every frozen structural constraint", () => {
    const rankingIntegrity = classifyRelatedPetsV10TopicAcceptance(
      acceptance({ baseline: completeTop8, candidate: completeTop8.slice(0, 7) }),
    );
    expect(rankingIntegrity.rankingIntegrity).toBe(false);

    const requiredNeighbor = classifyRelatedPetsV10TopicAcceptance(
      acceptance({
        baseline: completeTop8,
        candidate: ["lower", "negative", ...fillers.slice(0, 2), "peer", ...fillers.slice(2, 5)],
        fixture: { mustIncludeOneOfTop4: ["peer"] },
      }),
    );
    expect(requiredNeighbor.requiredNeighborTop4).toBe(false);

    const explicitTop4 = classifyRelatedPetsV10TopicAcceptance(
      acceptance({
        baseline: completeTop8,
        candidate: ["lower", "negative", ...fillers.slice(0, 2), "peer", ...fillers.slice(2, 5)],
        fixture: { mustIncludeAllTop4: ["peer"] },
      }),
    );
    expect(explicitTop4.explicitTop4).toBe(false);

    const explicitTop8 = classifyRelatedPetsV10TopicAcceptance(
      acceptance({
        baseline: completeTop8,
        candidate: ["lower", "negative", ...fillers],
        fixture: { mustIncludeAllTop8: ["peer"] },
      }),
    );
    expect(explicitTop8.explicitTop8).toBe(false);

    const ordering = classifyRelatedPetsV10TopicAcceptance(
      acceptance({
        baseline: completeTop8,
        candidate: ["lower", "peer", "negative", ...fillers.slice(0, 5)],
        fixture: {
          relevance: { peer: 3, lower: 1 },
          mustRankBefore: [{ higherSlug: "peer", lowerSlug: "lower" }],
        },
      }),
    );
    expect(ordering.ordering).toBe(false);

    const hardNegative = classifyRelatedPetsV10TopicAcceptance(
      acceptance({
        baseline: completeTop8,
        candidate: completeTop8,
        fixture: { negativeSlugs: ["negative"] },
      }),
    );
    expect(hardNegative.noHardNegative).toBe(false);
  });
});

function acceptance(input: {
  baseline: readonly string[];
  candidate: readonly string[];
  fixture?: Partial<RelatedPetAcceptanceFixture>;
}) {
  const fixtureValue: RelatedPetAcceptanceFixture = {
    id: "gate",
    sourceSlug: "source",
    relevance: { peer: 3 },
    mustIncludeOneOfTop4: [],
    mustIncludeAllTop4: [],
    mustIncludeAllTop8: [],
    mustRankBefore: [],
    negativeSlugs: [],
    ...input.fixture,
  };
  const ranking: RelatedPetAcceptanceRankingCase = {
    sourceSlug: fixtureValue.sourceSlug,
    metadataSlugs: completeTop8,
    textSlugs: input.baseline,
    noVisualSlugs: input.baseline,
    candidateSlugs: input.candidate,
    v8Slugs: completeTop8,
    v7Slugs: completeTop8,
  };
  return evaluateRelatedPetsAcceptance({
    fixtures: [fixtureValue],
    rankings: [ranking],
    minimumCaseCount: 1,
  });
}

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
    visualMatches: [],
  };
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...collectKeys(child),
  ]);
}

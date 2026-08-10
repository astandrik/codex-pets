import { describe, expect, it } from "vitest";

import fixturesJson from "@/lib/pets/related-pets-acceptance-fixtures.json";
import {
  createRelatedPetsAcceptanceCases,
  evaluateRelatedPetsAcceptance,
  gradedNdcgAtK,
  parseRelatedPetsAcceptanceFixtures,
  type RelatedPetAcceptanceRankingCase,
} from "@/lib/pets/related-pets-acceptance";

describe("related pets acceptance fixtures", () => {
  it("loads the frozen multi-theme fixture set", () => {
    const fixtures = parseRelatedPetsAcceptanceFixtures(fixturesJson);
    const cases = createRelatedPetsAcceptanceCases(fixtures);

    expect(fixtures).toHaveLength(12);
    expect(new Set(fixtures.map(({ sourceSlug }) => sourceSlug)).size).toBe(12);
    expect(cases).toHaveLength(12);
    expect(cases[0]).toMatchObject({
      groupId: "acceptance:gothic-dracula",
      split: "holdout",
      sourceSlug: "dracula",
    });
  });

  it("rejects duplicate sources, invalid grades, and overlapping negatives", () => {
    expect(() =>
      parseRelatedPetsAcceptanceFixtures([
        fixture("one", "source", { related: 4 }),
      ]),
    ).toThrow(/incompatible/i);
    expect(() =>
      parseRelatedPetsAcceptanceFixtures([
        fixture("one", "source", { related: 3 }),
        fixture("two", "source", { another: 3 }),
      ]),
    ).toThrow(/incompatible/i);
    expect(() =>
      parseRelatedPetsAcceptanceFixtures([
        {
          ...fixture("one", "source", { related: 3 }),
          negativeSlugs: ["related"],
        },
      ]),
    ).toThrow(/incompatible/i);
  });
});

describe("graded related pets acceptance", () => {
  it("uses exponential graded gain and rank discount", () => {
    const relevance = { exact: 3, sameUniverse: 2, adjacent: 1 } as const;

    expect(gradedNdcgAtK(["exact", "sameUniverse", "adjacent"], relevance, 3))
      .toBe(1);
    expect(gradedNdcgAtK(["adjacent", "sameUniverse", "exact"], relevance, 3))
      .toBeLessThan(1);
    expect(gradedNdcgAtK(["unknown", "exact", "exact"], relevance, 3))
      .toBeCloseTo((7 / Math.log2(3)) / (7 + 3 / Math.log2(3) + 1 / 2));
  });

  it("passes aggregate, neighbor, negative, and per-case safety checks", () => {
    const fixtures = acceptanceFixtures();
    const report = evaluateRelatedPetsAcceptance({
      fixtures,
      rankings: fixtures.map(({ sourceSlug }, index) =>
        ranking(sourceSlug, index === 0
          ? ["exact", "same", "peer", "tail", "a", "b", "c", "d"]
          : ["exact", "peer", "same", "tail", "a", "b", "c", "d"]),
      ),
    });

    expect(report.passed).toBe(true);
    expect(report.improvedCaseCount).toBeGreaterThan(0);
    expect(Object.values(report.checks)).not.toContain(false);
  });

  it("reports severe regressions, missing neighbors, and hard negatives", () => {
    const fixtures = acceptanceFixtures();
    const rankings = fixtures.map(({ sourceSlug }) => ranking(sourceSlug));
    rankings[0] = {
      ...rankings[0],
      v8Slugs: ["negative", "a", "b", "c", "d", "e", "f", "g"],
    };
    const report = evaluateRelatedPetsAcceptance({ fixtures, rankings });

    expect(report.passed).toBe(false);
    expect(report.checks).toMatchObject({
      noSevereTextRegressionAt8: false,
      allRequiredNeighborsInTop4: false,
      noExplicitNegativeInTop8: false,
    });
  });

  it("reports too few cases and malformed top-8 rankings", () => {
    const fixtures = acceptanceFixtures().slice(0, 11);
    const rankings = fixtures.map(({ sourceSlug }) => ranking(sourceSlug));
    rankings[0] = {
      ...rankings[0],
      v8Slugs: ["exact", "exact", "peer"],
    };

    expect(
      evaluateRelatedPetsAcceptance({ fixtures, rankings }).checks,
    ).toMatchObject({
      minimumCaseCount: false,
      rankingIntegrity: false,
    });
  });
});

function fixture(
  id: string,
  sourceSlug: string,
  relevance: Record<string, number>,
) {
  return { id, sourceSlug, relevance, mustIncludeOneOfTop4: ["related"] };
}

function acceptanceFixtures() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `case-${index}`,
    sourceSlug: `source-${index}`,
    relevance: { exact: 3, same: 2, peer: 1 } as const,
    mustIncludeOneOfTop4: ["exact"],
    negativeSlugs: ["negative"],
  }));
}

function ranking(
  sourceSlug: string,
  v8Slugs = ["exact", "same", "peer", "tail", "a", "b", "c", "d"],
): RelatedPetAcceptanceRankingCase {
  return {
    sourceSlug,
    metadataSlugs: ["same", "exact", "peer", "tail", "a", "b", "c", "d"],
    textSlugs: ["same", "exact", "peer", "tail", "a", "b", "c", "d"],
    v8Slugs,
    v7Slugs: ["peer", "same", "exact", "tail", "a", "b", "c", "d"],
  };
}

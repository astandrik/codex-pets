import { describe, expect, it } from "vitest";

import {
  createRelatedPetsV11SimilarityCache,
  diagnoseRelatedPetsV11AnnotationProfiles,
  evaluateRelatedPetsV11Profile,
} from "@/lib/pets/related-pets-v11-eval";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";

describe("V11 evaluation safety", () => {
  it("accepts a complete ranking without hard negatives or conflict fallback", () => {
    const input = dataset(false);
    const report = evaluateRelatedPetsV11Profile({
      dataset: input.dataset,
      profile: profile(),
      comparisons: input.comparisons,
    });

    expect(report.checks).toMatchObject({
      noHardNegatives: true,
      mandatorySatisfied: true,
      orderingSatisfied: true,
      integritySatisfied: true,
      noConflictFallback: true,
    });
    expect(report.cases[0]?.comparisons).toMatchObject({
      v7: { slugs: expect.any(Array), ndcgAt4: expect.any(Number) },
      v8: { slugs: expect.any(Array), ndcgAt8: expect.any(Number) },
      description: { slugs: expect.any(Array) },
      v10Best: { slugs: expect.any(Array) },
    });
    expect(report.cases[0]).toMatchObject({
      negativeSlugsPresent: [],
      mandatory: {
        oneOfTop4: ["relevant"],
        oneOfTop4Satisfied: true,
        missingAllTop4: [],
        missingAllTop8: [],
      },
      orderingViolations: [],
    });
  });

  it("rejects profiles that need conflict fallback anywhere in the catalog", () => {
    const input = dataset(true);
    const report = evaluateRelatedPetsV11Profile({
      dataset: input.dataset,
      profile: profile(),
      comparisons: input.comparisons,
    });

    expect(report.allCatalogConflictFallbackCount).toBeGreaterThan(0);
    expect(report.checks.noConflictFallback).toBe(false);
  });

  it("produces the same report from precomputed similarities", () => {
    const input = dataset(false);
    const direct = evaluateRelatedPetsV11Profile({
      dataset: input.dataset,
      profile: profile(),
      comparisons: input.comparisons,
    });
    const cached = evaluateRelatedPetsV11Profile({
      dataset: input.dataset,
      profile: profile(),
      comparisons: input.comparisons,
      similarityCache: createRelatedPetsV11SimilarityCache(input.dataset),
    });

    expect(cached).toEqual(direct);
  });

  it("diagnoses the frozen annotation grid without opening a holdout", () => {
    const safe = dataset(false);
    const unsafe = dataset(true);
    const descriptionThresholds = [0];
    const annotationThresholds = [0];
    const reversed = new Map([
      ["source", ["g", "f", "e", "d", "c", "b", "a", "relevant"]],
    ]);
    safe.comparisons = {
      description: reversed,
      v7: reversed,
      v8: reversed,
      v10Best: reversed,
    };
    unsafe.comparisons = safe.comparisons;

    const safeReport = diagnoseRelatedPetsV11AnnotationProfiles({
      ...safe,
      descriptionThresholds,
      annotationThresholds,
    });
    const unsafeReport = diagnoseRelatedPetsV11AnnotationProfiles({
      ...unsafe,
      descriptionThresholds,
      annotationThresholds,
    });

    expect(safeReport).toMatchObject({
      split: "calibration",
      caseCount: 1,
      profileCount: 3,
      evaluatedProfileCount: 3,
      screeningSafeAndImprovingCount: 3,
      fullSafeAndImprovingCount: 3,
      frontierLimit: 8,
    });
    expect(unsafeReport.gatePassCounts.noConflictFallback).toBe(0);
    expect(unsafeReport.frontier[0]?.failedGates).toContain(
      "noConflictFallback",
    );
    expect(unsafeReport.frontier).toHaveLength(3);
    expect(JSON.stringify(unsafeReport)).not.toContain("textQueryVectors");
    expect(diagnoseRelatedPetsV11AnnotationProfiles({
      ...unsafe,
      descriptionThresholds,
      annotationThresholds,
    })).toEqual(unsafeReport);
  });
});

function dataset(conflict: boolean) {
  const slugs = ["source", "relevant", "a", "b", "c", "d", "e", "f", "g"];
  const candidates = slugs.map(candidate);
  const vectorMap = new Map(
    slugs.map((slug, index) => [slug, [1, index / 100] as const]),
  );
  const annotations = new Map(slugs.map((slug) => [slug, annotation(
    conflict && slug === "g" ? "different-franchise" : "main-franchise",
  )]));
  const fixture = {
    id: "source-case",
    sourceSlug: "source",
    relevance: { relevant: 3 as const },
    mustIncludeOneOfTop4: ["relevant"],
    mustIncludeAllTop4: [],
    mustIncludeAllTop8: [],
    mustRankBefore: [],
    negativeSlugs: [],
  };
  const baseline = new Map([["source", slugs.slice(1, 9)]]);
  return {
    dataset: {
      fixtures: [fixture],
      candidates,
      textQueryVectors: vectorMap,
      textDocumentVectors: vectorMap,
      annotationQueryVectors: vectorMap,
      annotationDocumentVectors: vectorMap,
      visualVectors: vectorMap,
      annotations,
    },
    comparisons: {
      description: baseline,
      v7: baseline,
      v8: baseline,
      v10Best: baseline,
    },
  };
}

function candidate(slug: string): RelatedPetCandidate {
  return {
    slug,
    displayName: slug,
    description: slug,
    kind: "character",
    tags: [],
    createdAt: "2026-08-11T00:00:00.000Z",
    approvedAt: "2026-08-11T00:00:00.000Z",
  };
}

function annotation(franchise: string | null) {
  return {
    schemaVersion: 1 as const,
    entity: null,
    aliases: [],
    franchises: franchise ? [franchise] : [],
    franchiseFamilies: [],
    collections: [],
    specificArchetypes: [],
    themes: [],
    mediaOrigins: [],
  };
}

function profile() {
  return {
    strategy: "entity-controlled-v11" as const,
    textMinSimilarity: 0,
    annotationMinSimilarity: 0,
    annotationWeight: 0.25,
    visualMinSimilarity: null,
    visualWeight: 0,
  };
}

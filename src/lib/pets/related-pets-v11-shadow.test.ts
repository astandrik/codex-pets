import { describe, expect, it } from "vitest";

import {
  RELATED_PETS_ANNOTATION_REVISION,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationSourceHash,
  resolveRelatedPetAnnotation,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  createProductionV7SnapshotBaseline,
  createRelatedPetsCatalogFingerprint,
  createRelatedPetsV11AnnotationAudit,
  createRelatedPetsV11ComparisonReport,
} from "@/lib/pets/related-pets-v11-shadow";
import { evaluateRelatedPetsV11Profile } from "@/lib/pets/related-pets-v11-eval";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";

const modelUri = "gpt://folder/qwen3.6-35b-a3b";
const proposal = {
  entity: {
    key: "vi",
    aliases: [],
    confidence: "high" as const,
    evidence: ["name" as const],
  },
  franchises: [{
    key: "arcane",
    confidence: "high" as const,
    evidence: ["description" as const],
  }],
  franchiseFamilies: [],
  collections: [],
  specificArchetypes: [],
  themes: [],
  mediaOrigins: [],
};

describe("V11 shadow comparison helpers", () => {
  it("audits current annotation rows without exposing source cards or proposals", () => {
    const pet = candidate("vi", "SECRET_DESCRIPTION", ["SECRET_TAG"]);
    const annotation = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
    const audit = createRelatedPetsV11AnnotationAudit({
      pets: [pet],
      rows: [{
        slug: pet.slug,
        sourceHash: createRelatedPetAnnotationSourceHash({
          pet,
          modelUri,
          annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
        }),
        proposalJson: JSON.stringify(proposal),
        annotationJson: JSON.stringify(annotation),
        annotationText: buildRelatedPetAnnotationText(annotation),
        updatedAt: "2026-08-11T00:00:00.000Z",
      }],
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri,
    });

    expect(audit.coverage).toEqual({
      approved: 1,
      stored: 1,
      accepted: 1,
      overrideRequired: 0,
      extra: 0,
    });
    expect(audit.decisions[0]).toMatchObject({
      slug: "vi",
      decision: "accepted",
      unresolvedFields: [],
      checks: {
        sourceHash: true,
        effectiveAnnotation: true,
        controlledText: true,
      },
    });
    expect(JSON.stringify(audit)).not.toContain("SECRET_DESCRIPTION");
    expect(JSON.stringify(audit)).not.toContain("SECRET_TAG");
    expect(JSON.stringify(audit)).not.toContain("proposalJson");
  });

  it("reports unresolved field names without provider values", () => {
    const pet = candidate("vi");
    const unresolvedProposal = {
      ...proposal,
      franchises: [{
        key: "SECRET_PROVIDER_VALUE",
        confidence: "high" as const,
        evidence: ["world_knowledge" as const],
      }],
    };
    const annotation = resolveRelatedPetAnnotation({
      slug: pet.slug,
      proposal: unresolvedProposal,
    });
    const audit = createRelatedPetsV11AnnotationAudit({
      pets: [pet],
      rows: [{
        slug: pet.slug,
        sourceHash: createRelatedPetAnnotationSourceHash({
          pet,
          modelUri,
          annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
        }),
        proposalJson: JSON.stringify(unresolvedProposal),
        annotationJson: JSON.stringify(annotation),
        annotationText: buildRelatedPetAnnotationText(annotation),
        updatedAt: "2026-08-11T00:00:00.000Z",
      }],
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri,
    });

    expect(audit.decisions[0]).toMatchObject({
      decision: "override-required",
      unresolvedFields: ["franchises"],
    });
    expect(JSON.stringify(audit)).not.toContain("SECRET_PROVIDER_VALUE");
  });

  it("binds the comparison to a complete active V7 snapshot", () => {
    const candidates = Array.from({ length: 9 }, (_, index) =>
      candidate(`pet-${index}`)
    );
    const related = candidates.slice(1).map(({ slug }) => slug);
    const recomputed = new Map([["pet-0", related]]);
    for (let index = 1; index < candidates.length; index += 1) {
      recomputed.set(
        `pet-${index}`,
        candidates.filter(({ slug }) => slug !== `pet-${index}`).map(({ slug }) => slug),
      );
    }
    const snapshots = Array.from(recomputed, ([sourceSlug, relatedSlugs]) => ({
      generationId: "generation-v7",
      sourceSlug,
      rankingRevision: "ranking-v7",
      relatedSlugs,
      createdAt: "2026-08-11T00:00:00.000Z",
    }));

    const baseline = createProductionV7SnapshotBaseline({
      state: {
        requestedGenerationId: "generation-v7",
        activeGenerationId: "generation-v7",
        previousGenerationId: "generation-v6",
        status: "ready",
        rankingRevision: "ranking-v7",
        failureReason: null,
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
      snapshots,
      candidates,
      recomputedRankings: recomputed,
      expectedGenerationId: "generation-v7",
      expectedRankingRevision: "ranking-v7",
    });

    expect(baseline.snapshotCount).toBe(9);
    expect(baseline.differenceSlugs).toEqual([]);
    expect(() => createProductionV7SnapshotBaseline({
      state: {
        requestedGenerationId: "generation-new",
        activeGenerationId: "generation-new",
        previousGenerationId: "generation-v7",
        status: "ready",
        rankingRevision: "ranking-v7",
        failureReason: null,
        updatedAt: "2026-08-11T00:01:00.000Z",
      },
      snapshots,
      candidates,
      recomputedRankings: recomputed,
      expectedGenerationId: "generation-v7",
      expectedRankingRevision: "ranking-v7",
    })).toThrow(/state changed/i);
  });

  it("creates a stable fingerprint independent of input order", () => {
    const left = [candidate("b"), candidate("a")];
    const right = [candidate("a"), candidate("b")];
    expect(createRelatedPetsCatalogFingerprint(left)).toBe(
      createRelatedPetsCatalogFingerprint(right),
    );
    expect(createRelatedPetsCatalogFingerprint([
      candidate("a", "changed"),
      candidate("b"),
    ])).not.toBe(createRelatedPetsCatalogFingerprint(right));
  });

  it("builds a bounded comparison report with aggregate, churn, and benchmark data", () => {
    const candidates = Array.from({ length: 9 }, (_, index) =>
      candidate(`pet-${index}`)
    );
    const vectors = new Map(
      candidates.map(({ slug }, index) => [slug, [1, index / 100] as const]),
    );
    const annotations = new Map(candidates.map(({ slug }) => [slug, {
      schemaVersion: 1 as const,
      entity: null,
      aliases: [],
      franchises: ["shared-franchise"],
      franchiseFamilies: [],
      collections: [],
      specificArchetypes: [],
      themes: [],
      mediaOrigins: [],
    }]));
    const production = new Map(candidates.map(({ slug }, index) => [
      slug,
      candidates
        .filter((_, candidateIndex) => candidateIndex !== index)
        .map(({ slug: relatedSlug }) => relatedSlug),
    ]));
    const dataset = {
      fixtures: [{
        id: "pet-0-case",
        sourceSlug: "pet-0",
        relevance: { "pet-1": 3 as const },
        mustIncludeOneOfTop4: ["pet-1"],
        mustIncludeAllTop4: [],
        mustIncludeAllTop8: [],
        mustRankBefore: [],
        negativeSlugs: [],
      }],
      candidates,
      textQueryVectors: vectors,
      textDocumentVectors: vectors,
      annotationQueryVectors: vectors,
      annotationDocumentVectors: vectors,
      visualVectors: vectors,
      annotations,
    };
    const comparisons = {
      description: production,
      v7: production,
      v8: production,
      v10Best: production,
    };
    const profile = {
      strategy: "entity-controlled-v11" as const,
      textMinSimilarity: -1,
      annotationMinSimilarity: -1,
      annotationWeight: 0.25,
      visualMinSimilarity: null,
      visualWeight: 0,
    };
    const evaluation = evaluateRelatedPetsV11Profile({
      dataset,
      comparisons,
      profile,
    });
    const report = createRelatedPetsV11ComparisonReport({
      catalogFingerprint: "catalog-hash",
      productionGenerationId: "generation-v7",
      productionRankingRevision: "ranking-v7",
      candidates,
      productionV7: production,
      v11: production,
      v11NoVisualReport: evaluation,
      v11Report: evaluation,
      representativeSlugs: ["pet-0"],
      benchmark: {
        warmups: 2,
        measuredRuns: 3,
        productionV7Ms: [1, 2, 3],
        v11Ms: [2, 3, 4],
      },
    });

    expect(report.aggregate.productionV7).toEqual(report.aggregate.v11);
    expect(report.catalog).toMatchObject({
      sourceCount: 9,
      integritySatisfied: true,
      averageOverlapAt8: 8,
    });
    expect(report.catalog.rows).toHaveLength(9);
    expect(report.cases[0]).toMatchObject({
      negativeSlugsPresent: [],
      orderingViolations: [],
      deltaFromBaselines: {
        v8: { ndcgAt4: 0, ndcgAt8: 0 },
      },
    });
    expect(report.benchmark).toMatchObject({
      productionV7: { p50Ms: 2, p95Ms: 3 },
      v11: { p50Ms: 3, p95Ms: 4 },
    });
    expect(report.representativeRankings).toHaveLength(1);
  });
});

function candidate(
  slug: string,
  description = slug,
  tags: string[] = [],
): RelatedPetCandidate {
  return {
    slug,
    displayName: slug,
    description,
    kind: "character",
    tags,
    createdAt: "2026-08-11T00:00:00.000Z",
    approvedAt: "2026-08-11T00:00:00.000Z",
  };
}

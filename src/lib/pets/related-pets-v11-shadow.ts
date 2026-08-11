import { createHash } from "node:crypto";

import {
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationSourceHash,
  listUnresolvedStrongRelations,
  parseResolvedRelatedPetAnnotation,
  resolveRelatedPetAnnotation,
  type ResolvedRelatedPetAnnotation,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import type { StoredRelatedPetAnnotation } from "@/lib/pets/related-pets-annotations-repository";
import type {
  RelatedPetsSnapshot,
  RelatedPetsState,
} from "@/lib/pets/related-pets-repository";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import type {
  evaluateRelatedPetsV11Profile,
} from "@/lib/pets/related-pets-v11-eval";

type Rankings = ReadonlyMap<string, readonly string[]>;
type V11Evaluation = ReturnType<typeof evaluateRelatedPetsV11Profile>;

export function createRelatedPetsCatalogFingerprint(
  pets: readonly RelatedPetCandidate[],
): string {
  const catalog = pets.map((pet) => ({
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    tags: [...pet.tags].toSorted(compareCodePoints),
    createdAt: pet.createdAt,
    approvedAt: pet.approvedAt,
  })).toSorted((left, right) => compareCodePoints(left.slug, right.slug));
  return createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
}

export function createRelatedPetsV11AnnotationAudit(input: {
  pets: readonly RelatedPetCandidate[];
  rows: readonly StoredRelatedPetAnnotation[];
  annotationRevision: string;
  modelUri: string;
}) {
  const rowsBySlug = new Map(input.rows.map((row) => [row.slug, row]));
  const approvedSlugs = new Set(input.pets.map(({ slug }) => slug));
  const decisions = input.pets
    .toSorted((left, right) => compareCodePoints(left.slug, right.slug))
    .map((pet) => auditAnnotation(pet, rowsBySlug.get(pet.slug), input));
  const extraSlugs = input.rows
    .map(({ slug }) => slug)
    .filter((slug) => !approvedSlugs.has(slug))
    .toSorted(compareCodePoints);
  return {
    coverage: {
      approved: input.pets.length,
      stored: decisions.filter(({ failureCode }) => failureCode !== "missing")
        .length,
      accepted: decisions.filter(({ decision }) => decision === "accepted")
        .length,
      overrideRequired: decisions.filter(
        ({ decision }) => decision === "override-required",
      ).length,
      extra: extraSlugs.length,
    },
    decisions,
    extraSlugs,
  };
}

export function createProductionV7SnapshotBaseline(input: {
  state: RelatedPetsState | null;
  snapshots: readonly RelatedPetsSnapshot[];
  candidates: readonly RelatedPetCandidate[];
  recomputedRankings: Rankings;
  expectedGenerationId: string;
  expectedRankingRevision: string;
}) {
  const state = input.state;
  if (
    !state ||
    state.status !== "ready" ||
    state.activeGenerationId !== input.expectedGenerationId ||
    state.rankingRevision !== input.expectedRankingRevision
  ) {
    throw new Error("Production V7 state changed during shadow comparison.");
  }
  const approvedSlugs = new Set(input.candidates.map(({ slug }) => slug));
  const rankings = new Map<string, readonly string[]>();
  for (const snapshot of input.snapshots) {
    if (
      snapshot.generationId !== state.activeGenerationId ||
      snapshot.rankingRevision !== state.rankingRevision ||
      !approvedSlugs.has(snapshot.sourceSlug) ||
      snapshot.relatedSlugs.length !== Math.min(8, input.candidates.length - 1) ||
      new Set(snapshot.relatedSlugs).size !== snapshot.relatedSlugs.length ||
      snapshot.relatedSlugs.includes(snapshot.sourceSlug) ||
      snapshot.relatedSlugs.some((slug) => !approvedSlugs.has(slug))
    ) {
      throw new Error("Production V7 snapshot integrity check failed.");
    }
    rankings.set(snapshot.sourceSlug, snapshot.relatedSlugs);
  }
  if (
    rankings.size !== input.candidates.length ||
    input.candidates.some(({ slug }) => !rankings.has(slug))
  ) {
    throw new Error("Production V7 snapshot coverage is incomplete.");
  }
  const differenceSlugs = input.candidates
    .map(({ slug }) => slug)
    .filter((slug) =>
      JSON.stringify(rankings.get(slug)) !==
        JSON.stringify(input.recomputedRankings.get(slug))
    )
    .toSorted(compareCodePoints);
  if (differenceSlugs.length > 0) {
    throw new Error("Production V7 snapshot differs from V7 recomputation.");
  }
  return {
    generationId: state.activeGenerationId,
    previousGenerationId: state.previousGenerationId,
    rankingRevision: state.rankingRevision,
    snapshotCount: rankings.size,
    differenceSlugs,
    rankings,
  };
}

export function createRelatedPetsV11ComparisonReport(input: {
  catalogFingerprint: string;
  productionGenerationId: string;
  productionRankingRevision: string;
  candidates: readonly RelatedPetCandidate[];
  productionV7: Rankings;
  v11: Rankings;
  v11NoVisualReport: V11Evaluation;
  v11Report: V11Evaluation;
  representativeSlugs: readonly string[];
  benchmark: {
    warmups: number;
    measuredRuns: number;
    productionV7Ms: readonly number[];
    v11Ms: readonly number[];
  };
}) {
  const catalog = compareCatalogRankings(
    input.candidates,
    input.productionV7,
    input.v11,
  );
  const noVisualCases = new Map(
    input.v11NoVisualReport.cases.map((item) => [item.sourceSlug, item]),
  );
  const cases = input.v11Report.cases.map((item) => {
    const noVisual = noVisualCases.get(item.sourceSlug);
    if (!noVisual) throw new Error(`Missing no-visual V11 case ${item.sourceSlug}.`);
    return {
      sourceSlug: item.sourceSlug,
      rankings: {
        productionV7: item.comparisons.v7.slugs,
        v8: item.comparisons.v8.slugs,
        description: item.comparisons.description.slugs,
        v10Best: item.comparisons.v10Best.slugs,
        v11NoVisual: noVisual.slugs,
        v11: item.slugs,
      },
      ndcgAt4: {
        productionV7: item.comparisons.v7.ndcgAt4,
        v8: item.comparisons.v8.ndcgAt4,
        description: item.comparisons.description.ndcgAt4,
        v10Best: item.comparisons.v10Best.ndcgAt4,
        v11NoVisual: noVisual.ndcgAt4,
        v11: item.ndcgAt4,
      },
      ndcgAt8: {
        productionV7: item.comparisons.v7.ndcgAt8,
        v8: item.comparisons.v8.ndcgAt8,
        description: item.comparisons.description.ndcgAt8,
        v10Best: item.comparisons.v10Best.ndcgAt8,
        v11NoVisual: noVisual.ndcgAt8,
        v11: item.ndcgAt8,
      },
      deltaFromProductionV7: {
        ndcgAt4: item.ndcgAt4 - item.comparisons.v7.ndcgAt4,
        ndcgAt8: item.ndcgAt8 - item.comparisons.v7.ndcgAt8,
      },
      deltaFromBaselines: {
        v8: {
          ndcgAt4: item.ndcgAt4 - item.comparisons.v8.ndcgAt4,
          ndcgAt8: item.ndcgAt8 - item.comparisons.v8.ndcgAt8,
        },
        description: {
          ndcgAt4: item.ndcgAt4 - item.comparisons.description.ndcgAt4,
          ndcgAt8: item.ndcgAt8 - item.comparisons.description.ndcgAt8,
        },
        v10Best: {
          ndcgAt4: item.ndcgAt4 - item.comparisons.v10Best.ndcgAt4,
          ndcgAt8: item.ndcgAt8 - item.comparisons.v10Best.ndcgAt8,
        },
        v11NoVisual: {
          ndcgAt4: item.ndcgAt4 - noVisual.ndcgAt4,
          ndcgAt8: item.ndcgAt8 - noVisual.ndcgAt8,
        },
      },
      negativeCount: item.negativeCount,
      negativeSlugsPresent: item.negativeSlugsPresent,
      mandatory: item.mandatory,
      mandatorySatisfied: item.mandatorySatisfied,
      orderingViolations: item.orderingViolations,
      orderingSatisfied: item.orderingSatisfied,
      integritySatisfied: item.integritySatisfied,
      diagnostics: item.diagnostics,
    };
  });
  const representativeRankings = Array.from(new Set(input.representativeSlugs))
    .filter((slug) => input.productionV7.has(slug) && input.v11.has(slug))
    .toSorted(compareCodePoints)
    .map((slug) => ({
      slug,
      productionV7: input.productionV7.get(slug),
      v11: input.v11.get(slug),
    }));
  return {
    version: 1,
    catalogFingerprint: input.catalogFingerprint,
    production: {
      generationId: input.productionGenerationId,
      rankingRevision: input.productionRankingRevision,
    },
    aggregate: {
      productionV7: input.v11Report.baselines.v7,
      v8: input.v11Report.baselines.v8,
      description: input.v11Report.baselines.description,
      v10Best: input.v11Report.baselines.v10Best,
      v11NoVisual: {
        ndcgAt4: input.v11NoVisualReport.ndcgAt4,
        ndcgAt8: input.v11NoVisualReport.ndcgAt8,
      },
      v11: {
        ndcgAt4: input.v11Report.ndcgAt4,
        ndcgAt8: input.v11Report.ndcgAt8,
      },
    },
    checks: input.v11Report.checks,
    allCatalogConflictFallbackCount:
      input.v11Report.allCatalogConflictFallbackCount,
    cases,
    catalog,
    representativeRankings,
    benchmark: {
      warmups: input.benchmark.warmups,
      measuredRuns: input.benchmark.measuredRuns,
      productionV7: summarizeDurations(input.benchmark.productionV7Ms),
      v11: summarizeDurations(input.benchmark.v11Ms),
    },
  };
}

function auditAnnotation(
  pet: RelatedPetCandidate,
  row: StoredRelatedPetAnnotation | undefined,
  input: {
    annotationRevision: string;
    modelUri: string;
  },
) {
  if (!row) return auditFailure(pet.slug, "missing");
  try {
    const proposal = JSON.parse(row.proposalJson);
    const unresolvedFields = listUnresolvedStrongRelations({
      slug: pet.slug,
      proposal,
    });
    const expectedAnnotation = resolveRelatedPetAnnotation({
      slug: pet.slug,
      proposal,
    });
    const storedAnnotation = parseResolvedRelatedPetAnnotation(row.annotationJson);
    const checks = {
      sourceHash: row.sourceHash === createRelatedPetAnnotationSourceHash({
        pet,
        modelUri: input.modelUri,
        annotationRevision: input.annotationRevision,
      }),
      effectiveAnnotation:
        JSON.stringify(storedAnnotation) === JSON.stringify(expectedAnnotation),
      controlledText:
        row.annotationText === buildRelatedPetAnnotationText(storedAnnotation),
    };
    const accepted = unresolvedFields.length === 0 &&
      Object.values(checks).every(Boolean);
    return {
      slug: pet.slug,
      decision: accepted ? "accepted" as const : "override-required" as const,
      failureCode: accepted ? null : "validation-failed",
      unresolvedFields,
      checks,
      annotation: storedAnnotation,
    };
  } catch {
    return auditFailure(pet.slug, "invalid-stored-annotation");
  }
}

function auditFailure(
  slug: string,
  failureCode: "missing" | "invalid-stored-annotation",
) {
  return {
    slug,
    decision: "override-required" as const,
    failureCode,
    unresolvedFields: [] as string[],
    checks: {
      sourceHash: false,
      effectiveAnnotation: false,
      controlledText: false,
    },
    annotation: null as ResolvedRelatedPetAnnotation | null,
  };
}

function compareCatalogRankings(
  candidates: readonly RelatedPetCandidate[],
  productionV7: Rankings,
  v11: Rankings,
) {
  const approvedSlugs = new Set(candidates.map(({ slug }) => slug));
  const rows = candidates.map(({ slug }) => {
    const production = productionV7.get(slug) ?? [];
    const candidate = v11.get(slug) ?? [];
    const overlapAt4 = overlap(production.slice(0, 4), candidate.slice(0, 4));
    const overlapAt8 = overlap(production.slice(0, 8), candidate.slice(0, 8));
    return {
      slug,
      overlapAt4,
      overlapAt8,
      changedAt4: overlapAt4 < Math.min(4, production.length, candidate.length),
      changedAt8: overlapAt8 < Math.min(8, production.length, candidate.length),
      integrity:
        candidate.length === Math.min(8, candidates.length - 1) &&
        new Set(candidate).size === candidate.length &&
        !candidate.includes(slug) &&
        candidate.every((item) => approvedSlugs.has(item)),
    };
  });
  return {
    sourceCount: rows.length,
    integritySatisfied: rows.every(({ integrity }) => integrity),
    averageOverlapAt4: average(rows.map(({ overlapAt4 }) => overlapAt4)),
    averageOverlapAt8: average(rows.map(({ overlapAt8 }) => overlapAt8)),
    changedAt4Count: rows.filter(({ changedAt4 }) => changedAt4).length,
    changedAt8Count: rows.filter(({ changedAt8 }) => changedAt8).length,
    rows,
    mostChanged: rows
      .toSorted((left, right) =>
        left.overlapAt8 - right.overlapAt8 || compareCodePoints(left.slug, right.slug)
      )
      .slice(0, 20),
  };
}

function overlap(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return left.filter((slug) => rightSet.has(slug)).length;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeDurations(values: readonly number[]) {
  const sorted = [...values].toSorted((left, right) => left - right);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

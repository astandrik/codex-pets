import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import calibrationJson from "@/lib/pets/related-pets-v10-calibration-fixtures.json";
import holdoutJson from "@/lib/pets/related-pets-v9-holdout-fixtures.json";
import { parseRelatedPetsAcceptanceFixtures } from "@/lib/pets/related-pets-acceptance";
import { RELATED_PETS_ANNOTATION_MODEL_NAME } from "@/lib/pets/related-pets-annotation-contract.mjs";
import { listRelatedPetAnnotations } from "@/lib/pets/related-pets-annotations-repository";
import {
  LEGACY_RELATED_PETS_V7_PROFILE,
  RELATED_PETS_V8_PROFILE,
  RELATED_PETS_V9_PROFILE,
  RELATED_PETS_V10_PROFILE,
  RELATED_PETS_V11_PROFILE,
} from "@/lib/pets/related-pets-profile";
import {
  getCurrentRelatedPetsVisualSourceContext,
  prepareRelatedPetsRankingInputs,
  type RelatedPetsRebuildProfile,
} from "@/lib/pets/related-pets-rebuild";
import {
  getRelatedPetsState,
  listRelatedPetsSnapshots,
} from "@/lib/pets/related-pets-repository";
import { rankRelatedPets } from "@/lib/pets/related-pets-ranking";
import {
  createProductionV7SnapshotBaseline,
  createRelatedPetsCatalogFingerprint,
  createRelatedPetsV11AnnotationAudit,
  createRelatedPetsV11ComparisonReport,
} from "@/lib/pets/related-pets-v11-shadow";
import {
  diagnoseRelatedPetsV11AnnotationProfiles,
  evaluateRelatedPetsV11Profile,
  selectRelatedPetsV11Profile,
  type RelatedPetsV11Profile,
} from "@/lib/pets/related-pets-v11-eval";
import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import { PET_VISUAL_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { listRawPetSearchEmbeddings } from "@/lib/pets/search-embeddings-repository";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";

const MODE = process.env.PET_RELATED_V11_EVAL;
const ENABLED = [
  "audit",
  "calibrate",
  "diagnose",
  "acceptance",
  "compare",
  "holdout",
]
  .includes(MODE ?? "");
const BENCHMARK_WARMUPS = 2;
const BENCHMARK_RUNS = 20;
const V10_DIAGNOSTIC_SHA256 =
  "475cacc46ec8392ac6bb7dc017af7ed7e20eb1a80415a46f5ba9e0739d999b74";
const V10_BEST_PROFILE = {
  strategy: "description-theme-v10",
  textMinSimilarity: 0.443752903829,
  topicMinSimilarity: 0.463712545896,
  topicWeight: 0.3,
  metadataWeight: 0.05,
  visualMinSimilarity: null,
  visualWeight: 0,
} as const;

describe.skipIf(!ENABLED)("live related-pets V11 evaluation", () => {
  it("audits annotations or runs the sealed V11 gates", async () => {
    const holdout = MODE === "holdout";
    const pinned = MODE === "acceptance" || MODE === "compare" || holdout;
    if (pinned && RELATED_PETS_V11_PROFILE.rankingRevision.endsWith(":candidate")) {
      throw new Error("Pin the immutable V11 profile before acceptance, comparison, or holdout.");
    }
    const folderId = requiredEnvironment("YANDEX_AI_STUDIO_FOLDER_ID");
    const expectedCatalogFingerprint = requiredEnvironment(
      "PET_RELATED_EXPECTED_CATALOG_FINGERPRINT",
    );
    const annotationModelUri =
      `gpt://${folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`;
    const v11 = withCaption(RELATED_PETS_V11_PROFILE);
    assertV11Profile(v11);
    const pets = await listApprovedPetsForSearch();
    const catalogFingerprint = createRelatedPetsCatalogFingerprint(pets);
    if (catalogFingerprint !== expectedCatalogFingerprint) {
      throw new Error("Approved catalog fingerprint changed during V11 evaluation.");
    }
    const annotationRows = await listRelatedPetAnnotations(
      v11.annotationRevision,
    );

    if (MODE === "audit") {
      const audit = createRelatedPetsV11AnnotationAudit({
        pets,
        rows: annotationRows,
        annotationRevision: v11.annotationRevision,
        modelUri: annotationModelUri,
      });
      console.info("[codex-pets][related-pets-v11-audit]", JSON.stringify({
        mode: MODE,
        catalogFingerprint,
        audit,
      }));
      expect(audit.coverage).toEqual({
        approved: pets.length,
        stored: pets.length,
        accepted: pets.length,
        overrideRequired: 0,
        extra: 0,
      });
      return;
    }

    const fixtures = parseRelatedPetsAcceptanceFixtures(
      holdout ? holdoutJson : calibrationJson,
    );
    expect(fixtures).toHaveLength(holdout ? 3 : 13);
    const visualContext = getCurrentRelatedPetsVisualSourceContext();
    if (!visualContext) throw new Error("V11 requires the exact visual source context.");
    const v7 = withCaption(LEGACY_RELATED_PETS_V7_PROFILE);
    const v8 = withCaption(RELATED_PETS_V8_PROFILE);
    const v9 = withCaption(RELATED_PETS_V9_PROFILE);
    const v10 = withCaption(readV10ComparisonProfile());
    const revisions = Array.from(new Set([
      v11.textQueryRevision,
      v11.textRevision,
      v11.annotationQueryRevision,
      v11.annotationDocumentRevision,
      v11.visualRevision,
      v7.textQueryRevision,
      v7.textRevision,
      v8.textQueryRevision,
      v9.textQueryRevision,
      v9.textRevision,
      v10.textQueryRevision,
      v10.textRevision,
      v10.topicQueryRevision,
      v10.topicRevision,
    ].filter((value): value is string => Boolean(value))));
    const [captions, ...vectorRows] = await Promise.all([
      listPetSearchCaptions(v11.visualCaptionRevision),
      ...revisions.map(listRawPetSearchEmbeddings),
    ]);
    const rowsByRevision = new Map(
      revisions.map((revision, index) => [revision, vectorRows[index] ?? []]),
    );
    const common = { pets, captions, visualContext };
    const preparedV11 = prepareRelatedPetsRankingInputs({
      ...common,
      profile: v11,
      textQueryRows: requiredRows(rowsByRevision, v11.textQueryRevision),
      textRows: requiredRows(rowsByRevision, v11.textRevision),
      annotationQueryRows: requiredRows(rowsByRevision, v11.annotationQueryRevision),
      annotationRows: requiredRows(rowsByRevision, v11.annotationDocumentRevision),
      annotations: annotationRows,
      annotationModelUri,
      visualRows: requiredRows(rowsByRevision, v11.visualRevision),
    });
    const coverage = {
      approved: pets.length,
      annotations: preparedV11.annotations.size,
      descriptionQuery: preparedV11.textQueryVectors.size,
      descriptionDocument: preparedV11.textDocumentVectors.size,
      annotationQuery: preparedV11.annotationQueryVectors.size,
      annotationDocument: preparedV11.annotationDocumentVectors.size,
      visual: preparedV11.visualVectors.size,
    };
    if (Object.values(coverage).some((count) => count !== pets.length)) {
      throw new Error(`Incomplete V11 coverage: ${JSON.stringify(coverage)}`);
    }

    const preparedV7 = prepareLegacy(v7);
    const preparedV8 = prepareLegacy(v8);
    const preparedV9 = prepareLegacy(v9);
    const preparedV10 = prepareLegacy(v10);
    const recomputedV7 = rankings(v7, preparedV7);
    const expectedGenerationId = requiredEnvironment(
      "PET_RELATED_EXPECTED_ACTIVE_GENERATION_ID",
    );
    const [state, snapshots] = await Promise.all([
      getRelatedPetsState(),
      listRelatedPetsSnapshots(expectedGenerationId),
    ]);
    const productionV7 = createProductionV7SnapshotBaseline({
      state,
      snapshots,
      candidates: preparedV11.approvedPets,
      recomputedRankings: recomputedV7,
      expectedGenerationId,
      expectedRankingRevision: v7.rankingRevision,
    });
    const comparisons = {
      description: rankings(v9, preparedV9),
      v7: productionV7.rankings,
      v8: rankings(v8, preparedV8),
      v10Best: rankings(v10, preparedV10),
    };
    const dataset = {
      fixtures,
      candidates: preparedV11.approvedPets,
      textQueryVectors: preparedV11.textQueryVectors,
      textDocumentVectors: preparedV11.textDocumentVectors,
      annotationQueryVectors: preparedV11.annotationQueryVectors,
      annotationDocumentVectors: preparedV11.annotationDocumentVectors,
      visualVectors: preparedV11.visualVectors,
      annotations: preparedV11.annotations,
    };
    let report;
    if (MODE === "calibrate") {
      report = selectRelatedPetsV11Profile({ dataset, comparisons });
    } else if (MODE === "diagnose") {
      report = diagnoseRelatedPetsV11AnnotationProfiles({
        dataset,
        comparisons,
      });
    } else {
      report = evaluateRelatedPetsV11Profile({
        dataset,
        comparisons,
        profile: v11 as RelatedPetsV11Profile,
      });
    }
    console.info("[codex-pets][related-pets-v11-eval]", JSON.stringify({
      mode: MODE,
      catalogFingerprint,
      production: {
        generationId: productionV7.generationId,
        previousGenerationId: productionV7.previousGenerationId,
        rankingRevision: productionV7.rankingRevision,
        snapshotCount: productionV7.snapshotCount,
        differenceCount: productionV7.differenceSlugs.length,
      },
      coverage,
      report,
    }));
    if ("checks" in report) {
      expect(Object.values(report.checks).every(Boolean)).toBe(true);
    }

    if (MODE === "compare") {
      if (!("checks" in report)) throw new Error("Comparison requires a pinned V11 report.");
      const noVisualProfile = {
        ...v11,
        visualMinSimilarity: null,
        visualWeight: 0,
      } as RelatedPetsV11Profile & RelatedPetsRebuildProfile;
      const noVisualReport = evaluateRelatedPetsV11Profile({
        dataset,
        comparisons,
        profile: noVisualProfile,
      });
      const v11Rankings = rankings(v11, preparedV11);
      const benchmark = benchmarkRankings({
        v7: () => rankings(v7, preparedV7),
        v11: () => rankings(v11, preparedV11),
      });
      const comparison = createRelatedPetsV11ComparisonReport({
        catalogFingerprint,
        productionGenerationId: productionV7.generationId,
        productionRankingRevision: productionV7.rankingRevision,
        candidates: preparedV11.approvedPets,
        productionV7: productionV7.rankings,
        v11: v11Rankings,
        v11NoVisualReport: noVisualReport,
        v11Report: report,
        representativeSlugs: [
          ...fixtures.map(({ sourceSlug }) => sourceSlug),
          "dracula",
          "cheburashka",
          "vi",
          "yuna",
          "fischl-detailed",
          "asuka",
          "tallulah",
        ],
        benchmark,
      });
      console.info("[codex-pets][related-pets-v11-comparison]", JSON.stringify({
        mode: MODE,
        source: {
          commit: requiredEnvironment("PET_RELATED_SHADOW_COMMIT"),
          image: requiredEnvironment("PET_RELATED_SHADOW_IMAGE"),
        },
        coverage,
        comparison,
      }));
      expect(comparison.catalog.integritySatisfied).toBe(true);
      expect(comparison.allCatalogConflictFallbackCount).toBe(0);
    }

    function prepareLegacy(profile: RelatedPetsRebuildProfile) {
      return prepareRelatedPetsRankingInputs({
        ...common,
        profile,
        textQueryRows: requiredRows(rowsByRevision, profile.textQueryRevision),
        textRows: requiredRows(rowsByRevision, profile.textRevision),
        topicQueryRows: profile.topicQueryRevision
          ? requiredRows(rowsByRevision, profile.topicQueryRevision)
          : [],
        topicRows: profile.topicRevision
          ? requiredRows(rowsByRevision, profile.topicRevision)
          : [],
        visualRows: requiredRows(rowsByRevision, profile.visualRevision),
      });
    }
  }, 300_000);
});

function rankings(
  profile: RelatedPetsRebuildProfile,
  prepared: ReturnType<typeof prepareRelatedPetsRankingInputs>,
) {
  return new Map(prepared.approvedPets.map((source) => [
    source.slug,
    rankRelatedPets({
      source,
      candidates: prepared.approvedPets,
      textQueryVectors: prepared.textQueryVectors,
      textDocumentVectors: prepared.textDocumentVectors,
      topicQueryVectors: prepared.topicQueryVectors,
      topicDocumentVectors: prepared.topicDocumentVectors,
      annotationQueryVectors: prepared.annotationQueryVectors,
      annotationDocumentVectors: prepared.annotationDocumentVectors,
      visualVectors: prepared.visualVectors,
      annotations: prepared.annotations,
      profile,
      limit: 8,
    }),
  ]));
}

function benchmarkRankings(input: {
  v7: () => unknown;
  v11: () => unknown;
}) {
  const productionV7Ms: number[] = [];
  const v11Ms: number[] = [];
  for (let index = 0; index < BENCHMARK_WARMUPS + BENCHMARK_RUNS; index += 1) {
    const first = index % 2 === 0 ? input.v7 : input.v11;
    const second = index % 2 === 0 ? input.v11 : input.v7;
    const firstDuration = measure(first);
    const secondDuration = measure(second);
    if (index < BENCHMARK_WARMUPS) continue;
    if (index % 2 === 0) {
      productionV7Ms.push(firstDuration);
      v11Ms.push(secondDuration);
    } else {
      v11Ms.push(firstDuration);
      productionV7Ms.push(secondDuration);
    }
  }
  return {
    warmups: BENCHMARK_WARMUPS,
    measuredRuns: BENCHMARK_RUNS,
    productionV7Ms,
    v11Ms,
  };
}

function measure(operation: () => unknown): number {
  const startedAt = performance.now();
  operation();
  return performance.now() - startedAt;
}

function withCaption<T extends Omit<RelatedPetsRebuildProfile, "visualCaptionRevision">>(
  profile: T,
): T & RelatedPetsRebuildProfile {
  return {
    ...profile,
    visualCaptionRevision: PET_VISUAL_MODEL_REVISIONS[
      profile.visualRevision as keyof typeof PET_VISUAL_MODEL_REVISIONS
    ].captionRevision,
  };
}

function assertV11Profile(profile: RelatedPetsRebuildProfile): asserts profile is
  RelatedPetsRebuildProfile & {
    annotationRevision: string;
    annotationQueryRevision: string;
    annotationDocumentRevision: string;
    annotationDimensions: number;
  } {
  if (
    !profile.annotationRevision ||
    !profile.annotationQueryRevision ||
    !profile.annotationDocumentRevision ||
    !profile.annotationDimensions
  ) {
    throw new Error("V11 annotation profile is incomplete.");
  }
}

function requiredRows<T>(map: ReadonlyMap<string, T>, revision: string): T {
  const rows = map.get(revision);
  if (!rows) throw new Error(`Missing embedding rows for ${revision}.`);
  return rows;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`V11 evaluation requires ${name}.`);
  return value;
}

function readV10ComparisonProfile() {
  if (
    requiredEnvironment("PET_RELATED_V10_BEST_PROFILE_SHA256") !==
      V10_DIAGNOSTIC_SHA256
  ) {
    throw new Error("Frozen V10 diagnostic artifact SHA-256 does not match.");
  }
  const json = process.env.PET_RELATED_V10_BEST_PROFILE_JSON?.trim();
  if (!json) {
    throw new Error(
      "V11 evaluation requires PET_RELATED_V10_BEST_PROFILE_JSON from the frozen diagnostic artifact.",
    );
  }
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const expectedEntries = Object.entries(V10_BEST_PROFILE);
  if (
    Object.keys(parsed).length !== expectedEntries.length ||
    expectedEntries.some(([key, value]) => parsed[key] !== value)
  ) {
    throw new Error("Frozen V10 best profile does not match its artifact.");
  }
  return {
    ...RELATED_PETS_V10_PROFILE,
    ...V10_BEST_PROFILE,
  };
}

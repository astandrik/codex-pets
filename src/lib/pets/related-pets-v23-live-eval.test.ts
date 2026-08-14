import { readFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import {
  gradedNdcgAtK,
  parseRelatedPetsAcceptanceFixtures,
} from "@/lib/pets/related-pets-acceptance";
import { RELATED_PETS_ANNOTATION_MODEL_NAME } from "@/lib/pets/related-pets-annotation-contract.mjs";
import { listRelatedPetAnnotations } from "@/lib/pets/related-pets-annotations-repository";
import {
  RELATED_PETS_V11_PROFILE,
  RELATED_PETS_V23_PROFILE,
} from "@/lib/pets/related-pets-profile";
import {
  getCurrentRelatedPetsVisualSourceContext,
  prepareRelatedPetsRankingInputs,
} from "@/lib/pets/related-pets-rebuild";
import {
  getRelatedPetsState,
  listRelatedPetsSnapshots,
} from "@/lib/pets/related-pets-repository";
import { rankRelatedPetsWithDiagnostics } from "@/lib/pets/related-pets-ranking";
import { createRelatedPetsCatalogFingerprint } from "@/lib/pets/related-pets-v11-shadow";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import { PET_VISUAL_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { listRawPetSearchEmbeddings } from "@/lib/pets/search-embeddings-repository";
import { destroyYdbDriver } from "@/lib/ydb/client";

const ENABLED = process.env.PET_RELATED_V23_EVAL === "compare";
const EXPECTED_CHANGED_SOURCES = [
  "primaris",
  "master-of-terra",
  "slaanesh",
  "emperor",
  "nurgle-2",
  "guardian",
  "daenerys",
];

describe.skipIf(!ENABLED)("live related-pets V23 comparison", () => {
  afterAll(async () => {
    await destroyYdbDriver();
  });

  it("compares the candidate relation policy with exact production V11", async () => {
    const expectedCatalogFingerprint = requiredEnvironment(
      "PET_RELATED_EXPECTED_CATALOG_FINGERPRINT",
    );
    const expectedGenerationId = requiredEnvironment(
      "PET_RELATED_EXPECTED_ACTIVE_GENERATION_ID",
    );
    const folderId = requiredEnvironment("YANDEX_AI_STUDIO_FOLDER_ID");
    const annotationModelUri =
      `gpt://${folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`;
    const v11 = withCaption(RELATED_PETS_V11_PROFILE);
    const v23 = withCaption(RELATED_PETS_V23_PROFILE);
    const visualContext = getCurrentRelatedPetsVisualSourceContext();
    if (!visualContext) throw new Error("V23 requires the exact visual source context.");

    const pets = await listApprovedPetsForSearch();
    const catalogFingerprint = createRelatedPetsCatalogFingerprint(pets);
    if (catalogFingerprint !== expectedCatalogFingerprint) {
      throw new Error("Approved catalog fingerprint changed during V23 comparison.");
    }
    const revisions = [
      v11.textQueryRevision,
      v11.textRevision,
      requiredRevision(v11.annotationQueryRevision),
      requiredRevision(v11.annotationDocumentRevision),
      v11.visualRevision,
    ];
    const [annotations, captions, ...vectorRows] = await Promise.all([
      listRelatedPetAnnotations(requiredRevision(v11.annotationRevision)),
      listPetSearchCaptions(v11.visualCaptionRevision),
      ...revisions.map(listRawPetSearchEmbeddings),
    ]);
    const rowsByRevision = new Map(
      revisions.map((revision, index) => [revision, vectorRows[index] ?? []]),
    );
    const prepared = prepareRelatedPetsRankingInputs({
      pets,
      profile: v11,
      textQueryRows: requiredRows(rowsByRevision, v11.textQueryRevision),
      textRows: requiredRows(rowsByRevision, v11.textRevision),
      annotationQueryRows: requiredRows(
        rowsByRevision,
        requiredRevision(v11.annotationQueryRevision),
      ),
      annotationRows: requiredRows(
        rowsByRevision,
        requiredRevision(v11.annotationDocumentRevision),
      ),
      annotations,
      annotationModelUri,
      visualRows: requiredRows(rowsByRevision, v11.visualRevision),
      captions,
      visualContext,
    });
    const coverage = {
      approved: prepared.approvedPets.length,
      annotations: prepared.annotations.size,
      descriptionQuery: prepared.textQueryVectors.size,
      descriptionDocument: prepared.textDocumentVectors.size,
      annotationQuery: prepared.annotationQueryVectors.size,
      annotationDocument: prepared.annotationDocumentVectors.size,
      visual: prepared.visualVectors.size,
    };
    expect(new Set(Object.values(coverage))).toEqual(new Set([pets.length]));

    const [stateBefore, snapshots] = await Promise.all([
      getRelatedPetsState(),
      listRelatedPetsSnapshots(expectedGenerationId),
    ]);
    expect(stateBefore).toMatchObject({
      activeGenerationId: expectedGenerationId,
      status: "ready",
      rankingRevision: v11.rankingRevision,
    });
    const active = new Map(
      snapshots.map(({ sourceSlug, relatedSlugs }) => [sourceSlug, relatedSlugs]),
    );
    const baseline = rankings(v11, prepared);
    const candidate = rankings(v23, prepared);
    const baselineDifferenceSlugs = prepared.approvedPets
      .map(({ slug }) => slug)
      .filter((slug) => !sameRanking(active.get(slug), baseline.get(slug)?.slugs));
    expect(active.size).toBe(pets.length);
    expect(baselineDifferenceSlugs).toEqual([]);

    const changedSourceSlugs = prepared.approvedPets
      .map(({ slug }) => slug)
      .filter((slug) =>
        !sameRanking(baseline.get(slug)?.slugs, candidate.get(slug)?.slugs)
      );
    expect(changedSourceSlugs).toEqual(EXPECTED_CHANGED_SOURCES);
    const fixtures = parseRelatedPetsAcceptanceFixtures(
      JSON.parse(readFileSync(
        new URL("./related-pets-v10-calibration-fixtures.json", import.meta.url),
        "utf8",
      )),
    );
    const fixtureCases = fixtures.map((fixture) => {
      const baselineSlugs = baseline.get(fixture.sourceSlug)?.slugs ?? [];
      const candidateSlugs = candidate.get(fixture.sourceSlug)?.slugs ?? [];
      return {
        sourceSlug: fixture.sourceSlug,
        changed: !sameRanking(baselineSlugs, candidateSlugs),
        baselineTop8: baselineSlugs,
        candidateTop8: candidateSlugs,
        baselineNdcgAt4: gradedNdcgAtK(baselineSlugs, fixture.relevance, 4),
        candidateNdcgAt4: gradedNdcgAtK(candidateSlugs, fixture.relevance, 4),
        baselineNdcgAt8: gradedNdcgAtK(baselineSlugs, fixture.relevance, 8),
        candidateNdcgAt8: gradedNdcgAtK(candidateSlugs, fixture.relevance, 8),
        baselineNegatives: fixture.negativeSlugs.filter((slug) =>
          baselineSlugs.includes(slug)
        ),
        candidateNegatives: fixture.negativeSlugs.filter((slug) =>
          candidateSlugs.includes(slug)
        ),
      };
    });
    const master = fixtureCases.find(
      ({ sourceSlug }) => sourceSlug === "master-of-terra",
    );
    expect(fixtureCases.filter(({ changed }) => changed).map(({ sourceSlug }) =>
      sourceSlug
    )).toEqual(["master-of-terra"]);
    expect(master).toMatchObject({
      candidateNdcgAt4: 1,
      candidateNdcgAt8: 1,
      candidateNegatives: [],
    });
    expect(master?.candidateTop8[3]).toBe("primaris");
    const aggregate = {
      baseline: aggregateFixtures(fixtureCases, "baseline"),
      candidate: aggregateFixtures(fixtureCases, "candidate"),
    };
    expect(aggregate.candidate.ndcgAt4).toBeGreaterThan(
      aggregate.baseline.ndcgAt4,
    );
    expect(aggregate.candidate.ndcgAt8).toBeGreaterThan(
      aggregate.baseline.ndcgAt8,
    );
    expect(aggregate.candidate.negativeCount).toBeLessThan(
      aggregate.baseline.negativeCount,
    );
    const integritySatisfied = prepared.approvedPets.every(({ slug }) => {
      const slugs = candidate.get(slug)?.slugs ?? [];
      return slugs.length === 8 && new Set(slugs).size === 8 &&
        !slugs.includes(slug);
    });
    expect(integritySatisfied).toBe(true);

    const stateAfter = await getRelatedPetsState();
    expect(stateAfter).toEqual(stateBefore);
    console.info("[codex-pets][related-pets-v23-comparison]", JSON.stringify({
      mode: "compare",
      source: {
        commit: requiredEnvironment("PET_RELATED_SHADOW_COMMIT"),
        image: requiredEnvironment("PET_RELATED_SHADOW_IMAGE"),
      },
      catalog: {
        approved: pets.length,
        fingerprint: catalogFingerprint,
      },
      production: {
        generationId: expectedGenerationId,
        rankingRevision: stateBefore?.rankingRevision,
        snapshotCount: active.size,
        baselineDifferenceCount: baselineDifferenceSlugs.length,
        unchangedAfter: true,
      },
      candidate: {
        rankingRevision: v23.rankingRevision,
        relationPolicyRevision: v23.relationPolicyRevision,
      },
      coverage,
      allCatalog: {
        changedSourceCount: changedSourceSlugs.length,
        changedSourceSlugs,
        integritySatisfied,
      },
      fixtures: {
        count: fixtureCases.length,
        aggregate,
        changedCases: fixtureCases.filter(({ changed }) => changed),
      },
      affectedRankings: Object.fromEntries(changedSourceSlugs.map((slug) => [
        slug,
        {
          baselineTop8: baseline.get(slug)?.slugs ?? [],
          candidateTop8: candidate.get(slug)?.slugs ?? [],
        },
      ])),
    }));
  }, 300_000);
});

function rankings(
  profile: typeof RELATED_PETS_V11_PROFILE | typeof RELATED_PETS_V23_PROFILE,
  prepared: ReturnType<typeof prepareRelatedPetsRankingInputs>,
) {
  return new Map(prepared.approvedPets.map((source) => [
    source.slug,
    rankRelatedPetsWithDiagnostics({
      source,
      candidates: prepared.approvedPets,
      textQueryVectors: prepared.textQueryVectors,
      textDocumentVectors: prepared.textDocumentVectors,
      annotationQueryVectors: prepared.annotationQueryVectors,
      annotationDocumentVectors: prepared.annotationDocumentVectors,
      visualVectors: prepared.visualVectors,
      annotations: prepared.annotations,
      profile,
      limit: 8,
    }),
  ]));
}

function withCaption<
  T extends typeof RELATED_PETS_V11_PROFILE | typeof RELATED_PETS_V23_PROFILE,
>(profile: T) {
  return {
    ...profile,
    visualCaptionRevision:
      PET_VISUAL_MODEL_REVISIONS[profile.visualRevision].captionRevision,
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function requiredRevision(value: string | undefined): string {
  if (!value) throw new Error("V23 annotation profile is incomplete.");
  return value;
}

function requiredRows<T>(rowsByRevision: Map<string, T[]>, revision: string): T[] {
  const rows = rowsByRevision.get(revision);
  if (!rows) throw new Error(`Missing rows for revision ${revision}.`);
  return rows;
}

function sameRanking(left: readonly string[] | undefined, right: readonly string[] | undefined) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function aggregateFixtures(
  cases: ReadonlyArray<{
    baselineNdcgAt4: number;
    candidateNdcgAt4: number;
    baselineNdcgAt8: number;
    candidateNdcgAt8: number;
    baselineNegatives: readonly string[];
    candidateNegatives: readonly string[];
  }>,
  prefix: "baseline" | "candidate",
) {
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    ndcgAt4: mean(cases.map((item) => item[`${prefix}NdcgAt4`])),
    ndcgAt8: mean(cases.map((item) => item[`${prefix}NdcgAt8`])),
    negativeCount: cases.reduce(
      (sum, item) => sum + item[`${prefix}Negatives`].length,
      0,
    ),
  };
}

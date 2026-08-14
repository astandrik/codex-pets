import { readFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import {
  gradedNdcgAtK,
  parseRelatedPetsAcceptanceFixtures,
} from "@/lib/pets/related-pets-acceptance";
import { RELATED_PETS_ANNOTATION_MODEL_NAME } from "@/lib/pets/related-pets-annotation-contract.mjs";
import { listRelatedPetAnnotations } from "@/lib/pets/related-pets-annotations-repository";
import {
  RELATED_PETS_V23_PROFILE,
  RELATED_PETS_V24_PROFILE,
} from "@/lib/pets/related-pets-profile";
import {
  getCurrentRelatedPetsVisualSourceContext,
  prepareRelatedPetsRankingInputs,
} from "@/lib/pets/related-pets-rebuild";
import {
  getRelatedPetsState,
  listRelatedPetsSnapshots,
} from "@/lib/pets/related-pets-repository";
import {
  rankRelatedPetsWithDiagnostics,
  type RelatedPetsRankingResult,
} from "@/lib/pets/related-pets-ranking";
import { createRelatedPetsCatalogFingerprint } from "@/lib/pets/related-pets-v11-shadow";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import { PET_VISUAL_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { listRawPetSearchEmbeddings } from "@/lib/pets/search-embeddings-repository";
import { destroyYdbDriver } from "@/lib/ydb/client";

const ENABLED = process.env.PET_RELATED_V24_EVAL === "compare";
const TIGRAN_EXPECTED_RESCUE = [
  "leon",
  "johnny",
  "grey-pilgrim-3",
  "gordon-freeman",
  "ovi",
  "gigachad-2",
  "jedi-blue-lightsaber",
  "gandalf-the-white-2",
] as const;
const TIGRAN_FRANCHISE_FALSE_POSITIVES = [
  "serah",
  "tifa-chibi",
  "rikku",
  "yuna",
  "fran",
] as const;

describe.skipIf(!ENABLED)("live related-pets V24 comparison", () => {
  afterAll(async () => {
    await destroyYdbDriver();
  });

  it("compares sparse fallback V24 with exact production V23", async () => {
    const expectedCatalogFingerprint = requiredEnvironment(
      "PET_RELATED_EXPECTED_CATALOG_FINGERPRINT",
    );
    const expectedGenerationId = requiredEnvironment(
      "PET_RELATED_EXPECTED_ACTIVE_GENERATION_ID",
    );
    const folderId = requiredEnvironment("YANDEX_AI_STUDIO_FOLDER_ID");
    const annotationModelUri =
      `gpt://${folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`;
    const v23 = withCaption(RELATED_PETS_V23_PROFILE);
    const v24 = withCaption(RELATED_PETS_V24_PROFILE);
    const visualContext = getCurrentRelatedPetsVisualSourceContext();
    if (!visualContext) throw new Error("V24 requires the visual source context.");

    const pets = await listApprovedPetsForSearch();
    const catalogFingerprint = createRelatedPetsCatalogFingerprint(pets);
    if (catalogFingerprint !== expectedCatalogFingerprint) {
      throw new Error("Approved catalog fingerprint changed during V24 comparison.");
    }
    const revisions = [
      v23.textQueryRevision,
      v23.textRevision,
      requiredRevision(v23.annotationQueryRevision),
      requiredRevision(v23.annotationDocumentRevision),
      v23.visualRevision,
    ];
    const [annotations, captions, ...vectorRows] = await Promise.all([
      listRelatedPetAnnotations(requiredRevision(v23.annotationRevision)),
      listPetSearchCaptions(v23.visualCaptionRevision),
      ...revisions.map(listRawPetSearchEmbeddings),
    ]);
    const rowsByRevision = new Map(
      revisions.map((revision, index) => [revision, vectorRows[index] ?? []]),
    );
    const prepared = prepareRelatedPetsRankingInputs({
      pets,
      profile: v23,
      textQueryRows: requiredRows(rowsByRevision, v23.textQueryRevision),
      textRows: requiredRows(rowsByRevision, v23.textRevision),
      annotationQueryRows: requiredRows(
        rowsByRevision,
        requiredRevision(v23.annotationQueryRevision),
      ),
      annotationRows: requiredRows(
        rowsByRevision,
        requiredRevision(v23.annotationDocumentRevision),
      ),
      annotations,
      annotationModelUri,
      visualRows: requiredRows(rowsByRevision, v23.visualRevision),
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
      rankingRevision: v23.rankingRevision,
    });
    const active = new Map(
      snapshots.map(({ sourceSlug, relatedSlugs }) => [sourceSlug, relatedSlugs]),
    );
    const baseline = rankings(v23, prepared);
    const candidate = rankings(v24, prepared);
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
    expect(changedSourceSlugs).toContain("tigran");
    expect(changedSourceSlugs.every((slug) =>
      baseline.get(slug)?.qualifiedCount === 0
    )).toBe(true);
    expect(prepared.approvedPets.every(({ slug }) => {
      const baselineResult = baseline.get(slug);
      return baselineResult?.qualifiedCount === 0 ||
        sameRanking(baselineResult?.slugs, candidate.get(slug)?.slugs);
    })).toBe(true);

    const tigran = candidate.get("tigran");
    expect(tigran?.slugs).toEqual(TIGRAN_EXPECTED_RESCUE);
    expect(tigran?.diagnostics.every(({ fallbackProvenance }) =>
      fallbackProvenance === "shared_topics_kind_visual_description"
    )).toBe(true);
    expect(TIGRAN_FRANCHISE_FALSE_POSITIVES.filter((slug) =>
      tigran?.slugs.includes(slug)
    )).toEqual([]);

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
    const aggregate = {
      baseline: aggregateFixtures(fixtureCases, "baseline"),
      candidate: aggregateFixtures(fixtureCases, "candidate"),
    };
    const integritySatisfied = prepared.approvedPets.every(({ slug }) => {
      const slugs = candidate.get(slug)?.slugs ?? [];
      return slugs.length === 8 && new Set(slugs).size === 8 &&
        !slugs.includes(slug) && slugs.every((candidateSlug) =>
          candidate.has(candidateSlug)
        );
    });
    const overlap = prepared.approvedPets.map(({ slug }) => ({
      sourceSlug: slug,
      at4: overlapAtK(
        baseline.get(slug)?.slugs ?? [],
        candidate.get(slug)?.slugs ?? [],
        4,
      ),
      at8: overlapAtK(
        baseline.get(slug)?.slugs ?? [],
        candidate.get(slug)?.slugs ?? [],
        8,
      ),
    }));
    const stateAfter = await getRelatedPetsState();
    expect(stateAfter).toEqual(stateBefore);
    console.info("[codex-pets][related-pets-v24-comparison]", JSON.stringify({
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
        rankingRevision: v24.rankingRevision,
        fallbackPolicyRevision: v24.fallbackPolicyRevision,
      },
      coverage,
      allCatalog: {
        zeroQualifiedSourceCount: Array.from(baseline.values()).filter(
          ({ qualifiedCount }) => qualifiedCount === 0,
        ).length,
        changedSourceCount: changedSourceSlugs.length,
        changedSourceSlugs,
        meanOverlapAt4: mean(overlap.map(({ at4 }) => at4)),
        meanOverlapAt8: mean(overlap.map(({ at8 }) => at8)),
        integritySatisfied,
      },
      fixtures: {
        count: fixtureCases.length,
        aggregate,
        changedCases: fixtureCases.filter(({ changed }) => changed),
      },
      tigran: {
        baselineTop8: baseline.get("tigran")?.slugs ?? [],
        candidateTop8: tigran?.slugs ?? [],
        diagnostics: tigran?.diagnostics.map((item) => ({
          slug: item.slug,
          sharedTagCount: item.sharedTagCount,
          sharedTagRank: item.sharedTagRank,
          visualSimilarity: item.visualSimilarity,
          textSimilarity: item.textSimilarity,
          fallbackProvenance: item.fallbackProvenance,
        })) ?? [],
      },
      affectedRankings: Object.fromEntries(changedSourceSlugs.map((slug) => [
        slug,
        {
          baselineTop8: baseline.get(slug)?.slugs ?? [],
          candidateTop8: candidate.get(slug)?.slugs ?? [],
          sharedTopicRescueCount: candidate.get(slug)?.diagnostics.filter(
            ({ fallbackProvenance }) =>
              fallbackProvenance === "shared_topics_kind_visual_description",
          ).length ?? 0,
        },
      ])),
    }));
    expect(aggregate.candidate.ndcgAt4).toBeGreaterThanOrEqual(
      aggregate.baseline.ndcgAt4,
    );
    expect(aggregate.candidate.ndcgAt8).toBeGreaterThanOrEqual(
      aggregate.baseline.ndcgAt8,
    );
    expect(aggregate.candidate.negativeCount).toBeLessThanOrEqual(
      aggregate.baseline.negativeCount,
    );
    expect(integritySatisfied).toBe(true);
  }, 300_000);
});

type Prepared = ReturnType<typeof prepareRelatedPetsRankingInputs>;
type Profile = typeof RELATED_PETS_V23_PROFILE | typeof RELATED_PETS_V24_PROFILE;

function rankings(
  profile: Profile,
  prepared: Prepared,
): Map<string, RelatedPetsRankingResult> {
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

function withCaption<T extends Profile>(profile: T) {
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
  if (!value) throw new Error("V24 annotation profile is incomplete.");
  return value;
}

function requiredRows<T>(rowsByRevision: Map<string, T[]>, revision: string): T[] {
  const rows = rowsByRevision.get(revision);
  if (!rows) throw new Error(`Missing rows for revision ${revision}.`);
  return rows;
}

function sameRanking(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function overlapAtK(
  left: readonly string[],
  right: readonly string[],
  k: number,
): number {
  const leftSet = new Set(left.slice(0, k));
  return right.slice(0, k).filter((slug) => leftSet.has(slug)).length / k;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  return {
    ndcgAt4: mean(cases.map((item) => item[`${prefix}NdcgAt4`])),
    ndcgAt8: mean(cases.map((item) => item[`${prefix}NdcgAt8`])),
    negativeCount: cases.reduce(
      (sum, item) => sum + item[`${prefix}Negatives`].length,
      0,
    ),
  };
}

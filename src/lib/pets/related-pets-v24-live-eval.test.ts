import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";

import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
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
import { petSearchRuntimeConfig } from "@/lib/pets/search-provider-runtime";
import { extractPetVisionFrames } from "@/lib/pets/search-vision-frames";
import {
  RELATED_PETS_V24_ACCEPTANCE_REVISION,
  RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS,
  evaluateRelatedPetsV24Acceptance,
  type RelatedPetsV24AcceptanceReport,
  type RelatedPetsV24ManualDecision,
} from "@/lib/pets/related-pets-v24-acceptance";
import {
  RelatedPetsV24JudgeProviderError,
  createRelatedPetsV24JudgeClient,
} from "@/lib/pets/related-pets-v24-judge-client";
import {
  RELATED_PETS_V24_JUDGE_MODEL_NAME,
  RELATED_PETS_V24_JUDGE_REVISION,
  type RelatedPetsV24JudgeCard,
} from "@/lib/pets/related-pets-v24-judge-contract.mjs";
import type { StructuredResponseDiagnostic } from
  "@/lib/pets/responses-structured-provider.mjs";
import { destroyYdbDriver } from "@/lib/ydb/client";

const ENABLED = process.env.PET_RELATED_V24_EVAL === "compare";
const ACCEPTANCE_ENABLED = process.env.PET_RELATED_V24_EVAL === "acceptance";
const COMPATIBLE_V24_JUDGE_REVISION =
  "gpt-oss-120b-related-slate-judge-2026-08-v24";
const COMPATIBLE_V24_SUPPORT_COMMIT =
  "ebd769ffb5e5b85907dcefd27aa6a68092763323";
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

describe.skipIf(!ACCEPTANCE_ENABLED)("live related-pets V24 acceptance", () => {
  afterAll(async () => {
    await destroyYdbDriver();
  });

  it("blindly judges exactly the 15 changed V23/V24 slates", async () => {
    const expectedCatalogFingerprint = requiredEnvironment(
      "PET_RELATED_EXPECTED_CATALOG_FINGERPRINT",
    );
    const expectedGenerationId = requiredEnvironment(
      "PET_RELATED_EXPECTED_ACTIVE_GENERATION_ID",
    );
    const expectedCommit = requiredEnvironment("PET_RELATED_SHADOW_COMMIT");
    const runnerImage = requiredEnvironment("PET_RELATED_SHADOW_IMAGE");
    const cachePath = requiredEnvironment("PET_RELATED_V24_ACCEPTANCE_CACHE");
    const artifactPath = requiredEnvironment("PET_RELATED_V24_ACCEPTANCE_ARTIFACT");
    const manualDecisionsPath = requiredEnvironment(
      "PET_RELATED_V24_MANUAL_DECISIONS",
    );
    const reviewDirectory = requiredEnvironment("PET_RELATED_V24_REVIEW_DIRECTORY");
    const compatibleCachePath = process.env
      .PET_RELATED_V24_ACCEPTANCE_COMPATIBLE_CACHE?.trim();
    const folderId = requiredEnvironment("YANDEX_AI_STUDIO_FOLDER_ID");
    const v23 = withCaption(RELATED_PETS_V23_PROFILE);
    const v24 = withCaption(RELATED_PETS_V24_PROFILE);
    const visualContext = getCurrentRelatedPetsVisualSourceContext();
    if (!visualContext) throw new Error("V24 acceptance requires visual context.");

    const pets = await listApprovedPetsForSearch();
    const catalogFingerprint = createRelatedPetsCatalogFingerprint(pets);
    if (catalogFingerprint !== expectedCatalogFingerprint) {
      throw new Error("Approved catalog fingerprint changed during V24 acceptance.");
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
      annotationModelUri:
        `gpt://${folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`,
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
    if (new Set(Object.values(coverage)).size !== 1 ||
        coverage.approved !== pets.length) {
      throw new Error("V24 acceptance input coverage is incomplete.");
    }

    const [stateBefore, snapshotsBefore] = await Promise.all([
      getRelatedPetsState(),
      listRelatedPetsSnapshots(expectedGenerationId),
    ]);
    if (stateBefore?.activeGenerationId !== expectedGenerationId ||
        stateBefore.status !== "ready" ||
        stateBefore.rankingRevision !== v23.rankingRevision ||
        snapshotsBefore.length !== pets.length) {
      throw new Error("Production V23 state changed before V24 acceptance.");
    }
    const active = new Map(snapshotsBefore.map(({ sourceSlug, relatedSlugs }) =>
      [sourceSlug, relatedSlugs]));
    const baseline = rankings(v23, prepared);
    const candidate = rankings(v24, prepared);
    const baselineDifferenceSlugs = prepared.approvedPets.flatMap(({ slug }) =>
      sameRanking(active.get(slug), baseline.get(slug)?.slugs) ? [] : [slug]);
    if (baselineDifferenceSlugs.length > 0) {
      throw new Error("Active production V23 differs from exact recomputation.");
    }
    const changedSourceSlugs = prepared.approvedPets.map(({ slug }) => slug)
      .filter((slug) => !sameRanking(
        baseline.get(slug)?.slugs,
        candidate.get(slug)?.slugs,
      ));
    if (!sameRanking(changedSourceSlugs, RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS)) {
      throw new Error("V24 changed-source manifest drifted before acceptance.");
    }

    const semantic = petSearchRuntimeConfig.semantic;
    if (!semantic || semantic.folderId !== folderId) {
      throw new Error("V24 acceptance requires the active AI Studio configuration.");
    }
    const cards = new Map<string, RelatedPetsV24JudgeCard>(pets.map((pet) => [
      pet.slug,
      {
        displayName: pet.displayName,
        kind: pet.kind,
        description: pet.description,
      },
    ]));
    const cache = await loadAcceptanceCache(cachePath, {
      catalogFingerprint,
      generationId: expectedGenerationId,
      candidateRankingRevision: v24.rankingRevision,
      supportCommit: expectedCommit,
    });
    const cacheImport = compatibleCachePath
      ? await importCompatibleAcceptanceCache({
          path: compatibleCachePath,
          cache,
          cards,
          baseline,
          candidate,
        })
      : { sourceSlugs: [] as string[] };
    if (cacheImport.sourceSlugs.length > 0) {
      await persistAcceptanceCache(cachePath, cache);
    }
    const reports: RelatedPetsV24AcceptanceReport[] = [];
    for (const sourceSlug of RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS) {
      const baselineTop8 = required(baseline, sourceSlug, "baseline ranking").slugs;
      const candidateTop8 = required(candidate, sourceSlug, "candidate ranking").slugs;
      const key = acceptanceCacheKey({
        sourceSlug,
        baselineTop8,
        candidateTop8,
        cards,
      });
      const cached = parseCachedAcceptanceReport(cache.entries[key], {
        sourceSlug,
        baselineTop8,
        candidateTop8,
      });
      if (cached) {
        reports.push(cached);
        continue;
      }
      const report = await runAcceptanceJudge({
        folderId,
        apiKey: semantic.apiKey,
        sourceSlug,
        baselineTop8,
        candidateTop8,
        cards,
      });
      reports.push(report);
      if (report.parsed) {
        cache.entries[key] = report;
        await persistAcceptanceCache(cachePath, cache);
      }
    }

    const manualDecisions = await loadManualDecisions(manualDecisionsPath);
    const acceptance = evaluateRelatedPetsV24Acceptance({
      reports,
      manualDecisions,
    });
    const reviewSources = Array.from(new Set([
      "tigran",
      ...acceptance.manualReviewSources,
    ])).toSorted((left, right) => left.localeCompare(right, "en"));
    const review = await writeManualReviewArtifacts({
      directory: reviewDirectory,
      sourceSlugs: reviewSources,
      petsBySlug: new Map(pets.map((pet) => [pet.slug, pet])),
      baseline,
      candidate,
    });
    const [postPets, stateAfter, snapshotsAfter] = await Promise.all([
      listApprovedPetsForSearch(),
      getRelatedPetsState(),
      listRelatedPetsSnapshots(expectedGenerationId),
    ]);
    const postcheckPassed =
      createRelatedPetsCatalogFingerprint(postPets) === catalogFingerprint &&
      stateAfter?.activeGenerationId === stateBefore.activeGenerationId &&
      stateAfter?.rankingRevision === stateBefore.rankingRevision &&
      snapshotFingerprint(snapshotsAfter) === snapshotFingerprint(snapshotsBefore);
    const artifact = {
      mode: "v24-acceptance",
      acceptanceRevision: RELATED_PETS_V24_ACCEPTANCE_REVISION,
      judgeRevision: RELATED_PETS_V24_JUDGE_REVISION,
      judgeModel: RELATED_PETS_V24_JUDGE_MODEL_NAME,
      runner: { commit: expectedCommit, image: runnerImage },
      catalog: { approved: pets.length, fingerprint: catalogFingerprint },
      production: {
        generationId: expectedGenerationId,
        rankingRevision: stateBefore.rankingRevision,
        baselineDifferenceCount: baselineDifferenceSlugs.length,
        unchangedAfter: postcheckPassed,
      },
      candidate: {
        rankingRevision: v24.rankingRevision,
        fallbackPolicyRevision: v24.fallbackPolicyRevision,
      },
      coverage,
      cacheImport,
      changedSourceSlugs,
      reports,
      acceptance,
      review,
    };
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {
      mode: 0o600,
    });
    console.info(
      "[codex-pets][related-pets-v24-acceptance]",
      JSON.stringify(artifact),
    );
    expect(postcheckPassed).toBe(true);
    expect(acceptance.incompleteSources).toEqual([]);
    if (process.env.PET_RELATED_V24_REQUIRE_ACCEPTANCE_PASS === "true") {
      expect(acceptance.status, acceptance.failures.join(", ")).toBe("passed");
    }
  }, 3_600_000);
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

type AcceptanceCache = {
  revision: typeof RELATED_PETS_V24_JUDGE_REVISION;
  catalogFingerprint: string;
  generationId: string;
  candidateRankingRevision: string;
  supportCommit: string;
  entries: Record<string, unknown>;
};

async function runAcceptanceJudge(input: {
  folderId: string;
  apiKey: string;
  sourceSlug: string;
  baselineTop8: string[];
  candidateTop8: string[];
  cards: ReadonlyMap<string, RelatedPetsV24JudgeCard>;
}): Promise<RelatedPetsV24AcceptanceReport> {
  const diagnostics: StructuredResponseDiagnostic[] = [];
  try {
    const result = await createRelatedPetsV24JudgeClient({
      folderId: input.folderId,
      apiKey: input.apiKey,
      modelUri: `gpt://${input.folderId}/${RELATED_PETS_V24_JUDGE_MODEL_NAME}`,
      timeoutMs: 300_000,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).judgeBlindedPair({
      source: required(input.cards, input.sourceSlug, "source card"),
      slateA: input.baselineTop8.map((slug) =>
        required(input.cards, slug, "baseline card")),
      slateB: input.candidateTop8.map((slug) =>
        required(input.cards, slug, "candidate card")),
    });
    return {
      sourceSlug: input.sourceSlug,
      baselineTop8: input.baselineTop8,
      candidateTop8: input.candidateTop8,
      parsed: true,
      requests: result.requests,
      orderConsistent: result.orderConsistent,
      confidence: result.confidence,
      decision: result.decision,
      baselineGrades: result.baselineGrades,
      candidateGrades: result.candidateGrades,
      usage: summarizeDiagnostics(diagnostics),
    };
  } catch (error) {
    if (!(error instanceof RelatedPetsV24JudgeProviderError)) throw error;
    return {
      sourceSlug: input.sourceSlug,
      baselineTop8: input.baselineTop8,
      candidateTop8: input.candidateTop8,
      parsed: false,
      failureReason: error.reason,
      requests: diagnostics.filter(({ stage }) => stage === "complete").length,
      usage: summarizeDiagnostics(diagnostics),
    };
  }
}

function summarizeDiagnostics(diagnostics: readonly StructuredResponseDiagnostic[]) {
  return diagnostics.reduce((usage, diagnostic) => ({
    inputTokens: usage.inputTokens + (diagnostic.inputTokens ?? 0),
    outputTokens: usage.outputTokens + (diagnostic.outputTokens ?? 0),
    reasoningTokens: usage.reasoningTokens + (diagnostic.reasoningTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
}

async function loadAcceptanceCache(
  path: string,
  provenance: Omit<AcceptanceCache, "revision" | "entries">,
): Promise<AcceptanceCache> {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse((await readFile(path)).toString("utf8"));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  if (parsed === null) {
    return {
      revision: RELATED_PETS_V24_JUDGE_REVISION,
      ...provenance,
      entries: {},
    };
  }
  if (!isRecord(parsed) || parsed.revision !== RELATED_PETS_V24_JUDGE_REVISION ||
      parsed.catalogFingerprint !== provenance.catalogFingerprint ||
      parsed.generationId !== provenance.generationId ||
      parsed.candidateRankingRevision !== provenance.candidateRankingRevision ||
      parsed.supportCommit !== provenance.supportCommit ||
      !isRecord(parsed.entries)) {
    throw new Error("V24 acceptance cache provenance is invalid.");
  }
  return {
    revision: RELATED_PETS_V24_JUDGE_REVISION,
    ...provenance,
    entries: parsed.entries,
  };
}

async function persistAcceptanceCache(path: string, cache: AcceptanceCache) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
}

async function importCompatibleAcceptanceCache(input: {
  path: string;
  cache: AcceptanceCache;
  cards: ReadonlyMap<string, RelatedPetsV24JudgeCard>;
  baseline: ReadonlyMap<string, RelatedPetsRankingResult>;
  candidate: ReadonlyMap<string, RelatedPetsRankingResult>;
}) {
  const parsed = JSON.parse((await readFile(input.path)).toString("utf8"));
  if (!isRecord(parsed) || parsed.revision !== COMPATIBLE_V24_JUDGE_REVISION ||
      parsed.catalogFingerprint !== input.cache.catalogFingerprint ||
      parsed.generationId !== input.cache.generationId ||
      parsed.candidateRankingRevision !== input.cache.candidateRankingRevision ||
      parsed.supportCommit !== COMPATIBLE_V24_SUPPORT_COMMIT ||
      !isRecord(parsed.entries)) {
    throw new Error("V24 compatible acceptance cache provenance is invalid.");
  }
  const sourceSlugs: string[] = [];
  for (const sourceSlug of RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS) {
    const baselineTop8 = required(input.baseline, sourceSlug, "baseline ranking").slugs;
    const candidateTop8 = required(input.candidate, sourceSlug, "candidate ranking").slugs;
    const report = Object.values(parsed.entries).map((entry) =>
      parseCachedAcceptanceReport(entry, {
        sourceSlug,
        baselineTop8,
        candidateTop8,
      })).find((entry) => entry !== null);
    if (!report) continue;
    input.cache.entries[acceptanceCacheKey({
      sourceSlug,
      baselineTop8,
      candidateTop8,
      cards: input.cards,
    })] = report;
    sourceSlugs.push(sourceSlug);
  }
  return { sourceSlugs };
}

function acceptanceCacheKey(input: {
  sourceSlug: string;
  baselineTop8: readonly string[];
  candidateTop8: readonly string[];
  cards: ReadonlyMap<string, RelatedPetsV24JudgeCard>;
}) {
  const card = (slug: string) => required(input.cards, slug, "judge card");
  return createHash("sha256").update(JSON.stringify({
    revision: RELATED_PETS_V24_JUDGE_REVISION,
    source: card(input.sourceSlug),
    baseline: input.baselineTop8.map(card),
    candidate: input.candidateTop8.map(card),
  })).digest("hex");
}

function parseCachedAcceptanceReport(
  input: unknown,
  expected: {
    sourceSlug: string;
    baselineTop8: string[];
    candidateTop8: string[];
  },
): RelatedPetsV24AcceptanceReport | null {
  if (!isRecord(input) || input.parsed !== true ||
      input.sourceSlug !== expected.sourceSlug || input.requests !== 2 ||
      !sameRanking(asStringArray(input.baselineTop8), expected.baselineTop8) ||
      !sameRanking(asStringArray(input.candidateTop8), expected.candidateTop8)) {
    return null;
  }
  return input as RelatedPetsV24AcceptanceReport;
}

async function loadManualDecisions(
  path: string,
): Promise<RelatedPetsV24ManualDecision[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readFile(path)).toString("utf8"));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  if (!Array.isArray(parsed)) throw new Error("V24 manual decisions must be an array.");
  return parsed.map((input) => {
    if (!isRecord(input) || typeof input.sourceSlug !== "string" ||
        !isPreference(input.preference) || !isPreference(input.top4) ||
        !isPreference(input.top8) || !isManualNoteCode(input.noteCode)) {
      throw new Error("V24 manual decision is invalid.");
    }
    return {
      sourceSlug: input.sourceSlug,
      preference: input.preference,
      top4: input.top4,
      top8: input.top8,
      noteCode: input.noteCode,
    };
  });
}

async function writeManualReviewArtifacts(input: {
  directory: string;
  sourceSlugs: readonly string[];
  petsBySlug: ReadonlyMap<string, Prepared["approvedPets"][number]>;
  baseline: ReadonlyMap<string, RelatedPetsRankingResult>;
  candidate: ReadonlyMap<string, RelatedPetsRankingResult>;
}) {
  await mkdir(input.directory, { recursive: true });
  const sources = [];
  for (const sourceSlug of input.sourceSlugs) {
    const baselineTop8 = required(input.baseline, sourceSlug, "baseline review ranking").slugs;
    const candidateTop8 = required(input.candidate, sourceSlug, "candidate review ranking").slugs;
    const slugs = Array.from(new Set([
      sourceSlug,
      ...baselineTop8,
      ...candidateTop8,
    ]));
    const sourceDirectory = join(input.directory, sourceSlug);
    await mkdir(sourceDirectory, { recursive: true });
    for (const slug of slugs) {
      const pet = required(input.petsBySlug, slug, "review pet");
      await writeFile(join(sourceDirectory, `${slug}.png`), await contactSheet(pet));
    }
    const indexPath = join(sourceDirectory, "index.html");
    await writeFile(indexPath, reviewHtml({
      source: required(input.petsBySlug, sourceSlug, "review source"),
      baselineTop8,
      candidateTop8,
      petsBySlug: input.petsBySlug,
    }), { mode: 0o600 });
    sources.push({
      sourceSlug,
      indexPath: `${sourceSlug}/index.html`,
      imageCount: slugs.length,
    });
  }
  return { directory: input.directory, sources };
}

async function contactSheet(pet: Prepared["approvedPets"][number]) {
  const assetId = getPetAssetIdFromSpritesheetUrl(pet.spritesheetUrl);
  if (!assetId) throw new Error("V24 review pet has unsupported spritesheet URL.");
  const asset = await readPetSpritesheetAsset({ assetId });
  const extracted = await extractPetVisionFrames(asset.buffer);
  if (extracted.frames.length !== 4) {
    throw new Error("V24 manual review requires exactly four frames.");
  }
  const metadata = await sharp(extracted.frames[0]?.png).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new Error("V24 manual review frame dimensions are invalid.");
  }
  return sharp({
    create: {
      width: width * 2,
      height: height * 2,
      channels: 4,
      background: { r: 24, g: 24, b: 24, alpha: 1 },
    },
  }).composite(extracted.frames.map((frame, index) => ({
    input: frame.png,
    left: (index % 2) * width,
    top: Math.floor(index / 2) * height,
  }))).png().toBuffer();
}

function reviewHtml(input: {
  source: Prepared["approvedPets"][number];
  baselineTop8: readonly string[];
  candidateTop8: readonly string[];
  petsBySlug: ReadonlyMap<string, Prepared["approvedPets"][number]>;
}) {
  const card = (slug: string, position?: number) => {
    const pet = required(input.petsBySlug, slug, "review HTML pet");
    return `<article><img src="${escapeHtml(slug)}.png" alt=""><h3>${
      position ? `${position}. ` : ""
    }${escapeHtml(pet.displayName)}</h3><p>${escapeHtml(pet.kind)}</p><p>${
      escapeHtml(pet.description)
    }</p></article>`;
  };
  const column = (title: string, slugs: readonly string[]) =>
    `<section><h2>${escapeHtml(title)}</h2><div class="cards">${
      slugs.map((slug, index) => card(slug, index + 1)).join("")
    }</div></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>V24 review: ${
    escapeHtml(input.source.displayName)
  }</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:24px}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}.source{max-width:720px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}article{background:#202020;padding:12px;border-radius:10px}img{width:100%;height:220px;object-fit:contain;background:#181818}h3{margin:8px 0 4px}p{color:#bbb;margin:4px 0;line-height:1.35}</style></head><body><h1>${
    escapeHtml(input.source.displayName)
  }</h1><div class="source">${card(input.source.slug)}</div><main>${
    column("V23", input.baselineTop8)
  }${column("V24", input.candidateTop8)}</main></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function snapshotFingerprint(
  snapshots: Awaited<ReturnType<typeof listRelatedPetsSnapshots>>,
) {
  return createHash("sha256").update(JSON.stringify(snapshots.map((snapshot) => ({
    sourceSlug: snapshot.sourceSlug,
    relatedSlugs: snapshot.relatedSlugs,
  })).toSorted((left, right) => left.sourceSlug.localeCompare(right.sourceSlug, "en"))))
    .digest("hex");
}

function required<K, V>(map: ReadonlyMap<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}

function asStringArray(input: unknown): string[] | undefined {
  return Array.isArray(input) && input.every((value) => typeof value === "string")
    ? input
    : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function isPreference(input: unknown): input is "A" | "B" | "tie" {
  return input === "A" || input === "B" || input === "tie";
}

function isManualNoteCode(
  input: unknown,
): input is RelatedPetsV24ManualDecision["noteCode"] {
  return input === "visual_supports_candidate" ||
    input === "text_and_visual_tie" || input === "baseline_clearer" ||
    input === "judge_order_noise";
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

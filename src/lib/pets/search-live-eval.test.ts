import { describe, expect, it } from "vitest";

import {
  getPetAssetIdFromSpritesheetUrl,
} from "@/lib/pets/asset-urls";
import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import {
  PET_VISION_CAPTION_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
  loadPetSearchConfig,
  type PetSearchSemanticConfig,
  type PetSearchVisualConfig,
} from "@/lib/pets/search-config";
import {
  createPetSearchSourceHash,
  createYandexEmbeddingClient,
} from "@/lib/pets/search-embeddings";
import {
  findSimilarPetEmbeddings,
  type StoredSemanticPetMatch,
} from "@/lib/pets/search-embeddings-repository";
import diagnosticFixtures from "@/lib/pets/search-eval-fixtures.json";
import frozenJudgments from "@/lib/pets/search-eval-judgments-v2.json";
import {
  joinPetSearchEvalJudgments,
  PET_SEARCH_EVAL_QUERIES_V2,
  type JudgmentMode,
  type PetSearchEvalJudgmentRecord,
  type PetSearchEvalSuite,
} from "@/lib/pets/search-eval-fixtures";
import {
  buildPetSearchLabelPool,
  writePetSearchLabelPoolBundle,
  type PetSearchLabelPoolCandidate,
} from "@/lib/pets/search-eval-label-pool";
import {
  assertV2VisualSearchEvalConfig,
  calibrateVisualSearchProfile,
  collectPotentialVisualEvaluationSlugs,
  condenseRankedSlugs,
  evaluateSearchQuality,
  evaluateVisualSearchProfile,
  evaluateVisualSearchRolloutGate,
  resolveVisualSearchEvalSplit,
  type RankedSearchObservation,
  type VisualSearchObservation,
  type VisualSearchProfileReport,
} from "@/lib/pets/search-eval";
import {
  acquirePetSearchHoldoutReceipt,
} from "@/lib/pets/search-eval-holdout-receipt";
import {
  fuseRankedPets,
  rankPetsLexically,
  type LexicalPetMatch,
  type SemanticPetMatch,
} from "@/lib/pets/search-ranking";
import { filterCurrentVisualMatches } from "@/lib/pets/search-runtime";
import {
  PET_VISION_CAPTION_REVISION_V1,
  PET_VISION_CAPTION_REVISION_V2,
  PET_VISUAL_MODEL_REVISION_V1,
  PET_VISUAL_MODEL_REVISION_V2,
} from "@/lib/pets/search-vision-contract";
import { extractPetVisionFrames } from "@/lib/pets/search-vision-frames";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import type { PublicPet } from "@/lib/pets/types";

const LIVE_EVAL_MODE = process.env.PET_SEARCH_LIVE_EVAL;
const LIVE_EVAL_SUITE = resolveVisualSearchEvalSplit(LIVE_EVAL_MODE);
const LABEL_POOL_MODE = LIVE_EVAL_MODE === "label-pool";
const LIVE_EVAL_ENABLED = LIVE_EVAL_SUITE !== null || LABEL_POOL_MODE;
const LABEL_POOL_OUTPUT_DIRECTORY =
  process.env.PET_SEARCH_EVAL_LABEL_POOL_DIR?.trim() ||
  "/private/tmp/codex-pets-v2-labels";

type LiveEvalFixture = {
  category: string;
  query: string;
  relevantSlugs: string[];
  judgmentMode: JudgmentMode;
  judgedSlugs: string[];
  poolCandidateSlugs: string[];
  reviewedBy: string | null;
  visualSubset: boolean;
};

describe.skipIf(!LIVE_EVAL_ENABLED)("live visual pet search evaluation", () => {
  it(
    "uses only frozen suites and blinded revision-complete candidate pools",
    async () => {
      const config = loadPetSearchConfig({
        ...process.env,
        PET_SEARCH_MODE: "hybrid",
        PET_SEARCH_VISUAL_MODE: "shadow",
      });
      if (!config.semantic) {
        throw new Error(
          "Live pet search eval text configuration is unavailable.",
        );
      }
      const semanticConfig = config.semantic;
      const selectedVisualConfig = config.visual;
      let preparedFixtures: LiveEvalFixture[] | null = null;
      if (LIVE_EVAL_SUITE) {
        if (
          LIVE_EVAL_SUITE === "visual-calibration-v2" ||
          LIVE_EVAL_SUITE === "visual-holdout-v2"
        ) {
          if (!selectedVisualConfig) {
            throw new Error(
              "Live visual search eval configuration is unavailable.",
            );
          }
          assertV2VisualSearchEvalConfig(
            LIVE_EVAL_SUITE,
            selectedVisualConfig,
          );
        }
        preparedFixtures = fixturesForSuite(LIVE_EVAL_SUITE);
        if (LIVE_EVAL_SUITE === "visual-holdout-v2") {
          if (!selectedVisualConfig?.profile) {
            throw new Error(
              "Holdout requires a committed revision-bound visual profile.",
            );
          }
          const receiptPath =
            process.env.PET_SEARCH_EVAL_HOLDOUT_RECEIPT_FILE?.trim();
          const commitSha =
            process.env.PET_SEARCH_EVAL_COMMIT_SHA?.trim();
          if (!receiptPath || !commitSha) {
            throw new Error(
              "Holdout requires PET_SEARCH_EVAL_HOLDOUT_RECEIPT_FILE and PET_SEARCH_EVAL_COMMIT_SHA.",
            );
          }
          await acquirePetSearchHoldoutReceipt({
            receiptPath,
            commitSha,
            captionRevision:
              selectedVisualConfig.captionRevision,
            visualRevision:
              selectedVisualConfig.visualRevision,
            profile: selectedVisualConfig.profile,
            queryManifest: PET_SEARCH_EVAL_QUERIES_V2,
            judgments:
              frozenJudgments as PetSearchEvalJudgmentRecord[],
          });
        }
      }
      const embeddingClient = createYandexEmbeddingClient(semanticConfig);
      const catalog = await listApprovedPetsForSearch();
      const petsBySlug = new Map(catalog.map((pet) => [pet.slug, pet]));

      if (LABEL_POOL_MODE) {
        const visualV1Config = createRevisionVisualConfig(
          semanticConfig,
          PET_VISUAL_MODEL_REVISION_V1,
          selectedVisualConfig?.visionTimeoutMs,
        );
        const visualV2Config = createRevisionVisualConfig(
          semanticConfig,
          PET_VISUAL_MODEL_REVISION_V2,
          selectedVisualConfig?.visionTimeoutMs,
        );
        const [
          visualV1Captions,
          visualV2Captions,
          labelCatalog,
        ] = await Promise.all([
          listPetSearchCaptions(PET_VISION_CAPTION_REVISION_V1),
          listPetSearchCaptions(PET_VISION_CAPTION_REVISION_V2),
          createLabelCatalog(catalog),
        ]);
        const pooledQueries = PET_SEARCH_EVAL_QUERIES_V2.filter(
          (query) => query.judgmentMode === "pooled",
        );
        const pools = [];
        for (const fixture of pooledQueries) {
          const queryEmbedding = await embeddingClient.embedQuery(
            fixture.query,
          );
          const [
            storedTextMatches,
            storedVisualV1Matches,
            storedVisualV2Matches,
          ] = await Promise.all([
            findSimilarPetEmbeddings({
              modelRevision: semanticConfig.revision,
              dimensions: semanticConfig.dimensions,
              embedding: queryEmbedding,
            }),
            findSimilarPetEmbeddings({
              modelRevision: visualV1Config.visualRevision,
              dimensions: visualV1Config.dimensions,
              embedding: queryEmbedding,
            }),
            findSimilarPetEmbeddings({
              modelRevision: visualV2Config.visualRevision,
              dimensions: visualV2Config.dimensions,
              embedding: queryEmbedding,
            }),
          ]);
          const textMatches = currentTextMatches(
            storedTextMatches,
            petsBySlug,
            semanticConfig.revision,
          );
          const visualV1Matches = filterCurrentVisualMatches({
            candidates: petsBySlug,
            storedMatches: storedVisualV1Matches,
            storedCaptions: visualV1Captions,
            visualConfig: visualV1Config,
          });
          const visualV2Matches = filterCurrentVisualMatches({
            candidates: petsBySlug,
            storedMatches: storedVisualV2Matches,
            storedCaptions: visualV2Captions,
            visualConfig: visualV2Config,
          });
          const lexicalMatches = rankPetsLexically(
            catalog,
            fixture.query,
          );
          const evaluatedTopSlugs =
            collectPotentialVisualEvaluationSlugs({
              pets: catalog,
              lexical: lexicalMatches,
              textMatches,
              visualMatches:
                fixture.suite === "visual-calibration-v2" ||
                fixture.suite === "visual-holdout-v2"
                  ? visualV2Matches
                  : [],
              textMinSemanticScore:
                semanticConfig.minSemanticScore,
            });
          pools.push(
            buildPetSearchLabelPool({
              queryId: fixture.id,
              suite: fixture.suite,
              query: fixture.query,
              catalog: labelCatalog,
              rankings: {
                lexical: lexicalMatches.map(
                  (match) => match.pet.slug,
                ),
                text: textMatches.map((match) => match.slug),
                visualV1: visualV1Matches.map((match) => match.slug),
                visualV2: visualV2Matches.map((match) => match.slug),
              },
              evaluatedTopSlugs,
            }),
          );
        }
        const bundle = await writePetSearchLabelPoolBundle({
          outputDirectory: LABEL_POOL_OUTPUT_DIRECTORY,
          pools,
        });
        console.info("[codex-pets][pet-search-label-pool]", {
          outputDirectory: LABEL_POOL_OUTPUT_DIRECTORY,
          queryCount: pools.length,
          candidateCount: pools.reduce(
            (count, pool) => count + pool.candidates.length,
            0,
          ),
        });
        expect(bundle.indexPath).toBe(
          `${LABEL_POOL_OUTPUT_DIRECTORY}/index.html`,
        );
        expect(pools).toHaveLength(pooledQueries.length);
        return;
      }

      if (!LIVE_EVAL_SUITE) {
        throw new Error("Live pet search eval suite is unavailable.");
      }
      const suite = LIVE_EVAL_SUITE;
      const selectedFixtures =
        preparedFixtures ?? fixturesForSuite(suite);
      if (selectedFixtures.length === 0) {
        throw new Error(`No frozen ${suite} fixtures are configured.`);
      }
      const observations: VisualSearchObservation<PublicPet>[] = [];
      if (
        suite === "diagnostic-v1" ||
        suite === "text-regression-v2"
      ) {
        for (const fixture of selectedFixtures) {
          observations.push(
            await collectTextOnlyObservation({
              fixture,
              catalog,
              petsBySlug,
              semanticConfig,
              embeddingClient,
            }),
          );
        }
      } else {
        if (!selectedVisualConfig) {
          throw new Error(
            "Live visual search eval configuration is unavailable.",
          );
        }
        const selectedCaptions = await listPetSearchCaptions(
          selectedVisualConfig.captionRevision,
        );
        for (const fixture of selectedFixtures) {
          observations.push(
            await collectObservation({
              fixture,
              catalog,
              petsBySlug,
              semanticConfig,
              visualConfig: selectedVisualConfig,
              storedCaptions: selectedCaptions,
              embeddingClient,
            }),
          );
        }
      }

      if (suite === "diagnostic-v1") {
        const diagnosticReport = evaluateSearchQuality(
          observations.map((observation) =>
            toTextObservation(
              observation,
              semanticConfig.minSemanticScore,
            ),
          ),
        );
        console.info("[codex-pets][pet-search-diagnostic-v1]", {
          report: diagnosticReport,
        });
        return;
      }

      const textObservations =
        suite === "text-regression-v2"
          ? observations
          : await collectTextRegressionObservations({
              catalog,
              petsBySlug,
              semanticConfig,
              embeddingClient,
            });
      const textReport = evaluateSearchQuality(
        textObservations.map((observation) =>
          toTextObservation(
            observation,
            semanticConfig.minSemanticScore,
          ),
        ),
      );

      if (suite === "text-regression-v2") {
        console.info("[codex-pets][pet-text-regression]", { textReport });
        expect(textReport.exactNameMrrAt5).toBe(1);
        expect(textReport.hybridNdcgLift).toBeGreaterThanOrEqual(0.2);
        expect(textReport.negativeSemanticOnlySafe).toBe(true);
        expect(textReport.p95DurationMs).toBeLessThan(1_000);
        return;
      }

      if (suite === "visual-calibration-v2") {
        if (!selectedVisualConfig) {
          throw new Error(
            "Visual calibration configuration is unavailable.",
          );
        }
        const calibration = calibrateVisualSearchProfile(
          observations,
          semanticConfig.minSemanticScore,
        );
        console.info("[codex-pets][pet-visual-calibration]", {
          captionRevision: selectedVisualConfig.captionRevision,
          visualRevision: selectedVisualConfig.visualRevision,
          profile: calibration.profile,
          evaluatedProfileCount: calibration.evaluatedProfileCount,
          textReport,
          report: aggregateVisualReport(calibration.report),
        });
        expect(calibration.report.exactNameMrrAt5).toBe(1);
        expect(calibration.report.negativeVisualOnlySafe).toBe(true);
        expect(calibration.report.visualSubsetLift).toBeGreaterThanOrEqual(
          0.15,
        );
        return;
      }

      if (!selectedVisualConfig?.profile) {
        throw new Error(
          "Holdout requires a committed revision-bound visual profile.",
        );
      }
      const selectedCaptions = await listPetSearchCaptions(
        selectedVisualConfig.captionRevision,
      );
      const holdoutReport = evaluateVisualSearchProfile(
        observations,
        semanticConfig.minSemanticScore,
        selectedVisualConfig.profile,
      );
      const sexyFixture = fixturesForSuite("visual-calibration-v2").find(
        (fixture) => fixture.query === "sexy",
      );
      if (!sexyFixture) {
        throw new Error("The frozen sexy review fixture is missing.");
      }
      const sexyObservation = await collectObservation({
        fixture: sexyFixture,
        catalog,
        petsBySlug,
        semanticConfig,
        visualConfig: selectedVisualConfig,
        storedCaptions: selectedCaptions,
        embeddingClient,
      });
      const sexyRanking = combinedSlugs(
        sexyObservation,
        semanticConfig.minSemanticScore,
        selectedVisualConfig.profile,
      );
      const sexyTop5 = sexyRanking.slice(0, 5);
      const sexyJudgedTop5 = condenseRankedSlugs(
        sexyRanking,
        sexyObservation.judgmentMode ?? "deterministic",
        sexyObservation.judgedSlugs ?? [],
      ).slice(0, 5);
      const sexyRelevant = sexyJudgedTop5.some((slug) =>
        sexyFixture.relevantSlugs.includes(slug),
      );
      const gate = evaluateVisualSearchRolloutGate(
        holdoutReport,
        textReport,
        {
          providerFallbackHttpStatuses: [200, 200, 200],
          visualFallbackHttpStatuses: [200, 200],
          captionsAbsentFromPublicContracts: true,
          sexyHasRelevantTop5: sexyRelevant,
        },
      );
      console.info("[codex-pets][pet-visual-holdout]", {
        captionRevision: selectedVisualConfig.captionRevision,
        visualRevision: selectedVisualConfig.visualRevision,
        profile: selectedVisualConfig.profile,
        textReport,
        report: aggregateVisualReport(holdoutReport),
        gate,
        sexyTop5,
        requiresHumanReview: true,
      });
      expect(gate.passed).toBe(true);
    },
    300_000,
  );
});

function fixturesForSuite(suite: PetSearchEvalSuite): LiveEvalFixture[] {
  if (suite === "diagnostic-v1") {
    return diagnosticFixtures.map((fixture) => ({
      ...fixture,
      judgmentMode: "deterministic",
      judgedSlugs: [],
      poolCandidateSlugs: [],
    }));
  }
  return joinPetSearchEvalJudgments(
    PET_SEARCH_EVAL_QUERIES_V2,
    frozenJudgments as PetSearchEvalJudgmentRecord[],
    suite,
  );
}

async function collectTextRegressionObservations(input: {
  catalog: readonly PublicPet[];
  petsBySlug: ReadonlyMap<string, PublicPet>;
  semanticConfig: PetSearchSemanticConfig;
  embeddingClient: ReturnType<typeof createYandexEmbeddingClient>;
}): Promise<VisualSearchObservation<PublicPet>[]> {
  const observations: VisualSearchObservation<PublicPet>[] = [];
  for (const fixture of fixturesForSuite("text-regression-v2")) {
    observations.push(
      await collectTextOnlyObservation({
        ...input,
        fixture,
      }),
    );
  }
  return observations;
}

async function collectTextOnlyObservation(input: {
  fixture: LiveEvalFixture;
  catalog: readonly PublicPet[];
  petsBySlug: ReadonlyMap<string, PublicPet>;
  semanticConfig: PetSearchSemanticConfig;
  embeddingClient: ReturnType<typeof createYandexEmbeddingClient>;
}): Promise<VisualSearchObservation<PublicPet>> {
  const startedAt = performance.now();
  const queryEmbedding = await input.embeddingClient.embedQuery(
    input.fixture.query,
  );
  const storedTextMatches = await findSimilarPetEmbeddings({
    modelRevision: input.semanticConfig.revision,
    dimensions: input.semanticConfig.dimensions,
    embedding: queryEmbedding,
  });
  return {
    category: input.fixture.category,
    query: input.fixture.query,
    relevantSlugs: input.fixture.relevantSlugs,
    judgmentMode: input.fixture.judgmentMode,
    judgedSlugs: input.fixture.judgedSlugs,
    poolCandidateSlugs: input.fixture.poolCandidateSlugs,
    reviewedBy: input.fixture.reviewedBy,
    visualSubset: input.fixture.visualSubset,
    pets: input.catalog,
    lexical: rankPetsLexically(input.catalog, input.fixture.query),
    textMatches: currentTextMatches(
      storedTextMatches,
      input.petsBySlug,
      input.semanticConfig.revision,
    ),
    visualMatches: [],
    durationMs: performance.now() - startedAt,
  };
}

async function collectObservation(input: {
  fixture: LiveEvalFixture;
  catalog: readonly PublicPet[];
  petsBySlug: ReadonlyMap<string, PublicPet>;
  semanticConfig: PetSearchSemanticConfig;
  visualConfig: PetSearchVisualConfig;
  storedCaptions: Awaited<ReturnType<typeof listPetSearchCaptions>>;
  embeddingClient: ReturnType<typeof createYandexEmbeddingClient>;
}): Promise<VisualSearchObservation<PublicPet>> {
  const startedAt = performance.now();
  const queryEmbedding = await input.embeddingClient.embedQuery(
    input.fixture.query,
  );
  const [storedTextMatches, storedVisualMatches] = await Promise.all([
    findSimilarPetEmbeddings({
      modelRevision: input.semanticConfig.revision,
      dimensions: input.semanticConfig.dimensions,
      embedding: queryEmbedding,
    }),
    findSimilarPetEmbeddings({
      modelRevision: input.visualConfig.visualRevision,
      dimensions: input.visualConfig.dimensions,
      embedding: queryEmbedding,
    }),
  ]);
  const textMatches = currentTextMatches(
    storedTextMatches,
    input.petsBySlug,
    input.semanticConfig.revision,
  );
  const visualMatches = filterCurrentVisualMatches({
    candidates: input.petsBySlug,
    storedMatches: storedVisualMatches,
    storedCaptions: input.storedCaptions,
    visualConfig: input.visualConfig,
  });

  return {
    category: input.fixture.category,
    query: input.fixture.query,
    relevantSlugs: input.fixture.relevantSlugs,
    judgmentMode: input.fixture.judgmentMode,
    judgedSlugs: input.fixture.judgedSlugs,
    poolCandidateSlugs: input.fixture.poolCandidateSlugs,
    reviewedBy: input.fixture.reviewedBy,
    visualSubset: input.fixture.visualSubset,
    pets: input.catalog,
    lexical: rankPetsLexically(input.catalog, input.fixture.query),
    textMatches,
    visualMatches,
    durationMs: performance.now() - startedAt,
  };
}

function createRevisionVisualConfig(
  semanticConfig: PetSearchSemanticConfig,
  visualRevision: keyof typeof PET_VISUAL_MODEL_REVISIONS,
  visionTimeoutMs = 30_000,
): PetSearchVisualConfig {
  const definition = PET_VISUAL_MODEL_REVISIONS[visualRevision];
  const captionRevision =
    definition.captionRevision as keyof typeof PET_VISION_CAPTION_REVISIONS;
  const captionContract = PET_VISION_CAPTION_REVISIONS[captionRevision];
  return {
    folderId: semanticConfig.folderId,
    apiKey: semanticConfig.apiKey,
    captionRevision,
    visualRevision,
    dimensions: definition.dimensions,
    profile: definition.profile,
    visionTimeoutMs,
    modelUri:
      `gpt://${semanticConfig.folderId}/${captionContract.modelName}`,
  };
}

async function createLabelCatalog(
  catalog: readonly PublicPet[],
): Promise<PetSearchLabelPoolCandidate[]> {
  return mapWithConcurrency(catalog, 4, async (pet) => {
    const assetId = getPetAssetIdFromSpritesheetUrl(pet.spritesheetUrl);
    if (!assetId) {
      throw new Error(`Approved pet has no asset id: ${pet.slug}`);
    }
    const asset = await readPetSpritesheetAsset({ assetId });
    const extracted = await extractPetVisionFrames(asset.buffer);
    const frameDataUrls = extracted.frames.map((frame) => frame.dataUrl);
    if (frameDataUrls.length !== 4) {
      throw new Error(`Approved pet has incomplete vision frames: ${pet.slug}`);
    }
    return {
      slug: pet.slug,
      displayName: pet.displayName,
      spritesheetSha256: extracted.spritesheetSha256,
      frameDataUrls: [
        frameDataUrls[0] ?? "",
        frameDataUrls[1] ?? "",
        frameDataUrls[2] ?? "",
        frameDataUrls[3] ?? "",
      ],
    };
  });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      async () => {
        while (nextIndex < values.length) {
          const index = nextIndex;
          nextIndex += 1;
          const value = values[index];
          if (value !== undefined) {
            results[index] = await mapper(value);
          }
        }
      },
    ),
  );
  return results;
}

function currentTextMatches(
  matches: readonly StoredSemanticPetMatch[],
  petsBySlug: ReadonlyMap<string, PublicPet>,
  revision: string,
): SemanticPetMatch[] {
  return matches.flatMap((match) => {
    const pet = petsBySlug.get(match.slug);
    if (
      pet?.status !== "approved" ||
      match.sourceHash !== createPetSearchSourceHash(pet, revision)
    ) {
      return [];
    }
    return [{ slug: match.slug, score: match.score }];
  });
}

function toTextObservation(
  observation: VisualSearchObservation<PublicPet>,
  minSemanticScore: number,
): RankedSearchObservation {
  const lexicalSlugs = observation.lexical.map(
    (match) => match.pet.slug,
  );
  const hybridSlugs = fuseRankedPets({
    pets: observation.pets,
    lexical: observation.lexical,
    semanticRanks: [
      {
        matches: observation.textMatches,
        minScore: minSemanticScore,
        weight: 1,
      },
    ],
  }).map((pet) => pet.slug);
  return {
    category: observation.category,
    query: observation.query,
    relevantSlugs: observation.relevantSlugs,
    judgmentMode: observation.judgmentMode,
    judgedSlugs: observation.judgedSlugs,
    poolCandidateSlugs: observation.poolCandidateSlugs,
    reviewedBy: observation.reviewedBy,
    lexicalSlugs,
    hybridSlugs,
    semanticOnlySlugs: semanticOnlySlugs(
      observation.textMatches,
      lexicalSlugs,
      minSemanticScore,
    ),
    durationMs: observation.durationMs,
  };
}

function combinedSlugs<T extends PublicPet>(
  observation: {
    pets: readonly T[];
    lexical: readonly LexicalPetMatch<T>[];
    textMatches: readonly SemanticPetMatch[];
    visualMatches: readonly SemanticPetMatch[];
  },
  textMinSemanticScore: number,
  profile: { minSemanticScore: number; weight: number },
): string[] {
  return fuseRankedPets({
    pets: observation.pets,
    lexical: observation.lexical,
    semanticRanks: [
      {
        matches: observation.textMatches,
        minScore: textMinSemanticScore,
        weight: 1,
      },
      {
        matches: observation.visualMatches,
        minScore: profile.minSemanticScore,
        weight: profile.weight,
      },
    ],
  }).map((pet) => pet.slug);
}

function semanticOnlySlugs(
  semanticMatches: readonly SemanticPetMatch[],
  lexicalSlugs: readonly string[],
  threshold: number,
): string[] {
  const lexical = new Set(lexicalSlugs);
  return semanticMatches
    .filter((match) => match.score >= threshold && !lexical.has(match.slug))
    .toSorted((left, right) => right.score - left.score)
    .map((match) => match.slug);
}

function aggregateVisualReport(report: VisualSearchProfileReport) {
  return {
    exactNameMrrAt5: report.exactNameMrrAt5,
    textHybridNdcgAt5: report.textHybridNdcgAt5,
    combinedNdcgAt5: report.combinedNdcgAt5,
    visualSubsetTextHybridNdcgAt5:
      report.visualSubsetTextHybridNdcgAt5,
    visualSubsetCombinedNdcgAt5:
      report.visualSubsetCombinedNdcgAt5,
    visualSubsetLift: report.visualSubsetLift,
    sexyHasRelevantTop5: report.sexyHasRelevantTop5,
    negativeVisualOnlySafe: report.negativeVisualOnlySafe,
    p95DurationMs: report.p95DurationMs,
  };
}

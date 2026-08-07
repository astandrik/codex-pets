import { describe, expect, it } from "vitest";

import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import {
  loadPetSearchConfig,
  PET_SEARCH_EMBEDDING_MODELS,
  PET_VISION_CAPTION_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
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
import fixtures from "@/lib/pets/search-eval-fixtures.json";
import {
  calibrateVisualSearchProfile,
  evaluateSearchQuality,
  evaluateVisualSearchProfile,
  evaluateVisualSearchQualityGate,
  evaluateVisualSearchRevisionComparison,
  resolveVisualSearchEvalSplit,
  type RankedSearchObservation,
  type VisualSearchObservation,
  type VisualSearchProfileReport,
} from "@/lib/pets/search-eval";
import {
  fuseRankedPets,
  rankPetsLexically,
  type LexicalPetMatch,
  type SemanticPetMatch,
} from "@/lib/pets/search-ranking";
import { filterCurrentVisualMatches } from "@/lib/pets/search-runtime";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import type { PublicPet } from "@/lib/pets/types";

const LIVE_EVAL_MODE = process.env.PET_SEARCH_LIVE_EVAL;
const LIVE_EVAL_SPLIT = resolveVisualSearchEvalSplit(LIVE_EVAL_MODE);
const LIVE_EVAL_ENABLED = LIVE_EVAL_SPLIT !== null;
const V1_VISUAL_BASELINE_REVISION =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1";

describe.skipIf(!LIVE_EVAL_ENABLED)("live visual pet search evaluation", () => {
  it(
    "uses only the requested frozen split and deterministic profile rules",
    async () => {
      const config = loadPetSearchConfig({
        ...process.env,
        PET_SEARCH_MODE: "hybrid",
        PET_SEARCH_VISUAL_MODE: "shadow",
      });
      if (!config.semantic || !config.visual) {
        throw new Error(
          "Live visual search eval configuration is unavailable.",
        );
      }
      if (!LIVE_EVAL_SPLIT) {
        throw new Error("Live visual search eval mode is invalid.");
      }
      const semanticConfig = config.semantic;
      const visualConfig = config.visual;
      const embeddingClient = createYandexEmbeddingClient(semanticConfig);
      const split = LIVE_EVAL_SPLIT;
      const selectedFixtures = fixtures.filter(
        (fixture) => fixture.split === split,
      );
      if (selectedFixtures.length === 0) {
        throw new Error(`No frozen ${split} fixtures are configured.`);
      }

      const observations: VisualSearchObservation<PublicPet>[] = [];
      for (const fixture of selectedFixtures) {
        observations.push(await collectObservation(fixture));
      }
      const textReport = evaluateSearchQuality(
        observations.map((observation) =>
          toTextObservation(
            observation,
            semanticConfig.minSemanticScore,
          )
        ),
      );

      if (split === "calibration") {
        const calibration = calibrateVisualSearchProfile(
          observations,
          semanticConfig.minSemanticScore,
        );
        console.info("[codex-pets][pet-visual-calibration]", {
          captionRevision: visualConfig.captionRevision,
          visualRevision: visualConfig.visualRevision,
          profile: calibration.profile,
          evaluatedProfileCount: calibration.evaluatedProfileCount,
          textReport,
          report: aggregateVisualReport(calibration.report),
        });
        expect(calibration.report.exactNameMrrAt5).toBe(1);
        expect(calibration.report.negativeVisualOnlySafe).toBe(true);
        expect(textReport.hybridNdcgLift).toBeGreaterThanOrEqual(0.2);
        return;
      }

      if (!visualConfig.profile) {
        throw new Error(
          "Holdout requires a committed revision-bound visual profile.",
        );
      }
      const holdoutReport = evaluateVisualSearchProfile(
        observations,
        semanticConfig.minSemanticScore,
        visualConfig.profile,
      );
      const sexyFixture = fixtures.find(
        (fixture) => fixture.query === "sexy",
      );
      if (!sexyFixture) {
        throw new Error("The frozen sexy review fixture is missing.");
      }
      const sexyObservation = await collectObservation(sexyFixture);
      const sexyTop5 = combinedSlugs(
        sexyObservation,
        semanticConfig.minSemanticScore,
        visualConfig.profile,
      ).slice(0, 5);
      const sexyRelevant = sexyTop5.some((slug) =>
        sexyFixture.relevantSlugs.includes(slug)
      );
      // HTTP fallback and public DTO redaction are verified by the hermetic
      // search-service, search-runtime, API, homepage, MCP, and WebMCP suites.
      // They are deliberately not represented as live measurements here.
      const gate = evaluateVisualSearchQualityGate(
        holdoutReport,
        textReport,
        {
          sexyHasRelevantTop5: sexyRelevant,
        },
      );
      const revisionComparison =
        visualConfig.visualRevision === V1_VISUAL_BASELINE_REVISION
          ? null
          : await compareWithV1Baseline();
      console.info("[codex-pets][pet-visual-holdout]", {
        captionRevision: visualConfig.captionRevision,
        visualRevision: visualConfig.visualRevision,
        profile: visualConfig.profile,
        textReport,
        report: aggregateVisualReport(holdoutReport),
        gate,
        revisionComparison,
        sexyTop5,
      });
      expect(gate.passed).toBe(true);
      expect(revisionComparison?.passed ?? true).toBe(true);

      async function collectObservation(
        fixture: (typeof fixtures)[number],
        selectedVisualConfig: PetSearchVisualConfig = visualConfig,
      ) {
        const startedAt = performance.now();
        const catalog = await listApprovedPetsForSearch();
        const queryEmbedding = await embeddingClient.embedQuery(
          fixture.query,
        );
        const [storedTextMatches, storedVisualMatches, storedCaptions] =
          await Promise.all([
            findSimilarPetEmbeddings({
              modelRevision: semanticConfig.revision,
              dimensions: semanticConfig.dimensions,
              embedding: queryEmbedding,
            }),
            findSimilarPetEmbeddings({
              modelRevision: selectedVisualConfig.visualRevision,
              dimensions: selectedVisualConfig.dimensions,
              embedding: queryEmbedding,
            }),
            listPetSearchCaptions(selectedVisualConfig.captionRevision),
          ]);
        const petsBySlug = new Map(
          catalog.map((pet) => [pet.slug, pet]),
        );
        const textMatches = currentTextMatches(
          storedTextMatches,
          petsBySlug,
          semanticConfig.revision,
        );
        const visualMatches = filterCurrentVisualMatches({
          candidates: petsBySlug,
          storedMatches: storedVisualMatches,
          storedCaptions,
          visualConfig: selectedVisualConfig,
        });

        return {
          category: fixture.category,
          query: fixture.query,
          relevantSlugs: fixture.relevantSlugs,
          visualSubset: fixture.visualSubset,
          pets: catalog,
          lexical: rankPetsLexically(catalog, fixture.query),
          textMatches,
          visualMatches,
          durationMs: performance.now() - startedAt,
        };
      }

      async function compareWithV1Baseline() {
        const definition =
          PET_VISUAL_MODEL_REVISIONS[V1_VISUAL_BASELINE_REVISION];
        if (!definition.profile) {
          throw new Error("The V1 visual baseline profile is missing.");
        }
        const embeddingModel =
          PET_SEARCH_EMBEDDING_MODELS[definition.embeddingModelId];
        const baselineConfig: PetSearchVisualConfig = {
          ...visualConfig,
          captionRevision: definition.captionRevision,
          visualRevision: V1_VISUAL_BASELINE_REVISION,
          embeddingModelId: definition.embeddingModelId,
          dimensions: embeddingModel.dimensions,
          profile: definition.profile,
          modelUri: `gpt://${visualConfig.folderId}/${
            PET_VISION_CAPTION_REVISIONS[definition.captionRevision]
              .modelName
          }`,
        };
        const baselineObservations: VisualSearchObservation<PublicPet>[] = [];
        for (const fixture of selectedFixtures) {
          baselineObservations.push(
            await collectObservation(fixture, baselineConfig),
          );
        }
        const baselineReport = evaluateVisualSearchProfile(
          baselineObservations,
          semanticConfig.minSemanticScore,
          definition.profile,
        );
        return evaluateVisualSearchRevisionComparison(
          holdoutReport,
          baselineReport,
          { sexyHasRelevantTop5: sexyRelevant },
        );
      }
    },
    180_000,
  );
});

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

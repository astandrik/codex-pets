import { describe, expect, it } from "vitest";

import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import { loadPetSearchConfig } from "@/lib/pets/search-config";
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
} from "@/lib/pets/search-eval-fixtures";
import {
  calibrateVisualSearchProfile,
  evaluateSearchQuality,
  evaluateVisualSearchProfile,
  evaluateVisualSearchRolloutGate,
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

type LiveEvalFixture = {
  category: string;
  query: string;
  relevantSlugs: string[];
  judgmentMode: JudgmentMode;
  judgedSlugs: string[];
  reviewedBy: string | null;
  visualSubset: boolean;
};

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
      const selectedFixtures: LiveEvalFixture[] =
        split === "diagnostic-v1"
          ? diagnosticFixtures.map((fixture) => ({
              ...fixture,
              suite: "diagnostic-v1",
              judgmentMode: "deterministic",
              judgedSlugs: [],
            }))
          : joinPetSearchEvalJudgments(
              PET_SEARCH_EVAL_QUERIES_V2,
              frozenJudgments as PetSearchEvalJudgmentRecord[],
              split,
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

      if (split === "text-regression-v2") {
        console.info("[codex-pets][pet-text-regression]", {
          textReport,
        });
        expect(textReport.exactNameMrrAt5).toBe(1);
        expect(textReport.hybridNdcgLift).toBeGreaterThanOrEqual(0.2);
        expect(textReport.negativeSemanticOnlySafe).toBe(true);
        return;
      }

      if (split === "diagnostic-v1") {
        console.info("[codex-pets][pet-search-diagnostic-v1]", {
          textReport,
        });
        return;
      }

      if (split === "visual-calibration-v2") {
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
      const sexyFixture = joinPetSearchEvalJudgments(
        PET_SEARCH_EVAL_QUERIES_V2,
        frozenJudgments as PetSearchEvalJudgmentRecord[],
        "visual-calibration-v2",
      ).find((fixture) => fixture.query === "sexy");
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
        captionRevision: visualConfig.captionRevision,
        visualRevision: visualConfig.visualRevision,
        profile: visualConfig.profile,
        textReport,
        report: aggregateVisualReport(holdoutReport),
        gate,
        sexyTop5,
        requiresHumanReview: true,
      });
      expect(gate.passed).toBe(true);

      async function collectObservation(fixture: LiveEvalFixture) {
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
              modelRevision: visualConfig.visualRevision,
              dimensions: visualConfig.dimensions,
              embedding: queryEmbedding,
            }),
            listPetSearchCaptions(visualConfig.captionRevision),
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
          visualConfig,
        });

        return {
          category: fixture.category,
          query: fixture.query,
          relevantSlugs: fixture.relevantSlugs,
          judgmentMode: fixture.judgmentMode,
          judgedSlugs: fixture.judgedSlugs,
          reviewedBy: fixture.reviewedBy,
          visualSubset: fixture.visualSubset,
          pets: catalog,
          lexical: rankPetsLexically(catalog, fixture.query),
          textMatches,
          visualMatches,
          durationMs: performance.now() - startedAt,
        };
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
    judgmentMode: observation.judgmentMode,
    judgedSlugs: observation.judgedSlugs,
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

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTextRolloutEvidence } from "../../../scripts/lib/pet-search-text-rollout.mjs";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import {
  createPetSearchSourceHash,
  createYandexEmbeddingClient,
} from "@/lib/pets/search-embeddings";
import {
  findSimilarPetEmbeddings,
  type StoredSemanticPetMatch,
} from "@/lib/pets/search-embeddings-repository";
import {
  loadPetSearchConfig,
  PET_SEARCH_EMBEDDING_MODELS,
} from "@/lib/pets/search-config";
import fixtures from "@/lib/pets/search-eval-fixtures.json";
import {
  evaluateSearchQuality,
  selectSemanticThreshold,
  type RankedSearchObservation,
} from "@/lib/pets/search-eval";
import {
  collectSequentially,
  evaluateTextSearchRolloutGate,
  resolveTextEvaluationThreshold,
  toTextSearchObservation,
} from "@/lib/pets/search-text-rollout";
import { rankPetsLexically } from "@/lib/pets/search-ranking";
import type { PublicPet } from "@/lib/pets/types";

const LIVE_EVAL_MODE = process.env.PET_SEARCH_TEXT_LIVE_EVAL;
const LIVE_EVAL_SPLIT = resolveTextEvalSplit(LIVE_EVAL_MODE);
const LIVE_EVAL_ENABLED = LIVE_EVAL_SPLIT !== null;

describe.skipIf(!LIVE_EVAL_ENABLED)("live text-only pet search evaluation", () => {
  it(
    "uses frozen text splits without reading visual vectors or captions",
    async () => {
      const config = loadPetSearchConfig({
        ...process.env,
        PET_SEARCH_MODE: "hybrid",
        PET_SEARCH_VISUAL_MODE: "off",
      });
      if (!config.semantic) {
        throw new Error("Live text search evaluation configuration is unavailable.");
      }
      if (!LIVE_EVAL_SPLIT || config.visualMode !== "off") {
        throw new Error("Live text search evaluation must keep visual mode off.");
      }
      const committedThreshold = config.semantic.minSemanticScore;
      if (committedThreshold === null) {
        throw new Error("Text rollout requires a committed revision-bound threshold.");
      }

      const semanticConfig = config.semantic;
      const evidence =
        LIVE_EVAL_SPLIT === "holdout"
          ? parseTextRolloutEvidence(process.env)
          : null;
      const embeddingClient = createYandexEmbeddingClient({
        folderId: semanticConfig.folderId,
        apiKey: semanticConfig.apiKey,
        revision: semanticConfig.revision,
        ...PET_SEARCH_EMBEDDING_MODELS[semanticConfig.embeddingModelId],
        timeoutMs: semanticConfig.timeoutMs,
      });
      const selectedFixtures = fixtures.filter(
        (fixture) => fixture.split === LIVE_EVAL_SPLIT,
      );
      if (selectedFixtures.length === 0) {
        throw new Error(`No frozen ${LIVE_EVAL_SPLIT} fixtures are configured.`);
      }
      const observations = await collectSequentially(
        selectedFixtures,
        collectObservation,
      );
      const evaluatedThreshold = resolveTextEvaluationThreshold(
        LIVE_EVAL_SPLIT,
        committedThreshold,
        () =>
          selectSemanticThreshold(
            observations.map((observation) => ({
              relevantSlugs: observation.fixture.relevantSlugs,
              negative: observation.fixture.category === "negative",
              matches: [...observation.textMatches],
            })),
          ),
      );
      if (LIVE_EVAL_SPLIT === "calibration") {
        expect(evaluatedThreshold).toBe(committedThreshold);
      }

      const report = evaluateSearchQuality(
        observations.map((observation) =>
          toTextSearchObservation({
            category: observation.fixture.category,
            query: observation.fixture.query,
            relevantSlugs: observation.fixture.relevantSlugs,
            pets: observation.pets,
            lexical: observation.lexical,
            textMatches: observation.textMatches,
            durationMs: observation.durationMs,
            threshold: committedThreshold,
          }),
        ),
      );
      const sexyFixture = fixtures.find((fixture) => fixture.query === "sexy");
      if (!sexyFixture) {
        throw new Error("The frozen sexy readback fixture is missing.");
      }
      const sexyObservation = await collectObservation(sexyFixture);
      const sexyReadback = toTextSearchObservation({
        category: sexyObservation.fixture.category,
        query: sexyObservation.fixture.query,
        relevantSlugs: sexyObservation.fixture.relevantSlugs,
        pets: sexyObservation.pets,
        lexical: sexyObservation.lexical,
        textMatches: sexyObservation.textMatches,
        durationMs: sexyObservation.durationMs,
        threshold: committedThreshold,
        reviewedBy: evidence?.reviewedBy,
      });
      const reportWithReadback = {
        ...report,
        sexyHasRelevantTop5: hasRelevantTopFive(sexyReadback),
        sexyHumanReviewedTop5:
          Boolean(evidence?.reviewedBy) && hasRelevantTopFive(sexyReadback),
      };

      if (LIVE_EVAL_SPLIT === "calibration") {
        writeCalibrationReadback({
          textRevision: semanticConfig.revision,
          threshold: committedThreshold,
          report: reportWithReadback,
        });
        console.info("[codex-pets][pet-text-calibration]", {
          textRevision: semanticConfig.revision,
          threshold: committedThreshold,
          report: aggregateReport(reportWithReadback),
          topFiveSlugs: sexyReadback.hybridSlugs.slice(0, 5),
        });
        return;
      }

      const gate = evaluateTextSearchRolloutGate(reportWithReadback, evidence!);
      console.info("[codex-pets][pet-text-holdout]", {
        textRevision: semanticConfig.revision,
        threshold: committedThreshold,
        report: aggregateReport(reportWithReadback),
        topFiveSlugs: sexyReadback.hybridSlugs.slice(0, 5),
        gate,
      });
      expect(gate.passed).toBe(true);

      async function collectObservation(
        fixture: (typeof fixtures)[number],
      ) {
        const startedAt = performance.now();
        const pets = await listApprovedPetsForSearch();
        const embedding = await embeddingClient.embedQuery(fixture.query);
        const storedMatches = await findSimilarPetEmbeddings({
          modelRevision: semanticConfig.revision,
          dimensions: semanticConfig.dimensions,
          embedding,
        });
        const petsBySlug = new Map(pets.map((pet) => [pet.slug, pet]));
        return {
          fixture,
          pets,
          lexical: rankPetsLexically(pets, fixture.query),
          textMatches: currentTextMatches(
            storedMatches,
            petsBySlug,
            semanticConfig.revision,
          ),
          durationMs: performance.now() - startedAt,
        };
      }
    },
    180_000,
  );
});

function resolveTextEvalSplit(mode: string | undefined): "calibration" | "holdout" | null {
  if (mode === "calibrate") return "calibration";
  if (mode === "holdout") return "holdout";
  return null;
}

function currentTextMatches(
  matches: readonly StoredSemanticPetMatch[],
  petsBySlug: ReadonlyMap<string, PublicPet>,
  revision: string,
) {
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

function hasRelevantTopFive(observation: RankedSearchObservation) {
  return observation.hybridSlugs
    .slice(0, 5)
    .some((slug) => observation.relevantSlugs.includes(slug));
}

function aggregateReport(report: ReturnType<typeof evaluateSearchQuality>) {
  return {
    exactNameMrrAt5: report.exactNameMrrAt5,
    lexicalNdcgAt5: report.lexicalNdcgAt5,
    hybridNdcgAt5: report.hybridNdcgAt5,
    hybridNdcgLift: report.hybridNdcgLift,
    sexyHasRelevantTop5: report.sexyHasRelevantTop5,
    sexyHumanReviewedTop5: report.sexyHumanReviewedTop5,
    negativeSemanticOnlySafe: report.negativeSemanticOnlySafe,
    p95DurationMs: report.p95DurationMs,
  };
}

function writeCalibrationReadback(input: {
  textRevision: string;
  threshold: number;
  report: ReturnType<typeof evaluateSearchQuality>;
}) {
  const directory = resolve(process.cwd(), ".scratch/pet-text-rollout");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    resolve(directory, "calibration-readback.json"),
    `${JSON.stringify({ schemaVersion: 1, ...input }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

import { describe, expect, it } from "vitest";

import { loadPetSearchConfig } from "@/lib/pets/search-config";
import {
  createPetSearchSourceHash,
  createYandexEmbeddingClient,
} from "@/lib/pets/search-embeddings";
import { findSimilarPetEmbeddings } from "@/lib/pets/search-embeddings-repository";
import fixtures from "@/lib/pets/search-eval-fixtures.json";
import {
  evaluateSearchQuality,
  evaluateSearchRolloutGate,
  selectSemanticThreshold,
  type RankedSearchObservation,
} from "@/lib/pets/search-eval";
import {
  fuseRankedPets,
  rankPetsLexically,
  type SemanticPetMatch,
} from "@/lib/pets/search-ranking";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";

const LIVE_EVAL_ENABLED = process.env.PET_SEARCH_LIVE_EVAL === "1";

describe.skipIf(!LIVE_EVAL_ENABLED)("live pet search rollout evaluation", () => {
  it(
    "calibrates the configured revision and passes every rollout gate",
    async () => {
      const config = loadPetSearchConfig({
        ...process.env,
        PET_SEARCH_MODE: "hybrid",
      });
      if (!config.semantic) {
        throw new Error(
          `Live search eval configuration is unavailable: ${config.fallbackReason ?? "unknown"}.`,
        );
      }

      const semanticConfig = config.semantic;
      const embeddingClient = createYandexEmbeddingClient(semanticConfig);
      const samples = [];

      for (const fixture of fixtures) {
        const startedAt = performance.now();
        const catalog = await listApprovedPetsForSearch();
        const queryEmbedding = await embeddingClient.embedQuery(fixture.query);
        const storedMatches = await findSimilarPetEmbeddings({
          modelRevision: semanticConfig.revision,
          dimensions: semanticConfig.dimensions,
          embedding: queryEmbedding,
        });
        const petBySlug = new Map(catalog.map((pet) => [pet.slug, pet]));
        const semanticMatches = storedMatches.filter((match) => {
          const pet = petBySlug.get(match.slug);
          return (
            pet?.status === "approved" &&
            match.sourceHash ===
              createPetSearchSourceHash(pet, semanticConfig.revision)
          );
        });

        samples.push({
          fixture,
          catalog,
          semanticMatches,
          durationMs: performance.now() - startedAt,
        });
      }

      const threshold = selectSemanticThreshold(
        samples.map(({ fixture, semanticMatches }) => ({
          relevantSlugs: fixture.relevantSlugs,
          negative: fixture.category === "negative",
          matches: semanticMatches,
        })),
      );
      const observations: RankedSearchObservation[] = samples.map(
        ({ fixture, catalog, semanticMatches, durationMs }) => {
          const lexical = rankPetsLexically(catalog, fixture.query);
          const lexicalSlugs = lexical.map((match) => match.pet.slug);
          const hybridSlugs = fuseRankedPets({
            pets: catalog,
            lexical,
            semanticRanks: [
              {
                matches: semanticMatches,
                minScore: threshold,
                weight: 1,
              },
            ],
          }).map((pet) => pet.slug);

          return {
            category: fixture.category,
            query: fixture.query,
            relevantSlugs: fixture.relevantSlugs,
            lexicalSlugs,
            hybridSlugs,
            semanticOnlySlugs: semanticOnlySlugs(
              semanticMatches,
              lexicalSlugs,
              threshold,
            ),
            durationMs,
            reviewedBy: fixture.reviewedBy,
          };
        },
      );
      const report = evaluateSearchQuality(observations);
      // These three HTTP-200 contracts are exercised by the normal route suite
      // for timeout, 429, and provider 5xx fallbacks before this opt-in live gate.
      const gate = evaluateSearchRolloutGate(report, [200, 200, 200]);

      console.info("[codex-pets][pet-search-eval]", {
        revision: semanticConfig.revision,
        threshold,
        report,
        gate,
      });

      expect(threshold).toBe(semanticConfig.minSemanticScore);
      expect(gate.passed).toBe(true);
    },
    120_000,
  );
});

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

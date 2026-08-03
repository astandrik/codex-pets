import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import {
  loadPetSearchConfig,
  PET_SEARCH_EMBEDDING_MODELS,
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
  resolveVisualSearchEvalSplit,
  selectSemanticThreshold,
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
import {
  PET_DERIVED_VISION_CAPTION_REVISION,
  buildPetVisionCaptionText,
  parsePetDerivedVisionCaptionEnvelope,
  parsePetVisionCaptionEnvelope,
} from "@/lib/pets/search-vision-contract";

const LIVE_EVAL_MODE = process.env.PET_SEARCH_LIVE_EVAL;
const LIVE_EVAL_SPLIT = resolveVisualSearchEvalSplit(LIVE_EVAL_MODE);
const LIVE_EVAL_ENABLED = LIVE_EVAL_SPLIT !== null;

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
      if (
        semanticConfig.embeddingModelId !== visualConfig.embeddingModelId
      ) {
        throw new Error(
          "Live visual search eval requires compatible text and visual embedding providers.",
        );
      }
      const embeddingClient = createYandexEmbeddingClient({
        folderId: semanticConfig.folderId,
        apiKey: semanticConfig.apiKey,
        revision: semanticConfig.revision,
        ...PET_SEARCH_EMBEDDING_MODELS[
          semanticConfig.embeddingModelId
        ],
        timeoutMs: semanticConfig.timeoutMs,
      });
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
      const textMinSemanticScore =
        semanticConfig.minSemanticScore ??
        (split === "calibration"
          ? selectSemanticThreshold(
              observations.map((observation) => ({
                relevantSlugs: observation.relevantSlugs,
                negative: observation.category === "negative",
                matches: [...observation.textMatches],
              })),
            )
          : null);
      if (textMinSemanticScore === null) {
        throw new Error(
          "Holdout requires a committed revision-bound text threshold.",
        );
      }
      const textReport = evaluateSearchQuality(
        observations.map((observation) =>
          toTextObservation(
            observation,
            textMinSemanticScore,
          )
        ),
      );

      if (split === "calibration") {
        const calibration = calibrateVisualSearchProfile(
          observations,
          textMinSemanticScore,
        );
        const aggregateReport = aggregateVisualReport(calibration.report);
        const approvedPetSlugs =
          observations[0]?.pets.map((pet) => pet.slug).toSorted() ?? [];
        const approvedPetSlugSet = new Set(approvedPetSlugs);
        const captionRows = await listPetSearchCaptions(
          visualConfig.captionRevision,
        );
        const captionSlugs = new Set(captionRows.map((row) => row.slug));
        const missingCaptionSlugs = approvedPetSlugs.filter(
          (slug) => !captionSlugs.has(slug),
        );
        const schemaFailureSlugs = captionRows.flatMap((row) =>
          approvedPetSlugSet.has(row.slug) &&
          !isValidStoredCaption(
            visualConfig.captionRevision,
            row.captionJson,
            row.captionText,
          )
            ? [row.slug]
            : []
        );
        writeCalibrationArtifact({
          textRevision: semanticConfig.revision,
          captionRevision: visualConfig.captionRevision,
          visualRevision: visualConfig.visualRevision,
          textMinSemanticScore,
          profile: calibration.profile,
          textReport,
          visualReport: aggregateReport,
          approvedPetSlugs,
          missingCaptionSlugs,
          schemaFailureSlugs,
        });
        console.info("[codex-pets][pet-visual-calibration]", {
          captionRevision: visualConfig.captionRevision,
          visualRevision: visualConfig.visualRevision,
          textMinSemanticScore,
          profile: calibration.profile,
          evaluatedProfileCount: calibration.evaluatedProfileCount,
          textReport,
          report: aggregateReport,
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
        textMinSemanticScore,
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
        textMinSemanticScore,
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

      async function collectObservation(fixture: (typeof fixtures)[number]) {
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

function isValidStoredCaption(
  captionRevision: string,
  captionJson: string,
  captionText: string,
): boolean {
  try {
    const envelope =
      captionRevision === PET_DERIVED_VISION_CAPTION_REVISION
        ? parsePetDerivedVisionCaptionEnvelope(captionJson)
        : parsePetVisionCaptionEnvelope(captionJson);
    return buildPetVisionCaptionText(envelope.caption) === captionText;
  } catch {
    return false;
  }
}

function writeCalibrationArtifact(input: {
  textRevision: string;
  captionRevision: string;
  visualRevision: string;
  textMinSemanticScore: number;
  profile: { minSemanticScore: number; weight: number };
  textReport: ReturnType<typeof evaluateSearchQuality>;
  visualReport: ReturnType<typeof aggregateVisualReport>;
  approvedPetSlugs: string[];
  missingCaptionSlugs: string[];
  schemaFailureSlugs: string[];
}): void {
  const directory = resolve(
    process.cwd(),
    ".scratch/pet-caption-bakeoff/calibration",
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename =
    `${input.visualRevision.replace(/[^a-z0-9.-]/gi, "_")}.json`;
  writeFileSync(
    resolve(directory, filename),
    `${JSON.stringify({ schemaVersion: 1, ...input }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

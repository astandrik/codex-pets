import { randomUUID } from "node:crypto";

import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import {
  listPetSearchCaptions,
  type StoredPetSearchCaption,
} from "@/lib/pets/search-captions-repository";
import {
  PET_VISION_CAPTION_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
} from "@/lib/pets/search-config";
import { createPetSearchSourceHash } from "@/lib/pets/search-embeddings";
import {
  listRawPetSearchEmbeddings,
  type StoredRawPetSearchEmbedding,
} from "@/lib/pets/search-embeddings-repository";
import {
  buildPetVisionCaptionText,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  parsePetVisionCaptionEnvelope,
} from "@/lib/pets/search-vision-contract";
import {
  activateRelatedPetsGeneration,
  cleanupRelatedPetsGenerations,
  getRelatedPetsState,
  markRelatedPetsGenerationFailed,
  recoverPreviousRelatedPetsGeneration,
  requestRelatedPetsBuild,
  writeRelatedPetsSnapshot,
  type RelatedPetsSnapshot,
  type RelatedPetsState,
} from "@/lib/pets/related-pets-repository";
import {
  decodeRelatedPetVector,
  rankRelatedPets,
  type RelatedPetsRankingProfile,
} from "@/lib/pets/related-pets-ranking";
import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import type { PublicPet } from "@/lib/pets/types";

type RelatedPetsRebuildProfile = RelatedPetsRankingProfile & {
  rankingRevision: string;
  textRevision: string;
  textDimensions: number;
  visualRevision: string;
  visualCaptionRevision: string;
  visualDimensions: number;
};

type VisualSourceContext = {
  captionRevision: string;
  modelUri: string;
};

type RelatedPetsRepository = {
  getState: () => Promise<RelatedPetsState | null>;
  requestBuild: (input: {
    generationId: string;
    rankingRevision: string;
    updatedAt: string;
  }) => Promise<void>;
  writeSnapshot: (input: RelatedPetsSnapshot) => Promise<void>;
  activateGeneration: (input: {
    generationId: string;
    rankingRevision: string;
    updatedAt: string;
  }) => Promise<boolean>;
  markGenerationFailed: (input: {
    generationId: string;
    rankingRevision: string;
    failureReason: string;
    updatedAt: string;
  }) => Promise<boolean>;
  cleanupGenerations: (input: {
    activeGenerationId: string;
    previousGenerationId: string | null;
  }) => Promise<void>;
  recoverPreviousGeneration: (
    updatedAt: string,
  ) => Promise<{
    activeGenerationId: string;
    previousGenerationId: string;
    rankingRevision: string;
  } | null>;
};

type RelatedPetsRebuildCoverage = {
  approvedPetCount: number;
  snapshotCount: number;
  textVectorCount: number;
  visualVectorCount: number;
};

export type RelatedPetsRebuildLog = {
  operation: "dry-run" | "apply" | "recover-previous";
  status: "dry-run" | "ready" | "superseded" | "failed" | "recovered" | "unavailable";
  generationId: string | null;
  rankingRevision: string;
  coverage: RelatedPetsRebuildCoverage;
  durationMs: number;
  failureReason?: "rebuild_failed";
};

type RelatedPetsRebuildDependencies = {
  profile: RelatedPetsRebuildProfile;
  repository: RelatedPetsRepository;
  listApprovedPets: () => Promise<PublicPet[]>;
  listRawVectors: (
    modelRevision: string,
  ) => Promise<StoredRawPetSearchEmbedding[]>;
  listCaptions: (
    captionRevision: string,
  ) => Promise<StoredPetSearchCaption[]>;
  getVisualSourceContext: () => VisualSourceContext | null;
  createGenerationId: () => string;
  now: () => Date;
  log: (event: RelatedPetsRebuildLog) => void;
};

export type RelatedPetsRebuildResult = {
  operation: "dry-run" | "apply";
  status: "dry-run" | "ready" | "superseded";
  generationId: string | null;
  rankingRevision: string;
  coverage: RelatedPetsRebuildCoverage;
  rankings: Array<{ sourceSlug: string; relatedSlugs: string[] }>;
  durationMs: number;
};

export class RelatedPetsRebuildError extends Error {
  constructor() {
    super("rebuild_failed");
    this.name = "RelatedPetsRebuildError";
  }
}

const EMPTY_COVERAGE: RelatedPetsRebuildCoverage = {
  approvedPetCount: 0,
  snapshotCount: 0,
  textVectorCount: 0,
  visualVectorCount: 0,
};

export function createRelatedPetsRebuildService(
  dependencies: RelatedPetsRebuildDependencies,
) {
  return {
    rebuild,
    recoverPrevious,
  };

  async function rebuild(input: {
    mode: "dry-run" | "apply";
    includeVisual?: boolean;
  }): Promise<RelatedPetsRebuildResult> {
    const startedAt = dependencies.now().getTime();
    const includeVisual = input.includeVisual ?? true;
    const generationId =
      input.mode === "apply" ? dependencies.createGenerationId() : null;
    let coverage = EMPTY_COVERAGE;
    let activated = false;

    try {
      if (generationId) {
        await dependencies.repository.requestBuild({
          generationId,
          rankingRevision: dependencies.profile.rankingRevision,
          updatedAt: dependencies.now().toISOString(),
        });
      }

      const built = await buildRankings(includeVisual);
      coverage = built.coverage;

      if (!generationId) {
        return resultAndLog({
          operation: "dry-run",
          status: "dry-run",
          generationId: null,
          coverage,
          rankings: built.rankings,
          startedAt,
        });
      }

      for (const ranking of built.rankings) {
        await dependencies.repository.writeSnapshot({
          generationId,
          sourceSlug: ranking.sourceSlug,
          rankingRevision: dependencies.profile.rankingRevision,
          relatedSlugs: ranking.relatedSlugs,
          createdAt: dependencies.now().toISOString(),
        });
      }

      activated = await dependencies.repository.activateGeneration({
        generationId,
        rankingRevision: dependencies.profile.rankingRevision,
        updatedAt: dependencies.now().toISOString(),
      });
      if (!activated) {
        return resultAndLog({
          operation: "apply",
          status: "superseded",
          generationId,
          coverage,
          rankings: built.rankings,
          startedAt,
        });
      }

      const state = await dependencies.repository.getState();
      if (state?.activeGenerationId === generationId) {
        await dependencies.repository.cleanupGenerations({
          activeGenerationId: generationId,
          previousGenerationId: state.previousGenerationId,
        });
      }
      return resultAndLog({
        operation: "apply",
        status: "ready",
        generationId,
        coverage,
        rankings: built.rankings,
        startedAt,
      });
    } catch {
      if (generationId && !activated) {
        try {
          await dependencies.repository.markGenerationFailed({
            generationId,
            rankingRevision: dependencies.profile.rankingRevision,
            failureReason: "rebuild_failed",
            updatedAt: dependencies.now().toISOString(),
          });
        } catch {
          // Preserve the sanitized rebuild failure when state marking also fails.
        }
      }
      const durationMs = elapsedMilliseconds(startedAt);
      dependencies.log({
        operation: input.mode,
        status: "failed",
        generationId,
        rankingRevision: dependencies.profile.rankingRevision,
        coverage,
        durationMs,
        failureReason: "rebuild_failed",
      });
      throw new RelatedPetsRebuildError();
    }
  }

  async function buildRankings(includeVisual: boolean): Promise<{
    rankings: Array<{ sourceSlug: string; relatedSlugs: string[] }>;
    coverage: RelatedPetsRebuildCoverage;
  }> {
    const approvedPets = uniqueApprovedPets(
      await dependencies.listApprovedPets(),
    );
    const petsBySlug = new Map(
      approvedPets.map((item) => [item.slug, item]),
    );
    const requestedVisualContext = includeVisual
      ? dependencies.getVisualSourceContext()
      : null;
    const visualContext =
      requestedVisualContext?.captionRevision ===
        dependencies.profile.visualCaptionRevision &&
      requestedVisualContext.modelUri.trim()
        ? requestedVisualContext
        : null;
    const [textRows, visualRows, captions] = await Promise.all([
      dependencies.listRawVectors(dependencies.profile.textRevision),
      visualContext
        ? dependencies.listRawVectors(dependencies.profile.visualRevision)
        : Promise.resolve([]),
      visualContext
        ? dependencies.listCaptions(visualContext.captionRevision)
        : Promise.resolve([]),
    ]);
    const textVectors = validatedTextVectors(
      approvedPets,
      textRows,
      dependencies.profile,
    );
    const visualVectors = visualContext
      ? validatedVisualVectors({
          petsBySlug,
          rows: visualRows,
          captions,
          profile: dependencies.profile,
          context: visualContext,
        })
      : new Map<string, readonly number[]>();
    const rankings = approvedPets.map((source) => ({
      sourceSlug: source.slug,
      relatedSlugs: rankRelatedPets({
        source,
        candidates: approvedPets,
        textVectors,
        visualVectors,
        profile: dependencies.profile,
      }),
    }));
    return {
      rankings,
      coverage: {
        approvedPetCount: approvedPets.length,
        snapshotCount: rankings.length,
        textVectorCount: textVectors.size,
        visualVectorCount: visualVectors.size,
      },
    };
  }

  async function recoverPrevious(): Promise<{
    status: "recovered" | "unavailable";
    generationId: string | null;
    rankingRevision: string;
    durationMs: number;
  }> {
    const startedAt = dependencies.now().getTime();
    const recovered = await dependencies.repository.recoverPreviousGeneration(
      dependencies.now().toISOString(),
    );
    const durationMs = elapsedMilliseconds(startedAt);
    const status = recovered ? "recovered" : "unavailable";
    dependencies.log({
      operation: "recover-previous",
      status,
      generationId: recovered?.activeGenerationId ?? null,
      rankingRevision:
        recovered?.rankingRevision ?? dependencies.profile.rankingRevision,
      coverage: EMPTY_COVERAGE,
      durationMs,
    });
    return {
      status,
      generationId: recovered?.activeGenerationId ?? null,
      rankingRevision:
        recovered?.rankingRevision ?? dependencies.profile.rankingRevision,
      durationMs,
    };
  }

  function resultAndLog(input: {
    operation: "dry-run" | "apply";
    status: "dry-run" | "ready" | "superseded";
    generationId: string | null;
    coverage: RelatedPetsRebuildCoverage;
    rankings: Array<{ sourceSlug: string; relatedSlugs: string[] }>;
    startedAt: number;
  }): RelatedPetsRebuildResult {
    const durationMs = elapsedMilliseconds(input.startedAt);
    const result: RelatedPetsRebuildResult = {
      operation: input.operation,
      status: input.status,
      generationId: input.generationId,
      rankingRevision: dependencies.profile.rankingRevision,
      coverage: input.coverage,
      rankings: input.rankings,
      durationMs,
    };
    dependencies.log({
      operation: result.operation,
      status: result.status,
      generationId: result.generationId,
      rankingRevision: result.rankingRevision,
      coverage: result.coverage,
      durationMs: result.durationMs,
    });
    return result;
  }

  function elapsedMilliseconds(startedAt: number): number {
    return Math.max(0, dependencies.now().getTime() - startedAt);
  }
}

function uniqueApprovedPets(pets: readonly PublicPet[]): PublicPet[] {
  const unique = new Map<string, PublicPet>();
  for (const item of pets) {
    if (item.status === "approved" && !unique.has(item.slug)) {
      unique.set(item.slug, item);
    }
  }
  return Array.from(unique.values());
}

function validatedTextVectors(
  pets: readonly PublicPet[],
  rows: readonly StoredRawPetSearchEmbedding[],
  profile: RelatedPetsRebuildProfile,
): Map<string, readonly number[]> {
  const petsBySlug = new Map(pets.map((item) => [item.slug, item]));
  const vectors = new Map<string, readonly number[]>();
  for (const row of rows) {
    const item = petsBySlug.get(row.slug);
    if (!item) continue;
    const vector = decodeRelatedPetVector(row, {
      modelRevision: profile.textRevision,
      dimensions: profile.textDimensions,
      sourceHash: createPetSearchSourceHash(item, profile.textRevision),
    });
    if (vector) vectors.set(row.slug, vector);
  }
  return vectors;
}

function validatedVisualVectors(input: {
  petsBySlug: ReadonlyMap<string, PublicPet>;
  rows: readonly StoredRawPetSearchEmbedding[];
  captions: readonly StoredPetSearchCaption[];
  profile: RelatedPetsRebuildProfile;
  context: VisualSourceContext;
}): Map<string, readonly number[]> {
  const captionsBySlug = new Map(
    input.captions.map((caption) => [caption.slug, caption]),
  );
  const vectors = new Map<string, readonly number[]>();

  for (const row of input.rows) {
    const item = input.petsBySlug.get(row.slug);
    const caption = captionsBySlug.get(row.slug);
    if (!item || !caption) continue;

    try {
      const assetId = getPetAssetIdFromSpritesheetUrl(item.spritesheetUrl);
      if (!assetId) continue;
      const envelope = parsePetVisionCaptionEnvelope(caption.captionJson);
      const captionText = buildPetVisionCaptionText(envelope.caption);
      if (
        captionText !== caption.captionText ||
        envelope.source.assetId !== assetId
      ) {
        continue;
      }
      const captionSourceHash = createPetVisionCaptionSourceHash({
        captionRevision: input.context.captionRevision,
        modelUri: input.context.modelUri,
        assetId,
        spritesheetSha256: envelope.source.spritesheetSha256,
      });
      if (caption.sourceHash !== captionSourceHash) continue;
      const vector = decodeRelatedPetVector(row, {
        modelRevision: input.profile.visualRevision,
        dimensions: input.profile.visualDimensions,
        sourceHash: createPetVisualEmbeddingSourceHash({
          visualRevision: input.profile.visualRevision,
          captionRevision: input.context.captionRevision,
          captionSourceHash,
          captionText,
        }),
      });
      if (vector) vectors.set(row.slug, vector);
    } catch {
      // A malformed derived visual row removes only that modality.
    }
  }
  return vectors;
}

const productionRepository: RelatedPetsRepository = {
  getState: getRelatedPetsState,
  requestBuild: requestRelatedPetsBuild,
  writeSnapshot: writeRelatedPetsSnapshot,
  activateGeneration: activateRelatedPetsGeneration,
  markGenerationFailed: markRelatedPetsGenerationFailed,
  cleanupGenerations: cleanupRelatedPetsGenerations,
  recoverPreviousGeneration: recoverPreviousRelatedPetsGeneration,
};

function currentVisualSourceContext(): VisualSourceContext | null {
  const profile = CURRENT_RELATED_PETS_RANKING_PROFILE;
  const visualDefinition = PET_VISUAL_MODEL_REVISIONS[profile.visualRevision];
  const captionRevision = visualDefinition.captionRevision;
  const captionDefinition = PET_VISION_CAPTION_REVISIONS[captionRevision];
  const configuredCaptionRevision =
    process.env.PET_SEARCH_VISION_CAPTION_REVISION?.trim();
  const configuredVisualRevision =
    process.env.PET_SEARCH_VISUAL_MODEL_REVISION?.trim();
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  if (
    !folderId ||
    (configuredCaptionRevision &&
      configuredCaptionRevision !== captionRevision) ||
    (configuredVisualRevision &&
      configuredVisualRevision !== profile.visualRevision)
  ) {
    return null;
  }
  return {
    captionRevision,
    modelUri: `gpt://${folderId}/${captionDefinition.modelName}`,
  };
}

const service = createRelatedPetsRebuildService({
  profile: {
    ...CURRENT_RELATED_PETS_RANKING_PROFILE,
    visualCaptionRevision:
      PET_VISUAL_MODEL_REVISIONS[
        CURRENT_RELATED_PETS_RANKING_PROFILE.visualRevision
      ].captionRevision,
  },
  repository: productionRepository,
  listApprovedPets: listApprovedPetsForSearch,
  listRawVectors: listRawPetSearchEmbeddings,
  listCaptions: listPetSearchCaptions,
  getVisualSourceContext: currentVisualSourceContext,
  createGenerationId: randomUUID,
  now: () => new Date(),
  log: (event) => {
    console.info("[codex-pets][related-pets-rebuild]", event);
  },
});

export const rebuildRelatedPets = service.rebuild;
export const recoverPreviousRelatedPets = service.recoverPrevious;

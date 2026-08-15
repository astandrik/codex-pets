import { randomUUID } from "node:crypto";

import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import {
  RELATED_PETS_ANNOTATION_MODEL_NAME,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationEmbeddingSourceHash,
  createRelatedPetAnnotationSourceHash,
  parseResolvedRelatedPetAnnotation,
  type ResolvedRelatedPetAnnotation,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import type { StoredRelatedPetAnnotation } from "@/lib/pets/related-pets-annotations-repository";
import {
  listPetSearchCaptions,
  type StoredPetSearchCaption,
} from "@/lib/pets/search-captions-repository";
import {
  PET_VISION_CAPTION_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
} from "@/lib/pets/search-config";
import {
  createRelatedPetDocumentSourceHash,
  createRelatedPetQuerySourceHash,
} from "@/lib/pets/search-embeddings";
import {
  listRawPetSearchEmbeddings,
  type StoredRawPetSearchEmbedding,
} from "@/lib/pets/search-embeddings-repository";
import {
  PET_VISION_CAPTION_REVISION,
  PET_VISUAL_MODEL_REVISION,
  buildPetVisionCaptionText,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  parsePetVisionCaptionEnvelope,
} from "@/lib/pets/search-vision-contract";
import {
  activateRelatedPetsGeneration,
  cleanupInactiveRelatedPetsGeneration,
  cleanupRelatedPetsGenerations,
  getRelatedPetsRankingInputRevision,
  getRelatedPetsState,
  markRelatedPetsGenerationFailed,
  recoverPreviousRelatedPetsGeneration,
  requestRelatedPetsBuild,
  writeRelatedPetsSnapshot,
  type RecoverPreviousRelatedPetsGenerationInput,
  type RecoverPreviousRelatedPetsGenerationResult,
  type RelatedPetsRankingInputScope,
  type RelatedPetsSnapshot,
  type RelatedPetsState,
} from "@/lib/pets/related-pets-repository";
import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";
import {
  decodeRelatedPetV24Vector,
  rankRelatedPetsV24,
  type RelatedPetsV24RankingProfile,
} from "@/lib/pets/related-pets-v24-ranking";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-v24-profile";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import type { PublicPet } from "@/lib/pets/types";
import { isYdbConfigured } from "@/lib/ydb/client";

export type RelatedPetsRebuildProfile = RelatedPetsV24RankingProfile & {
  rankingRevision: string;
  textRevision: string;
  textQueryRevision: string;
  textDimensions: number;
  annotationRevision: string;
  annotationDocumentRevision: string;
  annotationQueryRevision: string;
  annotationDimensions: number;
  visualRevision: string;
  visualCaptionRevision: string;
  visualDimensions: number;
};

export type VisualSourceContext = {
  captionRevision: string;
  modelUri: string;
};

type RelatedPetsRepository = {
  requestBuild: (input: {
    generationId: string;
    rankingRevision: string;
    updatedAt: string;
    expectedState: RelatedPetsState | null;
    inputScope: RelatedPetsRankingInputScope;
    expectedInputRevision: string;
  }) => Promise<boolean>;
  writeSnapshot: (input: RelatedPetsSnapshot) => Promise<void>;
  activateGeneration: (input: {
    generationId: string;
    rankingRevision: string;
    updatedAt: string;
    inputScope: RelatedPetsRankingInputScope;
    expectedInputRevision: string;
    previousState: RelatedPetsState | null;
  }) => Promise<boolean>;
  markGenerationFailed: (input: {
    generationId: string;
    rankingRevision: string;
    failureReason: string;
    updatedAt: string;
  }) => Promise<boolean>;
  cleanupGenerations: (input: {
    expectedGenerationId: string;
  }) => Promise<boolean>;
  cleanupInactiveGeneration: (input: {
    expectedGenerationId: string;
  }) => Promise<boolean>;
  getState: () => Promise<RelatedPetsState | null>;
  getRankingInputRevision: (
    scope: RelatedPetsRankingInputScope,
  ) => Promise<string | null>;
  recoverPreviousGeneration: (
    input: RecoverPreviousRelatedPetsGenerationInput,
  ) => Promise<RecoverPreviousRelatedPetsGenerationResult | null>;
};

type RelatedPetsRebuildCoverage = {
  approvedPetCount: number;
  snapshotCount: number;
  textVectorCount: number;
  annotationCount: number;
  annotationVectorCount: number;
  visualVectorCount: number;
};

export type RelatedPetsInvalidationReason = "text_profile_incompatible";

type RelatedPetsRebuildFailureReason =
  | "rebuild_failed"
  | "storage_unavailable"
  | "text_vectors_incomplete"
  | "annotations_incomplete"
  | "annotation_vectors_incomplete"
  | "visual_vectors_incomplete";

export type RelatedPetsRebuildLog = {
  operation: "dry-run" | "apply" | "invalidate" | "recover-previous";
  status:
    | "dry-run"
    | "ready"
    | "superseded"
    | "failed"
    | "invalidated"
    | "recovered"
    | "unavailable";
  generationId: string | null;
  rankingRevision: string;
  coverage: RelatedPetsRebuildCoverage;
  durationMs: number;
  failureReason?: RelatedPetsRebuildFailureReason | RelatedPetsInvalidationReason;
  cleanupStatus?: "failed";
};

type RelatedPetsRebuildDependencies = {
  profile: RelatedPetsRebuildProfile;
  repository: RelatedPetsRepository;
  isStorageAvailable: () => boolean;
  listApprovedPets: () => Promise<PublicPet[]>;
  listRawVectors: (
    modelRevision: string,
  ) => Promise<StoredRawPetSearchEmbedding[]>;
  listCaptions: (
    captionRevision: string,
  ) => Promise<StoredPetSearchCaption[]>;
  listAnnotations: (
    annotationRevision: string,
  ) => Promise<StoredRelatedPetAnnotation[]>;
  getAnnotationModelUri: () => string | null;
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

export type RelatedPetsInvalidationResult = {
  operation: "invalidate";
  status: "invalidated" | "superseded";
  generationId: string;
  rankingRevision: string;
  failureReason: RelatedPetsInvalidationReason;
  durationMs: number;
};

export class RelatedPetsRebuildError extends Error {
  constructor(
    public readonly reason: RelatedPetsRebuildFailureReason = "rebuild_failed",
  ) {
    super(reason);
    this.name = "RelatedPetsRebuildError";
  }
}

const EMPTY_COVERAGE: RelatedPetsRebuildCoverage = {
  approvedPetCount: 0,
  snapshotCount: 0,
  textVectorCount: 0,
  annotationCount: 0,
  annotationVectorCount: 0,
  visualVectorCount: 0,
};

export function createRelatedPetsRebuildService(
  dependencies: RelatedPetsRebuildDependencies,
) {
  return {
    rebuild,
    prepareGeneration,
    invalidate,
    recoverPrevious,
  };

  async function prepareGeneration(input: {
    generationId: string;
    candidatePets: readonly PublicPet[];
    includeVisual?: boolean;
  }): Promise<{
    generationId: string;
    rankingRevision: string;
    coverage: RelatedPetsRebuildCoverage;
    rankings: Array<{ sourceSlug: string; relatedSlugs: string[] }>;
    inputScope: RelatedPetsRankingInputScope;
    expectedInputRevision: string;
  }> {
    if (!dependencies.isStorageAvailable()) {
      throw new RelatedPetsRebuildError("storage_unavailable");
    }
    const includeVisual = input.includeVisual ?? true;
    const inputScope = createRankingInputScope(includeVisual);
    const expectedInputRevision = await dependencies.repository
      .getRankingInputRevision(inputScope);
    if (!expectedInputRevision) {
      throw new RelatedPetsRebuildError("storage_unavailable");
    }
    const { rankings, coverage } = await buildRankings(
      includeVisual,
      input.candidatePets,
    );
    const createdAt = dependencies.now().toISOString();
    for (const ranking of rankings) {
      await dependencies.repository.writeSnapshot({
        generationId: input.generationId,
        sourceSlug: ranking.sourceSlug,
        rankingRevision: dependencies.profile.rankingRevision,
        relatedSlugs: ranking.relatedSlugs,
        createdAt,
      });
    }
    const currentInputRevision = await dependencies.repository
      .getRankingInputRevision(inputScope);
    if (currentInputRevision !== expectedInputRevision) {
      throw new RelatedPetsRebuildError("rebuild_failed");
    }
    return {
      generationId: input.generationId,
      rankingRevision: dependencies.profile.rankingRevision,
      coverage,
      rankings,
      inputScope,
      expectedInputRevision,
    };
  }

  async function rebuild(input: {
    mode: "dry-run" | "apply";
    includeVisual?: boolean;
  }): Promise<RelatedPetsRebuildResult> {
    const startedAt = dependencies.now().getTime();
    const includeVisual = input.includeVisual ?? true;
    let generationId: string | null = null;
    let coverage = EMPTY_COVERAGE;
    let activated = false;

    try {
      if (!dependencies.isStorageAvailable()) {
        throw new RelatedPetsRebuildError("storage_unavailable");
      }

      const inputScope = createRankingInputScope(includeVisual);
      const [expectedState, expectedInputRevision] =
        input.mode === "apply"
          ? await Promise.all([
              dependencies.repository.getState(),
              dependencies.repository.getRankingInputRevision(inputScope),
            ])
          : [null, null];
      const built = await buildRankings(includeVisual);
      coverage = built.coverage;

      if (input.mode === "dry-run") {
        return resultAndLog({
          operation: "dry-run",
          status: "dry-run",
          generationId: null,
          coverage,
          rankings: built.rankings,
          startedAt,
        });
      }

      if (expectedInputRevision === null) {
        throw new RelatedPetsRebuildError("storage_unavailable");
      }

      generationId = dependencies.createGenerationId();
      const requested = await dependencies.repository.requestBuild({
        generationId,
        rankingRevision: dependencies.profile.rankingRevision,
        updatedAt: dependencies.now().toISOString(),
        expectedState,
        inputScope,
        expectedInputRevision,
      });
      if (!requested) {
        return resultAndLog({
          operation: "apply",
          status: "superseded",
          generationId,
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

      try {
        activated = await dependencies.repository.activateGeneration({
          generationId,
          rankingRevision: dependencies.profile.rankingRevision,
          updatedAt: dependencies.now().toISOString(),
          inputScope,
          expectedInputRevision,
          previousState: expectedState,
        });
      } catch (error) {
        let persistedState: RelatedPetsState | null = null;
        try {
          persistedState = await dependencies.repository.getState();
        } catch {
          // Preserve the original activation failure if reconciliation also fails.
        }
        if (
          persistedState?.status !== "ready" ||
          persistedState.requestedGenerationId !== generationId ||
          persistedState.activeGenerationId !== generationId ||
          persistedState.rankingRevision !==
            dependencies.profile.rankingRevision
        ) {
          throw error;
        }
        activated = true;
      }
      if (!activated) {
        const cleanupStatus = await cleanupInactiveGeneration(generationId);
        return resultAndLog({
          operation: "apply",
          status: "superseded",
          generationId,
          coverage,
          rankings: built.rankings,
          startedAt,
          cleanupStatus,
        });
      }

      let cleanupStatus: "failed" | undefined;
      try {
        const cleaned = await dependencies.repository.cleanupGenerations({
          expectedGenerationId: generationId,
        });
        if (!cleaned) {
          return resultAndLog({
            operation: "apply",
            status: "superseded",
            generationId,
            coverage,
            rankings: built.rankings,
            startedAt,
          });
        }
      } catch {
        cleanupStatus = "failed";
      }
      return resultAndLog({
        operation: "apply",
        status: "ready",
        generationId,
        coverage,
        rankings: built.rankings,
        startedAt,
        cleanupStatus,
      });
    } catch (error) {
      const failureReason =
        error instanceof RelatedPetsRebuildError
          ? error.reason
          : "rebuild_failed";
      let cleanupStatus: "failed" | undefined;
      if (generationId && !activated) {
        try {
          await dependencies.repository.markGenerationFailed({
            generationId,
            rankingRevision: dependencies.profile.rankingRevision,
            failureReason,
            updatedAt: dependencies.now().toISOString(),
          });
        } catch {
          // Preserve the sanitized rebuild failure when state marking also fails.
        }
        cleanupStatus = await cleanupInactiveGeneration(generationId);
      }
      const durationMs = elapsedMilliseconds(startedAt);
      dependencies.log({
        operation: input.mode,
        status: "failed",
        generationId,
        rankingRevision: dependencies.profile.rankingRevision,
        coverage,
        durationMs,
        failureReason,
        cleanupStatus,
      });
      throw new RelatedPetsRebuildError(failureReason);
    }
  }

  async function cleanupInactiveGeneration(
    generationId: string,
  ): Promise<"failed" | undefined> {
    try {
      const cleaned =
        await dependencies.repository.cleanupInactiveGeneration({
          expectedGenerationId: generationId,
        });
      return cleaned ? undefined : "failed";
    } catch {
      return "failed";
    }
  }

  async function buildRankings(
    includeVisual: boolean,
    candidatePets?: readonly PublicPet[],
  ): Promise<{
    rankings: Array<{ sourceSlug: string; relatedSlugs: string[] }>;
    coverage: RelatedPetsRebuildCoverage;
  }> {
    const requestedVisualContext = includeVisual
      ? dependencies.getVisualSourceContext()
      : null;
    const visualContext =
      requestedVisualContext?.captionRevision ===
        dependencies.profile.visualCaptionRevision &&
      requestedVisualContext.modelUri.trim()
        ? requestedVisualContext
        : null;
    const pets = candidatePets ?? await dependencies.listApprovedPets();
    const annotationProfile = getAnnotationProfile(dependencies.profile);
    const annotationModelUri = dependencies.getAnnotationModelUri();
    if (!annotationModelUri) {
      throw new RelatedPetsRebuildError("annotations_incomplete");
    }
    const [
      textQueryRows,
      textRows,
      annotationQueryRows,
      annotationRows,
      annotations,
      visualRows,
      captions,
    ] =
      await Promise.all([
        dependencies.listRawVectors(dependencies.profile.textQueryRevision),
        dependencies.listRawVectors(dependencies.profile.textRevision),
        dependencies.listRawVectors(annotationProfile.annotationQueryRevision),
        dependencies.listRawVectors(
          annotationProfile.annotationDocumentRevision,
        ),
        dependencies.listAnnotations(annotationProfile.annotationRevision),
        visualContext
          ? dependencies.listRawVectors(dependencies.profile.visualRevision)
          : Promise.resolve([]),
        visualContext
          ? dependencies.listCaptions(visualContext.captionRevision)
          : Promise.resolve([]),
      ]);
    const prepared = prepareRelatedPetsRankingInputs({
      pets,
      textQueryRows,
      textRows,
      annotationQueryRows,
      annotationRows,
      annotations,
      annotationModelUri,
      visualRows,
      captions,
      profile: dependencies.profile,
      visualContext,
    });
    const textVectorCount = prepared.approvedPets.filter(
      ({ slug }) =>
        prepared.textQueryVectors.has(slug) &&
        prepared.textDocumentVectors.has(slug),
    ).length;
    if (textVectorCount !== prepared.approvedPets.length) {
      throw new RelatedPetsRebuildError("text_vectors_incomplete");
    }
    const annotationCount = prepared.annotations.size;
    if (annotationCount !== prepared.approvedPets.length) {
      throw new RelatedPetsRebuildError("annotations_incomplete");
    }
    const annotationVectorCount = prepared.approvedPets.filter(
      ({ slug }) =>
        prepared.annotationQueryVectors.has(slug) &&
        prepared.annotationDocumentVectors.has(slug),
    ).length;
    if (annotationVectorCount !== prepared.approvedPets.length) {
      throw new RelatedPetsRebuildError("annotation_vectors_incomplete");
    }
    if (
      includeVisual &&
      dependencies.profile.visualMinSimilarity !== null &&
      prepared.visualVectors.size !== prepared.approvedPets.length
    ) {
      throw new RelatedPetsRebuildError("visual_vectors_incomplete");
    }
    const rankings = prepared.approvedPets.map((source) => ({
      sourceSlug: source.slug,
      relatedSlugs: rankRelatedPetsV24({
        source,
        candidates: prepared.approvedPets,
        textQueryVectors: prepared.textQueryVectors,
        textDocumentVectors: prepared.textDocumentVectors,
        annotationQueryVectors: prepared.annotationQueryVectors,
        annotationDocumentVectors: prepared.annotationDocumentVectors,
        annotations: prepared.annotations,
        visualVectors: prepared.visualVectors,
        profile: dependencies.profile,
        limit: RELATED_PETS_SNAPSHOT_DEPTH,
      }),
    }));
    const approvedSlugs = new Set(
      prepared.approvedPets.map(({ slug }) => slug),
    );
    const expectedRankingDepth = Math.min(
      RELATED_PETS_SNAPSHOT_DEPTH,
      Math.max(0, prepared.approvedPets.length - 1),
    );
    if (
      rankings.some(({ sourceSlug, relatedSlugs }) =>
        relatedSlugs.length !== expectedRankingDepth ||
        new Set(relatedSlugs).size !== relatedSlugs.length ||
        relatedSlugs.includes(sourceSlug) ||
        relatedSlugs.some((slug) => !approvedSlugs.has(slug)),
      )
    ) {
      throw new RelatedPetsRebuildError("rebuild_failed");
    }
    return {
      rankings,
      coverage: {
        approvedPetCount: prepared.approvedPets.length,
        snapshotCount: rankings.length,
        textVectorCount,
        annotationCount,
        annotationVectorCount,
        visualVectorCount: prepared.visualVectors.size,
      },
    };
  }

  function createRankingInputScope(
    includeVisual: boolean,
  ): RelatedPetsRankingInputScope {
    const includeVisualInputs =
      includeVisual && dependencies.profile.visualMinSimilarity !== null;
    const annotationProfile = getAnnotationProfile(dependencies.profile);
    return {
      embeddingModelRevisions: [
        dependencies.profile.textQueryRevision,
        dependencies.profile.textRevision,
        annotationProfile.annotationQueryRevision,
        annotationProfile.annotationDocumentRevision,
        ...(includeVisualInputs ? [dependencies.profile.visualRevision] : []),
      ],
      captionRevision: includeVisualInputs
        ? dependencies.profile.visualCaptionRevision
        : null,
      annotationRevision: annotationProfile.annotationRevision,
    };
  }

  async function invalidate(input: {
    failureReason: RelatedPetsInvalidationReason;
  }): Promise<RelatedPetsInvalidationResult> {
    const startedAt = dependencies.now().getTime();
    const storageAvailable = dependencies.isStorageAvailable();
    const generationId = storageAvailable
      ? dependencies.createGenerationId()
      : null;

    try {
      if (!generationId) {
        throw new RelatedPetsRebuildError("storage_unavailable");
      }
      const inputScope: RelatedPetsRankingInputScope = {
        embeddingModelRevisions: [],
        captionRevision: null,
      };
      const [expectedState, expectedInputRevision] = await Promise.all([
        dependencies.repository.getState(),
        dependencies.repository.getRankingInputRevision(inputScope),
      ]);
      if (expectedInputRevision === null) {
        throw new RelatedPetsRebuildError("storage_unavailable");
      }
      const requested = await dependencies.repository.requestBuild({
        generationId,
        rankingRevision: dependencies.profile.rankingRevision,
        updatedAt: dependencies.now().toISOString(),
        expectedState,
        inputScope,
        expectedInputRevision,
      });
      const invalidated =
        requested &&
        (await dependencies.repository.markGenerationFailed({
          generationId,
          rankingRevision: dependencies.profile.rankingRevision,
          failureReason: input.failureReason,
          updatedAt: dependencies.now().toISOString(),
        }));
      const result: RelatedPetsInvalidationResult = {
        operation: "invalidate",
        status: invalidated ? "invalidated" : "superseded",
        generationId,
        rankingRevision: dependencies.profile.rankingRevision,
        failureReason: input.failureReason,
        durationMs: elapsedMilliseconds(startedAt),
      };
      dependencies.log({
        ...result,
        coverage: EMPTY_COVERAGE,
      });
      return result;
    } catch (error) {
      const failureReason =
        error instanceof RelatedPetsRebuildError
          ? error.reason
          : "rebuild_failed";
      dependencies.log({
        operation: "invalidate",
        status: "failed",
        generationId,
        rankingRevision: dependencies.profile.rankingRevision,
        coverage: EMPTY_COVERAGE,
        durationMs: elapsedMilliseconds(startedAt),
        failureReason,
      });
      throw new RelatedPetsRebuildError(failureReason);
    }
  }

  async function recoverPrevious(input: {
    targetGenerationId: string;
    expectedActiveGenerationId: string;
  }): Promise<{
    status: "recovered" | "unavailable";
    generationId: string | null;
    rankingRevision: string;
    durationMs: number;
  }> {
    const startedAt = dependencies.now().getTime();
    try {
      if (!dependencies.isStorageAvailable()) {
        throw new RelatedPetsRebuildError("storage_unavailable");
      }
      const state = await dependencies.repository.getState();
      if (
        input.targetGenerationId !== input.expectedActiveGenerationId &&
        state?.status === "ready" &&
        state.requestedGenerationId === input.targetGenerationId &&
        state.activeGenerationId === input.targetGenerationId &&
        state.previousGenerationId === input.expectedActiveGenerationId &&
        state.rankingRevision === dependencies.profile.rankingRevision
      ) {
        return recoveryResultAndLog({
          status: "recovered",
          generationId: input.targetGenerationId,
          rankingRevision: state.rankingRevision,
          startedAt,
        });
      }
      if (
        !state?.requestedGenerationId ||
        !state.activeGenerationId ||
        input.targetGenerationId === input.expectedActiveGenerationId ||
        state.activeGenerationId !== input.expectedActiveGenerationId ||
        state.previousGenerationId !== input.targetGenerationId
      ) {
        return recoveryResultAndLog({
          status: "unavailable",
          generationId: null,
          rankingRevision:
            state?.rankingRevision ?? dependencies.profile.rankingRevision,
          startedAt,
        });
      }
      const recovered =
        await dependencies.repository.recoverPreviousGeneration({
          expectedRequestedGenerationId: state.requestedGenerationId,
          expectedStatus: state.status,
          expectedActiveGenerationId: input.expectedActiveGenerationId,
          targetPreviousGenerationId: input.targetGenerationId,
          expectedRankingRevision: dependencies.profile.rankingRevision,
          updatedAt: dependencies.now().toISOString(),
        });
      const status = recovered ? "recovered" : "unavailable";
      return recoveryResultAndLog({
        status,
        generationId: recovered?.activeGenerationId ?? null,
        rankingRevision:
          recovered?.rankingRevision ?? dependencies.profile.rankingRevision,
        startedAt,
      });
    } catch (error) {
      const failureReason =
        error instanceof RelatedPetsRebuildError
          ? error.reason
          : "rebuild_failed";
      dependencies.log({
        operation: "recover-previous",
        status: "failed",
        generationId: null,
        rankingRevision: dependencies.profile.rankingRevision,
        coverage: EMPTY_COVERAGE,
        durationMs: elapsedMilliseconds(startedAt),
        failureReason,
      });
      throw new RelatedPetsRebuildError(failureReason);
    }
  }

  function recoveryResultAndLog(input: {
    status: "recovered" | "unavailable";
    generationId: string | null;
    rankingRevision: string;
    startedAt: number;
  }): {
    status: "recovered" | "unavailable";
    generationId: string | null;
    rankingRevision: string;
    durationMs: number;
  } {
    const result = {
      status: input.status,
      generationId: input.generationId,
      rankingRevision: input.rankingRevision,
      durationMs: elapsedMilliseconds(input.startedAt),
    };
    dependencies.log({
      operation: "recover-previous",
      status: result.status,
      generationId: result.generationId,
      rankingRevision: result.rankingRevision,
      coverage: EMPTY_COVERAGE,
      durationMs: result.durationMs,
    });
    return result;
  }

  function resultAndLog(input: {
    operation: "dry-run" | "apply";
    status: "dry-run" | "ready" | "superseded";
    generationId: string | null;
    coverage: RelatedPetsRebuildCoverage;
    rankings: Array<{ sourceSlug: string; relatedSlugs: string[] }>;
    startedAt: number;
    cleanupStatus?: "failed";
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
      ...(input.cleanupStatus
        ? { cleanupStatus: input.cleanupStatus }
        : {}),
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

function getAnnotationProfile(
  profile: RelatedPetsRebuildProfile,
): {
  annotationRevision: string;
  annotationDocumentRevision: string;
  annotationQueryRevision: string;
  annotationDimensions: number;
} {
  const annotationDimensions = profile.annotationDimensions;
  if (
    !profile.annotationRevision ||
    !profile.annotationDocumentRevision ||
    !profile.annotationQueryRevision ||
    !Number.isSafeInteger(annotationDimensions) ||
    annotationDimensions <= 0
  ) {
    throw new Error("Related-pet annotation profile is incomplete.");
  }
  return {
    annotationRevision: profile.annotationRevision,
    annotationDocumentRevision: profile.annotationDocumentRevision,
    annotationQueryRevision: profile.annotationQueryRevision,
    annotationDimensions,
  };
}

export function prepareRelatedPetsRankingInputs(input: {
  pets: readonly PublicPet[];
  textQueryRows: readonly StoredRawPetSearchEmbedding[];
  textRows: readonly StoredRawPetSearchEmbedding[];
  annotationQueryRows?: readonly StoredRawPetSearchEmbedding[];
  annotationRows?: readonly StoredRawPetSearchEmbedding[];
  annotations?: readonly StoredRelatedPetAnnotation[];
  annotationModelUri?: string | null;
  visualRows: readonly StoredRawPetSearchEmbedding[];
  captions: readonly StoredPetSearchCaption[];
  profile: RelatedPetsRebuildProfile;
  visualContext: VisualSourceContext | null;
}): {
  approvedPets: PublicPet[];
  textQueryVectors: Map<string, readonly number[]>;
  textDocumentVectors: Map<string, readonly number[]>;
  annotationQueryVectors: Map<string, readonly number[]>;
  annotationDocumentVectors: Map<string, readonly number[]>;
  annotations: Map<string, ResolvedRelatedPetAnnotation>;
  visualVectors: Map<string, readonly number[]>;
} {
  const approvedPets = uniqueApprovedPets(input.pets);
  const textQueryVectors = validatedTextVectors(
    approvedPets,
    input.textQueryRows,
    {
      revision: input.profile.textQueryRevision,
      dimensions: input.profile.textDimensions,
      sourceHash: createRelatedPetQuerySourceHash,
    },
  );
  const textDocumentVectors = validatedTextVectors(
    approvedPets,
    input.textRows,
    {
      revision: input.profile.textRevision,
      dimensions: input.profile.textDimensions,
      sourceHash: createRelatedPetDocumentSourceHash,
    },
  );
  const annotationProfile = getAnnotationProfile(input.profile);
  const preparedAnnotations = input.annotationModelUri
    ? validatedAnnotations({
        pets: approvedPets,
        rows: input.annotations ?? [],
        profile: annotationProfile,
        modelUri: input.annotationModelUri,
      })
    : {
        values: new Map<string, ResolvedRelatedPetAnnotation>(),
        sourceHashes: new Map<string, string>(),
        texts: new Map<string, string>(),
      };
  const annotationQueryVectors = validatedAnnotationVectors({
    rows: input.annotationQueryRows ?? [],
    revision: annotationProfile.annotationQueryRevision,
    dimensions: annotationProfile.annotationDimensions,
    role: "query",
    annotationRevision: annotationProfile.annotationRevision,
    sourceHashes: preparedAnnotations.sourceHashes,
    texts: preparedAnnotations.texts,
  });
  const annotationDocumentVectors = validatedAnnotationVectors({
    rows: input.annotationRows ?? [],
    revision: annotationProfile.annotationDocumentRevision,
    dimensions: annotationProfile.annotationDimensions,
    role: "document",
    annotationRevision: annotationProfile.annotationRevision,
    sourceHashes: preparedAnnotations.sourceHashes,
    texts: preparedAnnotations.texts,
  });
  const visualVectors = input.visualContext
    ? validatedVisualVectors({
        petsBySlug: new Map(
          approvedPets.map((item) => [item.slug, item]),
        ),
        rows: input.visualRows,
        captions: input.captions,
        profile: input.profile,
        context: input.visualContext,
      })
    : new Map<string, readonly number[]>();
  return {
    approvedPets,
    textQueryVectors,
    textDocumentVectors,
    annotationQueryVectors,
    annotationDocumentVectors,
    annotations: preparedAnnotations.values,
    visualVectors,
  };
}

function validatedAnnotations(input: {
  pets: readonly PublicPet[];
  rows: readonly StoredRelatedPetAnnotation[];
  profile: ReturnType<typeof getAnnotationProfile>;
  modelUri: string;
}): {
  values: Map<string, ResolvedRelatedPetAnnotation>;
  sourceHashes: Map<string, string>;
  texts: Map<string, string>;
} {
  const petsBySlug = new Map(input.pets.map((pet) => [pet.slug, pet]));
  const values = new Map<string, ResolvedRelatedPetAnnotation>();
  const sourceHashes = new Map<string, string>();
  const texts = new Map<string, string>();
  for (const row of input.rows) {
    const pet = petsBySlug.get(row.slug);
    if (!pet) continue;
    try {
      const expectedSourceHash = createRelatedPetAnnotationSourceHash({
        pet,
        modelUri: input.modelUri,
        annotationRevision: input.profile.annotationRevision,
      });
      const annotation = parseResolvedRelatedPetAnnotation(row.annotationJson);
      const annotationText = buildRelatedPetAnnotationText(annotation);
      if (
        row.sourceHash !== expectedSourceHash ||
        row.annotationText !== annotationText
      ) {
        continue;
      }
      values.set(row.slug, annotation);
      sourceHashes.set(row.slug, row.sourceHash);
      texts.set(row.slug, annotationText);
    } catch {
      // Malformed derived rows are excluded from current coverage.
    }
  }
  return { values, sourceHashes, texts };
}

function validatedAnnotationVectors(input: {
  rows: readonly StoredRawPetSearchEmbedding[];
  revision: string;
  dimensions: number;
  role: "query" | "document";
  annotationRevision: string;
  sourceHashes: ReadonlyMap<string, string>;
  texts: ReadonlyMap<string, string>;
}): Map<string, readonly number[]> {
  const vectors = new Map<string, readonly number[]>();
  for (const row of input.rows) {
    const annotationSourceHash = input.sourceHashes.get(row.slug);
    const annotationText = input.texts.get(row.slug);
    if (!annotationSourceHash || !annotationText) continue;
    const vector = decodeRelatedPetV24Vector(row, {
      modelRevision: input.revision,
      dimensions: input.dimensions,
      sourceHash: createRelatedPetAnnotationEmbeddingSourceHash({
        modelRevision: input.revision,
        role: input.role,
        annotationRevision: input.annotationRevision,
        annotationSourceHash,
        annotationText,
      }),
    });
    if (vector) vectors.set(row.slug, vector);
  }
  return vectors;
}

function validatedTextVectors(
  pets: readonly PublicPet[],
  rows: readonly StoredRawPetSearchEmbedding[],
  expected: {
    revision: string;
    dimensions: number;
    sourceHash: (pet: PublicPet, revision: string) => string;
  },
): Map<string, readonly number[]> {
  const petsBySlug = new Map(pets.map((item) => [item.slug, item]));
  const vectors = new Map<string, readonly number[]>();
  for (const row of rows) {
    const item = petsBySlug.get(row.slug);
    if (!item) continue;
    const vector = decodeRelatedPetV24Vector(row, {
      modelRevision: expected.revision,
      dimensions: expected.dimensions,
      sourceHash: expected.sourceHash(item, expected.revision),
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
      const vector = decodeRelatedPetV24Vector(row, {
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
  requestBuild: requestRelatedPetsBuild,
  writeSnapshot: writeRelatedPetsSnapshot,
  activateGeneration: activateRelatedPetsGeneration,
  markGenerationFailed: markRelatedPetsGenerationFailed,
  cleanupGenerations: cleanupRelatedPetsGenerations,
  cleanupInactiveGeneration: cleanupInactiveRelatedPetsGeneration,
  getState: getRelatedPetsState,
  getRankingInputRevision: getRelatedPetsRankingInputRevision,
  recoverPreviousGeneration: recoverPreviousRelatedPetsGeneration,
};

export function getCurrentRelatedPetsVisualSourceContext(): VisualSourceContext | null {
  const profile = RELATED_PETS_V24_PROFILE;
  const visualDefinition = PET_VISUAL_MODEL_REVISIONS[profile.visualRevision];
  const captionRevision = visualDefinition.captionRevision;
  const captionDefinition = PET_VISION_CAPTION_REVISIONS[captionRevision];
  const configuredCaptionRevision =
    process.env.PET_SEARCH_VISION_CAPTION_REVISION?.trim() ||
    PET_VISION_CAPTION_REVISION;
  const configuredVisualRevision =
    process.env.PET_SEARCH_VISUAL_MODEL_REVISION?.trim() ||
    PET_VISUAL_MODEL_REVISION;
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  if (
    !folderId ||
    configuredCaptionRevision !== captionRevision ||
    configuredVisualRevision !== profile.visualRevision
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
    ...RELATED_PETS_V24_PROFILE,
    visualCaptionRevision:
      PET_VISUAL_MODEL_REVISIONS[
        RELATED_PETS_V24_PROFILE.visualRevision
      ].captionRevision,
  },
  repository: productionRepository,
  isStorageAvailable: isYdbConfigured,
  listApprovedPets: listApprovedPetsForSearch,
  listRawVectors: listRawPetSearchEmbeddings,
  listCaptions: listPetSearchCaptions,
  listAnnotations: async (annotationRevision) => {
    const { listRelatedPetAnnotations } = await import(
      "@/lib/pets/related-pets-annotations-repository"
    );
    return listRelatedPetAnnotations(annotationRevision);
  },
  getAnnotationModelUri: () => {
    const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
    return folderId
      ? `gpt://${folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`
      : null;
  },
  getVisualSourceContext: getCurrentRelatedPetsVisualSourceContext,
  createGenerationId: randomUUID,
  now: () => new Date(),
  log: (event) => {
    console.error("[codex-pets][related-pets-rebuild]", event);
  },
});

export const rebuildRelatedPets = service.rebuild;
export const prepareRelatedPetsGeneration = service.prepareGeneration;
export const invalidateRelatedPets = service.invalidate;
export const recoverPreviousRelatedPets = service.recoverPrevious;

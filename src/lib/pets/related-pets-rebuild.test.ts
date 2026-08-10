import { describe, expect, it } from "vitest";

import {
  createRelatedPetDocumentSourceHash,
  createRelatedPetQuerySourceHash,
  embeddingToBuffer,
} from "@/lib/pets/search-embeddings";
import type { StoredRawPetSearchEmbedding } from "@/lib/pets/search-embeddings-repository";
import {
  buildPetVisionCaptionText,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  type PetVisionCaption,
} from "@/lib/pets/search-vision-contract";
import {
  createRelatedPetsRebuildService,
  RelatedPetsRebuildError,
  type RelatedPetsRebuildProfile,
} from "@/lib/pets/related-pets-rebuild";
import type {
  RelatedPetsSnapshot,
  RelatedPetsState,
} from "@/lib/pets/related-pets-repository";
import type { PublicPet } from "@/lib/pets/types";

const profile: RelatedPetsRebuildProfile = {
  rankingRevision: "ranking-v1",
  textRevision: "text-v1",
  textQueryRevision: "text-query-v1",
  textDimensions: 2,
  textMinSimilarity: 0.1,
  visualRevision: "visual-v1",
  visualCaptionRevision: "caption-v1",
  visualDimensions: 2,
  visualMinSimilarity: 0.1,
  visualWeight: 0.5,
};

const visualContext = {
  captionRevision: "caption-v1",
  modelUri: "gpt://folder/model",
} as const;

const captionValue: PetVisionCaption = {
  subject: { en: "robot", ru: "робот" },
  appearance: { en: "small", ru: "маленький" },
  clothing: { en: "", ru: "" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "friendly", ru: "дружелюбный" },
  colors: { en: ["blue"], ru: ["синий"] },
  search_terms_en: ["robot", "pixel", "blue"],
  search_terms_ru: ["робот", "пиксель", "синий"],
};

function pet(slug: string, overrides: Partial<PublicPet> = {}): PublicPet {
  return {
    id: `id-${slug}`,
    slug,
    displayName: slug,
    description: `${slug} description`,
    spritesheetUrl: `/api/assets/asset-${slug}/spritesheet.webp`,
    petJsonUrl: `/api/assets/asset-${slug}/pet.json`,
    zipUrl: `/api/assets/asset-${slug}/pet.zip`,
    spritesheetExt: "webp",
    kind: "creature",
    tags: ["shared", slug],
    status: "approved",
    ownerName: null,
    contactEmail: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-02T00:00:00.000Z",
    downloadCount: 0,
    installCount: 0,
    likeCount: 0,
    ...overrides,
  };
}

function rawVector(input: {
  slug: string;
  modelRevision: string;
  sourceHash: string;
  vector?: readonly number[];
  embedding?: Buffer;
}): StoredRawPetSearchEmbedding {
  const vector = input.vector ?? [1, 0];
  return {
    modelRevision: input.modelRevision,
    slug: input.slug,
    sourceHash: input.sourceHash,
    dimensions: vector.length,
    embedding: input.embedding ?? embeddingToBuffer(vector),
    updatedAt: "2026-08-03T10:00:00.000Z",
  };
}

function captionFor(item: PublicPet, overrides: { staleSource?: boolean } = {}) {
  const assetId = `asset-${item.slug}`;
  const spritesheetSha256 = "a".repeat(64);
  const envelope = createPetVisionCaptionEnvelope({
    assetId,
    spritesheetSha256,
    caption: captionValue,
  });
  const captionText = buildPetVisionCaptionText(envelope.caption);
  const sourceHash = createPetVisionCaptionSourceHash({
    ...visualContext,
    assetId,
    spritesheetSha256,
  });
  return {
    slug: item.slug,
    sourceHash: overrides.staleSource ? "stale-caption-source" : sourceHash,
    captionJson: JSON.stringify(envelope),
    captionText,
    updatedAt: "2026-08-03T10:00:00.000Z",
  };
}

function visualVectorFor(item: PublicPet, vector: readonly number[] = [1, 0]) {
  const caption = captionFor(item);
  return rawVector({
    slug: item.slug,
    modelRevision: profile.visualRevision,
    sourceHash: createPetVisualEmbeddingSourceHash({
      visualRevision: profile.visualRevision,
      captionRevision: visualContext.captionRevision,
      captionSourceHash: caption.sourceHash,
      captionText: caption.captionText,
    }),
    vector,
  });
}

function createHarness(options: {
  rebuildProfile?: RelatedPetsRebuildProfile;
  pets?: PublicPet[];
  textQueryRows?: StoredRawPetSearchEmbedding[];
  textRows?: StoredRawPetSearchEmbedding[];
  topicQueryRows?: StoredRawPetSearchEmbedding[];
  topicRows?: StoredRawPetSearchEmbedding[];
  visualRows?: StoredRawPetSearchEmbedding[];
  captions?: ReturnType<typeof captionFor>[];
  superseded?: boolean;
  requestSuperseded?: boolean;
  supersedeDuringRanking?: boolean;
  mutateCatalogDuringRanking?: boolean;
  mutateEmbeddingsBeforeRequest?: boolean;
  mutateInputsBeforeActivation?: boolean;
  storageAvailable?: boolean;
  writeError?: Error;
  writeErrorAt?: number;
  cleanupError?: Error;
  recoveryError?: Error;
  retainedRankingRevision?: string;
  activationErrorAfterReady?: Error;
  initialState?: RelatedPetsState | null;
  interleaveNewerBuildBeforeCleanup?: boolean;
  supersedeInvalidationBeforeFailure?: boolean;
  visualSourceContext?: { captionRevision: string; modelUri: string } | null;
} = {}) {
  const rebuildProfile = options.rebuildProfile ?? profile;
  const pets = options.pets ?? [pet("source"), pet("peer-a"), pet("peer-b")];
  const textRows =
    options.textRows ??
    pets.map((item, index) =>
      rawVector({
        slug: item.slug,
        modelRevision: rebuildProfile.textRevision,
        sourceHash: createRelatedPetDocumentSourceHash(
          item,
          rebuildProfile.textRevision,
        ),
        vector: index === 2 ? [0, 1] : [1, 0],
      }),
    );
  const textQueryRows =
    options.textQueryRows ??
    pets.map((item) =>
      rawVector({
        slug: item.slug,
        modelRevision: rebuildProfile.textQueryRevision,
        sourceHash: createRelatedPetQuerySourceHash(
          item,
          rebuildProfile.textQueryRevision,
        ),
      }),
    );
  const topicQueryRows = options.topicQueryRows ??
    (rebuildProfile.topicQueryRevision
      ? pets.map((item) =>
          rawVector({
            slug: item.slug,
            modelRevision: rebuildProfile.topicQueryRevision ?? "",
            sourceHash: createRelatedPetQuerySourceHash(
              item,
              rebuildProfile.topicQueryRevision ?? "",
            ),
          }),
        )
      : []);
  const topicRows = options.topicRows ??
    (rebuildProfile.topicRevision
      ? pets.map((item) =>
          rawVector({
            slug: item.slug,
            modelRevision: rebuildProfile.topicRevision ?? "",
            sourceHash: createRelatedPetDocumentSourceHash(
              item,
              rebuildProfile.topicRevision ?? "",
            ),
          }),
        )
      : []);
  const visualRows = options.visualRows ?? pets.map((item) => visualVectorFor(item));
  const captions = options.captions ?? pets.map((item) => captionFor(item));
  const snapshots: RelatedPetsSnapshot[] = [];
  const mutations: string[] = [];
  const cleanupExpectedIds: Array<string | null> = [];
  const recoveryInputs: Array<{
    expectedRequestedGenerationId: string;
    expectedStatus: RelatedPetsState["status"];
    expectedActiveGenerationId: string;
    targetPreviousGenerationId: string;
    expectedRankingRevision: string;
    updatedAt: string;
  }> = [];
  const vectorRevisionReads: string[] = [];
  const rankingInputScopes: Array<{
    embeddingModelRevisions: readonly string[];
    captionRevision: string | null;
  }> = [];
  const logs: unknown[] = [];
  let state: RelatedPetsState | null = options.initialState ?? null;
  let catalogRevision = "catalog-revision-1";
  let embeddingRevision = "embedding-revision-1";
  let clock = Date.parse("2026-08-03T10:00:00.000Z");
  let snapshotWriteCount = 0;
  let rankingSuperseded = false;
  let catalogMutated = false;

  const repository = {
    getState: async () => state,
    getRankingInputRevision: async (scope: {
      embeddingModelRevisions: readonly string[];
      captionRevision: string | null;
    }) => {
      rankingInputScopes.push(scope);
      return `${catalogRevision}:${embeddingRevision}`;
    },
    getSnapshot: async () => null,
    requestBuild: async (input: {
      generationId: string;
      rankingRevision: string;
      updatedAt: string;
      expectedState: RelatedPetsState | null;
      expectedInputRevision: string;
    }) => {
      mutations.push("request");
      if (options.requestSuperseded) {
        state = {
          requestedGenerationId: "generation-newer",
          activeGenerationId: "generation-old",
          previousGenerationId: "generation-older",
          status: "building",
          rankingRevision: rebuildProfile.rankingRevision,
          failureReason: null,
          updatedAt: "2026-08-03T10:01:00.000Z",
        };
        return false;
      }
      if (JSON.stringify(state) !== JSON.stringify(input.expectedState)) {
        return false;
      }
      if (
        input.expectedInputRevision !==
        `${catalogRevision}:${embeddingRevision}`
      ) {
        return false;
      }
      state = {
        requestedGenerationId: input.generationId,
        activeGenerationId: "generation-old",
        previousGenerationId: "generation-older",
        status: "building",
        rankingRevision: input.rankingRevision,
        failureReason: null,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    writeSnapshot: async (snapshot: RelatedPetsSnapshot) => {
      mutations.push(`write:${snapshot.sourceSlug}`);
      snapshotWriteCount += 1;
      if (
        options.writeError &&
        snapshotWriteCount === (options.writeErrorAt ?? 1)
      ) {
        throw options.writeError;
      }
      snapshots.push(snapshot);
    },
    activateGeneration: async (input: {
      generationId: string;
      rankingRevision: string;
      updatedAt: string;
      expectedInputRevision: string;
      previousState: RelatedPetsState | null;
    }) => {
      mutations.push("activate");
      if (options.mutateInputsBeforeActivation) {
        catalogRevision = "catalog-revision-2";
      }
      if (
        input.expectedInputRevision !==
        `${catalogRevision}:${embeddingRevision}`
      ) {
        state = input.previousState;
        return false;
      }
      if (options.superseded) {
        state = {
          requestedGenerationId: "generation-newer",
          activeGenerationId: "generation-old",
          previousGenerationId: "generation-older",
          status: "building",
          rankingRevision: rebuildProfile.rankingRevision,
          failureReason: null,
          updatedAt: "2026-08-03T10:01:00.000Z",
        };
        snapshots.push({
          generationId: "generation-newer",
          sourceSlug: "source",
          rankingRevision: rebuildProfile.rankingRevision,
          relatedSlugs: ["peer-a"],
          createdAt: "2026-08-03T10:01:00.000Z",
        });
        return false;
      }
      state = {
        requestedGenerationId: input.generationId,
        activeGenerationId: input.generationId,
        previousGenerationId: "generation-old",
        status: "ready",
        rankingRevision: input.rankingRevision,
        failureReason: null,
        updatedAt: input.updatedAt,
      };
      if (options.activationErrorAfterReady) {
        throw options.activationErrorAfterReady;
      }
      return true;
    },
    markGenerationFailed: async (input: {
      generationId: string;
      rankingRevision: string;
      failureReason: string;
      updatedAt: string;
    }) => {
      mutations.push(`failed:${input.failureReason}`);
      if (options.supersedeInvalidationBeforeFailure) {
        state = {
          requestedGenerationId: "generation-newer",
          activeGenerationId: "generation-old",
          previousGenerationId: "generation-older",
          status: "building",
          rankingRevision: rebuildProfile.rankingRevision,
          failureReason: null,
          updatedAt: "2026-08-03T10:01:00.000Z",
        };
      }
      if (
        state?.requestedGenerationId !== input.generationId ||
        state.status !== "building"
      ) {
        return false;
      }
      state = {
        ...state,
        status: "failed",
        rankingRevision: input.rankingRevision,
        failureReason: input.failureReason,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    cleanupGenerations: async (
      input:
        | { expectedGenerationId: string }
        | {
            activeGenerationId: string;
            previousGenerationId: string | null;
          },
    ) => {
      mutations.push("cleanup");
      if (options.interleaveNewerBuildBeforeCleanup) {
        state = {
          requestedGenerationId: "generation-newer",
          activeGenerationId: "generation-new",
          previousGenerationId: "generation-old",
          status: "building",
          rankingRevision: rebuildProfile.rankingRevision,
          failureReason: null,
          updatedAt: "2026-08-03T10:01:00.000Z",
        };
        snapshots.push({
          generationId: "generation-newer",
          sourceSlug: "source",
          rankingRevision: rebuildProfile.rankingRevision,
          relatedSlugs: ["peer-a"],
          createdAt: "2026-08-03T10:01:00.000Z",
        });
      }
      if (options.cleanupError) throw options.cleanupError;
      if ("expectedGenerationId" in input) {
        cleanupExpectedIds.push(input.expectedGenerationId);
        if (
          state?.status !== "ready" ||
          state.activeGenerationId !== input.expectedGenerationId ||
          state.requestedGenerationId !== input.expectedGenerationId
        ) {
          return false;
        }
        snapshots.splice(
          0,
          snapshots.length,
          ...snapshots.filter(
            ({ generationId }) =>
              generationId === state?.activeGenerationId ||
              generationId === state?.previousGenerationId,
          ),
        );
        return true;
      }

      cleanupExpectedIds.push(null);
      snapshots.splice(
        0,
        snapshots.length,
        ...snapshots.filter(
          ({ generationId }) =>
            generationId === input.activeGenerationId ||
            generationId === input.previousGenerationId,
        ),
      );
      return true;
    },
    cleanupInactiveGeneration: async (input: {
      expectedGenerationId: string;
    }) => {
      mutations.push("cleanup-inactive");
      if (
        !state ||
        state.activeGenerationId === input.expectedGenerationId ||
        state.previousGenerationId === input.expectedGenerationId ||
        (state.requestedGenerationId === input.expectedGenerationId &&
          state.status !== "failed")
      ) {
        return false;
      }
      snapshots.splice(
        0,
        snapshots.length,
        ...snapshots.filter(
          ({ generationId }) =>
            generationId !== input.expectedGenerationId,
        ),
      );
      return true;
    },
    recoverPreviousGeneration: async (input: {
      expectedRequestedGenerationId: string;
      expectedStatus: RelatedPetsState["status"];
      expectedActiveGenerationId: string;
      targetPreviousGenerationId: string;
      expectedRankingRevision: string;
      updatedAt: string;
    }) => {
      recoveryInputs.push(input);
      if (options.recoveryError) throw options.recoveryError;
      if (
        state?.status !== input.expectedStatus ||
        state.requestedGenerationId !== input.expectedRequestedGenerationId ||
        state.activeGenerationId !== input.expectedActiveGenerationId ||
        state.previousGenerationId !== input.targetPreviousGenerationId ||
        input.expectedRankingRevision !==
          (options.retainedRankingRevision ?? rebuildProfile.rankingRevision)
      ) {
        return null;
      }
      state = {
        requestedGenerationId: input.targetPreviousGenerationId,
        activeGenerationId: input.targetPreviousGenerationId,
        previousGenerationId: input.expectedActiveGenerationId,
        status: "ready",
        rankingRevision:
          options.retainedRankingRevision ?? rebuildProfile.rankingRevision,
        failureReason: null,
        updatedAt: input.updatedAt,
      };
      return {
        activeGenerationId: input.targetPreviousGenerationId,
        previousGenerationId: input.expectedActiveGenerationId,
        rankingRevision:
          options.retainedRankingRevision ?? rebuildProfile.rankingRevision,
      };
    },
  };

  const service = createRelatedPetsRebuildService({
    profile: rebuildProfile,
    repository,
    isStorageAvailable: () => options.storageAvailable ?? true,
    listApprovedPets: async () => {
      if (options.supersedeDuringRanking && !rankingSuperseded) {
        rankingSuperseded = true;
        state = {
          requestedGenerationId: "generation-newer",
          activeGenerationId: "generation-newer",
          previousGenerationId: "generation-old",
          status: "ready",
          rankingRevision: rebuildProfile.rankingRevision,
          failureReason: null,
          updatedAt: "2026-08-03T10:01:00.000Z",
        };
      }
      if (options.mutateCatalogDuringRanking && !catalogMutated) {
        catalogMutated = true;
        catalogRevision = "catalog-revision-2";
      }
      return pets;
    },
    listRawVectors: async (revision) => {
      vectorRevisionReads.push(revision);
      if (revision === rebuildProfile.textQueryRevision) return textQueryRows;
      if (revision === rebuildProfile.textRevision) return textRows;
      if (revision === rebuildProfile.topicQueryRevision) return topicQueryRows;
      if (revision === rebuildProfile.topicRevision) return topicRows;
      return visualRows;
    },
    listCaptions: async () => captions,
    getVisualSourceContext: () =>
      options.visualSourceContext === undefined
        ? visualContext
        : options.visualSourceContext,
    createGenerationId: () => {
      if (options.mutateEmbeddingsBeforeRequest) {
        embeddingRevision = "embedding-revision-2";
      }
      return "generation-new";
    },
    now: () => {
      const result = new Date(clock);
      clock += 10;
      return result;
    },
    log: (event) => logs.push(event),
  });

  return {
    service,
    snapshots,
    mutations,
    cleanupExpectedIds,
    recoveryInputs,
    vectorRevisionReads,
    rankingInputScopes,
    logs,
    get state() {
      return state;
    },
  };
}

describe("related pets rebuild service", () => {
  it("publishes every approved source with validated text and visual vectors", async () => {
    const harness = createHarness();

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("ready");
    expect(result.coverage).toEqual({
      approvedPetCount: 3,
      snapshotCount: 3,
      textVectorCount: 3,
      visualVectorCount: 3,
    });
    expect(harness.snapshots.map(({ sourceSlug }) => sourceSlug)).toEqual([
      "source",
      "peer-a",
      "peer-b",
    ]);
    expect(harness.mutations).toEqual([
      "request",
      "write:source",
      "write:peer-a",
      "write:peer-b",
      "activate",
      "cleanup",
    ]);
    expect(harness.cleanupExpectedIds).toEqual(["generation-new"]);
    expect(harness.rankingInputScopes).toEqual([
      {
        embeddingModelRevisions: [
          profile.textQueryRevision,
          profile.textRevision,
          profile.visualRevision,
        ],
        captionRevision: profile.visualCaptionRevision,
      },
    ]);
    expect(harness.state).toMatchObject({
      activeGenerationId: "generation-new",
      previousGenerationId: "generation-old",
      status: "ready",
    });
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "apply",
      status: "ready",
      generationId: "generation-new",
      rankingRevision: profile.rankingRevision,
      durationMs: expect.any(Number),
    });
  });

  it("requires and reports complete V10 description and topic vector pairs", async () => {
    const v10Profile: RelatedPetsRebuildProfile = {
      ...profile,
      strategy: "description-theme-v10",
      rankingRevision: "ranking-v10-candidate",
      topicRevision: "topic-document-v10",
      topicQueryRevision: "topic-query-v10",
      topicDimensions: 2,
      topicMinSimilarity: 0.1,
      topicWeight: 0.2,
      metadataWeight: 0.05,
    };
    const harness = createHarness({ rebuildProfile: v10Profile });

    const result = await harness.service.rebuild({
      mode: "dry-run",
      includeVisual: true,
    });

    expect(result.coverage).toEqual({
      approvedPetCount: 3,
      snapshotCount: 3,
      textVectorCount: 3,
      topicVectorCount: 3,
      visualVectorCount: 3,
    });
    expect(harness.vectorRevisionReads).toEqual([
      v10Profile.textQueryRevision,
      v10Profile.textRevision,
      v10Profile.topicQueryRevision,
      v10Profile.topicRevision,
      v10Profile.visualRevision,
    ]);
  });

  it("blocks V10 rebuild before writes when one topic contour is incomplete", async () => {
    const v10Profile: RelatedPetsRebuildProfile = {
      ...profile,
      strategy: "description-theme-v10",
      rankingRevision: "ranking-v10-candidate",
      topicRevision: "topic-document-v10",
      topicQueryRevision: "topic-query-v10",
      topicDimensions: 2,
      topicMinSimilarity: 0.1,
      topicWeight: 0.2,
      metadataWeight: 0.05,
    };
    const harness = createHarness({
      rebuildProfile: v10Profile,
      topicRows: [],
    });

    await expect(
      harness.service.rebuild({ mode: "apply", includeVisual: true }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      message: "topic_vectors_incomplete",
    });
    expect(harness.mutations).toEqual([]);
    expect(harness.logs.at(-1)).toMatchObject({
      status: "failed",
      failureReason: "topic_vectors_incomplete",
    });
  });

  it("writes eight unique related slugs for a nine-pet catalog", async () => {
    const pets = Array.from({ length: 9 }, (_, index) =>
      pet(index === 0 ? "source" : `peer-${index}`),
    );
    const harness = createHarness({ pets });

    await harness.service.rebuild({ mode: "apply", includeVisual: true });

    expect(harness.snapshots).toHaveLength(9);
    for (const snapshot of harness.snapshots) {
      expect(snapshot.relatedSlugs).toHaveLength(8);
      expect(new Set(snapshot.relatedSlugs).size).toBe(8);
      expect(snapshot.relatedSlugs).not.toContain(snapshot.sourceSlug);
    }
  });

  it("supports text-first rebuilds without reading visual rows or captions", async () => {
    const harness = createHarness();

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: false,
    });

    expect(result.status).toBe("ready");
    expect(result.coverage.visualVectorCount).toBe(0);
    expect(harness.vectorRevisionReads).toEqual([
      profile.textQueryRevision,
      profile.textRevision,
    ]);
    expect(harness.rankingInputScopes).toEqual([
      {
        embeddingModelRevisions: [
          profile.textQueryRevision,
          profile.textRevision,
        ],
        captionRevision: null,
      },
    ]);
  });

  it("dry-runs real rankings with zero state or snapshot writes", async () => {
    const harness = createHarness();

    const result = await harness.service.rebuild({
      mode: "dry-run",
      includeVisual: true,
    });

    expect(result.status).toBe("dry-run");
    expect(result.generationId).toBeNull();
    expect(result.rankings).toHaveLength(3);
    expect(result.coverage.snapshotCount).toBe(3);
    expect(harness.mutations).toEqual([]);
    expect(harness.snapshots).toEqual([]);
  });

  it("fails dry-run when storage is unavailable before reading catalog data", async () => {
    const harness = createHarness({ storageAvailable: false });

    await expect(
      harness.service.rebuild({ mode: "dry-run", includeVisual: true }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      message: "storage_unavailable",
    });

    expect(harness.vectorRevisionReads).toEqual([]);
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "dry-run",
      status: "failed",
      failureReason: "storage_unavailable",
    });
  });

  it("cleans its snapshots after supersession without touching newer state", async () => {
    const harness = createHarness({ superseded: true });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("superseded");
    expect(harness.mutations.at(-1)).toBe("cleanup-inactive");
    expect(harness.mutations).not.toContain("cleanup");
    expect(harness.mutations.some((item) => item.startsWith("failed:"))).toBe(
      false,
    );
    expect(
      harness.snapshots.map(({ generationId }) => generationId),
    ).toEqual(["generation-newer"]);
  });

  it("stops before snapshot writes when a retried request is superseded", async () => {
    const harness = createHarness({ requestSuperseded: true });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("superseded");
    expect(harness.mutations).toEqual(["request"]);
    expect(harness.snapshots).toEqual([]);
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-newer",
      status: "building",
    });
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "apply",
      status: "superseded",
      generationId: "generation-new",
    });
  });

  it("rejects rankings computed before an approved catalog mutation", async () => {
    const harness = createHarness({ mutateCatalogDuringRanking: true });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("superseded");
    expect(harness.mutations).toEqual(["request"]);
    expect(harness.snapshots).toEqual([]);
    expect(harness.state).toBeNull();
  });

  it("rejects rankings computed before an embedding backfill completes", async () => {
    const harness = createHarness({ mutateEmbeddingsBeforeRequest: true });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("superseded");
    expect(harness.mutations).toEqual(["request"]);
    expect(harness.snapshots).toEqual([]);
    expect(harness.state).toBeNull();
  });

  it("rejects rankings computed before a newer generation is published", async () => {
    const harness = createHarness({ supersedeDuringRanking: true });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("superseded");
    expect(harness.mutations).toEqual(["request"]);
    expect(harness.snapshots).toEqual([]);
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-newer",
      activeGenerationId: "generation-newer",
      status: "ready",
    });
  });

  it("does not activate snapshots after ranking inputs change", async () => {
    const initialState: RelatedPetsState = {
      requestedGenerationId: "generation-old",
      activeGenerationId: "generation-old",
      previousGenerationId: "generation-older",
      status: "ready",
      rankingRevision: profile.rankingRevision,
      failureReason: null,
      updatedAt: "2026-08-03T09:59:00.000Z",
    };
    const harness = createHarness({
      initialState,
      mutateInputsBeforeActivation: true,
    });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("superseded");
    expect(harness.mutations).toContain("activate");
    expect(harness.state).toEqual(initialState);
    expect(harness.snapshots).toEqual([]);
  });

  it("fails apply when storage is unavailable without reporting supersession", async () => {
    const harness = createHarness({ storageAvailable: false });

    await expect(
      harness.service.rebuild({ mode: "apply", includeVisual: true }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      message: "storage_unavailable",
    });

    expect(harness.mutations).toEqual([]);
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "apply",
      status: "failed",
      failureReason: "storage_unavailable",
    });
  });

  it("invalidates the retained active generation without reading ranking inputs", async () => {
    const harness = createHarness();
    const result = await harness.service.invalidate({
      failureReason: "text_profile_incompatible",
    });

    expect(result).toMatchObject({
      operation: "invalidate",
      status: "invalidated",
      generationId: "generation-new",
      rankingRevision: profile.rankingRevision,
      failureReason: "text_profile_incompatible",
    });
    expect(harness.mutations).toEqual([
      "request",
      "failed:text_profile_incompatible",
    ]);
    expect(harness.vectorRevisionReads).toEqual([]);
    expect(harness.snapshots).toEqual([]);
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-new",
      activeGenerationId: "generation-old",
      previousGenerationId: "generation-older",
      status: "failed",
      rankingRevision: profile.rankingRevision,
      failureReason: "text_profile_incompatible",
    });
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "invalidate",
      status: "invalidated",
      generationId: "generation-new",
      failureReason: "text_profile_incompatible",
    });
  });

  it("does not overwrite a newer rebuild that supersedes invalidation", async () => {
    const harness = createHarness({
      supersedeInvalidationBeforeFailure: true,
    });
    const result = await harness.service.invalidate({
      failureReason: "text_profile_incompatible",
    });

    expect(result.status).toBe("superseded");
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-newer",
      status: "building",
      failureReason: null,
    });
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "invalidate",
      status: "superseded",
      generationId: "generation-new",
    });
  });

  it("does not invalidate a newer request after request replay", async () => {
    const harness = createHarness({ requestSuperseded: true });

    const result = await harness.service.invalidate({
      failureReason: "text_profile_incompatible",
    });

    expect(result.status).toBe("superseded");
    expect(harness.mutations).toEqual(["request"]);
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-newer",
      status: "building",
      failureReason: null,
    });
  });

  it("marks current failures with a bounded reason and never logs raw errors", async () => {
    const rawMessage = "credential=secret vector=[1,2,3] caption=private";
    const harness = createHarness({ writeError: new Error(rawMessage) });

    await expect(
      harness.service.rebuild({ mode: "apply", includeVisual: true }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RelatedPetsRebuildError>>({
        name: "RelatedPetsRebuildError",
        message: "rebuild_failed",
      }),
    );
    expect(harness.mutations).toContain("failed:rebuild_failed");
    expect(harness.state).toMatchObject({
      status: "failed",
      failureReason: "rebuild_failed",
    });
    expect(JSON.stringify(harness.logs)).not.toContain(rawMessage);
    expect(JSON.stringify(harness.logs)).not.toContain("[1,2,3]");
  });

  it("removes partial snapshots after marking a failed generation", async () => {
    const harness = createHarness({
      writeError: new Error("second snapshot write failed"),
      writeErrorAt: 2,
    });

    await expect(
      harness.service.rebuild({ mode: "apply", includeVisual: true }),
    ).rejects.toThrow("rebuild_failed");

    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-new",
      status: "failed",
    });
    expect(harness.mutations).toContain("cleanup-inactive");
    expect(harness.snapshots).toEqual([]);
  });

  it("reconciles an already activated generation after an ambiguous activation error", async () => {
    const harness = createHarness({
      activationErrorAfterReady: new Error("transport lost after commit"),
    });

    await expect(
      harness.service.rebuild({ mode: "apply", includeVisual: true }),
    ).resolves.toMatchObject({
      operation: "apply",
      status: "ready",
      generationId: "generation-new",
      rankingRevision: "ranking-v1",
    });

    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-new",
      activeGenerationId: "generation-new",
      previousGenerationId: "generation-old",
      status: "ready",
      failureReason: null,
    });
    expect(harness.mutations).toContain("cleanup");
    expect(harness.mutations).not.toContain("failed:rebuild_failed");
    expect(JSON.stringify(harness.logs)).not.toContain(
      "transport lost after commit",
    );
  });

  it("recovers the captured active and retained generation pair", async () => {
    const harness = createHarness({
      initialState: {
        requestedGenerationId: "generation-2",
        activeGenerationId: "generation-2",
        previousGenerationId: "generation-1",
        status: "ready",
        rankingRevision: "ranking-v1",
        failureReason: null,
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
    });

    await expect(
      harness.service.recoverPrevious({
        targetGenerationId: "generation-1",
        expectedActiveGenerationId: "generation-2",
      }),
    ).resolves.toMatchObject({
      status: "recovered",
      generationId: "generation-1",
      rankingRevision: "ranking-v1",
    });
    expect(harness.recoveryInputs).toEqual([
      {
        expectedRequestedGenerationId: "generation-2",
        expectedStatus: "ready",
        expectedActiveGenerationId: "generation-2",
        targetPreviousGenerationId: "generation-1",
        expectedRankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:00:00.010Z",
      },
    ]);
  });

  it("keeps recovery retries on the requested generation", async () => {
    const harness = createHarness({
      initialState: {
        requestedGenerationId: "generation-2",
        activeGenerationId: "generation-2",
        previousGenerationId: "generation-1",
        status: "ready",
        rankingRevision: "ranking-v1",
        failureReason: null,
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
    });

    await expect(
      harness.service.recoverPrevious({
        targetGenerationId: "generation-1",
        expectedActiveGenerationId: "generation-2",
      }),
    ).resolves.toMatchObject({
      status: "recovered",
      generationId: "generation-1",
    });
    await expect(
      harness.service.recoverPrevious({
        targetGenerationId: "generation-1",
        expectedActiveGenerationId: "generation-2",
      }),
    ).resolves.toMatchObject({
      status: "recovered",
      generationId: "generation-1",
    });
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-1",
      activeGenerationId: "generation-1",
      previousGenerationId: "generation-2",
      status: "ready",
    });
    expect(harness.recoveryInputs).toHaveLength(1);
  });

  it("rejects the current active generation as an initial recovery target", async () => {
    const harness = createHarness({
      initialState: {
        requestedGenerationId: "generation-2",
        activeGenerationId: "generation-2",
        previousGenerationId: "generation-1",
        status: "ready",
        rankingRevision: "ranking-v1",
        failureReason: null,
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
    });

    await expect(
      harness.service.recoverPrevious({
        targetGenerationId: "generation-2",
        expectedActiveGenerationId: "generation-2",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      generationId: null,
    });
    expect(harness.recoveryInputs).toEqual([]);
  });

  it("reports an incompatible retained ranking revision as unavailable", async () => {
    const harness = createHarness({
      retainedRankingRevision: "ranking-v0",
      initialState: {
        requestedGenerationId: "generation-2",
        activeGenerationId: "generation-2",
        previousGenerationId: "generation-1",
        status: "ready",
        rankingRevision: "ranking-v1",
        failureReason: null,
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
    });

    await expect(
      harness.service.recoverPrevious({
        targetGenerationId: "generation-1",
        expectedActiveGenerationId: "generation-2",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      generationId: null,
      rankingRevision: "ranking-v1",
    });
    expect(harness.recoveryInputs).toEqual([
      expect.objectContaining({ expectedRankingRevision: "ranking-v1" }),
    ]);
  });

  it.each(["failed", "building"] as const)(
    "recovers the retained generation from an exact captured %s state",
    async (expectedStatus) => {
      const harness = createHarness({
        initialState: {
          requestedGenerationId: "generation-incomplete",
          activeGenerationId: "generation-2",
          previousGenerationId: "generation-1",
          status: expectedStatus,
          rankingRevision: "ranking-v1",
          failureReason:
            expectedStatus === "failed" ? "rebuild_failed" : null,
          updatedAt: "2026-08-03T10:00:00.000Z",
        },
      });

      await expect(
        harness.service.recoverPrevious({
          targetGenerationId: "generation-1",
          expectedActiveGenerationId: "generation-2",
        }),
      ).resolves.toMatchObject({
        status: "recovered",
        generationId: "generation-1",
        rankingRevision: "ranking-v1",
      });
      expect(harness.recoveryInputs).toEqual([
        {
          expectedRequestedGenerationId: "generation-incomplete",
          expectedStatus,
          expectedActiveGenerationId: "generation-2",
          targetPreviousGenerationId: "generation-1",
          expectedRankingRevision: "ranking-v1",
          updatedAt: "2026-08-03T10:00:00.010Z",
        },
      ]);
    },
  );

  it("reports no retained generation without treating configured storage as a failure", async () => {
    const harness = createHarness({
      initialState: {
        requestedGenerationId: "generation-2",
        activeGenerationId: "generation-2",
        previousGenerationId: null,
        status: "ready",
        rankingRevision: "ranking-v1",
        failureReason: null,
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
    });

    await expect(
      harness.service.recoverPrevious({
        targetGenerationId: "generation-1",
        expectedActiveGenerationId: "generation-2",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      generationId: null,
    });
    expect(harness.recoveryInputs).toEqual([]);
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "recover-previous",
      status: "unavailable",
    });
  });

  it("fails recovery with a bounded storage reason when YDB is unconfigured", async () => {
    const harness = createHarness({ storageAvailable: false });

    await expect(
      harness.service.recoverPrevious({
        targetGenerationId: "generation-1",
        expectedActiveGenerationId: "generation-2",
      }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      message: "storage_unavailable",
    });
    expect(harness.recoveryInputs).toEqual([]);
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "recover-previous",
      status: "failed",
      failureReason: "storage_unavailable",
    });
  });

  it("logs recovery failures with the same bounded structured fields", async () => {
    const rawMessage = "credential=secret retained-generation=private";
    const harness = createHarness({
      recoveryError: new Error(rawMessage),
      initialState: {
        requestedGenerationId: "generation-2",
        activeGenerationId: "generation-2",
        previousGenerationId: "generation-1",
        status: "ready",
        rankingRevision: "ranking-v1",
        failureReason: null,
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
    });

    await expect(
      harness.service.recoverPrevious({
        targetGenerationId: "generation-1",
        expectedActiveGenerationId: "generation-2",
      }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      message: "rebuild_failed",
    });
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "recover-previous",
      status: "failed",
      generationId: null,
      rankingRevision: profile.rankingRevision,
      coverage: {
        approvedPetCount: 0,
        snapshotCount: 0,
        textVectorCount: 0,
        visualVectorCount: 0,
      },
      durationMs: expect.any(Number),
      failureReason: "rebuild_failed",
    });
    expect(JSON.stringify(harness.logs)).not.toContain(rawMessage);
  });

  it("fails closed when enabled visual vectors are stale or corrupt", async () => {
    const pets = [pet("source"), pet("stale"), pet("corrupt")];
    const staleCaption = captionFor(pets[1], { staleSource: true });
    const corruptCaption = captionFor(pets[2]);
    const harness = createHarness({
      pets,
      captions: [captionFor(pets[0]), staleCaption, corruptCaption],
      visualRows: [
        visualVectorFor(pets[0]),
        rawVector({
          slug: pets[1].slug,
          modelRevision: profile.visualRevision,
          sourceHash: "stale-visual-source",
        }),
        rawVector({
          slug: pets[2].slug,
          modelRevision: profile.visualRevision,
          sourceHash: createPetVisualEmbeddingSourceHash({
            visualRevision: profile.visualRevision,
            captionRevision: visualContext.captionRevision,
            captionSourceHash: corruptCaption.sourceHash,
            captionText: corruptCaption.captionText,
          }),
          embedding: Buffer.from([0x00]),
        }),
      ],
    });

    await expect(
      harness.service.rebuild({
        mode: "dry-run",
        includeVisual: true,
      }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      reason: "visual_vectors_incomplete",
    });
  });

  it("fails closed unless query and document vectors are both current", async () => {
    const pets = [pet("source"), pet("peer-a"), pet("peer-b")];
    const harness = createHarness({
      pets,
      textQueryRows: pets.slice(0, 2).map((item) =>
        rawVector({
          slug: item.slug,
          modelRevision: profile.textQueryRevision,
          sourceHash: createRelatedPetQuerySourceHash(
            item,
            profile.textQueryRevision,
          ),
        }),
      ),
    });

    await expect(
      harness.service.rebuild({
        mode: "dry-run",
        includeVisual: true,
      }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      reason: "text_vectors_incomplete",
    });
  });

  it("keeps the active generation when apply has incomplete text vectors", async () => {
    const pets = [pet("source"), pet("peer-a"), pet("peer-b")];
    const harness = createHarness({
      pets,
      initialState: {
        requestedGenerationId: "generation-ready",
        activeGenerationId: "generation-ready",
        previousGenerationId: "generation-previous",
        status: "ready",
        rankingRevision: profile.rankingRevision,
        failureReason: null,
        updatedAt: "2026-08-03T09:00:00.000Z",
      },
      textQueryRows: pets.slice(0, 2).map((item) =>
        rawVector({
          slug: item.slug,
          modelRevision: profile.textQueryRevision,
          sourceHash: createRelatedPetQuerySourceHash(
            item,
            profile.textQueryRevision,
          ),
        }),
      ),
    });

    await expect(
      harness.service.rebuild({
        mode: "apply",
        includeVisual: true,
      }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      reason: "text_vectors_incomplete",
    });
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-ready",
      activeGenerationId: "generation-ready",
      status: "ready",
      failureReason: null,
    });
    expect(harness.snapshots).toEqual([]);
    expect(harness.mutations).toEqual([]);
  });

  it("keeps the active generation when apply has incomplete visual vectors", async () => {
    const pets = [pet("source"), pet("peer-a"), pet("peer-b")];
    const harness = createHarness({
      pets,
      initialState: {
        requestedGenerationId: "generation-ready",
        activeGenerationId: "generation-ready",
        previousGenerationId: "generation-previous",
        status: "ready",
        rankingRevision: profile.rankingRevision,
        failureReason: null,
        updatedAt: "2026-08-03T09:00:00.000Z",
      },
      visualRows: pets.slice(0, 2).map((item) => visualVectorFor(item)),
      captions: pets.slice(0, 2).map((item) => captionFor(item)),
    });

    await expect(
      harness.service.rebuild({
        mode: "apply",
        includeVisual: true,
      }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      reason: "visual_vectors_incomplete",
    });
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-ready",
      activeGenerationId: "generation-ready",
      status: "ready",
      failureReason: null,
    });
    expect(harness.snapshots).toEqual([]);
    expect(harness.mutations).toEqual([]);
  });

  it("fails closed when enabled visual context is incompatible", async () => {
    const harness = createHarness({
      visualSourceContext: {
        captionRevision: "caption-stale",
        modelUri: visualContext.modelUri,
      },
    });

    await expect(
      harness.service.rebuild({
        mode: "dry-run",
        includeVisual: true,
      }),
    ).rejects.toMatchObject({
      name: "RelatedPetsRebuildError",
      reason: "visual_vectors_incomplete",
    });
    expect(harness.vectorRevisionReads).toEqual([
      profile.textQueryRevision,
      profile.textRevision,
    ]);
  });

  it("reports ready with bounded cleanup diagnostics after activation", async () => {
    const harness = createHarness({
      cleanupError: new Error("cleanup contained private storage detail"),
    });

    await expect(
      harness.service.rebuild({ mode: "apply", includeVisual: true }),
    ).resolves.toMatchObject({
      status: "ready",
      generationId: "generation-new",
    });

    expect(harness.state).toMatchObject({
      status: "ready",
      activeGenerationId: "generation-new",
      failureReason: null,
    });
    expect(harness.mutations).not.toContain("failed:rebuild_failed");
    expect(harness.logs.at(-1)).toMatchObject({
      operation: "apply",
      status: "ready",
      cleanupStatus: "failed",
    });
    expect(JSON.stringify(harness.logs)).not.toContain(
      "cleanup contained private storage detail",
    );
  });

  it("preserves a newer partial generation when it starts before cleanup", async () => {
    const harness = createHarness({
      interleaveNewerBuildBeforeCleanup: true,
    });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("superseded");
    expect(harness.cleanupExpectedIds).toEqual(["generation-new"]);
    expect(harness.state).toMatchObject({
      requestedGenerationId: "generation-newer",
      activeGenerationId: "generation-new",
      status: "building",
    });
    expect(
      harness.snapshots.some(
        ({ generationId }) => generationId === "generation-newer",
      ),
    ).toBe(true);
  });
});

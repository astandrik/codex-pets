import { describe, expect, it } from "vitest";

import { embeddingToBuffer, createPetSearchSourceHash } from "@/lib/pets/search-embeddings";
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
} from "@/lib/pets/related-pets-rebuild";
import type {
  RelatedPetsSnapshot,
  RelatedPetsState,
} from "@/lib/pets/related-pets-repository";
import type { PublicPet } from "@/lib/pets/types";

const profile = {
  rankingRevision: "ranking-v1",
  textRevision: "text-v1",
  textDimensions: 2,
  textMinSimilarity: 0.1,
  visualRevision: "visual-v1",
  visualCaptionRevision: "caption-v1",
  visualDimensions: 2,
  visualMinSimilarity: 0.1,
  visualWeight: 0.5,
} as const;

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
  pets?: PublicPet[];
  textRows?: StoredRawPetSearchEmbedding[];
  visualRows?: StoredRawPetSearchEmbedding[];
  captions?: ReturnType<typeof captionFor>[];
  superseded?: boolean;
  storageAvailable?: boolean;
  writeError?: Error;
  cleanupError?: Error;
  interleaveNewerBuildBeforeCleanup?: boolean;
  visualSourceContext?: { captionRevision: string; modelUri: string } | null;
} = {}) {
  const pets = options.pets ?? [pet("source"), pet("peer-a"), pet("peer-b")];
  const textRows =
    options.textRows ??
    pets.map((item, index) =>
      rawVector({
        slug: item.slug,
        modelRevision: profile.textRevision,
        sourceHash: createPetSearchSourceHash(item, profile.textRevision),
        vector: index === 2 ? [0, 1] : [1, 0],
      }),
    );
  const visualRows = options.visualRows ?? pets.map((item) => visualVectorFor(item));
  const captions = options.captions ?? pets.map((item) => captionFor(item));
  const snapshots: RelatedPetsSnapshot[] = [];
  const mutations: string[] = [];
  const cleanupExpectedIds: Array<string | null> = [];
  const vectorRevisionReads: string[] = [];
  const logs: unknown[] = [];
  let state: RelatedPetsState | null = null;
  let clock = Date.parse("2026-08-03T10:00:00.000Z");

  const repository = {
    getState: async () => state,
    getSnapshot: async () => null,
    requestBuild: async (input: {
      generationId: string;
      rankingRevision: string;
      updatedAt: string;
    }) => {
      mutations.push("request");
      state = {
        requestedGenerationId: input.generationId,
        activeGenerationId: "generation-old",
        previousGenerationId: "generation-older",
        status: "building",
        rankingRevision: input.rankingRevision,
        failureReason: null,
        updatedAt: input.updatedAt,
      };
    },
    writeSnapshot: async (snapshot: RelatedPetsSnapshot) => {
      mutations.push(`write:${snapshot.sourceSlug}`);
      if (options.writeError) throw options.writeError;
      snapshots.push(snapshot);
    },
    activateGeneration: async (input: {
      generationId: string;
      rankingRevision: string;
      updatedAt: string;
    }) => {
      mutations.push("activate");
      if (options.superseded) return false;
      state = {
        requestedGenerationId: input.generationId,
        activeGenerationId: input.generationId,
        previousGenerationId: "generation-old",
        status: "ready",
        rankingRevision: input.rankingRevision,
        failureReason: null,
        updatedAt: input.updatedAt,
      };
      return true;
    },
    markGenerationFailed: async (input: {
      generationId: string;
      rankingRevision: string;
      failureReason: string;
      updatedAt: string;
    }) => {
      mutations.push(`failed:${input.failureReason}`);
      if (state?.requestedGenerationId !== input.generationId) return false;
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
          rankingRevision: profile.rankingRevision,
          failureReason: null,
          updatedAt: "2026-08-03T10:01:00.000Z",
        };
        snapshots.push({
          generationId: "generation-newer",
          sourceSlug: "source",
          rankingRevision: profile.rankingRevision,
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
    recoverPreviousGeneration: async () => null,
  };

  const service = createRelatedPetsRebuildService({
    profile,
    repository,
    isStorageAvailable: () => options.storageAvailable ?? true,
    listApprovedPets: async () => pets,
    listRawVectors: async (revision) => {
      vectorRevisionReads.push(revision);
      return revision === profile.textRevision ? textRows : visualRows;
    },
    listCaptions: async () => captions,
    getVisualSourceContext: () =>
      options.visualSourceContext === undefined
        ? visualContext
        : options.visualSourceContext,
    createGenerationId: () => "generation-new",
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
    vectorRevisionReads,
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

  it("supports text-first rebuilds without reading visual rows or captions", async () => {
    const harness = createHarness();

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: false,
    });

    expect(result.status).toBe("ready");
    expect(result.coverage.visualVectorCount).toBe(0);
    expect(harness.vectorRevisionReads).toEqual([profile.textRevision]);
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

  it("returns superseded without cleaning or overwriting newer state", async () => {
    const harness = createHarness({ superseded: true });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("superseded");
    expect(harness.mutations.at(-1)).toBe("activate");
    expect(harness.mutations).not.toContain("cleanup");
    expect(harness.mutations.some((item) => item.startsWith("failed:"))).toBe(
      false,
    );
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

  it("omits stale captions and corrupt visual vectors without rejecting text", async () => {
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

    const result = await harness.service.rebuild({
      mode: "dry-run",
      includeVisual: true,
    });

    expect(result.coverage).toEqual({
      approvedPetCount: 3,
      snapshotCount: 3,
      textVectorCount: 3,
      visualVectorCount: 1,
    });
  });

  it("omits visual loading when the current caption context is incompatible", async () => {
    const harness = createHarness({
      visualSourceContext: {
        captionRevision: "caption-stale",
        modelUri: visualContext.modelUri,
      },
    });

    const result = await harness.service.rebuild({
      mode: "dry-run",
      includeVisual: true,
    });

    expect(result.coverage.visualVectorCount).toBe(0);
    expect(harness.vectorRevisionReads).toEqual([profile.textRevision]);
  });

  it("does not replace an activated ready state when retention cleanup fails", async () => {
    const harness = createHarness({
      cleanupError: new Error("cleanup contained private storage detail"),
    });

    await expect(
      harness.service.rebuild({ mode: "apply", includeVisual: true }),
    ).rejects.toThrow("rebuild_failed");

    expect(harness.state).toMatchObject({
      status: "ready",
      activeGenerationId: "generation-new",
      failureReason: null,
    });
    expect(harness.mutations).not.toContain("failed:rebuild_failed");
  });

  it("preserves a newer partial generation when it starts before cleanup", async () => {
    const harness = createHarness({
      interleaveNewerBuildBeforeCleanup: true,
    });

    const result = await harness.service.rebuild({
      mode: "apply",
      includeVisual: true,
    });

    expect(result.status).toBe("ready");
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

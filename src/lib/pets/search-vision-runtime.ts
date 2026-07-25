import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import {
  getPetSearchCaption,
  upsertPetSearchCaption,
  type StoredPetSearchCaption,
} from "@/lib/pets/search-captions-repository";
import type { PetSearchConfig } from "@/lib/pets/search-config";
import type { YandexEmbeddingClient } from "@/lib/pets/search-embeddings";
import {
  getPetSearchEmbeddingMetadata,
  upsertPetSearchEmbedding,
  type StoredEmbeddingMetadata,
} from "@/lib/pets/search-embeddings-repository";
import {
  petSearchRuntimeConfig,
  petVisionCaptionClient,
  petVisualEmbeddingClient,
} from "@/lib/pets/search-provider-runtime";
import {
  buildPetVisionCaptionText,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  parsePetVisionCaptionEnvelope,
} from "@/lib/pets/search-vision-contract";
import type { YandexVisionCaptionClient } from "@/lib/pets/search-vision-client";
import {
  extractPetVisionFrames,
  type ExtractedPetVisionFrames,
} from "@/lib/pets/search-vision-frames";
import type { ApprovalStatus, PublicPet } from "@/lib/pets/types";

export type PetVisionRefreshResult =
  | "skipped"
  | "unchanged"
  | "vector-only"
  | "caption-and-vector";

type VisionSearchPet = {
  slug: string;
  status: ApprovalStatus;
  spritesheetUrl: string;
};

type PetVisionSearchRuntimeDependencies = {
  config: PetSearchConfig;
  embeddingClient: Pick<YandexEmbeddingClient, "embedDocument"> | null;
  visionClient: YandexVisionCaptionClient | null;
  readSpritesheet: typeof readPetSpritesheetAsset;
  extractFrames: (spritesheet: Buffer) => Promise<ExtractedPetVisionFrames>;
  getCaption: (
    captionRevision: string,
    slug: string,
  ) => Promise<StoredPetSearchCaption | null>;
  upsertCaption: typeof upsertPetSearchCaption;
  getEmbeddingMetadata: (
    modelRevision: string,
    slug: string,
  ) => Promise<StoredEmbeddingMetadata | null>;
  upsertEmbedding: typeof upsertPetSearchEmbedding;
  now?: () => Date;
};

export function createPetVisionSearchRuntime(
  dependencies: PetVisionSearchRuntimeDependencies,
) {
  return { refresh };

  async function refresh(
    pet: VisionSearchPet,
    options: { force?: boolean } = {},
  ): Promise<PetVisionRefreshResult> {
    if (pet.status !== "approved") return "skipped";

    const visual = dependencies.config.visual;
    const embeddingClient = dependencies.embeddingClient;
    if (!visual || !embeddingClient) return "skipped";

    const assetId = getPetAssetIdFromSpritesheetUrl(pet.spritesheetUrl);
    if (!assetId) {
      throw new PetVisionIndexingError("asset_error");
    }

    let extracted: ExtractedPetVisionFrames;
    try {
      const asset = await dependencies.readSpritesheet({ assetId });
      extracted = await dependencies.extractFrames(asset.buffer);
    } catch (error) {
      throw new PetVisionIndexingError("asset_error", { cause: error });
    }

    const captionSourceHash = createPetVisionCaptionSourceHash({
      captionRevision: visual.captionRevision,
      modelUri: visual.modelUri,
      assetId,
      spritesheetSha256: extracted.spritesheetSha256,
    });
    const storedCaption = options.force
      ? null
      : await dependencies.getCaption(visual.captionRevision, pet.slug);
    const freshCaption = readFreshCaption({
      storedCaption,
      expectedSourceHash: captionSourceHash,
      assetId,
      spritesheetSha256: extracted.spritesheetSha256,
    });

    if (freshCaption) {
      const visualSourceHash = createPetVisualEmbeddingSourceHash({
        visualRevision: visual.visualRevision,
        captionRevision: visual.captionRevision,
        captionSourceHash,
        captionText: freshCaption.captionText,
      });
      const metadata = await dependencies.getEmbeddingMetadata(
        visual.visualRevision,
        pet.slug,
      );
      if (
        metadata?.sourceHash === visualSourceHash &&
        metadata.dimensions === visual.dimensions
      ) {
        return "unchanged";
      }

      const embedding = await embeddingClient.embedDocument(
        freshCaption.captionText,
      );
      validateEmbedding(embedding, visual.dimensions);
      await dependencies.upsertEmbedding({
        modelRevision: visual.visualRevision,
        slug: pet.slug,
        sourceHash: visualSourceHash,
        dimensions: visual.dimensions,
        embedding,
        updatedAt: currentTimestamp(),
      });
      return "vector-only";
    }

    if (!dependencies.visionClient) {
      throw new PetVisionIndexingError("configuration_missing");
    }
    const caption = await dependencies.visionClient.createCaption(
      extracted.frames,
    );
    const captionText = buildPetVisionCaptionText(caption);
    const captionJson = JSON.stringify(
      createPetVisionCaptionEnvelope({
        assetId,
        spritesheetSha256: extracted.spritesheetSha256,
        caption,
      }),
    );
    await dependencies.upsertCaption({
      captionRevision: visual.captionRevision,
      slug: pet.slug,
      sourceHash: captionSourceHash,
      captionJson,
      captionText,
      updatedAt: currentTimestamp(),
    });

    const embedding = await embeddingClient.embedDocument(captionText);
    validateEmbedding(embedding, visual.dimensions);
    await dependencies.upsertEmbedding({
      modelRevision: visual.visualRevision,
      slug: pet.slug,
      sourceHash: createPetVisualEmbeddingSourceHash({
        visualRevision: visual.visualRevision,
        captionRevision: visual.captionRevision,
        captionSourceHash,
        captionText,
      }),
      dimensions: visual.dimensions,
      embedding,
      updatedAt: currentTimestamp(),
    });
    return "caption-and-vector";
  }

  function currentTimestamp(): string {
    return (dependencies.now ?? (() => new Date()))().toISOString();
  }
}

type PetVisionIndexingFailureReason =
  | "asset_error"
  | "configuration_missing"
  | "embedding_error"
  | "persistence_error"
  | "provider_error";

class PetVisionIndexingError extends Error {
  constructor(
    public readonly reason: PetVisionIndexingFailureReason,
    options?: ErrorOptions,
  ) {
    super("Pet vision indexing failed.", options);
    this.name = "PetVisionIndexingError";
  }
}

function readFreshCaption(input: {
  storedCaption: StoredPetSearchCaption | null;
  expectedSourceHash: string;
  assetId: string;
  spritesheetSha256: string;
}): { captionText: string } | null {
  if (input.storedCaption?.sourceHash !== input.expectedSourceHash) return null;

  try {
    const envelope = parsePetVisionCaptionEnvelope(
      input.storedCaption.captionJson,
    );
    const canonicalText = buildPetVisionCaptionText(envelope.caption);
    if (
      envelope.source.assetId !== input.assetId ||
      envelope.source.spritesheetSha256 !== input.spritesheetSha256 ||
      canonicalText !== input.storedCaption.captionText
    ) {
      return null;
    }
    return { captionText: canonicalText };
  } catch {
    return null;
  }
}

function validateEmbedding(
  embedding: readonly number[],
  dimensions: number,
): void {
  if (
    embedding.length !== dimensions ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new PetVisionIndexingError("embedding_error");
  }
}

const productionRuntime = createPetVisionSearchRuntime({
  config: petSearchRuntimeConfig,
  embeddingClient: petVisualEmbeddingClient,
  visionClient: petVisionCaptionClient,
  readSpritesheet: readPetSpritesheetAsset,
  extractFrames: extractPetVisionFrames,
  getCaption: getPetSearchCaption,
  upsertCaption: upsertPetSearchCaption,
  getEmbeddingMetadata: getPetSearchEmbeddingMetadata,
  upsertEmbedding: upsertPetSearchEmbedding,
});

export function refreshApprovedPetVisionSearch(
  pet: PublicPet,
  options: { force?: boolean } = {},
): Promise<PetVisionRefreshResult> {
  return productionRuntime.refresh(pet, options);
}

export async function refreshApprovedPetVisionSearchBestEffort(
  pet: PublicPet,
): Promise<boolean> {
  try {
    await refreshApprovedPetVisionSearch(pet);
    return true;
  } catch (error) {
    console.warn("[codex-pets][pet-vision-search]", {
      operation: "refresh",
      status: "failed",
      reason: indexingFailureReason(error),
    });
    return false;
  }
}

function indexingFailureReason(
  error: unknown,
): PetVisionIndexingFailureReason {
  if (error instanceof PetVisionIndexingError) return error.reason;
  if (error && typeof error === "object" && "reason" in error) {
    return "provider_error";
  }
  return "persistence_error";
}

import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import {
  getPetSearchCaption,
  upsertPetSearchCaption,
  type StoredPetSearchCaption,
} from "@/lib/pets/search-captions-repository";
import type { YandexCaptionRewriteClient } from "@/lib/pets/search-caption-rewriter";
import {
  PET_VISION_CAPTION_REVISIONS,
  type PetSearchConfig,
} from "@/lib/pets/search-config";
import type { YandexEmbeddingClient } from "@/lib/pets/search-embeddings";
import {
  getPetSearchEmbeddingMetadata,
  upsertPetSearchEmbedding,
  type StoredEmbeddingMetadata,
} from "@/lib/pets/search-embeddings-repository";
import {
  petCaptionRewriteClient,
  petSearchRuntimeConfig,
  petVisionCaptionClient,
  petVisualEmbeddingClient,
} from "@/lib/pets/search-provider-runtime";
import {
  buildPetVisionCaptionText,
  createPetDerivedVisionCaptionEnvelope,
  createPetDerivedVisionCaptionSourceHash,
  createPetVisionCaptionTextHash,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  parsePetDerivedVisionCaptionEnvelope,
  parsePetVisionCaptionEnvelope,
  type PetVisionCaption,
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
  rewriteClient: YandexCaptionRewriteClient | null;
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
    if (dependencies.config.visualMode === "off") return "skipped";

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

    const captionDefinition =
      PET_VISION_CAPTION_REVISIONS[visual.captionRevision];
    const resolvedCaption =
      captionDefinition.kind === "vision"
        ? await resolveVisionCaption({
            captionRevision: visual.captionRevision,
            modelUri: visual.modelUri,
            petSlug: pet.slug,
            assetId,
            extracted,
            force: options.force ?? false,
          })
        : await resolveDerivedCaption({
            captionRevision: visual.captionRevision,
            modelUri: visual.modelUri,
            upstreamCaptionRevision:
              captionDefinition.upstreamCaptionRevision,
            upstreamModelUri:
              `gpt://${visual.folderId}/${captionDefinition.upstreamModelName}`,
            petSlug: pet.slug,
            assetId,
            extracted,
            force: options.force ?? false,
          });
    const visualSourceHash = createPetVisualEmbeddingSourceHash({
      visualRevision: visual.visualRevision,
      captionRevision: visual.captionRevision,
      captionSourceHash: resolvedCaption.sourceHash,
      captionText: resolvedCaption.captionText,
    });
    const metadata = options.force
      ? null
      : await dependencies.getEmbeddingMetadata(
          visual.visualRevision,
          pet.slug,
        );
    if (
      metadata?.sourceHash === visualSourceHash &&
      metadata.dimensions === visual.dimensions
    ) {
      return resolvedCaption.created ? "caption-and-vector" : "unchanged";
    }

    const embedding = await embeddingClient.embedDocument(
      resolvedCaption.captionText,
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
    return resolvedCaption.created ? "caption-and-vector" : "vector-only";
  }

  async function resolveVisionCaption(input: {
    captionRevision: string;
    modelUri: string;
    petSlug: string;
    assetId: string;
    extracted: ExtractedPetVisionFrames;
    force: boolean;
  }): Promise<ResolvedCaption> {
    const sourceHash = createPetVisionCaptionSourceHash({
      captionRevision: input.captionRevision,
      modelUri: input.modelUri,
      assetId: input.assetId,
      spritesheetSha256: input.extracted.spritesheetSha256,
    });
    const storedCaption = input.force
      ? null
      : await dependencies.getCaption(
          input.captionRevision,
          input.petSlug,
        );
    const freshCaption = readFreshVisionCaption({
      storedCaption,
      expectedSourceHash: sourceHash,
      assetId: input.assetId,
      spritesheetSha256: input.extracted.spritesheetSha256,
    });
    if (freshCaption) {
      return {
        ...freshCaption,
        sourceHash,
        created: false,
      };
    }
    if (!dependencies.visionClient) {
      throw new PetVisionIndexingError("configuration_missing");
    }
    const caption = await dependencies.visionClient.createCaption(
      input.extracted.frames,
    );
    const captionText = buildPetVisionCaptionText(caption);
    await dependencies.upsertCaption({
      captionRevision: input.captionRevision,
      slug: input.petSlug,
      sourceHash,
      captionJson: JSON.stringify(
        createPetVisionCaptionEnvelope({
          assetId: input.assetId,
          spritesheetSha256: input.extracted.spritesheetSha256,
          caption,
        }),
      ),
      captionText,
      updatedAt: currentTimestamp(),
    });
    return { caption, captionText, sourceHash, created: true };
  }

  async function resolveDerivedCaption(input: {
    captionRevision: string;
    modelUri: string;
    upstreamCaptionRevision: string;
    upstreamModelUri: string;
    petSlug: string;
    assetId: string;
    extracted: ExtractedPetVisionFrames;
    force: boolean;
  }): Promise<ResolvedCaption> {
    const upstream = await resolveVisionCaption({
      captionRevision: input.upstreamCaptionRevision,
      modelUri: input.upstreamModelUri,
      petSlug: input.petSlug,
      assetId: input.assetId,
      extracted: input.extracted,
      force: input.force,
    });
    const sourceHash = createPetDerivedVisionCaptionSourceHash({
      captionRevision: input.captionRevision,
      modelUri: input.modelUri,
      upstreamCaptionRevision: input.upstreamCaptionRevision,
      upstreamSourceHash: upstream.sourceHash,
      upstreamCaptionText: upstream.captionText,
    });
    const storedCaption = input.force
      ? null
      : await dependencies.getCaption(
          input.captionRevision,
          input.petSlug,
        );
    const freshCaption = readFreshDerivedCaption({
      storedCaption,
      expectedSourceHash: sourceHash,
      upstreamCaptionRevision: input.upstreamCaptionRevision,
      upstreamSourceHash: upstream.sourceHash,
      upstreamCaptionText: upstream.captionText,
    });
    if (freshCaption) {
      return {
        ...freshCaption,
        sourceHash,
        created: upstream.created,
      };
    }
    if (!dependencies.rewriteClient) {
      throw new PetVisionIndexingError("configuration_missing");
    }
    const caption = await dependencies.rewriteClient.rewriteCaption(
      upstream.caption,
    );
    const captionText = buildPetVisionCaptionText(caption);
    await dependencies.upsertCaption({
      captionRevision: input.captionRevision,
      slug: input.petSlug,
      sourceHash,
      captionJson: JSON.stringify(
        createPetDerivedVisionCaptionEnvelope({
          upstreamCaptionRevision: input.upstreamCaptionRevision,
          upstreamSourceHash: upstream.sourceHash,
          upstreamCaptionTextSha256:
            createPetVisionCaptionTextHash(upstream.captionText),
          caption,
        }),
      ),
      captionText,
      updatedAt: currentTimestamp(),
    });
    return { caption, captionText, sourceHash, created: true };
  }

  function currentTimestamp(): string {
    return (dependencies.now ?? (() => new Date()))().toISOString();
  }
}

type ResolvedCaption = {
  caption: PetVisionCaption;
  captionText: string;
  sourceHash: string;
  created: boolean;
};

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

function readFreshVisionCaption(input: {
  storedCaption: StoredPetSearchCaption | null;
  expectedSourceHash: string;
  assetId: string;
  spritesheetSha256: string;
}): { caption: PetVisionCaption; captionText: string } | null {
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
    return { caption: envelope.caption, captionText: canonicalText };
  } catch {
    return null;
  }
}

function readFreshDerivedCaption(input: {
  storedCaption: StoredPetSearchCaption | null;
  expectedSourceHash: string;
  upstreamCaptionRevision: string;
  upstreamSourceHash: string;
  upstreamCaptionText: string;
}): { caption: PetVisionCaption; captionText: string } | null {
  if (input.storedCaption?.sourceHash !== input.expectedSourceHash) return null;

  try {
    const envelope = parsePetDerivedVisionCaptionEnvelope(
      input.storedCaption.captionJson,
    );
    const canonicalText = buildPetVisionCaptionText(envelope.caption);
    if (
      envelope.source.upstreamCaptionRevision !==
        input.upstreamCaptionRevision ||
      envelope.source.upstreamSourceHash !== input.upstreamSourceHash ||
      envelope.source.upstreamCaptionTextSha256 !==
        createPetVisionCaptionTextHash(input.upstreamCaptionText) ||
      canonicalText !== input.storedCaption.captionText
    ) {
      return null;
    }
    return { caption: envelope.caption, captionText: canonicalText };
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
  rewriteClient: petCaptionRewriteClient,
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

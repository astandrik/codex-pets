import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import {
  listPetSearchCaptions,
  type StoredPetSearchCaption,
} from "@/lib/pets/search-captions-repository";
import type { PetSearchConfig } from "@/lib/pets/search-config";
import {
  buildPetSearchDocument,
  createPetSearchSourceHash,
  type YandexEmbeddingClient,
} from "@/lib/pets/search-embeddings";
import {
  findSimilarPetEmbeddings,
  getPetSearchEmbeddingMetadata,
  upsertPetSearchEmbedding,
  type StoredEmbeddingMetadata,
  type StoredSemanticPetMatch,
} from "@/lib/pets/search-embeddings-repository";
import {
  createPetSearchService,
  PetSearchFallbackError,
  type PetSearchCatalogItem,
  type PetSearchFallbackReason,
  type PetSearchInput,
  type PetSearchResult,
  type PetSemanticSearchResult,
} from "@/lib/pets/search-service";
import {
  petSearchEmbeddingClient,
  petSearchRuntimeConfig,
} from "@/lib/pets/search-provider-runtime";
import {
  buildPetVisionCaptionText,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  parsePetVisionCaptionEnvelope,
} from "@/lib/pets/search-vision-contract";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import type { ApprovalStatus, PublicPet } from "@/lib/pets/types";
import { trackPetSearch } from "@/lib/metrics/yandex-measurement";

type ApprovedSearchPet = PetSearchCatalogItem & {
  status: ApprovalStatus;
  spritesheetUrl: string;
};

type ApprovedPetSearchRuntimeDependencies<T extends ApprovedSearchPet> = {
  config: PetSearchConfig;
  listApprovedPets: () => Promise<T[]>;
  embeddingClient: YandexEmbeddingClient | null;
  findSimilar: (input: {
    modelRevision: string;
    dimensions: number;
    embedding: readonly number[];
  }) => Promise<StoredSemanticPetMatch[]>;
  listCaptions: (
    captionRevision: string,
  ) => Promise<StoredPetSearchCaption[]>;
  getMetadata: (
    modelRevision: string,
    slug: string,
  ) => Promise<StoredEmbeddingMetadata | null>;
  upsert: (input: {
    modelRevision: string;
    slug: string;
    sourceHash: string;
    dimensions: number;
    embedding: readonly number[];
    updatedAt: string;
  }) => Promise<void>;
  now?: () => Date;
};

export type PetSearchEmbeddingRefreshResult =
  | "skipped"
  | "unchanged"
  | "updated";

export function createApprovedPetSearchRuntime<T extends ApprovedSearchPet>(
  dependencies: ApprovedPetSearchRuntimeDependencies<T>,
) {
  const search = createPetSearchService<T>({
    listApprovedPets: dependencies.listApprovedPets,
    mode: dependencies.config.mode,
    minSemanticScore: dependencies.config.semantic?.minSemanticScore,
    visualMode: dependencies.config.visualMode,
    visualProfile: dependencies.config.visual?.profile,
    configuredVisualFallbackReason:
      dependencies.config.visualFallbackReason,
    semanticSearch,
  });

  return {
    searchApprovedPets: search,
    refreshApprovedPetEmbedding,
  };

  async function semanticSearch(
    query: string,
    candidates: readonly T[],
  ): Promise<PetSemanticSearchResult> {
    const semanticConfig = dependencies.config.semantic;
    const embeddingClient = dependencies.embeddingClient;
    if (!semanticConfig || !embeddingClient) {
      throw new PetSearchFallbackError(
        dependencies.config.fallbackReason ?? "configuration_missing",
      );
    }

    let embedding: number[];
    try {
      embedding = await embeddingClient.embedQuery(query);
    } catch (error) {
      throw new PetSearchFallbackError(providerFallbackReason(error));
    }

    const visualConfig = dependencies.config.visual;
    const readVisual =
      dependencies.config.visualMode !== "off" && visualConfig !== null;
    const [textResult, visualResult, captionsResult] =
      await Promise.allSettled([
        dependencies.findSimilar({
          modelRevision: semanticConfig.revision,
          dimensions: semanticConfig.dimensions,
          embedding,
        }),
        readVisual
          ? dependencies.findSimilar({
              modelRevision: visualConfig.visualRevision,
              dimensions: visualConfig.dimensions,
              embedding,
            })
          : Promise.resolve([]),
        readVisual
          ? dependencies.listCaptions(visualConfig.captionRevision)
          : Promise.resolve([]),
      ]);

    if (textResult.status === "rejected") {
      throw new PetSearchFallbackError("vector_search_error");
    }

    const candidateBySlug = new Map(
      candidates.map((candidate) => [candidate.slug, candidate]),
    );
    const text = textResult.value
      .filter((match) => {
        const pet = candidateBySlug.get(match.slug);
        return (
          pet?.status === "approved" &&
          match.sourceHash ===
            createPetSearchSourceHash(pet, semanticConfig.revision)
        );
      })
      .map(({ slug, score }) => ({ slug, score }));

    if (!readVisual || !visualConfig) {
      return { text, visual: [], visualFallbackReason: null };
    }
    if (visualResult.status === "rejected") {
      return {
        text,
        visual: [],
        visualFallbackReason: "visual_vector_search_error",
      };
    }
    if (captionsResult.status === "rejected") {
      return {
        text,
        visual: [],
        visualFallbackReason: "visual_caption_lookup_error",
      };
    }

    try {
      return {
        text,
        visual: filterCurrentVisualMatches({
          candidates: candidateBySlug,
          storedMatches: visualResult.value,
          storedCaptions: captionsResult.value,
          visualConfig,
        }),
        visualFallbackReason: null,
      };
    } catch {
      return {
        text,
        visual: [],
        visualFallbackReason: "visual_caption_invalid",
      };
    }
  }

  async function refreshApprovedPetEmbedding(
    pet: T,
    options: { force?: boolean } = {},
  ): Promise<PetSearchEmbeddingRefreshResult> {
    if (pet.status !== "approved") return "skipped";

    const semanticConfig = dependencies.config.semantic;
    const embeddingClient = dependencies.embeddingClient;
    if (!semanticConfig || !embeddingClient) return "skipped";

    const sourceHash = createPetSearchSourceHash(
      pet,
      semanticConfig.revision,
    );
    const metadata = await dependencies.getMetadata(
      semanticConfig.revision,
      pet.slug,
    );
    if (
      !options.force &&
      metadata?.sourceHash === sourceHash &&
      metadata.dimensions === semanticConfig.dimensions
    ) {
      return "unchanged";
    }

    const embedding = await embeddingClient.embedDocument(
      buildPetSearchDocument(pet),
    );
    await dependencies.upsert({
      modelRevision: semanticConfig.revision,
      slug: pet.slug,
      sourceHash,
      dimensions: semanticConfig.dimensions,
      embedding,
      updatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
    return "updated";
  }
}

export function filterCurrentVisualMatches<T extends ApprovedSearchPet>(input: {
  candidates: ReadonlyMap<string, T>;
  storedMatches: readonly StoredSemanticPetMatch[];
  storedCaptions: readonly StoredPetSearchCaption[];
  visualConfig: NonNullable<PetSearchConfig["visual"]>;
}): { slug: string; score: number }[] {
  const captionsBySlug = new Map(
    input.storedCaptions.map((caption) => [caption.slug, caption]),
  );

  return input.storedMatches.flatMap((match) => {
    const pet = input.candidates.get(match.slug);
    const caption = captionsBySlug.get(match.slug);
    if (pet?.status !== "approved" || !caption) return [];

    const assetId = getPetAssetIdFromSpritesheetUrl(pet.spritesheetUrl);
    if (!assetId) return [];

    const envelope = parsePetVisionCaptionEnvelope(caption.captionJson);
    const captionText = buildPetVisionCaptionText(envelope.caption);
    if (captionText !== caption.captionText) {
      throw new Error("Stored visual caption is not canonical.");
    }
    if (envelope.source.assetId !== assetId) return [];

    const captionSourceHash = createPetVisionCaptionSourceHash({
      captionRevision: input.visualConfig.captionRevision,
      modelUri: input.visualConfig.modelUri,
      assetId,
      spritesheetSha256: envelope.source.spritesheetSha256,
    });
    if (caption.sourceHash !== captionSourceHash) return [];

    const visualSourceHash = createPetVisualEmbeddingSourceHash({
      visualRevision: input.visualConfig.visualRevision,
      captionRevision: input.visualConfig.captionRevision,
      captionSourceHash,
      captionText,
    });
    if (match.sourceHash !== visualSourceHash) return [];

    return [{ slug: match.slug, score: match.score }];
  });
}

const PROVIDER_FALLBACK_REASONS = new Set<PetSearchFallbackReason>([
  "invalid_request",
  "invalid_response",
  "overloaded",
  "provider_error",
  "rate_limited",
  "timeout",
]);

function providerFallbackReason(error: unknown): PetSearchFallbackReason {
  if (error && typeof error === "object" && "reason" in error) {
    const reason = (error as { reason?: unknown }).reason;
    if (
      typeof reason === "string" &&
      PROVIDER_FALLBACK_REASONS.has(reason as PetSearchFallbackReason)
    ) {
      return reason as PetSearchFallbackReason;
    }
  }
  return "provider_error";
}

const runtime = createApprovedPetSearchRuntime<PublicPet>({
  config: petSearchRuntimeConfig,
  listApprovedPets: listApprovedPetsForSearch,
  embeddingClient: petSearchEmbeddingClient,
  findSimilar: findSimilarPetEmbeddings,
  listCaptions: listPetSearchCaptions,
  getMetadata: getPetSearchEmbeddingMetadata,
  upsert: upsertPetSearchEmbedding,
});

export function searchApprovedPets(
  input: PetSearchInput = {},
): Promise<PetSearchResult<PublicPet>> {
  return runtime.searchApprovedPets(input).then((result) => {
    void trackPetSearch({
      mode: result.mode,
      fallbackReason: result.fallbackReason,
      visualMode: result.visualMode,
      visualFallbackReason: result.visualFallbackReason,
      durationMs: result.durationMs,
      resultCount: result.pets.length,
    });
    return result;
  });
}

export function refreshApprovedPetSearchEmbedding(
  pet: PublicPet,
  options: { force?: boolean } = {},
): Promise<PetSearchEmbeddingRefreshResult> {
  return runtime.refreshApprovedPetEmbedding(pet, options);
}

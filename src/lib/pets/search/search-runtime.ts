import { listPetCaptionsWithSources } from "@/lib/pets/metadata-records";
import { selectFreshCaptionMetadata, groupMetadataBySlug } from "@/lib/pets/metadata-sources";
import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import {
  type StoredPetSearchCaption,
} from "@/lib/pets/search/search-captions-repository";
import type { PetSearchConfig } from "@/lib/pets/search/search-config";
import {
  buildPetSearchDocument,
  createPetSearchSourceHash,
  type EmbeddingClient,
} from "@/lib/pets/search/search-embeddings";
import {
  findSimilarPetEmbeddings,
  getPetSearchEmbeddingMetadata,
  upsertPetSearchEmbedding,
  type StoredEmbeddingMetadata,
  type StoredSemanticPetMatch,
} from "@/lib/pets/search/search-embeddings-repository";
import {
  createPetSearchService,
  PetSearchFallbackError,
  type PetSearchCatalogItem,
  type PetSearchFallbackReason,
  type PetSearchInput,
  type PetSearchOptions,
  type PetSearchResult,
  type PetSemanticSearchResult,
} from "@/lib/pets/search/search-service";
import { getPetSearchProviders } from "@/lib/pets/search/search-provider-runtime";
import {
  createPetVisualEmbeddingSourceHash,
} from "@/lib/pets/search/search-vision-contract";
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
  embeddingClient: Pick<
    EmbeddingClient,
    "embedQuery" | "embedDocument"
  > | null;
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
      dependencies.config.visualMode !== "off" &&
      visualConfig !== null &&
      visualConfig.embeddingModelId === semanticConfig.embeddingModelId;
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
  const captionsBySlug = groupMetadataBySlug(input.storedCaptions);
  return input.storedMatches.flatMap((match) => {
    const pet = input.candidates.get(match.slug);
    if (pet?.status !== "approved") return [];
    const assetId = getPetAssetIdFromSpritesheetUrl(pet.spritesheetUrl);
    if (!assetId) return [];
    const fresh = selectFreshCaptionMetadata(captionsBySlug.get(pet.slug) ?? [], {
      slug: pet.slug, assetId, legacy: input.visualConfig, throwOnMalformed: true,
    });
    if (!fresh) return [];
    const { source, captionText, sourceHash: captionSourceHash } = fresh;

    const visualSourceHash = createPetVisualEmbeddingSourceHash({
      visualRevision: input.visualConfig.visualRevision,
      captionRevision: source.captionRevision,
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

let runtime: ReturnType<typeof createApprovedPetSearchRuntime<PublicPet>> | undefined;

function getSearchRuntime() {
  if (!runtime) {
    const { petSearchRuntimeConfig, petSearchEmbeddingClient } = getPetSearchProviders();
    runtime = createApprovedPetSearchRuntime<PublicPet>({
      config: petSearchRuntimeConfig,
      listApprovedPets: listApprovedPetsForSearch,
      embeddingClient: petSearchEmbeddingClient,
      findSimilar: findSimilarPetEmbeddings,
      listCaptions: listPetCaptionsWithSources,
      getMetadata: getPetSearchEmbeddingMetadata,
      upsert: upsertPetSearchEmbedding,
    });
  }
  return runtime;
}

export async function searchApprovedPets(
  input: PetSearchInput = {},
  options: PetSearchOptions<PublicPet> = {},
): Promise<PetSearchResult<PublicPet>> {
  const result = await getSearchRuntime().searchApprovedPets(input, options);
  void trackPetSearch({
    mode: result.mode,
    fallbackReason: result.fallbackReason,
    visualMode: result.visualMode,
    visualFallbackReason: result.visualFallbackReason,
    durationMs: result.durationMs,
    resultCount: result.pets.length,
  });
  return result;
}

export async function refreshApprovedPetSearchEmbedding(
  pet: PublicPet,
  options: { force?: boolean } = {},
): Promise<PetSearchEmbeddingRefreshResult> {
  return await getSearchRuntime().refreshApprovedPetEmbedding(pet, options);
}

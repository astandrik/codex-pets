import {
  loadPetSearchConfig,
  type PetSearchConfig,
} from "@/lib/pets/search-config";
import {
  buildPetSearchDocument,
  createPetSearchSourceHash,
  createYandexEmbeddingClient,
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
} from "@/lib/pets/search-service";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import type { ApprovalStatus, PublicPet } from "@/lib/pets/types";
import { trackPetSearch } from "@/lib/metrics/yandex-measurement";

type ApprovedSearchPet = PetSearchCatalogItem & { status: ApprovalStatus };

type ApprovedPetSearchRuntimeDependencies<T extends ApprovedSearchPet> = {
  config: PetSearchConfig;
  listApprovedPets: () => Promise<T[]>;
  embeddingClient: YandexEmbeddingClient | null;
  findSimilar: (input: {
    modelRevision: string;
    dimensions: number;
    embedding: readonly number[];
  }) => Promise<StoredSemanticPetMatch[]>;
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
    semanticSearch,
  });

  return {
    searchApprovedPets: search,
    refreshApprovedPetEmbedding,
  };

  async function semanticSearch(
    query: string,
    candidates: readonly T[],
  ): Promise<StoredSemanticPetMatch[]> {
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

    let storedMatches: StoredSemanticPetMatch[];
    try {
      storedMatches = await dependencies.findSimilar({
        modelRevision: semanticConfig.revision,
        dimensions: semanticConfig.dimensions,
        embedding,
      });
    } catch {
      throw new PetSearchFallbackError("vector_search_error");
    }

    const candidateBySlug = new Map(
      candidates.map((candidate) => [candidate.slug, candidate]),
    );
    return storedMatches.filter((match) => {
      const pet = candidateBySlug.get(match.slug);
      return (
        pet?.status === "approved" &&
        match.sourceHash ===
          createPetSearchSourceHash(pet, semanticConfig.revision)
      );
    });
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

const runtimeConfig = loadPetSearchConfig();
const runtimeEmbeddingClient = runtimeConfig.semantic
  ? createYandexEmbeddingClient(runtimeConfig.semantic)
  : null;
const runtime = createApprovedPetSearchRuntime<PublicPet>({
  config: runtimeConfig,
  listApprovedPets: listApprovedPetsForSearch,
  embeddingClient: runtimeEmbeddingClient,
  findSimilar: findSimilarPetEmbeddings,
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

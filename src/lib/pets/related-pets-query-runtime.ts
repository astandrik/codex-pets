import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import {
  buildRelatedPetQuery,
  createRelatedPetQuerySourceHash,
  type YandexEmbeddingClient,
} from "@/lib/pets/search-embeddings";
import {
  getPetSearchEmbeddingMetadata,
  upsertPetSearchEmbedding,
  type StoredEmbeddingMetadata,
} from "@/lib/pets/search-embeddings-repository";
import { petSearchEmbeddingClient } from "@/lib/pets/search-provider-runtime";
import type { PublicPet } from "@/lib/pets/types";

type RelatedPetQueryProfile = {
  textRevision: string;
  textQueryRevision: string;
  textDimensions: number;
};

type RelatedPetQueryRuntimeDependencies = {
  profile: RelatedPetQueryProfile;
  embeddingClient: Pick<
    YandexEmbeddingClient,
    "revision" | "dimensions" | "embedPreparedQuery"
  > | null;
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

export type RelatedPetQueryEmbeddingRefreshResult =
  | "skipped"
  | "unchanged"
  | "updated";

export function createRelatedPetQueryRuntime(
  dependencies: RelatedPetQueryRuntimeDependencies,
) {
  return { refreshApprovedPetRelatedQueryEmbedding };

  async function refreshApprovedPetRelatedQueryEmbedding(
    pet: PublicPet,
  ): Promise<RelatedPetQueryEmbeddingRefreshResult> {
    if (pet.status !== "approved") return "skipped";

    const embeddingClient = dependencies.embeddingClient;
    if (
      !embeddingClient ||
      embeddingClient.revision !== dependencies.profile.textRevision ||
      embeddingClient.dimensions !== dependencies.profile.textDimensions
    ) {
      return "skipped";
    }

    const sourceHash = createRelatedPetQuerySourceHash(
      pet,
      dependencies.profile.textQueryRevision,
    );
    const metadata = await dependencies.getMetadata(
      dependencies.profile.textQueryRevision,
      pet.slug,
    );
    if (
      metadata?.sourceHash === sourceHash &&
      metadata.dimensions === dependencies.profile.textDimensions
    ) {
      return "unchanged";
    }

    const embedding = await embeddingClient.embedPreparedQuery(
      buildRelatedPetQuery(pet, dependencies.profile.textQueryRevision),
    );
    await dependencies.upsert({
      modelRevision: dependencies.profile.textQueryRevision,
      slug: pet.slug,
      sourceHash,
      dimensions: dependencies.profile.textDimensions,
      embedding,
      updatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
    return "updated";
  }
}

const runtime = createRelatedPetQueryRuntime({
  profile: CURRENT_RELATED_PETS_RANKING_PROFILE,
  embeddingClient: petSearchEmbeddingClient,
  getMetadata: getPetSearchEmbeddingMetadata,
  upsert: upsertPetSearchEmbedding,
});

export function refreshApprovedPetRelatedQueryEmbedding(
  pet: PublicPet,
): Promise<RelatedPetQueryEmbeddingRefreshResult> {
  return runtime.refreshApprovedPetRelatedQueryEmbedding(pet);
}

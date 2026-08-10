import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
  createRelatedPetDocumentSourceHash,
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
  embeddingRevision: string;
  textRevision: string;
  textQueryRevision: string;
  textDimensions: number;
};

type RelatedPetQueryRuntimeDependencies = {
  profile: RelatedPetQueryProfile;
  embeddingClient: Pick<
    YandexEmbeddingClient,
    | "revision"
    | "dimensions"
    | "embedPreparedQuery"
    | "embedDocument"
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
  return {
    refreshApprovedPetRelatedDocumentEmbedding,
    refreshApprovedPetRelatedQueryEmbedding,
  };

  async function refreshApprovedPetRelatedQueryEmbedding(
    pet: PublicPet,
  ): Promise<RelatedPetQueryEmbeddingRefreshResult> {
    return refreshApprovedPetRelatedEmbedding(pet, {
      modelRevision: dependencies.profile.textQueryRevision,
      buildInput: buildRelatedPetQuery,
      createSourceHash: createRelatedPetQuerySourceHash,
      embed: (client, text) => client.embedPreparedQuery(text),
    });
  }

  async function refreshApprovedPetRelatedDocumentEmbedding(
    pet: PublicPet,
  ): Promise<RelatedPetQueryEmbeddingRefreshResult> {
    return refreshApprovedPetRelatedEmbedding(pet, {
      modelRevision: dependencies.profile.textRevision,
      buildInput: buildRelatedPetDocument,
      createSourceHash: createRelatedPetDocumentSourceHash,
      embed: (client, text) => client.embedDocument(text),
    });
  }

  async function refreshApprovedPetRelatedEmbedding(
    pet: PublicPet,
    input: {
      modelRevision: string;
      buildInput: (pet: PublicPet, revision: string) => string;
      createSourceHash: (pet: PublicPet, revision: string) => string;
      embed: (
        client: NonNullable<
          RelatedPetQueryRuntimeDependencies["embeddingClient"]
        >,
        text: string,
      ) => Promise<number[]>;
    },
  ): Promise<RelatedPetQueryEmbeddingRefreshResult> {
    if (pet.status !== "approved") return "skipped";

    const embeddingClient = dependencies.embeddingClient;
    if (
      !embeddingClient ||
      embeddingClient.revision !== dependencies.profile.embeddingRevision ||
      embeddingClient.dimensions !== dependencies.profile.textDimensions
    ) {
      return "skipped";
    }

    const sourceHash = input.createSourceHash(pet, input.modelRevision);
    const metadata = await dependencies.getMetadata(
      input.modelRevision,
      pet.slug,
    );
    if (
      metadata?.sourceHash === sourceHash &&
      metadata.dimensions === dependencies.profile.textDimensions
    ) {
      return "unchanged";
    }

    const embedding = await input.embed(
      embeddingClient,
      input.buildInput(pet, input.modelRevision),
    );
    await dependencies.upsert({
      modelRevision: input.modelRevision,
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

export function refreshApprovedPetRelatedDocumentEmbedding(
  pet: PublicPet,
): Promise<RelatedPetQueryEmbeddingRefreshResult> {
  return runtime.refreshApprovedPetRelatedDocumentEmbedding(pet);
}

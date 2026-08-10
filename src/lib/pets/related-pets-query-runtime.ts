import {
  CURRENT_RELATED_PETS_RANKING_PROFILE,
  RELATED_PETS_V10_CALIBRATION_PROFILE,
} from "@/lib/pets/related-pets-profile";
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
  topicRevision?: string;
  topicQueryRevision?: string;
  topicDimensions?: number;
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
    refreshApprovedPetRelatedTopicDocumentEmbedding,
    refreshApprovedPetRelatedTopicQueryEmbedding,
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

  async function refreshApprovedPetRelatedTopicQueryEmbedding(
    pet: PublicPet,
  ): Promise<RelatedPetQueryEmbeddingRefreshResult> {
    if (!dependencies.profile.topicQueryRevision) return "skipped";
    return refreshApprovedPetRelatedEmbedding(pet, {
      modelRevision: dependencies.profile.topicQueryRevision,
      dimensions:
        dependencies.profile.topicDimensions ??
        dependencies.profile.textDimensions,
      buildInput: buildRelatedPetQuery,
      createSourceHash: createRelatedPetQuerySourceHash,
      embed: (client, text) => client.embedPreparedQuery(text),
    });
  }

  async function refreshApprovedPetRelatedTopicDocumentEmbedding(
    pet: PublicPet,
  ): Promise<RelatedPetQueryEmbeddingRefreshResult> {
    if (!dependencies.profile.topicRevision) return "skipped";
    return refreshApprovedPetRelatedEmbedding(pet, {
      modelRevision: dependencies.profile.topicRevision,
      dimensions:
        dependencies.profile.topicDimensions ??
        dependencies.profile.textDimensions,
      buildInput: buildRelatedPetDocument,
      createSourceHash: createRelatedPetDocumentSourceHash,
      embed: (client, text) => client.embedDocument(text),
    });
  }

  async function refreshApprovedPetRelatedEmbedding(
    pet: PublicPet,
    input: {
      modelRevision: string;
      dimensions?: number;
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

    const dimensions = input.dimensions ?? dependencies.profile.textDimensions;
    const sourceHash = input.createSourceHash(pet, input.modelRevision);
    const metadata = await dependencies.getMetadata(
      input.modelRevision,
      pet.slug,
    );
    if (
      metadata?.sourceHash === sourceHash &&
      metadata.dimensions === dimensions
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
      dimensions,
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

const v10Runtime = createRelatedPetQueryRuntime({
  profile: RELATED_PETS_V10_CALIBRATION_PROFILE,
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

export type RelatedPetV10EmbeddingRefresh = {
  descriptionQuery: RelatedPetQueryEmbeddingRefreshResult | "failed";
  descriptionDocument: RelatedPetQueryEmbeddingRefreshResult | "failed";
  topicQuery: RelatedPetQueryEmbeddingRefreshResult | "failed";
  topicDocument: RelatedPetQueryEmbeddingRefreshResult | "failed";
};

export async function refreshApprovedPetRelatedV10Embeddings(
  pet: PublicPet,
): Promise<RelatedPetV10EmbeddingRefresh> {
  const results = await Promise.allSettled([
    v10Runtime.refreshApprovedPetRelatedQueryEmbedding(pet),
    v10Runtime.refreshApprovedPetRelatedDocumentEmbedding(pet),
    v10Runtime.refreshApprovedPetRelatedTopicQueryEmbedding(pet),
    v10Runtime.refreshApprovedPetRelatedTopicDocumentEmbedding(pet),
  ]);
  return {
    descriptionQuery: settledStatus(results[0]),
    descriptionDocument: settledStatus(results[1]),
    topicQuery: settledStatus(results[2]),
    topicDocument: settledStatus(results[3]),
  };
}

function settledStatus(
  result: PromiseSettledResult<RelatedPetQueryEmbeddingRefreshResult>,
): RelatedPetQueryEmbeddingRefreshResult | "failed" {
  return result.status === "fulfilled" ? result.value : "failed";
}

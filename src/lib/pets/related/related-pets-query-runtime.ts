import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related/related-pets-profile";
import {
  type EmbeddingClient,
} from "@/lib/pets/search/search-embeddings";
import {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
  createRelatedPetDocumentSourceHash,
  createRelatedPetQuerySourceHash,
} from "@/lib/pets/related/related-pets-embeddings";
import {
  getPetSearchEmbeddingMetadata,
  upsertPetSearchEmbedding,
  type StoredEmbeddingMetadata,
} from "@/lib/pets/search/search-embeddings-repository";
import { getPetSearchProviders } from "@/lib/pets/search/search-provider-runtime";
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
    EmbeddingClient,
    "revision" | "dimensions" | "embedPreparedQuery" | "embedDocument"
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

export type RelatedPetDescriptionEmbeddingRefresh = {
  descriptionQuery: RelatedPetQueryEmbeddingRefreshResult | "failed";
  descriptionDocument: RelatedPetQueryEmbeddingRefreshResult | "failed";
};

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

let runtime: ReturnType<typeof createRelatedPetQueryRuntime> | undefined;

function getRelatedQueryRuntime() {
  if (!runtime) {
    const { petSearchEmbeddingClient } = getPetSearchProviders();
    runtime = createRelatedPetQueryRuntime({
      profile: RELATED_PETS_V24_PROFILE,
      embeddingClient: petSearchEmbeddingClient,
      getMetadata: getPetSearchEmbeddingMetadata,
      upsert: upsertPetSearchEmbedding,
    });
  }
  return runtime;
}

export async function refreshApprovedPetRelatedQueryEmbedding(
  pet: PublicPet,
): Promise<RelatedPetQueryEmbeddingRefreshResult> {
  return await getRelatedQueryRuntime().refreshApprovedPetRelatedQueryEmbedding(pet);
}

export async function refreshApprovedPetRelatedDocumentEmbedding(
  pet: PublicPet,
): Promise<RelatedPetQueryEmbeddingRefreshResult> {
  return await getRelatedQueryRuntime().refreshApprovedPetRelatedDocumentEmbedding(pet);
}

export async function refreshApprovedPetRelatedDescriptionEmbeddings(
  pet: PublicPet,
): Promise<RelatedPetDescriptionEmbeddingRefresh> {
  const results = await Promise.allSettled([
    refreshApprovedPetRelatedQueryEmbedding(pet),
    refreshApprovedPetRelatedDocumentEmbedding(pet),
  ]);
  return {
    descriptionQuery: settledStatus(results[0]),
    descriptionDocument: settledStatus(results[1]),
  };
}

export async function refreshApprovedPetRelatedDescriptionEmbeddingsStrict(
  pet: PublicPet,
): Promise<{
  descriptionQuery: RelatedPetQueryEmbeddingRefreshResult;
  descriptionDocument: RelatedPetQueryEmbeddingRefreshResult;
}> {
  const descriptionQuery = await getRelatedQueryRuntime()
    .refreshApprovedPetRelatedQueryEmbedding(pet);
  const descriptionDocument = await getRelatedQueryRuntime()
    .refreshApprovedPetRelatedDocumentEmbedding(pet);
  return { descriptionQuery, descriptionDocument };
}

function settledStatus(
  result: PromiseSettledResult<RelatedPetQueryEmbeddingRefreshResult>,
): RelatedPetQueryEmbeddingRefreshResult | "failed" {
  return result.status === "fulfilled" ? result.value : "failed";
}

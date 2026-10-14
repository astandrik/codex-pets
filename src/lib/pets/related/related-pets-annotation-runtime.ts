import { getPetAnnotationCandidates } from "@/lib/pets/metadata-records";
import { resolveAnnotationMetadataSource, selectFreshAnnotationMetadata, OPENAI_ANNOTATION_REVISION } from "@/lib/pets/metadata-sources";
import { isOpenAIPetsProfile, OPENAI_PETS_REVISIONS } from "@/lib/pets/openai-embedding-profile";
import { createPrivateOpenAIEmbeddingClient } from "@/lib/pets/openai-embedding-client";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related/related-pets-profile";
import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_MODEL_NAME,
  RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
  RELATED_PETS_ANNOTATION_WRITE_PROPOSAL_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
  createRelatedPetAnnotationEmbeddingSourceHash,
  type RelatedPetAnnotationInput,
  type RelatedPetAnnotationProposal,
} from "@/lib/pets/related/related-pets-annotation-contract.mjs";
import { createYandexRelatedPetAnnotationClient } from "@/lib/pets/related/related-pets-annotation-client.mjs";
import { refreshRelatedPetAnnotationRecord, validateCurrentRelatedPetAnnotation } from "@/lib/pets/related/related-pets-annotation-refresh.mjs";
import {
  getRelatedPetAnnotation,
  upsertRelatedPetAnnotation,
} from "@/lib/pets/related/related-pets-annotations-repository";
import {
  createYandexEmbeddingClient,
  type EmbeddingClient,
} from "@/lib/pets/search/search-embeddings";
import {
  PET_SEARCH_EMBEDDING_MODELS,
  type PetSearchSemanticConfig,
} from "@/lib/pets/search/search-config";
import {
  getPetSearchEmbeddingMetadata,
  upsertPetSearchEmbedding,
} from "@/lib/pets/search/search-embeddings-repository";
import { getPetSearchProviders } from "@/lib/pets/search/search-provider-runtime";

export type RelatedPetAnnotationRefreshResult =
  | "unchanged"
  | "annotation-and-vectors"
  | "vectors-only";

type Dependencies = {
  annotationRevision: string;
  proposalRevision: string;
  acceptedProposalRevisions?: readonly string[];
  queryRevision: string;
  documentRevision: string;
  dimensions: number;
  modelUri: string;
  createProposal: (
    pet: RelatedPetAnnotationInput,
  ) => Promise<RelatedPetAnnotationProposal>;
  embeddingClient: Pick<
    EmbeddingClient,
    "embedPreparedQuery" | "embedDocument"
  >;
  getAnnotation: typeof getRelatedPetAnnotation;
  getAnnotationCandidates?: typeof getPetAnnotationCandidates;
  upsertAnnotation: typeof upsertRelatedPetAnnotation;
  getEmbeddingMetadata: typeof getPetSearchEmbeddingMetadata;
  upsertEmbedding: typeof upsertPetSearchEmbedding;
  now?: () => Date;
};

export function createRelatedPetAnnotationRuntime(dependencies: Dependencies) {
  return { refresh };

  async function refresh(
    pet: RelatedPetAnnotationInput,
  ): Promise<RelatedPetAnnotationRefreshResult> {
    const candidates = dependencies.getAnnotationCandidates
      ? await dependencies.getAnnotationCandidates(dependencies.annotationRevision, pet.slug)
      : [await dependencies.getAnnotation(dependencies.annotationRevision, pet.slug)].filter((row) => row !== null);
    const legacy = { annotationRevision: dependencies.annotationRevision, modelUri: dependencies.modelUri,
      proposalRevision: dependencies.proposalRevision, acceptedProposalRevisions: dependencies.acceptedProposalRevisions };
    const fresh = selectFreshAnnotationMetadata(pet, candidates, legacy);
    const stored = fresh?.row ?? candidates.find(row => row.annotationRevision === OPENAI_ANNOTATION_REVISION) ?? candidates[0] ?? null;
    const source = resolveAnnotationMetadataSource(stored?.annotationRevision, legacy);
    const annotation = source.annotationRevision === OPENAI_ANNOTATION_REVISION && stored
      ? { outcome: "unchanged", ...validateCurrentRelatedPetAnnotation({ pet, stored, ...source }) }
      : await refreshRelatedPetAnnotationRecord({
      mode: "apply",
      force: false,
      pet,
      modelUri: dependencies.modelUri,
      annotationRevision: dependencies.annotationRevision,
      proposalRevision: dependencies.proposalRevision,
      acceptedProposalRevisions: dependencies.acceptedProposalRevisions,
      getAnnotation: async () => stored,
      createProposal: dependencies.createProposal,
      upsertAnnotation: dependencies.upsertAnnotation,
      now,
    });
    const annotationUpdated = annotation.outcome === "updated";

    const queryUpdated = await refreshVector({
      revision: dependencies.queryRevision,
      role: "query",
      embed: (text) => dependencies.embeddingClient.embedPreparedQuery(text),
    });
    const documentUpdated = await refreshVector({
      revision: dependencies.documentRevision,
      role: "document",
      embed: (text) => dependencies.embeddingClient.embedDocument(text),
    });
    if (!annotationUpdated && !queryUpdated && !documentUpdated) {
      return "unchanged";
    }
    return annotationUpdated ? "annotation-and-vectors" : "vectors-only";

    async function refreshVector(input: {
      revision: string;
      role: "query" | "document";
      embed: (text: string) => Promise<number[]>;
    }): Promise<boolean> {
      const vectorSourceHash = createRelatedPetAnnotationEmbeddingSourceHash({
        modelRevision: input.revision,
        role: input.role,
        annotationRevision: source.annotationRevision,
        annotationSourceHash: annotation.sourceHash,
        annotationText: annotation.annotationText,
      });
      const metadata = await dependencies.getEmbeddingMetadata(
        input.revision,
        pet.slug,
      );
      if (
        metadata?.sourceHash === vectorSourceHash &&
        metadata.dimensions === dependencies.dimensions
      ) {
        return false;
      }
      const embedding = await input.embed(annotation.annotationText);
      if (embedding.length !== dependencies.dimensions) {
        throw Object.assign(new Error("annotation_embedding_invalid"), {
          reason: "annotation_embedding_invalid",
        });
      }
      await dependencies.upsertEmbedding({
        modelRevision: input.revision,
        slug: pet.slug,
        sourceHash: vectorSourceHash,
        dimensions: dependencies.dimensions,
        embedding,
        updatedAt: now().toISOString(),
      });
      return true;
    }
  }

  function now(): Date {
    return (dependencies.now ?? (() => new Date()))();
  }
}

export function createRelatedPetAnnotationEmbeddingClient(
  config: PetSearchSemanticConfig,
): EmbeddingClient {
  if (config.privateEmbedding) return createPrivateOpenAIEmbeddingClient({
    ...config.privateEmbedding, revision: OPENAI_PETS_REVISIONS.annotationDocument, timeoutMs: config.timeoutMs,
  });
  return createYandexEmbeddingClient({
    folderId: config.folderId,
    apiKey: config.apiKey,
    revision: RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
    ...PET_SEARCH_EMBEDDING_MODELS["yandex-text-embeddings-v2-768"],
    timeoutMs: config.timeoutMs,
  });
}

let productionRuntime: ReturnType<typeof createRelatedPetAnnotationRuntime> | null | undefined;

function getAnnotationRuntime() {
  if (productionRuntime !== undefined) return productionRuntime;
  const { petSearchRuntimeConfig, metadataMaxAttempts } = getPetSearchProviders();
  const semantic = petSearchRuntimeConfig.semantic;
  const annotationEmbeddingClient = semantic
    ? createRelatedPetAnnotationEmbeddingClient(semantic)
    : null;
  productionRuntime = semantic && annotationEmbeddingClient
    ? createRelatedPetAnnotationRuntime({
        annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
        proposalRevision: RELATED_PETS_ANNOTATION_WRITE_PROPOSAL_REVISION,
        acceptedProposalRevisions:
          RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
        queryRevision: RELATED_PETS_V24_PROFILE.annotationQueryRevision,
        documentRevision: RELATED_PETS_V24_PROFILE.annotationDocumentRevision,
        dimensions: RELATED_PETS_V24_PROFILE.annotationDimensions,
        modelUri: `gpt://${semantic.folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`,
        createProposal: isOpenAIPetsProfile() ? async () => {
          throw Object.assign(new Error("metadata_openai_annotation_missing"), { reason: "metadata_openai_annotation_missing" });
        } : createYandexRelatedPetAnnotationClient({
          folderId: semantic.folderId,
          apiKey: semantic.apiKey,
          modelUri: `gpt://${semantic.folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`,
          proposalRevision: RELATED_PETS_ANNOTATION_WRITE_PROPOSAL_REVISION,
          timeoutMs: 180_000,
          maxAttempts: metadataMaxAttempts,
        }).createProposal,
        embeddingClient: annotationEmbeddingClient,
        getAnnotation: getRelatedPetAnnotation,
        getAnnotationCandidates: getPetAnnotationCandidates,
        upsertAnnotation: upsertRelatedPetAnnotation,
        getEmbeddingMetadata: getPetSearchEmbeddingMetadata,
        upsertEmbedding: upsertPetSearchEmbedding,
      })
    : null;
  return productionRuntime;
}

export async function refreshPetRelatedAnnotation(
  pet: RelatedPetAnnotationInput,
): Promise<RelatedPetAnnotationRefreshResult> {
  const runtime = getAnnotationRuntime();
  if (!runtime) {
    throw Object.assign(new Error("annotation_configuration_missing"), {
      reason: "annotation_configuration_missing",
    });
  }
  return runtime.refresh(pet);
}

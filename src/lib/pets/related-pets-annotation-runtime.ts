import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_MODEL_NAME,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationEmbeddingSourceHash,
  createRelatedPetAnnotationSourceHash,
  listUnresolvedStrongRelations,
  resolveRelatedPetAnnotation,
  type RelatedPetAnnotationInput,
  type RelatedPetAnnotationProposal,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import { createYandexRelatedPetAnnotationClient } from "@/lib/pets/related-pets-annotation-client.mjs";
import {
  getRelatedPetAnnotation,
  upsertRelatedPetAnnotation,
} from "@/lib/pets/related-pets-annotations-repository";
import type { YandexEmbeddingClient } from "@/lib/pets/search-embeddings";
import {
  getPetSearchEmbeddingMetadata,
  upsertPetSearchEmbedding,
} from "@/lib/pets/search-embeddings-repository";
import {
  petSearchEmbeddingClient,
  petSearchRuntimeConfig,
} from "@/lib/pets/search-provider-runtime";

export type RelatedPetAnnotationRefreshResult =
  | "unchanged"
  | "annotation-and-vectors"
  | "vectors-only";

type Dependencies = {
  annotationRevision: string;
  queryRevision: string;
  documentRevision: string;
  dimensions: number;
  modelUri: string;
  createProposal: (
    pet: RelatedPetAnnotationInput,
  ) => Promise<RelatedPetAnnotationProposal>;
  embeddingClient: Pick<
    YandexEmbeddingClient,
    "embedPreparedQuery" | "embedDocument"
  >;
  getAnnotation: typeof getRelatedPetAnnotation;
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
    const sourceHash = createRelatedPetAnnotationSourceHash({
      pet,
      modelUri: dependencies.modelUri,
      annotationRevision: dependencies.annotationRevision,
    });
    const stored = await dependencies.getAnnotation(
      dependencies.annotationRevision,
      pet.slug,
    );
    let annotationUpdated = false;
    let annotationSourceHash = stored?.sourceHash ?? "";
    let annotationText = stored?.annotationText ?? "";
    if (stored?.sourceHash !== sourceHash) {
      const proposal = await dependencies.createProposal(pet);
      if (listUnresolvedStrongRelations({ slug: pet.slug, proposal }).length > 0) {
        throw Object.assign(new Error("unresolved_strong_relation"), {
          reason: "unresolved_strong_relation",
        });
      }
      const annotation = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
      annotationText = buildRelatedPetAnnotationText(annotation);
      annotationSourceHash = sourceHash;
      await dependencies.upsertAnnotation({
        annotationRevision: dependencies.annotationRevision,
        slug: pet.slug,
        sourceHash,
        proposalJson: JSON.stringify(proposal),
        annotationJson: JSON.stringify(annotation),
        annotationText,
        updatedAt: now().toISOString(),
      });
      annotationUpdated = true;
    }

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
        annotationRevision: dependencies.annotationRevision,
        annotationSourceHash,
        annotationText,
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
      const embedding = await input.embed(annotationText);
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

const semantic = petSearchRuntimeConfig.semantic;
const productionRuntime = semantic && petSearchEmbeddingClient
  ? createRelatedPetAnnotationRuntime({
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      queryRevision: RELATED_PETS_ANNOTATION_QUERY_REVISION,
      documentRevision: RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
      dimensions: 768,
      modelUri: `gpt://${semantic.folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`,
      createProposal: createYandexRelatedPetAnnotationClient({
        folderId: semantic.folderId,
        apiKey: semantic.apiKey,
        modelUri: `gpt://${semantic.folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`,
        timeoutMs: 180_000,
      }).createProposal,
      embeddingClient: petSearchEmbeddingClient,
      getAnnotation: getRelatedPetAnnotation,
      upsertAnnotation: upsertRelatedPetAnnotation,
      getEmbeddingMetadata: getPetSearchEmbeddingMetadata,
      upsertEmbedding: upsertPetSearchEmbedding,
    })
  : null;

export async function refreshPetRelatedAnnotation(
  pet: RelatedPetAnnotationInput,
): Promise<RelatedPetAnnotationRefreshResult> {
  if (!productionRuntime) {
    throw Object.assign(new Error("annotation_configuration_missing"), {
      reason: "annotation_configuration_missing",
    });
  }
  return productionRuntime.refresh(pet);
}

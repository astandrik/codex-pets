export const PET_SEARCH_BACKFILL_REVISIONS = {
  "yandex-text-search-2026-07": {
    dimensions: 256,
    documentModelPath: "text-search-doc/latest",
    requestDimensions: null,
  },
  "yandex-text-embeddings-v2-768-2026-07": {
    dimensions: 768,
    // The REST textEmbedding endpoint rejects a trailing slash for v2 URIs.
    documentModelPath: "text-embeddings-v2-doc",
    requestDimensions: 768,
  },
  "yandex-text-embeddings-v2-768-related-tags-query-2026-08": {
    dimensions: 768,
    modelPath: "text-embeddings-v2-query",
    requestDimensions: 768,
    inputKind: "related-query",
  },
};

export const PET_VISION_BACKFILL_CAPTION_REVISIONS = {
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1": {
    modelName: "qwen3.6-35b-a3b",
  },
};

export const PET_VISUAL_BACKFILL_REVISIONS = {
  "yandex-text-search-2026-07-pet-vision-v1": {
    captionRevision:
      "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1",
    dimensions: 256,
    documentModelPath: "text-search-doc/latest",
    requestDimensions: null,
  },
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1": {
    captionRevision:
      "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1",
    dimensions: 768,
    documentModelPath: "text-embeddings-v2-doc",
    requestDimensions: 768,
  },
};

export function requirePetSearchBackfillRevision(revision) {
  const definition = PET_SEARCH_BACKFILL_REVISIONS[revision];
  if (!definition) {
    throw new Error(
      "PET_SEARCH_MODEL_REVISION must name a supported additive search revision.",
    );
  }
  return definition;
}

export function createEmbeddingRequest({ folderId, definition, text }) {
  return {
    modelUri: `emb://${folderId}/${definition.modelPath ?? definition.documentModelPath}`,
    text,
    ...(definition.requestDimensions
      ? { dim: String(definition.requestDimensions) }
      : {}),
  };
}

export function requirePetVisualBackfillRevision({
  captionRevision,
  visualRevision,
}) {
  const captionDefinition =
    PET_VISION_BACKFILL_CAPTION_REVISIONS[captionRevision];
  const visualDefinition =
    PET_VISUAL_BACKFILL_REVISIONS[visualRevision];
  if (
    !captionDefinition ||
    !visualDefinition ||
    visualDefinition.captionRevision !== captionRevision
  ) {
    throw new Error(
      "Caption and visual revisions must name one compatible managed pipeline.",
    );
  }
  return { captionDefinition, visualDefinition };
}

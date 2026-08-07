import {
  loadPetSearchConfig,
  PET_SEARCH_EMBEDDING_MODELS,
} from "@/lib/pets/search-config";
import { createYandexEmbeddingClient } from "@/lib/pets/search-embeddings";
import { createYandexVisionCaptionClient } from "@/lib/pets/search-vision-client";

export const petSearchRuntimeConfig = loadPetSearchConfig();

const semanticEmbeddingConfig = petSearchRuntimeConfig.semantic;
const visualEmbeddingConfig = petSearchRuntimeConfig.visual;

export const petSearchEmbeddingClient = semanticEmbeddingConfig
  ? createYandexEmbeddingClient({
      folderId: semanticEmbeddingConfig.folderId,
      apiKey: semanticEmbeddingConfig.apiKey,
      revision: semanticEmbeddingConfig.revision,
      ...PET_SEARCH_EMBEDDING_MODELS[
        semanticEmbeddingConfig.embeddingModelId
      ],
      timeoutMs: semanticEmbeddingConfig.timeoutMs,
    })
  : null;

export const petVisualEmbeddingClient = visualEmbeddingConfig
  ? createYandexEmbeddingClient({
      folderId: visualEmbeddingConfig.folderId,
      apiKey: visualEmbeddingConfig.apiKey,
      revision: visualEmbeddingConfig.visualRevision,
      ...PET_SEARCH_EMBEDDING_MODELS[
        visualEmbeddingConfig.embeddingModelId
      ],
      timeoutMs: semanticEmbeddingConfig?.timeoutMs ?? 800,
    })
  : null;

export const petVisionCaptionClient = visualEmbeddingConfig
  ? createYandexVisionCaptionClient({
      folderId: visualEmbeddingConfig.folderId,
      apiKey: visualEmbeddingConfig.apiKey,
      modelUri: visualEmbeddingConfig.modelUri,
      timeoutMs: visualEmbeddingConfig.visionTimeoutMs,
      captionRevision: visualEmbeddingConfig.captionRevision,
    })
  : null;

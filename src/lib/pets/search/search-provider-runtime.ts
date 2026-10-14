import { isOpenAIPetsProfile } from "@/lib/pets/openai-embedding-profile";
import { loadMetadataMaxAttempts } from "@/lib/pets/metadata-attempts.mjs";
import {
  loadPetSearchConfig,
  PET_SEARCH_EMBEDDING_MODELS,
} from "@/lib/pets/search/search-config";
import { createPrivateOpenAIEmbeddingClient } from "@/lib/pets/openai-embedding-client";
import { createYandexEmbeddingClient } from "@/lib/pets/search/search-embeddings";
import { createYandexVisionCaptionClient } from "@/lib/pets/search/search-vision-client";

let providers: ReturnType<typeof createPetSearchProviders> | undefined;

export function getPetSearchProviders() {
  return providers ??= createPetSearchProviders();
}

function createPetSearchProviders() {
  const metadataMaxAttempts = loadMetadataMaxAttempts();
  const petSearchRuntimeConfig = loadPetSearchConfig();

  const semanticEmbeddingConfig = petSearchRuntimeConfig.semantic;
  const visualEmbeddingConfig = petSearchRuntimeConfig.visual;

  const petSearchEmbeddingClient = semanticEmbeddingConfig
    ? semanticEmbeddingConfig.privateEmbedding
      ? createPrivateOpenAIEmbeddingClient({ ...semanticEmbeddingConfig.privateEmbedding,
          revision: semanticEmbeddingConfig.revision, timeoutMs: semanticEmbeddingConfig.timeoutMs })
      : createYandexEmbeddingClient({
        folderId: semanticEmbeddingConfig.folderId,
        apiKey: semanticEmbeddingConfig.apiKey,
        revision: semanticEmbeddingConfig.revision,
        ...PET_SEARCH_EMBEDDING_MODELS[
          semanticEmbeddingConfig.embeddingModelId
        ],
        timeoutMs: semanticEmbeddingConfig.timeoutMs,
      })
    : null;

  const petVisualEmbeddingClient = visualEmbeddingConfig
    ? visualEmbeddingConfig.privateEmbedding
      ? createPrivateOpenAIEmbeddingClient({ ...visualEmbeddingConfig.privateEmbedding,
          revision: visualEmbeddingConfig.visualRevision, timeoutMs: semanticEmbeddingConfig?.timeoutMs ?? 5000 })
      : createYandexEmbeddingClient({
        folderId: visualEmbeddingConfig.folderId,
        apiKey: visualEmbeddingConfig.apiKey,
        revision: visualEmbeddingConfig.visualRevision,
        ...PET_SEARCH_EMBEDDING_MODELS[
          visualEmbeddingConfig.embeddingModelId
        ],
        timeoutMs: semanticEmbeddingConfig?.timeoutMs ?? 800,
      })
    : null;

  const petVisionCaptionClient = visualEmbeddingConfig && !isOpenAIPetsProfile()
    ? createYandexVisionCaptionClient({
        folderId: visualEmbeddingConfig.folderId,
        apiKey: visualEmbeddingConfig.apiKey,
        modelUri: visualEmbeddingConfig.modelUri,
        timeoutMs: visualEmbeddingConfig.visionTimeoutMs,
        maxAttempts: metadataMaxAttempts,
      })
    : null;
  return {
    petSearchRuntimeConfig,
    petSearchEmbeddingClient,
    petVisualEmbeddingClient,
    petVisionCaptionClient,
    metadataMaxAttempts,
  };
}

import { loadPetSearchConfig } from "@/lib/pets/search-config";
import { createYandexEmbeddingClient } from "@/lib/pets/search-embeddings";
import { createYandexVisionCaptionClient } from "@/lib/pets/search-vision-client";

export const petSearchRuntimeConfig = loadPetSearchConfig();

const embeddingConfig =
  petSearchRuntimeConfig.semantic ?? petSearchRuntimeConfig.visual;

export const petSearchEmbeddingClient = embeddingConfig
  ? createYandexEmbeddingClient({
      folderId: embeddingConfig.folderId,
      apiKey: embeddingConfig.apiKey,
      revision:
        petSearchRuntimeConfig.semantic?.revision ??
        petSearchRuntimeConfig.visual?.visualRevision ??
        "yandex-text-search-provider",
      dimensions: embeddingConfig.dimensions,
      timeoutMs: petSearchRuntimeConfig.semantic?.timeoutMs ?? 800,
    })
  : null;

export const petVisionCaptionClient = petSearchRuntimeConfig.visual
  ? createYandexVisionCaptionClient({
      folderId: petSearchRuntimeConfig.visual.folderId,
      apiKey: petSearchRuntimeConfig.visual.apiKey,
      modelUri: petSearchRuntimeConfig.visual.modelUri,
      captionRevision: petSearchRuntimeConfig.visual.captionRevision,
      timeoutMs: petSearchRuntimeConfig.visual.visionTimeoutMs,
    })
  : null;

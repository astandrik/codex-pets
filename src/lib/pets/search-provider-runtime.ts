import {
  loadPetSearchConfig,
  PET_SEARCH_EMBEDDING_MODELS,
  PET_VISION_CAPTION_REVISIONS,
} from "@/lib/pets/search-config";
import { createYandexCaptionRewriteClient } from "@/lib/pets/search-caption-rewriter";
import { createYandexEmbeddingClient } from "@/lib/pets/search-embeddings";
import { createYandexVisionCaptionClient } from "@/lib/pets/search-vision-client";

export const petSearchRuntimeConfig = loadPetSearchConfig();

const semanticEmbeddingConfig = petSearchRuntimeConfig.semantic;
const visualEmbeddingConfig = petSearchRuntimeConfig.visual;
const captionDefinition = visualEmbeddingConfig
  ? PET_VISION_CAPTION_REVISIONS[
      visualEmbeddingConfig.captionRevision
    ]
  : null;

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
      timeoutMs: petSearchRuntimeConfig.semantic?.timeoutMs ?? 800,
    })
  : null;

export const petVisionCaptionClient =
  visualEmbeddingConfig && captionDefinition
  ? createYandexVisionCaptionClient({
      folderId: visualEmbeddingConfig.folderId,
      apiKey: visualEmbeddingConfig.apiKey,
      modelUri:
        captionDefinition.kind === "vision"
          ? visualEmbeddingConfig.modelUri
          : `gpt://${visualEmbeddingConfig.folderId}/${captionDefinition.upstreamModelName}`,
      timeoutMs: visualEmbeddingConfig.visionTimeoutMs,
    })
  : null;

export const petCaptionRewriteClient =
  visualEmbeddingConfig && captionDefinition?.kind === "rewrite"
    ? createYandexCaptionRewriteClient({
        folderId: visualEmbeddingConfig.folderId,
        apiKey: visualEmbeddingConfig.apiKey,
        modelUri: visualEmbeddingConfig.modelUri,
        timeoutMs: visualEmbeddingConfig.visionTimeoutMs,
      })
    : null;

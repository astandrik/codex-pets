import { readFileSync } from "node:fs";

import type { PetSearchMode } from "@/lib/pets/search-service";
import {
  PET_VISION_CAPTION_REVISION,
  PET_VISION_CAPTION_REVISION_V2,
  PET_VISION_CAPTION_REVISION_V3,
  PET_VISUAL_MODEL_REVISION,
  PET_VISUAL_MODEL_REVISION_V2,
  PET_VISUAL_MODEL_REVISION_V3,
} from "@/lib/pets/search-vision-contract";

const DEFAULT_EMBEDDING_TIMEOUT_MS = 800;
const DEFAULT_VISION_TIMEOUT_MS = 180_000;
const MIN_EMBEDDING_TIMEOUT_MS = 50;
const MAX_EMBEDDING_TIMEOUT_MS = 5_000;
const MIN_VISION_TIMEOUT_MS = 1_000;
const MAX_VISION_TIMEOUT_MS = 300_000;

export const PET_SEARCH_MODEL_REVISIONS = {
  "yandex-text-search-2026-07": {
    embeddingModelId: "yandex-text-search-v1-256",
    minSemanticScore: 0.31,
  },
  "yandex-text-embeddings-v2-768-2026-07": {
    embeddingModelId: "yandex-text-embeddings-v2-768",
    minSemanticScore: 0.28,
  },
} as const;

export const PET_SEARCH_EMBEDDING_MODELS = {
  "yandex-text-search-v1-256": {
    dimensions: 256,
    queryModelPath: "text-search-query/latest",
    documentModelPath: "text-search-doc/latest",
    requestDimensions: null,
  },
  "yandex-text-embeddings-v2-768": {
    dimensions: 768,
    queryModelPath: "text-embeddings-v2-query",
    documentModelPath: "text-embeddings-v2-doc",
    requestDimensions: 768,
  },
} as const;

export type PetSearchEmbeddingModelId =
  keyof typeof PET_SEARCH_EMBEDDING_MODELS;

export type PetVisualCalibrationProfile = {
  minSemanticScore: number;
  weight: number;
};

type PetVisualModelRevisionDefinition = {
  embeddingModelId: PetSearchEmbeddingModelId;
  captionRevision: string;
  profile: PetVisualCalibrationProfile | null;
};

export const PET_VISION_CAPTION_REVISIONS = {
  [PET_VISION_CAPTION_REVISION]: {
    modelName: "qwen3.6-35b-a3b",
  },
  [PET_VISION_CAPTION_REVISION_V2]: {
    modelName: "qwen3.6-35b-a3b",
  },
  [PET_VISION_CAPTION_REVISION_V3]: {
    modelName: "qwen3.6-35b-a3b",
  },
} as const;

export const PET_VISUAL_MODEL_REVISIONS = {
  [PET_VISUAL_MODEL_REVISION]: {
    embeddingModelId: "yandex-text-search-v1-256",
    captionRevision: PET_VISION_CAPTION_REVISION,
    profile: {
      minSemanticScore: 0.3455384373664856,
      weight: 0.25,
    },
  },
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1": {
    embeddingModelId: "yandex-text-embeddings-v2-768",
    captionRevision: PET_VISION_CAPTION_REVISION,
    profile: {
      minSemanticScore: 0.3574455678462982,
      weight: 0.25,
    },
  },
  [PET_VISUAL_MODEL_REVISION_V2]: {
    embeddingModelId: "yandex-text-embeddings-v2-768",
    captionRevision: PET_VISION_CAPTION_REVISION_V2,
    profile: {
      minSemanticScore: 0.42264288663864136,
      weight: 1,
    },
  },
  [PET_VISUAL_MODEL_REVISION_V3]: {
    embeddingModelId: "yandex-text-embeddings-v2-768",
    captionRevision: PET_VISION_CAPTION_REVISION_V3,
    profile: {
      minSemanticScore: 0.5043169260025024,
      weight: 1,
    },
  },
} as const satisfies Record<string, PetVisualModelRevisionDefinition>;

export type PetSearchVisualMode = "off" | "shadow" | "hybrid";

export type PetSearchConfigurationFallbackReason =
  | "configuration_missing"
  | "secret_unavailable"
  | "unsupported_model_revision";

export type PetVisualSearchFallbackReason =
  | "visual_configuration_missing"
  | "visual_embedding_incompatible"
  | "visual_calibration_missing"
  | "visual_vector_search_error"
  | "visual_caption_lookup_error"
  | "visual_caption_invalid";

export type PetSearchSemanticConfig = {
  folderId: string;
  apiKey: string;
  revision: keyof typeof PET_SEARCH_MODEL_REVISIONS;
  embeddingModelId: PetSearchEmbeddingModelId;
  dimensions: number;
  minSemanticScore: number;
  timeoutMs: number;
};

export type PetSearchVisualConfig = {
  folderId: string;
  apiKey: string;
  captionRevision: keyof typeof PET_VISION_CAPTION_REVISIONS;
  visualRevision: keyof typeof PET_VISUAL_MODEL_REVISIONS;
  embeddingModelId: PetSearchEmbeddingModelId;
  dimensions: number;
  profile: PetVisualCalibrationProfile | null;
  visionTimeoutMs: number;
  modelUri: string;
};

export type PetSearchConfig = {
  mode: PetSearchMode;
  semantic: PetSearchSemanticConfig | null;
  fallbackReason: PetSearchConfigurationFallbackReason | null;
  visualMode: PetSearchVisualMode;
  visual: PetSearchVisualConfig | null;
  visualFallbackReason: PetVisualSearchFallbackReason | null;
};

type Environment = Readonly<Record<string, string | undefined>>;
type ReadTextFile = (path: string) => string;

export function loadPetSearchConfig(
  environment: Environment = process.env,
  readTextFile: ReadTextFile = (path) => readFileSync(path, "utf8"),
): PetSearchConfig {
  const mode = readMode(environment.PET_SEARCH_MODE);
  const visualMode = readVisualMode(environment.PET_SEARCH_VISUAL_MODE);
  const textRevisionValue =
    environment.PET_SEARCH_MODEL_REVISION?.trim() ?? "";
  const captionRevisionValue =
    environment.PET_SEARCH_VISION_CAPTION_REVISION?.trim() ||
    PET_VISION_CAPTION_REVISION;
  const visualRevisionValue =
    environment.PET_SEARCH_VISUAL_MODEL_REVISION?.trim() ||
    PET_VISUAL_MODEL_REVISION;
  const visualConfiguredExplicitly =
    visualMode !== "off" ||
    Boolean(environment.PET_SEARCH_VISION_CAPTION_REVISION?.trim()) ||
    Boolean(environment.PET_SEARCH_VISUAL_MODEL_REVISION?.trim());
  const needsCredentials =
    Boolean(textRevisionValue) || visualConfiguredExplicitly;

  if (!needsCredentials) {
    return {
      mode,
      semantic: null,
      fallbackReason:
        mode === "lexical" ? null : "configuration_missing",
      visualMode,
      visual: null,
      visualFallbackReason: null,
    };
  }

  const folderId = environment.YANDEX_AI_STUDIO_FOLDER_ID?.trim() ?? "";
  const apiKeyFile =
    environment.YANDEX_AI_STUDIO_API_KEY_FILE?.trim() ?? "";
  const credentialFailure = readCredentialFailure(
    folderId,
    apiKeyFile,
    readTextFile,
  );
  const apiKey = credentialFailure.apiKey;

  const semantic = createSemanticConfig({
    mode,
    folderId,
    apiKey,
    textRevisionValue,
    timeoutMs: readBoundedTimeout(
      environment.PET_SEARCH_EMBEDDING_TIMEOUT_MS,
      DEFAULT_EMBEDDING_TIMEOUT_MS,
      MIN_EMBEDDING_TIMEOUT_MS,
      MAX_EMBEDDING_TIMEOUT_MS,
    ),
  });
  const visual = createVisualConfig({
    folderId,
    apiKey,
    captionRevisionValue,
    visualRevisionValue,
    visionTimeoutMs: readBoundedTimeout(
      environment.PET_SEARCH_VISION_TIMEOUT_MS,
      DEFAULT_VISION_TIMEOUT_MS,
      MIN_VISION_TIMEOUT_MS,
      MAX_VISION_TIMEOUT_MS,
    ),
  });

  return {
    mode,
    semantic: semantic.config,
    fallbackReason:
      credentialFailure.reason ??
      semantic.reason ??
      (mode !== "lexical" && !semantic.config
        ? "configuration_missing"
        : null),
    visualMode,
    visual: credentialFailure.reason ? null : visual,
    visualFallbackReason: visualFallbackReason({
      visualMode,
      visual: credentialFailure.reason ? null : visual,
      semantic: credentialFailure.reason ? null : semantic.config,
    }),
  };
}

function createSemanticConfig(input: {
  mode: PetSearchMode;
  folderId: string;
  apiKey: string;
  textRevisionValue: string;
  timeoutMs: number;
}): {
  config: PetSearchSemanticConfig | null;
  reason: PetSearchConfigurationFallbackReason | null;
} {
  if (!input.textRevisionValue) {
    return { config: null, reason: null };
  }
  if (!isSupportedTextRevision(input.textRevisionValue)) {
    return { config: null, reason: "unsupported_model_revision" };
  }
  if (!input.folderId || !input.apiKey) {
    return {
      config: null,
      reason: input.mode === "lexical" ? null : "configuration_missing",
    };
  }

  const revision = PET_SEARCH_MODEL_REVISIONS[input.textRevisionValue];
  const embeddingModel =
    PET_SEARCH_EMBEDDING_MODELS[revision.embeddingModelId];
  return {
    config: {
      folderId: input.folderId,
      apiKey: input.apiKey,
      revision: input.textRevisionValue,
      embeddingModelId: revision.embeddingModelId,
      dimensions: embeddingModel.dimensions,
      minSemanticScore: revision.minSemanticScore,
      timeoutMs: input.timeoutMs,
    },
    reason: null,
  };
}

function createVisualConfig(input: {
  folderId: string;
  apiKey: string;
  captionRevisionValue: string;
  visualRevisionValue: string;
  visionTimeoutMs: number;
}): PetSearchVisualConfig | null {
  if (
    !input.folderId ||
    !input.apiKey ||
    !isSupportedCaptionRevision(input.captionRevisionValue) ||
    !isSupportedVisualRevision(input.visualRevisionValue)
  ) {
    return null;
  }

  const captionRevision =
    PET_VISION_CAPTION_REVISIONS[input.captionRevisionValue];
  const visualRevision: PetVisualModelRevisionDefinition =
    PET_VISUAL_MODEL_REVISIONS[input.visualRevisionValue];
  const embeddingModel =
    PET_SEARCH_EMBEDDING_MODELS[visualRevision.embeddingModelId];
  if (visualRevision.captionRevision !== input.captionRevisionValue) {
    return null;
  }

  return {
    folderId: input.folderId,
    apiKey: input.apiKey,
    captionRevision: input.captionRevisionValue,
    visualRevision: input.visualRevisionValue,
    embeddingModelId: visualRevision.embeddingModelId,
    dimensions: embeddingModel.dimensions,
    profile: visualRevision.profile,
    visionTimeoutMs: input.visionTimeoutMs,
    modelUri: `gpt://${input.folderId}/${captionRevision.modelName}`,
  };
}

function readCredentialFailure(
  folderId: string,
  apiKeyFile: string,
  readTextFile: ReadTextFile,
): {
  apiKey: string;
  reason: PetSearchConfigurationFallbackReason | null;
} {
  if (!folderId || !apiKeyFile) {
    return { apiKey: "", reason: "configuration_missing" };
  }
  try {
    const apiKey = readTextFile(apiKeyFile).trim();
    return apiKey
      ? { apiKey, reason: null }
      : { apiKey: "", reason: "secret_unavailable" };
  } catch {
    return { apiKey: "", reason: "secret_unavailable" };
  }
}

function visualFallbackReason(input: {
  visualMode: PetSearchVisualMode;
  visual: PetSearchVisualConfig | null;
  semantic: PetSearchSemanticConfig | null;
}): PetVisualSearchFallbackReason | null {
  if (input.visualMode === "off") return null;
  if (!input.visual) return "visual_configuration_missing";
  if (
    input.semantic &&
    input.semantic.embeddingModelId !== input.visual.embeddingModelId
  ) {
    return "visual_embedding_incompatible";
  }
  if (input.visualMode === "hybrid" && !input.visual.profile) {
    return "visual_calibration_missing";
  }
  return null;
}

function readMode(value: string | undefined): PetSearchMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "shadow" || normalized === "hybrid") return normalized;
  return "lexical";
}

function readVisualMode(value: string | undefined): PetSearchVisualMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "shadow" || normalized === "hybrid") return normalized;
  return "off";
}

function isSupportedTextRevision(
  value: string,
): value is keyof typeof PET_SEARCH_MODEL_REVISIONS {
  return Object.hasOwn(PET_SEARCH_MODEL_REVISIONS, value);
}

function isSupportedCaptionRevision(
  value: string,
): value is keyof typeof PET_VISION_CAPTION_REVISIONS {
  return Object.hasOwn(PET_VISION_CAPTION_REVISIONS, value);
}

function isSupportedVisualRevision(
  value: string,
): value is keyof typeof PET_VISUAL_MODEL_REVISIONS {
  return Object.hasOwn(PET_VISUAL_MODEL_REVISIONS, value);
}

function readBoundedTimeout(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

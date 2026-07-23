import { readFileSync } from "node:fs";

import type { PetSearchMode } from "@/lib/pets/search-service";
import {
  PET_VISION_CAPTION_REVISION,
  PET_VISUAL_MODEL_REVISION,
} from "@/lib/pets/search-vision-contract";

const DEFAULT_EMBEDDING_TIMEOUT_MS = 800;
const DEFAULT_VISION_TIMEOUT_MS = 30_000;
const MIN_EMBEDDING_TIMEOUT_MS = 50;
const MAX_EMBEDDING_TIMEOUT_MS = 5_000;
const MIN_VISION_TIMEOUT_MS = 1_000;
const MAX_VISION_TIMEOUT_MS = 60_000;

export const PET_SEARCH_MODEL_REVISIONS = {
  "yandex-text-search-2026-07": {
    dimensions: 256,
    minSemanticScore: 0.31,
  },
} as const;

export type PetVisualCalibrationProfile = {
  minSemanticScore: number;
  weight: number;
};

type PetVisualModelRevisionDefinition = {
  dimensions: number;
  captionRevision: string;
  profile: PetVisualCalibrationProfile | null;
};

export const PET_VISION_CAPTION_REVISIONS = {
  [PET_VISION_CAPTION_REVISION]: {
    modelName: "qwen3.6-35b-a3b",
  },
} as const;

export const PET_VISUAL_MODEL_REVISIONS = {
  [PET_VISUAL_MODEL_REVISION]: {
    dimensions: 256,
    captionRevision: PET_VISION_CAPTION_REVISION,
    profile: null,
  },
} as const satisfies Record<string, PetVisualModelRevisionDefinition>;

export type PetSearchVisualMode = "off" | "shadow" | "hybrid";

export type PetSearchConfigurationFallbackReason =
  | "configuration_missing"
  | "secret_unavailable"
  | "unsupported_model_revision";

export type PetVisualSearchFallbackReason =
  | "visual_configuration_missing"
  | "visual_calibration_missing"
  | "visual_vector_search_error"
  | "visual_caption_lookup_error"
  | "visual_caption_invalid";

export type PetSearchSemanticConfig = {
  folderId: string;
  apiKey: string;
  revision: keyof typeof PET_SEARCH_MODEL_REVISIONS;
  dimensions: number;
  minSemanticScore: number;
  timeoutMs: number;
};

export type PetSearchVisualConfig = {
  folderId: string;
  apiKey: string;
  captionRevision: keyof typeof PET_VISION_CAPTION_REVISIONS;
  visualRevision: keyof typeof PET_VISUAL_MODEL_REVISIONS;
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
  return {
    config: {
      folderId: input.folderId,
      apiKey: input.apiKey,
      revision: input.textRevisionValue,
      dimensions: revision.dimensions,
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
  if (visualRevision.captionRevision !== input.captionRevisionValue) {
    return null;
  }

  return {
    folderId: input.folderId,
    apiKey: input.apiKey,
    captionRevision: input.captionRevisionValue,
    visualRevision: input.visualRevisionValue,
    dimensions: visualRevision.dimensions,
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
}): PetVisualSearchFallbackReason | null {
  if (input.visualMode === "off") return null;
  if (!input.visual) return "visual_configuration_missing";
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

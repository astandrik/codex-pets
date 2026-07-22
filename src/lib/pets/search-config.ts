import { readFileSync } from "node:fs";

import type { PetSearchMode } from "@/lib/pets/search-service";

const DEFAULT_TIMEOUT_MS = 800;
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 5_000;

export const PET_SEARCH_MODEL_REVISIONS = {
  "yandex-text-search-2026-07": {
    dimensions: 256,
    minSemanticScore: 0.31,
  },
} as const;

export type PetSearchConfigurationFallbackReason =
  | "configuration_missing"
  | "secret_unavailable"
  | "unsupported_model_revision";

export type PetSearchSemanticConfig = {
  folderId: string;
  apiKey: string;
  revision: keyof typeof PET_SEARCH_MODEL_REVISIONS;
  dimensions: number;
  minSemanticScore: number;
  timeoutMs: number;
};

export type PetSearchConfig = {
  mode: PetSearchMode;
  semantic: PetSearchSemanticConfig | null;
  fallbackReason: PetSearchConfigurationFallbackReason | null;
};

type Environment = Readonly<Record<string, string | undefined>>;
type ReadTextFile = (path: string) => string;

export function loadPetSearchConfig(
  environment: Environment = process.env,
  readTextFile: ReadTextFile = (path) => readFileSync(path, "utf8"),
): PetSearchConfig {
  const mode = readMode(environment.PET_SEARCH_MODE);
  const folderId = environment.YANDEX_AI_STUDIO_FOLDER_ID?.trim() ?? "";
  const apiKeyFile =
    environment.YANDEX_AI_STUDIO_API_KEY_FILE?.trim() ?? "";
  const revisionValue = environment.PET_SEARCH_MODEL_REVISION?.trim() ?? "";
  if (!folderId || !apiKeyFile || !revisionValue) {
    return {
      mode,
      semantic: null,
      fallbackReason:
        mode === "lexical" ? null : "configuration_missing",
    };
  }

  if (!isSupportedRevision(revisionValue)) {
    return {
      mode,
      semantic: null,
      fallbackReason: "unsupported_model_revision",
    };
  }

  let apiKey = "";
  try {
    apiKey = readTextFile(apiKeyFile).trim();
  } catch {
    return { mode, semantic: null, fallbackReason: "secret_unavailable" };
  }
  if (!apiKey) {
    return { mode, semantic: null, fallbackReason: "secret_unavailable" };
  }

  const revision = PET_SEARCH_MODEL_REVISIONS[revisionValue];
  return {
    mode,
    semantic: {
      folderId,
      apiKey,
      revision: revisionValue,
      dimensions: revision.dimensions,
      minSemanticScore: revision.minSemanticScore,
      timeoutMs: readTimeout(environment.PET_SEARCH_EMBEDDING_TIMEOUT_MS),
    },
    fallbackReason: null,
  };
}

function readMode(value: string | undefined): PetSearchMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "shadow" || normalized === "hybrid") return normalized;
  return "lexical";
}

function isSupportedRevision(
  value: string,
): value is keyof typeof PET_SEARCH_MODEL_REVISIONS {
  return Object.hasOwn(PET_SEARCH_MODEL_REVISIONS, value);
}

function readTimeout(value: string | undefined): number {
  const parsed = Number(value);
  if (
    Number.isInteger(parsed) &&
    parsed >= MIN_TIMEOUT_MS &&
    parsed <= MAX_TIMEOUT_MS
  ) {
    return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

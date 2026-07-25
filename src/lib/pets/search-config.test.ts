import { describe, expect, it, vi } from "vitest";

import {
  loadPetSearchConfig,
  PET_SEARCH_MODEL_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
} from "@/lib/pets/search-config";
import { PET_VISION_CAPTION_REVISION } from "@/lib/pets/search-vision-contract";

const supportedRevision = Object.keys(PET_SEARCH_MODEL_REVISIONS)[0] ?? "";
const supportedVisualRevision =
  Object.keys(PET_VISUAL_MODEL_REVISIONS)[0] ?? "";
const v2TextRevision =
  "yandex-text-embeddings-v2-768-2026-07";
const v2VisualRevision =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1";
const calibratedVisualProfile = {
  minSemanticScore: 0.3455384373664856,
  weight: 0.25,
};

describe("pet search runtime configuration", () => {
  it("defaults to lexical mode without reading semantic secrets", () => {
    const readTextFile = vi.fn();

    expect(loadPetSearchConfig({}, readTextFile)).toEqual({
      mode: "lexical",
      semantic: null,
      fallbackReason: null,
      visualMode: "off",
      visual: null,
      visualFallbackReason: null,
    });
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("can load background-indexing credentials while query mode stays lexical", () => {
    const config = loadPetSearchConfig(
      {
        PET_SEARCH_MODE: "lexical",
        PET_SEARCH_MODEL_REVISION: supportedRevision,
        YANDEX_AI_STUDIO_FOLDER_ID: "folder-1",
        YANDEX_AI_STUDIO_API_KEY_FILE: "/run/secrets/key",
      },
      () => "secret",
    );

    expect(config.mode).toBe("lexical");
    expect(config.semantic).toMatchObject({ revision: supportedRevision });
    expect(config.visual).toMatchObject({
      captionRevision: PET_VISION_CAPTION_REVISION,
      visualRevision: supportedVisualRevision,
      embeddingModelId: "yandex-text-search-v1-256",
      dimensions: 256,
      profile: calibratedVisualProfile,
      visionTimeoutMs: 30_000,
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
    });
    expect(config.fallbackReason).toBeNull();
    expect(config.visualFallbackReason).toBeNull();
  });

  it("loads a supported hybrid model and trims the secret file", () => {
    const config = loadPetSearchConfig(
      {
        PET_SEARCH_MODE: "hybrid",
        PET_SEARCH_MODEL_REVISION: supportedRevision,
        PET_SEARCH_EMBEDDING_TIMEOUT_MS: "900",
        YANDEX_AI_STUDIO_FOLDER_ID: "folder-1",
        YANDEX_AI_STUDIO_API_KEY_FILE: "/run/secrets/yandex-ai-key",
      },
      (path) => {
        expect(path).toBe("/run/secrets/yandex-ai-key");
        return "secret-key\n";
      },
    );

    expect(config).toEqual({
      mode: "hybrid",
      semantic: {
        folderId: "folder-1",
        apiKey: "secret-key",
        revision: supportedRevision,
        embeddingModelId: "yandex-text-search-v1-256",
        dimensions: 256,
        minSemanticScore: 0.31,
        timeoutMs: 900,
      },
      fallbackReason: null,
      visualMode: "off",
      visual: {
        folderId: "folder-1",
        apiKey: "secret-key",
        captionRevision: PET_VISION_CAPTION_REVISION,
        visualRevision: supportedVisualRevision,
        embeddingModelId: "yandex-text-search-v1-256",
        dimensions: 256,
        profile: calibratedVisualProfile,
        visionTimeoutMs: 30_000,
        modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      },
      visualFallbackReason: null,
    });
  });

  it("loads compatible calibrated v2 text and Qwen visual profiles", () => {
    const config = loadPetSearchConfig(
      {
        PET_SEARCH_MODE: "hybrid",
        PET_SEARCH_MODEL_REVISION: v2TextRevision,
        PET_SEARCH_VISUAL_MODE: "hybrid",
        PET_SEARCH_VISUAL_MODEL_REVISION: v2VisualRevision,
        YANDEX_AI_STUDIO_FOLDER_ID: "folder-1",
        YANDEX_AI_STUDIO_API_KEY_FILE: "/run/secrets/key",
      },
      () => "secret",
    );

    expect(config.semantic).toMatchObject({
      revision: v2TextRevision,
      embeddingModelId: "yandex-text-embeddings-v2-768",
      dimensions: 768,
      minSemanticScore: 0.28,
    });
    expect(config.visual).toMatchObject({
      visualRevision: v2VisualRevision,
      embeddingModelId: "yandex-text-embeddings-v2-768",
      dimensions: 768,
      profile: {
        minSemanticScore: 0.3574455678462982,
        weight: 0.25,
      },
    });
    expect(config.fallbackReason).toBeNull();
    expect(config.visualFallbackReason).toBeNull();
  });

  it("disables visual ranking for incompatible embedding providers", () => {
    const config = loadPetSearchConfig(
      {
        PET_SEARCH_MODE: "hybrid",
        PET_SEARCH_MODEL_REVISION: supportedRevision,
        PET_SEARCH_VISUAL_MODE: "hybrid",
        PET_SEARCH_VISUAL_MODEL_REVISION: v2VisualRevision,
        YANDEX_AI_STUDIO_FOLDER_ID: "folder-1",
        YANDEX_AI_STUDIO_API_KEY_FILE: "/run/secrets/key",
      },
      () => "secret",
    );

    expect(config.visualFallbackReason).toBe(
      "visual_embedding_incompatible",
    );
  });

  it("keeps hybrid mode but reports a safe lexical fallback when config is incomplete", () => {
    expect(
      loadPetSearchConfig({ PET_SEARCH_MODE: "hybrid" }, () => "unused"),
    ).toEqual({
      mode: "hybrid",
      semantic: null,
      fallbackReason: "configuration_missing",
      visualMode: "off",
      visual: null,
      visualFallbackReason: null,
    });
  });

  it("rejects unsupported revisions and unreadable or empty secret files", () => {
    const base = {
      PET_SEARCH_MODE: "shadow",
      YANDEX_AI_STUDIO_FOLDER_ID: "folder-1",
      YANDEX_AI_STUDIO_API_KEY_FILE: "/run/secrets/key",
    };

    expect(
      loadPetSearchConfig(
        { ...base, PET_SEARCH_MODEL_REVISION: "unknown" },
        () => "secret",
      ),
    ).toMatchObject({
      mode: "shadow",
      semantic: null,
      fallbackReason: "unsupported_model_revision",
    });
    expect(
      loadPetSearchConfig(
        { ...base, PET_SEARCH_MODEL_REVISION: supportedRevision },
        () => {
          throw new Error("permission denied");
        },
      ),
    ).toMatchObject({
      semantic: null,
      fallbackReason: "secret_unavailable",
    });
    expect(
      loadPetSearchConfig(
        { ...base, PET_SEARCH_MODEL_REVISION: supportedRevision },
        () => "\n",
      ),
    ).toMatchObject({
      semantic: null,
      fallbackReason: "secret_unavailable",
    });
  });

  it("uses bounded defaults for invalid mode and timeout values", () => {
    expect(loadPetSearchConfig({ PET_SEARCH_MODE: "other" }, () => "unused"))
      .toMatchObject({ mode: "lexical" });

    const config = loadPetSearchConfig(
      {
        PET_SEARCH_MODE: "hybrid",
        PET_SEARCH_MODEL_REVISION: supportedRevision,
        PET_SEARCH_EMBEDDING_TIMEOUT_MS: "999999",
        YANDEX_AI_STUDIO_FOLDER_ID: "folder-1",
        YANDEX_AI_STUDIO_API_KEY_FILE: "/run/secrets/key",
      },
      () => "secret",
    );
    expect(config.semantic?.timeoutMs).toBe(800);
  });

  it("loads the revision-bound visual calibration independently", () => {
    const config = loadPetSearchConfig(
      {
        PET_SEARCH_VISUAL_MODE: "hybrid",
        PET_SEARCH_VISION_TIMEOUT_MS: "45000",
        YANDEX_AI_STUDIO_FOLDER_ID: "folder-1",
        YANDEX_AI_STUDIO_API_KEY_FILE: "/run/secrets/key",
      },
      () => "secret",
    );

    expect(config).toMatchObject({
      mode: "lexical",
      semantic: null,
      fallbackReason: null,
      visualMode: "hybrid",
      visual: {
        captionRevision: PET_VISION_CAPTION_REVISION,
        visualRevision: supportedVisualRevision,
        visionTimeoutMs: 45_000,
        profile: calibratedVisualProfile,
      },
      visualFallbackReason: null,
    });
  });

  it("disables unsupported or incomplete visual configuration safely", () => {
    expect(
      loadPetSearchConfig(
        {
          PET_SEARCH_VISUAL_MODE: "shadow",
          YANDEX_AI_STUDIO_FOLDER_ID: "folder-1",
          YANDEX_AI_STUDIO_API_KEY_FILE: "/run/secrets/key",
          PET_SEARCH_VISUAL_MODEL_REVISION: "unknown",
        },
        () => "secret",
      ),
    ).toMatchObject({
      visualMode: "shadow",
      visual: null,
      visualFallbackReason: "visual_configuration_missing",
    });
    expect(
      loadPetSearchConfig({ PET_SEARCH_VISUAL_MODE: "hybrid" }, () => "unused"),
    ).toMatchObject({
      visualMode: "hybrid",
      visual: null,
      visualFallbackReason: "visual_configuration_missing",
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  loadPetSearchConfig,
  PET_SEARCH_MODEL_REVISIONS,
} from "@/lib/pets/search-config";

const supportedRevision = Object.keys(PET_SEARCH_MODEL_REVISIONS)[0] ?? "";

describe("pet search runtime configuration", () => {
  it("defaults to lexical mode without reading semantic secrets", () => {
    const readTextFile = vi.fn();

    expect(loadPetSearchConfig({}, readTextFile)).toEqual({
      mode: "lexical",
      semantic: null,
      fallbackReason: null,
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
    expect(config.fallbackReason).toBeNull();
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
        dimensions: 256,
        minSemanticScore: 0.31,
        timeoutMs: 900,
      },
      fallbackReason: null,
    });
  });

  it("keeps hybrid mode but reports a safe lexical fallback when config is incomplete", () => {
    expect(
      loadPetSearchConfig({ PET_SEARCH_MODE: "hybrid" }, () => "unused"),
    ).toEqual({
      mode: "hybrid",
      semantic: null,
      fallbackReason: "configuration_missing",
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
});

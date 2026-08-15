import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildRelatedPetDocument as buildRuntimeRelatedDocument,
  buildRelatedPetQuery as buildRuntimeRelatedQuery,
  buildPetSearchDocument as buildRuntimeDocument,
  createRelatedPetDocumentSourceHash as createRuntimeRelatedDocumentHash,
  createRelatedPetQuerySourceHash as createRuntimeRelatedQueryHash,
  createPetSearchSourceHash as createRuntimeHash,
  embeddingToBuffer as runtimeEmbeddingToBuffer,
} from "../src/lib/pets/search-embeddings";
import {
  PET_SEARCH_EMBEDDING_MODELS,
  PET_SEARCH_MODEL_REVISIONS,
} from "../src/lib/pets/search-config";
import {
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  RELATED_PETS_DESCRIPTION_QUERY_REVISION,
} from "../src/lib/pets/related-pets-semantics.mjs";

const packageScripts = (JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> }).scripts;

const {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
  buildPetSearchDocument,
  createRelatedPetDocumentSourceHash,
  createRelatedPetQuerySourceHash,
  createPetSearchSourceHash,
  createRequestStartLimiter,
  embeddingToBuffer,
  parseBackfillArgs,
  runPetSearchBackfill,
} = await import("./lib/pet-search-backfill.mjs");
const {
  PET_SEARCH_BACKFILL_REVISIONS,
  createEmbeddingRequest,
} = await import("./lib/pet-search-provider-config.mjs");
const { RELATED_PETS_REBUILD_COMMANDS } = await import(
  "./lib/related-pets-maintenance.mjs"
);

const pet = {
  slug: "velvet-byte",
  displayName: "Velvet Byte",
  description: "A confident gothic coding character",
  kind: "character" as const,
  tags: ["night", "gothic"],
};

describe("pet search embeddings backfill", () => {
  it("keeps legacy and v2 provider definitions in runtime parity", () => {
    for (const [revision, definition] of Object.entries(
      PET_SEARCH_MODEL_REVISIONS,
    )) {
      const runtimeModel =
        PET_SEARCH_EMBEDDING_MODELS[definition.embeddingModelId];
      expect(PET_SEARCH_BACKFILL_REVISIONS[revision]).toEqual({
        dimensions: runtimeModel.dimensions,
        documentModelPath: runtimeModel.documentModelPath,
        requestDimensions: runtimeModel.requestDimensions,
      });
    }
    expect(
      createEmbeddingRequest({
        folderId: "folder-1",
        definition:
          PET_SEARCH_BACKFILL_REVISIONS[
            "yandex-text-embeddings-v2-768-2026-07"
          ],
        text: "document",
      }),
    ).toEqual({
      modelUri: "emb://folder-1/text-embeddings-v2-doc",
      text: "document",
      dim: "768",
    });
    expect(
      PET_SEARCH_BACKFILL_REVISIONS[RELATED_PETS_DESCRIPTION_QUERY_REVISION],
    ).toEqual({
      dimensions: 768,
      modelPath: "text-embeddings-v2-query",
      requestDimensions: 768,
      inputKind: "related-query",
    });
    expect(PET_SEARCH_BACKFILL_REVISIONS[RELATED_PETS_DESCRIPTION_QUERY_REVISION])
      .toEqual({
        dimensions: 768,
        modelPath: "text-embeddings-v2-query",
        requestDimensions: 768,
        inputKind: "related-query",
      });
    expect(
      createEmbeddingRequest({
        folderId: "folder-1",
        definition:
          PET_SEARCH_BACKFILL_REVISIONS[
            RELATED_PETS_DESCRIPTION_QUERY_REVISION
          ],
        text: "skeleton pixel art",
      }),
    ).toEqual({
      modelUri: "emb://folder-1/text-embeddings-v2-query",
      text: "skeleton pixel art",
      dim: "768",
    });
  });

  it("parses explicit dry-run/apply modes and optional flags", () => {
    expect(parseBackfillArgs(["--dry-run"])).toEqual({
      mode: "dry-run",
      slug: null,
      force: false,
      continueOnError: false,
      concurrency: 1,
    });
    expect(
      parseBackfillArgs(["--apply", "--slug", "velvet-byte", "--force"]),
    ).toEqual({
      mode: "apply",
      slug: "velvet-byte",
      force: true,
      continueOnError: false,
      concurrency: 1,
    });
    expect(() => parseBackfillArgs([])).toThrow(/--dry-run.*--apply/);
    expect(() => parseBackfillArgs(["--dry-run", "--apply"])).toThrow(
      /exactly one/i,
    );
    expect(() => parseBackfillArgs(["--apply", "--slug", "../bad"])).toThrow(
      /slug/i,
    );
    expect(() => parseBackfillArgs(["--dry-run", "--force"])).toThrow(
      /force.*apply/i,
    );
    expect(() => parseBackfillArgs(["--apply", "--unknown"])).toThrow(
      /unknown argument/i,
    );
  });

  it("keeps the command canonical document and source hash in sync with runtime", () => {
    expect(buildPetSearchDocument(pet)).toBe(buildRuntimeDocument(pet));
    expect(createPetSearchSourceHash(pet, "model-v1")).toBe(
      createRuntimeHash(pet, "model-v1"),
    );
    const commandBuffer = embeddingToBuffer([1.5, -2.25]);
    expect(commandBuffer).toEqual(runtimeEmbeddingToBuffer([1.5, -2.25]));
    expect(commandBuffer.at(-1)).toBe(0x01);
  });

  it("keeps the related query and source hash in runtime parity", () => {
    expect(buildRelatedPetQuery(pet, RELATED_PETS_DESCRIPTION_QUERY_REVISION))
      .toBe(buildRuntimeRelatedQuery(
        pet,
        RELATED_PETS_DESCRIPTION_QUERY_REVISION,
      ));
    expect(createRelatedPetQuerySourceHash(pet, "query-v1")).toBe(
      createRuntimeRelatedQueryHash(pet, "query-v1"),
    );
    expect(buildRelatedPetDocument(
      pet,
      RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
    )).toBe(buildRuntimeRelatedDocument(
      pet,
      RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
    ));
    expect(createRelatedPetDocumentSourceHash(
      pet,
      RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
    )).toBe(createRuntimeRelatedDocumentHash(
      pet,
      RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
    ));
  });

  it("spaces provider starts across the configured per-minute limit", async () => {
    let currentTime = 0;
    const waits: number[] = [];
    const reserve = createRequestStartLimiter({
      requestsPerMinute: 60,
      now: () => currentTime,
      sleep: async (milliseconds: number) => {
        waits.push(milliseconds);
        currentTime += milliseconds;
      },
    });

    const starts: number[] = [];
    for (let request = 0; request < 3; request += 1) {
      await reserve();
      starts.push(currentTime);
    }

    expect(starts).toEqual([0, 1_000, 2_000]);
    expect(waits).toEqual([1_000, 1_000]);
  });

  it("serializes concurrent rate-limit reservations", async () => {
    let currentTime = 0;
    const waits: number[] = [];
    const pendingSleeps: Array<() => void> = [];
    const reserve = createRequestStartLimiter({
      requestsPerMinute: 60,
      now: () => currentTime,
      sleep: (milliseconds: number) => {
        waits.push(milliseconds);
        return new Promise<void>((resolve) => {
          pendingSleeps.push(() => {
            currentTime += milliseconds;
            resolve();
          });
        });
      },
    });

    const reservations = [reserve(), reserve(), reserve()];
    await reservations[0];
    await Promise.resolve();
    expect(waits).toEqual([1_000]);
    pendingSleeps.shift()?.();
    await reservations[1];
    await Promise.resolve();
    expect(waits).toEqual([1_000, 1_000]);
    pendingSleeps.shift()?.();
    await Promise.all(reservations);
  });

  it("keeps the active query command separate from V24 preparation", () => {
    expect(packageScripts["related:backfill-query"]).toContain(
      RELATED_PETS_DESCRIPTION_QUERY_REVISION,
    );
    expect(packageScripts["related:backfill-description-query"]).toContain(
      RELATED_PETS_DESCRIPTION_QUERY_REVISION,
    );
    expect(packageScripts["related:backfill-description-document"]).toContain(
      RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
    );
  });

  it("dry-runs stale approved pets without provider or YDB writes", async () => {
    const embedDocument = vi.fn();
    const upsert = vi.fn();
    const logs: unknown[] = [];

    const summary = await runPetSearchBackfill({
      options: backfillOptions("dry-run"),
      revision: "model-v1",
      dimensions: 256,
      pets: [pet],
      getMetadata: async () => null,
      embedDocument,
      upsert,
      log: (entry: unknown) => logs.push(entry),
    });

    expect(summary).toEqual({
      scanned: 1,
      unchanged: 0,
      planned: 1,
      updated: 0,
      failed: 0,
      failedSlugs: [],
    });
    expect(embedDocument).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain(pet.displayName);
    expect(JSON.stringify(logs)).not.toContain(pet.description);
  });

  it("uses the related query builder and hash for its additive revision", async () => {
    const embedDocument = vi.fn(async () => Array(768).fill(0.25));
    const upsert = vi.fn(async () => undefined);

    await runPetSearchBackfill({
      options: backfillOptions("apply"),
      revision: RELATED_PETS_DESCRIPTION_QUERY_REVISION,
      dimensions: 768,
      pets: [pet],
      getMetadata: async () => null,
      embedDocument,
      upsert,
      buildInput: (candidate) => buildRelatedPetQuery(
        candidate,
        RELATED_PETS_DESCRIPTION_QUERY_REVISION,
      ),
      createSourceHash: createRelatedPetQuerySourceHash,
      log: () => undefined,
    });

    expect(embedDocument).toHaveBeenCalledWith([
      "name: Velvet Byte",
      "kind: character",
      "description: A confident gothic coding character",
    ].join("\n"));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRevision: RELATED_PETS_DESCRIPTION_QUERY_REVISION,
        sourceHash: createRelatedPetQuerySourceHash(
          pet,
          RELATED_PETS_DESCRIPTION_QUERY_REVISION,
        ),
      }),
    );
  });

  it("skips fresh vectors and applies stale or forced vectors", async () => {
    const sourceHash = createPetSearchSourceHash(pet, "model-v1");
    const upsert = vi.fn(async () => undefined);
    const embedDocument = vi.fn(async () => Array(256).fill(0.25));

    const unchanged = await runPetSearchBackfill({
      options: backfillOptions("apply"),
      revision: "model-v1",
      dimensions: 256,
      pets: [pet],
      getMetadata: async () => ({ sourceHash, dimensions: 256 }),
      embedDocument,
      upsert,
      log: () => undefined,
    });
    expect(unchanged.unchanged).toBe(1);
    expect(embedDocument).not.toHaveBeenCalled();

    const forced = await runPetSearchBackfill({
      options: {
        ...backfillOptions("apply"),
        slug: "velvet-byte",
        force: true,
      },
      revision: "model-v1",
      dimensions: 256,
      pets: [pet],
      getMetadata: async () => ({ sourceHash, dimensions: 256 }),
      embedDocument,
      upsert,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      log: () => undefined,
    });
    expect(forced.updated).toBe(1);
    expect(upsert).toHaveBeenCalledWith({
      modelRevision: "model-v1",
      slug: "velvet-byte",
      sourceHash,
      dimensions: 256,
      embedding: Array(256).fill(0.25),
      updatedAt: "2026-07-22T00:00:00.000Z",
    });
  });

  it("emits executable related snapshot follow-up after applied changes", async () => {
    const logs: unknown[] = [];

    await runPetSearchBackfill({
      options: backfillOptions("apply"),
      revision: "model-v1",
      dimensions: 256,
      pets: [pet],
      getMetadata: async () => null,
      embedDocument: async () => Array(256).fill(0.25),
      upsert: async () => undefined,
      log: (entry: unknown) => logs.push(entry),
    });

    expect(logs.at(-1)).toEqual({
      action: "related-pets-rebuild-required",
      commands: RELATED_PETS_REBUILD_COMMANDS,
    });
  });

  it("emits the related snapshot follow-up after a later applied update fails", async () => {
    const logs: unknown[] = [];
    const providerFailure = new Error("provider unavailable");
    let embeddingAttempt = 0;

    await expect(
      runPetSearchBackfill({
        options: backfillOptions("apply"),
        revision: "model-v1",
        dimensions: 256,
        pets: [
          pet,
          {
            ...pet,
            slug: "nightshade",
            displayName: "Nightshade",
          },
        ],
        getMetadata: async () => null,
        embedDocument: async () => {
          embeddingAttempt += 1;
          if (embeddingAttempt === 2) throw providerFailure;
          return Array(256).fill(0.25);
        },
        upsert: async () => undefined,
        log: (entry: unknown) => logs.push(entry),
      }),
    ).rejects.toBe(providerFailure);

    expect(logs.at(-1)).toEqual({
      action: "related-pets-rebuild-required",
      commands: RELATED_PETS_REBUILD_COMMANDS,
    });
  });

  it("fails closed for missing slugs and invalid provider dimensions", async () => {
    await expect(
      runPetSearchBackfill({
        options: { ...backfillOptions("dry-run"), slug: "missing" },
        revision: "model-v1",
        dimensions: 256,
        pets: [pet],
        getMetadata: async () => null,
        embedDocument: async () => [],
        upsert: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow(/missing/);

    await expect(
      runPetSearchBackfill({
        options: backfillOptions("apply"),
        revision: "model-v1",
        dimensions: 256,
        pets: [pet],
        getMetadata: async () => null,
        embedDocument: async () => [0.1],
        upsert: async () => undefined,
        log: () => undefined,
      }),
    ).rejects.toThrow(/expected 256/);
  });
});

function backfillOptions(mode: "dry-run" | "apply") {
  return {
    mode,
    slug: null,
    force: false,
    continueOnError: false,
    concurrency: 1,
  };
}

import { describe, expect, it, vi } from "vitest";

import {
  buildPetSearchDocument as buildRuntimeDocument,
  createPetSearchSourceHash as createRuntimeHash,
  embeddingToBuffer as runtimeEmbeddingToBuffer,
} from "../src/lib/pets/search-embeddings";

const {
  buildPetSearchDocument,
  createPetSearchSourceHash,
  createRequestStartLimiter,
  embeddingToBuffer,
  parseBackfillArgs,
  runPetSearchBackfill,
} = await import("./lib/pet-search-backfill.mjs");

const pet = {
  slug: "velvet-byte",
  displayName: "Velvet Byte",
  description: "A confident gothic coding character",
  kind: "character" as const,
  tags: ["night", "gothic"],
};

describe("pet search embeddings backfill", () => {
  it("parses explicit dry-run/apply modes and optional flags", () => {
    expect(parseBackfillArgs(["--dry-run"])).toEqual({
      mode: "dry-run",
      slug: null,
      force: false,
    });
    expect(
      parseBackfillArgs(["--apply", "--slug", "velvet-byte", "--force"]),
    ).toEqual({
      mode: "apply",
      slug: "velvet-byte",
      force: true,
    });
    expect(() => parseBackfillArgs([])).toThrow(/--dry-run.*--apply/);
    expect(() => parseBackfillArgs(["--dry-run", "--apply"])).toThrow(
      /exactly one/i,
    );
    expect(() => parseBackfillArgs(["--apply", "--slug", "../bad"])).toThrow(
      /slug/i,
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

  it("dry-runs stale approved pets without provider or YDB writes", async () => {
    const embedDocument = vi.fn();
    const upsert = vi.fn();
    const logs: unknown[] = [];

    const summary = await runPetSearchBackfill({
      options: { mode: "dry-run", slug: null, force: false },
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
    });
    expect(embedDocument).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain(pet.displayName);
    expect(JSON.stringify(logs)).not.toContain(pet.description);
  });

  it("skips fresh vectors and applies stale or forced vectors", async () => {
    const sourceHash = createPetSearchSourceHash(pet, "model-v1");
    const upsert = vi.fn(async () => undefined);
    const embedDocument = vi.fn(async () => Array(256).fill(0.25));

    const unchanged = await runPetSearchBackfill({
      options: { mode: "apply", slug: null, force: false },
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
      options: { mode: "apply", slug: "velvet-byte", force: true },
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

  it("fails closed for missing slugs and invalid provider dimensions", async () => {
    await expect(
      runPetSearchBackfill({
        options: { mode: "dry-run", slug: "missing", force: false },
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
        options: { mode: "apply", slug: null, force: false },
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

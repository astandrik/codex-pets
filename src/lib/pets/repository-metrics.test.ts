import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isYdbConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/ydb/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ydb/client")>(),
  isYdbConfigured: mocks.isYdbConfigured,
  withSession: async (callback: (session: { executeQuery: typeof mocks.executeQuery }) => unknown) =>
    callback({ executeQuery: mocks.executeQuery }),
}));

import { ExecuteQuerySettings, TypedValues, Types } from "@/lib/ydb/client";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";

function catalogResult(slugs: string[]) {
  return {
    resultSets: [{
      rows: slugs.map((slug) => ({
        items: [
          slug, `pet_${slug}`, slug, "Description", "/sheet.webp", "/pet.json",
          "/pet.zip", "webp", "creature", "[]", "approved", "", "", "", "", "",
          "2026-11-07T00:00:00Z", "2026-11-07T00:00:00Z", "2026-11-07T00:00:00Z", "",
        ].map((textValue) => ({ textValue })),
      })),
    }],
  };
}

function metricsResult(entries: Array<[string, number, number, number]>) {
  return {
    resultSets: [{
      rows: entries.map(([slug, downloads, installs, likes]) => ({
        items: [
          { textValue: slug }, { uint32Value: downloads },
          { uint32Value: installs }, { uint32Value: likes },
        ],
      })),
    }],
  };
}

function serveCatalog(slugs: string[], metrics: Array<[string, number, number, number]> = []) {
  mocks.executeQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM codex_pets")) return catalogResult(slugs);
    if (sql.includes("FROM codex_pet_metrics")) return metricsResult(metrics);
    throw new Error(`Unexpected query: ${sql}`);
  });
}

function metricsCalls() {
  return mocks.executeQuery.mock.calls.filter(([sql]) => sql.includes("FROM codex_pet_metrics"));
}

describe("catalog metric queries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "ydb");
    mocks.isYdbConfigured.mockReturnValue(true);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reuses the same cacheable SQL and one typed list for 1, 600 and 601 keys", async () => {
    const statements: string[] = [];
    for (const count of [1, 600, 601]) {
      mocks.executeQuery.mockClear();
      const slugs = Array.from({ length: count }, (_, i) => `pet-${i}`);
      serveCatalog(slugs);

      const pets = await listApprovedPetsForSearch();
      expect(pets.map((pet) => pet.slug)).toEqual(slugs);
      expect(metricsCalls()).toHaveLength(1);
      const [sql, params, txControl, settings] = metricsCalls()[0];
      statements.push(sql);
      expect(sql).toContain("DECLARE $slugs AS List<Utf8>;");
      expect(sql).toContain("WHERE pet_slug IN $slugs;");
      expect(params).toEqual({ $slugs: TypedValues.list(Types.UTF8, slugs) });
      expect(txControl).toBeUndefined();
      expect(settings).toBeInstanceOf(ExecuteQuerySettings);
      expect(settings.keepInCache).toBe(true);
    }
    expect(new Set(statements).size).toBe(1);
  });

  it("deduplicates keys before sending the list", async () => {
    serveCatalog(["first", "first", "second"]);
    await listApprovedPetsForSearch();
    expect(metricsCalls()).toHaveLength(1);
    expect(metricsCalls()[0][1]).toEqual({
      $slugs: TypedValues.list(Types.UTF8, ["first", "second"]),
    });
  });

  it("maps reordered counters by slug, preserving catalog order and missing defaults", async () => {
    serveCatalog(["first", "missing", "last"], [["last", 7, 8, 9], ["first", 4_294_967_295, 0, 3]]);
    const pets = await listApprovedPetsForSearch();
    expect(pets.map(({ slug, downloadCount, installCount, likeCount }) => ({
      slug, downloadCount, installCount, likeCount,
    }))).toEqual([
      { slug: "first", downloadCount: 4_294_967_295, installCount: 0, likeCount: 3 },
      { slug: "missing", downloadCount: 0, installCount: 0, likeCount: 0 },
      { slug: "last", downloadCount: 7, installCount: 8, likeCount: 9 },
    ]);
    expect(pets.every((pet) => pet.status === "approved")).toBe(true);
  });

  it("skips metrics for an empty catalog", async () => {
    serveCatalog([]);
    await expect(listApprovedPetsForSearch()).resolves.toEqual([]);
    expect(metricsCalls()).toHaveLength(0);
  });

  it("skips all queries when YDB is not configured", async () => {
    mocks.isYdbConfigured.mockReturnValue(false);
    await expect(listApprovedPetsForSearch()).resolves.toEqual([]);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });
});

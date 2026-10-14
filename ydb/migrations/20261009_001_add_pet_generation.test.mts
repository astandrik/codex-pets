import { describe, expect, it, vi } from "vitest";
import { Column, TableDescription, Types } from "ydb-sdk";

describe("generation schema migration", () => {
  it("creates only three expiring feature tables", async () => {
    const { up } = await import(new URL("./20261009_001_add_pet_generation.mjs", import.meta.url).href);
    const createTable = vi.fn();
    const session = { describeTable: async () => { throw new Error("path not found"); }, createTable };
    await up({ sdk: { Column, TableDescription, Types }, withSession: async (fn: (value: typeof session) => Promise<void>) => fn(session) });
    expect(createTable.mock.calls.map((x) => x[0])).toEqual(["codex_pet_generation_jobs", "codex_pet_generation_artifacts", "codex_pet_generation_quotas"]);
    for (const [, table] of createTable.mock.calls) {
      expect(table.columns.every((column: { type?: unknown }) => column.type !== undefined)).toBe(true);
      expect(table.ttlSettings.dateTypeColumn).toMatchObject({ columnName: "expires_at", expireAfterSeconds: 0 });
    }
    expect(createTable.mock.calls[1][1].columns.find((column: { name: string }) => column.name === "bytes").type).toEqual(Types.BYTES);
  });
  it("does not interpret permission failures as missing tables", async () => {
    const { up } = await import(new URL("./20261009_001_add_pet_generation.mjs", import.meta.url).href);
    const createTable = vi.fn();
    const session = { describeTable: async () => { throw new Error("unauthorized"); }, createTable };
    await expect(up({ sdk: { Column, TableDescription, Types }, withSession: async (fn: (value: typeof session) => Promise<void>) => fn(session) })).rejects.toThrow("unauthorized");
    expect(createTable).not.toHaveBeenCalled();
  });
});

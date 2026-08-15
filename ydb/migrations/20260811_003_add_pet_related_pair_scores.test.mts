import { readFileSync } from "node:fs";

import { Types } from "ydb-sdk";
import { describe, expect, it, vi } from "vitest";

class FakeColumn {
  constructor(public readonly name: string, public readonly type: unknown) {}
}
class FakeTableDescription {
  readonly columns: FakeColumn[] = [];
  readonly primaryKeys: string[] = [];
  withColumn(column: FakeColumn) { this.columns.push(column); return this; }
  withPrimaryKey(column: string) { this.primaryKeys.push(column); return this; }
}

describe("historical related pet pair scores migration", () => {
  it("creates the applied additive table and matches manual schema", async () => {
    const createTable = vi.fn();
    const { up } = await import(
      new URL("./20260811_003_add_pet_related_pair_scores.mjs", import.meta.url).href
    );
    await up({
      sdk: { Column: FakeColumn, TableDescription: FakeTableDescription, Types },
      withSession: async (callback: (session: {
        describeTable: () => Promise<never>;
        createTable: typeof createTable;
      }) => Promise<unknown>) => callback({
        describeTable: async () => { throw new Error("path not found"); },
        createTable,
      }),
    });
    expect(createTable.mock.calls[0]?.[0]).toBe("codex_pet_related_pair_scores");
    expect(createTable.mock.calls[0]?.[1]).toMatchObject({
      primaryKeys: ["scoring_revision", "left_slug", "right_slug"],
    });
    expect(createTable.mock.calls[0]?.[1].columns.map(({ name }: FakeColumn) => name))
      .toEqual([
        "scoring_revision",
        "left_slug",
        "right_slug",
        "source_hash",
        "relevance_grade",
        "confidence",
        "relation_types_json",
        "reason_codes_json",
        "updated_at",
      ]);
    const schema = readFileSync(new URL("../schema.yql", import.meta.url), "utf8");
    expect(schema).toContain("CREATE TABLE codex_pet_related_pair_scores");
    expect(schema).toContain(
      "PRIMARY KEY (scoring_revision, left_slug, right_slug)",
    );
  });

  it("does not recreate an existing table", async () => {
    const createTable = vi.fn();
    const { up } = await import(
      new URL("./20260811_003_add_pet_related_pair_scores.mjs", import.meta.url).href
    );
    await up({
      sdk: { Column: FakeColumn, TableDescription: FakeTableDescription, Types },
      withSession: async (callback: (session: {
        describeTable: () => Promise<object>;
        createTable: typeof createTable;
      }) => Promise<unknown>) => callback({
        describeTable: async () => ({}),
        createTable,
      }),
    });
    expect(createTable).not.toHaveBeenCalled();
  });
});

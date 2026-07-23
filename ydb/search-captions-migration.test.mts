import { readFileSync } from "node:fs";

import { Types } from "ydb-sdk";
import { describe, expect, it, vi } from "vitest";

class FakeColumn {
  constructor(
    public readonly name: string,
    public readonly type: unknown,
  ) {}
}

class FakeTableDescription {
  readonly columns: FakeColumn[] = [];
  readonly primaryKeys: string[] = [];

  withColumn(column: FakeColumn) {
    this.columns.push(column);
    return this;
  }

  withPrimaryKey(column: string) {
    this.primaryKeys.push(column);
    return this;
  }
}

describe("pet search captions migration", () => {
  it("creates the versioned captions table idempotently", async () => {
    const { up } = await import(
      new URL(
        "./migrations/20260722_002_add_pet_search_captions.mjs",
        import.meta.url,
      ).href
    );
    const createTable = vi.fn();
    await up({
      sdk: {
        Column: FakeColumn,
        TableDescription: FakeTableDescription,
        Types,
      },
      withSession: async (callback: (session: {
        describeTable: () => Promise<never>;
        createTable: typeof createTable;
      }) => Promise<unknown>) =>
        callback({
          describeTable: async () => {
            throw new Error("path not found");
          },
          createTable,
        }),
    });

    const [tableName, description] = createTable.mock.calls[0] ?? [];
    expect(tableName).toBe("codex_pet_search_captions");
    expect(description.columns.map((column: FakeColumn) => column.name)).toEqual([
      "caption_revision",
      "pet_slug",
      "source_hash",
      "caption_json",
      "caption_text",
      "updated_at",
    ]);
    expect(description.columns.map((column: FakeColumn) => column.type)).toEqual(
      Array.from({ length: 6 }, () => Types.UTF8),
    );
    expect(description.primaryKeys).toEqual(["caption_revision", "pet_slug"]);

    const existingCreateTable = vi.fn();
    await up({
      sdk: {
        Column: FakeColumn,
        TableDescription: FakeTableDescription,
        Types,
      },
      withSession: async (callback: (session: {
        describeTable: () => Promise<object>;
        createTable: typeof existingCreateTable;
      }) => Promise<unknown>) =>
        callback({
          describeTable: async () => ({}),
          createTable: existingCreateTable,
        }),
    });
    expect(existingCreateTable).not.toHaveBeenCalled();
  });

  it("keeps the manual schema source of truth in sync", () => {
    const schema = readFileSync(new URL("./schema.yql", import.meta.url), "utf8");

    expect(schema).toContain("CREATE TABLE codex_pet_search_captions");
    expect(schema).toContain("PRIMARY KEY (caption_revision, pet_slug)");
  });
});

import { readFileSync } from "node:fs";

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

describe("pet search embeddings migration", () => {
  it("creates the versioned embeddings table idempotently", async () => {
    const { up } = await import(
      new URL(
        "./migrations/20260722_001_add_pet_search_embeddings.mjs",
        import.meta.url,
      ).href
    );
    const createTable = vi.fn(
      async (tableName: string, description: FakeTableDescription) => {
        void tableName;
        void description;
      },
    );
    const withSession = vi.fn(async (callback) =>
      callback({
        describeTable: vi.fn(async () => {
          throw new Error("path not found");
        }),
        createTable,
      }),
    );
    const types = {
      UTF8: "utf8",
      UINT32: "uint32",
      STRING: "string",
      optional: (type: string) => ({ optionalType: { item: type } }),
    };

    await up({
      sdk: {
        Column: FakeColumn,
        TableDescription: FakeTableDescription,
        Types: types,
      },
      withSession,
    });

    const [tableName, description] = createTable.mock.calls[0] ?? [];
    expect(tableName).toBe("codex_pet_search_embeddings");
    expect(description.columns.map((column: FakeColumn) => column.name)).toEqual([
      "model_revision",
      "pet_slug",
      "source_hash",
      "dimensions",
      "embedding",
      "updated_at",
    ]);
    expect(description.columns.map((column: FakeColumn) => column.type)).toEqual([
      types.optional(types.UTF8),
      types.optional(types.UTF8),
      types.optional(types.UTF8),
      types.optional(types.UINT32),
      types.optional(types.STRING),
      types.optional(types.UTF8),
    ]);
    expect(description.primaryKeys).toEqual(["model_revision", "pet_slug"]);

    const existingCreateTable = vi.fn();
    await up({
      sdk: {
        Column: FakeColumn,
        TableDescription: FakeTableDescription,
        Types: types,
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

    expect(schema).toContain("CREATE TABLE codex_pet_search_embeddings");
    expect(schema).toContain("PRIMARY KEY (model_revision, pet_slug)");
  });
});

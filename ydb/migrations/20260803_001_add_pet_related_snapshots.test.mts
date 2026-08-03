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

type ExistingTables = ReadonlySet<string>;

async function runMigration(existingTables: ExistingTables) {
  const { up } = await import(
    new URL(
      "./20260803_001_add_pet_related_snapshots.mjs",
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
      describeTable: (tableName: string) => Promise<object>;
      createTable: typeof createTable;
    }) => Promise<unknown>) =>
      callback({
        describeTable: async (tableName) => {
          if (existingTables.has(tableName)) return {};
          throw new Error("path not found");
        },
        createTable,
      }),
  });

  return createTable;
}

describe("pet related snapshots migration", () => {
  it.each([
    [
      "both tables missing",
      new Set<string>(),
      ["codex_pet_related_state", "codex_pet_related_snapshots"],
    ],
    [
      "state table already exists",
      new Set(["codex_pet_related_state"]),
      ["codex_pet_related_snapshots"],
    ],
    [
      "snapshots table already exists",
      new Set(["codex_pet_related_snapshots"]),
      ["codex_pet_related_state"],
    ],
    [
      "both tables already exist",
      new Set(["codex_pet_related_state", "codex_pet_related_snapshots"]),
      [],
    ],
  ])(
    "creates only missing tables when %s",
    async (_caseName, existingTables, expectedTables) => {
      const createTable = await runMigration(existingTables);

      expect(createTable.mock.calls.map(([tableName]) => tableName)).toEqual(
        expectedTables,
      );
    },
  );

  it("creates the related state and snapshots tables with their declared contracts", async () => {
    const createTable = await runMigration(new Set());
    const tables = new Map(
      createTable.mock.calls.map(([tableName, description]) => [
        tableName as string,
        description as FakeTableDescription,
      ]),
    );

    expect(tables.get("codex_pet_related_state")).toMatchObject({
      columns: [
        { name: "state_id", type: Types.UTF8 },
        { name: "requested_generation_id", type: Types.optional(Types.UTF8) },
        { name: "active_generation_id", type: Types.optional(Types.UTF8) },
        { name: "previous_generation_id", type: Types.optional(Types.UTF8) },
        { name: "status", type: Types.UTF8 },
        { name: "ranking_revision", type: Types.UTF8 },
        { name: "failure_reason", type: Types.optional(Types.UTF8) },
        { name: "updated_at", type: Types.UTF8 },
      ],
      primaryKeys: ["state_id"],
    });
    expect(tables.get("codex_pet_related_snapshots")).toMatchObject({
      columns: [
        { name: "generation_id", type: Types.UTF8 },
        { name: "source_slug", type: Types.UTF8 },
        { name: "ranking_revision", type: Types.UTF8 },
        { name: "related_slugs_json", type: Types.JSON },
        { name: "created_at", type: Types.UTF8 },
      ],
      primaryKeys: ["generation_id", "source_slug"],
    });
  });

  it("keeps the manual schema source of truth in sync", () => {
    const schema = readFileSync(
      new URL("../schema.yql", import.meta.url),
      "utf8",
    );

    expect(schema).toContain("CREATE TABLE codex_pet_related_state");
    expect(schema).toContain("requested_generation_id Utf8");
    expect(schema).toContain("active_generation_id Utf8");
    expect(schema).toContain("previous_generation_id Utf8");
    expect(schema).toContain("failure_reason Utf8");
    expect(schema).toContain("PRIMARY KEY (state_id)");
    expect(schema).toContain("CREATE TABLE codex_pet_related_snapshots");
    expect(schema).toContain("related_slugs_json Json NOT NULL");
    expect(schema).toContain("PRIMARY KEY (generation_id, source_slug)");
  });
});

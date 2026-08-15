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

describe("related pet annotations migration", () => {
  it("creates the additive table once and matches manual schema", async () => {
    const createTable = vi.fn();
    const { up } = await import(
      new URL("./20260811_001_add_pet_related_annotations.mjs", import.meta.url).href
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

    expect(createTable).toHaveBeenCalledOnce();
    expect(createTable.mock.calls[0]?.[0]).toBe("codex_pet_related_annotations");
    expect(createTable.mock.calls[0]?.[1]).toMatchObject({
      columns: [
        { name: "annotation_revision", type: Types.UTF8 },
        { name: "pet_slug", type: Types.UTF8 },
        { name: "source_hash", type: Types.UTF8 },
        { name: "proposal_json", type: Types.UTF8 },
        { name: "annotation_json", type: Types.UTF8 },
        { name: "annotation_text", type: Types.UTF8 },
        { name: "updated_at", type: Types.UTF8 },
      ],
      primaryKeys: ["annotation_revision", "pet_slug"],
    });
    const schema = readFileSync(new URL("../schema.yql", import.meta.url), "utf8");
    expect(schema).toContain("CREATE TABLE codex_pet_related_annotations");
    expect(schema).toContain("PRIMARY KEY (annotation_revision, pet_slug)");
  });

  it("does not recreate an existing table", async () => {
    const createTable = vi.fn();
    const { up } = await import(
      new URL("./20260811_001_add_pet_related_annotations.mjs", import.meta.url).href
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

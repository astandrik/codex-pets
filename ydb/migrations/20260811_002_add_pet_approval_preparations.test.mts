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

describe("approval preparations migration", () => {
  it("creates the additive queue table and matches manual schema", async () => {
    const createTable = vi.fn();
    const { up } = await import(
      new URL("./20260811_002_add_pet_approval_preparations.mjs", import.meta.url).href
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
    expect(createTable.mock.calls[0]?.[0]).toBe("codex_pet_approval_preparations");
    expect(createTable.mock.calls[0]?.[1]).toMatchObject({
      columns: expect.arrayContaining([
        { name: "preparation_id", type: Types.UTF8 },
        { name: "attempts", type: Types.UINT32 },
        { name: "lease_until", type: Types.UTF8 },
      ]),
      primaryKeys: ["preparation_id"],
    });
    const schema = readFileSync(new URL("../schema.yql", import.meta.url), "utf8");
    expect(schema).toContain("CREATE TABLE codex_pet_approval_preparations");
  });
});

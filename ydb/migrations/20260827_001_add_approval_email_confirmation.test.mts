import { readFileSync } from "node:fs";
import { Types } from "ydb-sdk";
import { describe, expect, it, vi } from "vitest";

class Column {
  constructor(public name: string, public type: unknown) {}
}
class AlterTableDescription {
  columns: Column[] = [];
  withAddColumn(column: Column) {
    this.columns.push(column);
    return this;
  }
}

describe("approval email confirmation migration", () => {
  it.each([false, true])("adds only a missing optional column, existing=%s", async (exists) => {
    const { up } = await import(new URL("./20260827_001_add_approval_email_confirmation.mjs", import.meta.url).href);
    const alterTable = vi.fn();
    const execute = vi.fn();
    const session = {
      describeTable: vi.fn(async () => ({ columns: exists ? [{ name: "publish_requested_email" }] : [] })),
      alterTable,
    };
    await up({
      sdk: { Column, AlterTableDescription, Types, TypedValues: { bool: (v: boolean) => v } },
      withSession: (fn: (s: typeof session) => Promise<unknown>) => fn(session),
      execute,
    });
    expect(session.describeTable).toHaveBeenCalledWith("codex_pet_approval_preparations");
    expect(alterTable).toHaveBeenCalledTimes(exists ? 0 : 1);
    if (!exists) {
      const [table, description] = alterTable.mock.calls[0];
      expect(table).toBe("codex_pet_approval_preparations");
      expect(description.columns).toEqual([new Column("publish_requested_email", Types.optional(Types.BOOL))]);
    }
    const [statement, params] = execute.mock.calls[0];
    expect(statement).toContain("WHERE publish_requested_email IS NULL");
    expect(params).toEqual({ $default_confirmation: false });
  });

  it("matches the manual schema", () => {
    const schema = readFileSync(new URL("../schema.yql", import.meta.url), "utf8");
    expect(schema).toContain("publish_requested_email Bool NOT NULL");
  });
});

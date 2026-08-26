import { readFileSync } from "node:fs";

import { Types } from "ydb-sdk";
import { describe, expect, it, vi } from "vitest";

class FakeColumn {
  constructor(public readonly name: string, public readonly type: unknown) {}
}
class FakeAlterTableDescription {
  readonly addColumns: FakeColumn[] = [];
  withAddColumn(column: FakeColumn) {
    this.addColumns.push(column);
    return this;
  }
}

describe("related annotation provenance migration", () => {
  it("adds only missing nullable provenance columns", async () => {
    const alterTable = await runMigration(["proposal_revision"]);

    expect(alterTable).toHaveBeenCalledWith(
      "codex_pet_related_annotations",
      expect.objectContaining({
        addColumns: [
          { name: "proposal_input_hash", type: Types.optional(Types.UTF8) },
          { name: "proposal_hash", type: Types.optional(Types.UTF8) },
        ],
      }),
    );
    const schema = readFileSync(new URL("../schema.yql", import.meta.url), "utf8");
    expect(schema).toContain("proposal_revision Utf8");
    expect(schema).toContain("proposal_input_hash Utf8");
    expect(schema).toContain("proposal_hash Utf8");
  });

  it("is idempotent when all columns already exist", async () => {
    const alterTable = await runMigration([
      "proposal_revision",
      "proposal_input_hash",
      "proposal_hash",
    ]);
    expect(alterTable).not.toHaveBeenCalled();
  });
});

async function runMigration(columns: string[]) {
  const alterTable = vi.fn();
  const { up } = await import(
    new URL(
      "./20260826_004_add_pet_related_annotation_provenance.mjs",
      import.meta.url,
    ).href
  );
  await up({
    sdk: {
      AlterTableDescription: FakeAlterTableDescription,
      Column: FakeColumn,
      Types,
    },
    withSession: async (callback: (session: {
      describeTable: () => Promise<{ columns: Array<{ name: string }> }>;
      alterTable: typeof alterTable;
    }) => Promise<unknown>) => callback({
      describeTable: async () => ({
        columns: columns.map((name) => ({ name })),
      }),
      alterTable,
    }),
  });
  return alterTable;
}

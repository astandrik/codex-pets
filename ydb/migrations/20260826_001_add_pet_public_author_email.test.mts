import { readFileSync } from "node:fs";

import { Types } from "ydb-sdk";
import { describe, expect, it, vi } from "vitest";

class FakeColumn {
  constructor(
    public readonly name: string,
    public readonly type: unknown,
  ) {}
}

class FakeAlterTableDescription {
  readonly columns: FakeColumn[] = [];

  withAddColumn(column: FakeColumn) {
    this.columns.push(column);
    return this;
  }
}

async function runMigration(existingColumns: string[]) {
  const { up } = await import(
    new URL(
      "./20260826_001_add_pet_public_author_email.mjs",
      import.meta.url,
    ).href
  );
  const alterTable = vi.fn();
  const execute = vi.fn();

  await up({
    sdk: {
      AlterTableDescription: FakeAlterTableDescription,
      Column: FakeColumn,
      Types,
      TypedValues: {
        bool: (value: boolean) => value,
        utf8: (value: string) => value,
      },
    },
    execute,
    withSession: async (
      callback: (session: {
        describeTable: () => Promise<{ columns: Array<{ name: string }> }>;
        alterTable: typeof alterTable;
      }) => Promise<unknown>,
    ) =>
      callback({
        describeTable: async () => ({
          columns: existingColumns.map((name) => ({ name })),
        }),
        alterTable,
      }),
  });

  return { alterTable, execute };
}

describe("public author email migration", () => {
  it.each([
    [[], ["public_email_requested", "public_author_email"]],
    [["public_email_requested"], ["public_author_email"]],
    [["public_author_email"], ["public_email_requested"]],
    [["public_email_requested", "public_author_email"], []],
  ])(
    "adds only missing columns for %j",
    async (existingColumns, expectedAddedColumns) => {
      const { alterTable } = await runMigration(existingColumns);
      const addedColumns = alterTable.mock.calls.flatMap(([, description]) =>
        (description as FakeAlterTableDescription).columns.map(
          (column) => column.name,
        ),
      );

      expect(addedColumns).toEqual(expectedAddedColumns);
    },
  );

  it("backfills both nullable migration columns on every run", async () => {
    const { execute } = await runMigration([
      "public_email_requested",
      "public_author_email",
    ]);
    const [statement, params] = execute.mock.calls[0] ?? [];

    expect(statement).toContain(
      "public_email_requested = COALESCE(public_email_requested, $public_email_requested)",
    );
    expect(statement).toContain(
      "public_author_email = COALESCE(public_author_email, $public_author_email)",
    );
    expect(params).toEqual({
      $public_email_requested: false,
      $public_author_email: "",
    });
  });

  it("keeps the manual schema source of truth in sync", () => {
    const schema = readFileSync(new URL("../schema.yql", import.meta.url), "utf8");

    expect(schema).toContain("public_email_requested Bool NOT NULL");
    expect(schema).toContain("public_author_email Utf8 NOT NULL");
  });
});

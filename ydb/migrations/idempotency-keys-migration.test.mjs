import { describe, expect, it } from "vitest";

import { up as addIdempotencyKeys } from "./20260529_001_add_idempotency_keys.mjs";

class FakeTableDescription {
  columns = [];
  primaryKeys = [];

  withColumn(column) {
    this.columns.push(column);
    return this;
  }

  withPrimaryKey(key) {
    this.primaryKeys.push(key);
    return this;
  }
}

class FakeColumn {
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
}

const fakeTypes = {
  UTF8: "Utf8",
  UINT32: "Uint32",
};

describe("idempotency YDB migrations", () => {
  it("creates codex_idempotency_keys with a composite primary key", async () => {
    let createdTable = null;

    await addIdempotencyKeys({
      sdk: {
        Column: FakeColumn,
        TableDescription: FakeTableDescription,
        Types: fakeTypes,
      },
      withSession: async (callback) =>
        callback({
          describeTable: async () => {
            throw new Error("Path not found");
          },
          createTable: async (_name, table) => {
            createdTable = table;
          },
        }),
    });

    expect(createdTable?.primaryKeys).toEqual(["route", "idempotency_key"]);
  });

  it("recreates an existing idempotency table when the primary key is incomplete", async () => {
    const { up: repairIdempotencyKeys } = await import(
      "./20260531_002_recreate_idempotency_keys_primary_key.mjs"
    );
    const calls = [];
    let createdTable = null;

    await repairIdempotencyKeys({
      sdk: {
        Column: FakeColumn,
        TableDescription: FakeTableDescription,
        Types: fakeTypes,
        TypedValues: {
          utf8: (value) => ({ type: "Utf8", value }),
          uint32: (value) => ({ type: "Uint32", value }),
        },
      },
      execute: async (statement, params) => {
        calls.push({ type: "execute", statement, params });
        if (statement.includes("SELECT route, idempotency_key")) {
          return {
            resultSets: [
              {
                rows: [
                  {
                    items: [
                      { textValue: "POST /api/generation-requests#anonymous" },
                      { textValue: "ora-key" },
                      { textValue: "hash" },
                      { textValue: "completed" },
                      { uint32Value: 201 },
                      { textValue: "{\"ok\":true}" },
                      { textValue: "2026-05-31T00:00:00.000Z" },
                      { textValue: "2026-05-31T00:00:01.000Z" },
                      { textValue: "" },
                      { textValue: "2026-06-01T00:00:00.000Z" },
                    ],
                  },
                ],
              },
            ],
          };
        }
        return {};
      },
      withSession: async (callback) =>
        callback({
          describeTable: async () => ({ primaryKey: ["route"] }),
          dropTable: async (name) => calls.push({ type: "dropTable", name }),
          createTable: async (name, table) => {
            calls.push({ type: "createTable", name });
            createdTable = table;
          },
        }),
    });

    expect(calls.map((call) => call.type)).toEqual([
      "execute",
      "dropTable",
      "createTable",
      "execute",
    ]);
    expect(createdTable?.primaryKeys).toEqual(["route", "idempotency_key"]);
    expect(calls.at(-1)?.params?.$idempotency_key).toEqual({
      type: "Utf8",
      value: "ora-key",
    });
  });
});

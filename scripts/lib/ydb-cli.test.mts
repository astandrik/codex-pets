import { describe, expect, it } from "vitest";

const {
  isLocalYdbEndpoint,
  parseStringArray,
  readYdbCliConfig,
  textAt,
  uint32At,
} = await import("./ydb-cli.mjs");

describe("YDB maintenance CLI helpers", () => {
  it("reads the established endpoint and database environment contract", () => {
    expect(readYdbCliConfig({
      YDB_PETS_ENDPOINT: " grpcs://example.net:2135 ",
      YDB_PETS_DATABASE: " /prod/pets ",
    })).toEqual({
      endpoint: "grpcs://example.net:2135",
      database: "/prod/pets",
    });
    expect(readYdbCliConfig({})).toEqual({
      endpoint: "grpc://127.0.0.1:2136",
      database: "/local",
    });
  });

  it("requires an explicit endpoint and database for writes", () => {
    expect(() => readYdbCliConfig({}, { requireExplicitTarget: true }))
      .toThrow(/YDB_PETS_ENDPOINT.*YDB_PETS_DATABASE/);
    expect(() => readYdbCliConfig({
      YDB_PETS_ENDPOINT: "grpc://127.0.0.1:2136",
    }, { requireExplicitTarget: true })).toThrow(/YDB_PETS_DATABASE/);
    expect(readYdbCliConfig({
      YDB_PETS_ENDPOINT: "grpc://127.0.0.1:2136",
      YDB_PETS_DATABASE: "/local",
    }, { requireExplicitTarget: true })).toEqual({
      endpoint: "grpc://127.0.0.1:2136",
      database: "/local",
    });
  });

  it("keeps row decoding and local endpoint checks centralized", () => {
    const row = { items: [{ textValue: "pet" }, { uint32Value: 768 }] };
    expect(textAt(row, 0)).toBe("pet");
    expect(uint32At(row, 1)).toBe(768);
    expect(parseStringArray('["a",2,"b"]')).toEqual(["a", "b"]);
    expect(parseStringArray("invalid")).toEqual([]);
    expect(isLocalYdbEndpoint("grpc://127.0.0.1:2136")).toBe(true);
    expect(isLocalYdbEndpoint("grpc://[::1]:2136")).toBe(true);
    expect(isLocalYdbEndpoint("grpcs://example.net:2135")).toBe(false);
  });
});

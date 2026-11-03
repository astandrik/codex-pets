import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ydb/client", () => ({
  TypedValues: { utf8: (value: string) => value },
  withSession: (operation: (session: { executeQuery: typeof query }) => unknown) => operation({ executeQuery: query }),
}));

import { assetUrl, readPetAssetFile, readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import { PetAssetNotFoundError } from "@/lib/pets/asset-errors";

describe("asset repository", () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ resultSets: [{ rows: [] }] });
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "ydb");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("builds internal asset URLs", () => {
    expect(assetUrl("asset_123456789abc", "pet.json")).toBe("/api/assets/asset_123456789abc/pet.json");
  });

  it("classifies an absent row as not found", async () => {
    await expect(readPetAssetFile({ assetId: "absent", filename: "pet.json" }))
      .rejects.toBeInstanceOf(PetAssetNotFoundError);
  });

  it("classifies an unsupported filename without querying storage", async () => {
    await expect(readPetAssetFile({ assetId: "absent", filename: "unsupported" }))
      .rejects.toBeInstanceOf(PetAssetNotFoundError);
    expect(query).not.toHaveBeenCalled();
  });

  it("preserves storage failures as distinct from missing rows", async () => {
    const failure = new Error("synthetic storage timeout");
    query.mockRejectedValueOnce(failure);
    await expect(readPetSpritesheetAsset({ assetId: "existing" })).rejects.toBe(failure);
  });

  it.each(["png", "webp"])("reads only sheet bytes and format for %s", async (extension) => {
    const sheet = Buffer.from("sheet bytes");
    query.mockResolvedValue({ resultSets: [{ rows: [{ items: [
      { bytesValue: sheet }, { textValue: extension },
    ] }] }] });
    expect(await readPetSpritesheetAsset({ assetId: "asset-a" })).toEqual({
      buffer: sheet,
      contentType: `image/${extension}`,
      filename: `spritesheet.${extension}`,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toMatch(/SELECT\s+spritesheet_bytes,\s*spritesheet_ext\s+FROM/);
    expect(sql).not.toMatch(/pet_json_bytes|zip_bytes/);
    expect(parameters).toEqual({ $asset_id: "asset-a" });
  });

  it("keeps the sheet missing-row error", async () => {
    await expect(readPetSpritesheetAsset({ assetId: "absent" }))
      .rejects.toBeInstanceOf(PetAssetNotFoundError);
  });

  it.each([
    ["pet.json", "application/json; charset=utf-8", 0],
    ["spritesheet.png", "image/png", 1],
    ["pet.zip", "application/zip", 2],
  ] as const)("preserves ordinary asset reading for %s", async (filename, contentType, index) => {
    const files = [Buffer.from("json"), Buffer.from("sheet"), Buffer.from("zip")];
    query.mockResolvedValue({ resultSets: [{ rows: [{ items: [
      ...files.map(bytesValue => ({ bytesValue })), { textValue: "png" },
    ] }] }] });
    expect(await readPetAssetFile({ assetId: "asset-a", filename })).toEqual({
      buffer: files[index], contentType,
    });
  });

  it("uses the same missing-asset contract in the mock data source", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    await expect(readPetSpritesheetAsset({ assetId: "missing-contract-fixture" }))
      .rejects.toBeInstanceOf(PetAssetNotFoundError);
    expect(query).not.toHaveBeenCalled();
  });
});

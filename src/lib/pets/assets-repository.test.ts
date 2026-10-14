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

  it("uses the same missing-asset contract in the mock data source", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    await expect(readPetSpritesheetAsset({ assetId: "missing-contract-fixture" }))
      .rejects.toBeInstanceOf(PetAssetNotFoundError);
    expect(query).not.toHaveBeenCalled();
  });
});

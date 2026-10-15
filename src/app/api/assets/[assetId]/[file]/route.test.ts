import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/pets/assets-repository", () => ({
  readPetAssetFile: vi.fn(),
  readPetSpritesheetAsset: vi.fn(),
}));

import { GET } from "@/app/api/assets/[assetId]/[file]/route";
import {
  readPetAssetFile,
  readPetSpritesheetAsset,
} from "@/lib/pets/assets-repository";
import { PetAssetNotFoundError } from "@/lib/pets/asset-errors";
import { ASSET_CACHE_CONTROL } from "@/lib/pets/asset-urls";

describe("GET /api/assets/:assetId/:file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("generates a cached webp preview from the spritesheet", async () => {
    const source = await createTestSpritesheet();

    vi.mocked(readPetSpritesheetAsset).mockResolvedValueOnce({
      buffer: source,
      contentType: "image/webp",
      filename: "spritesheet.webp",
    });

    const response = await GET(
      new Request("http://localhost:3000/api/assets/asset_1/preview.webp"),
      {
        params: Promise.resolve({
          assetId: "asset_1",
          file: "preview.webp",
        }),
      },
    );
    const metadata = await sharp(Buffer.from(await response.arrayBuffer()))
      .metadata();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe(ASSET_CACHE_CONTROL);
    expect(metadata.width).toBe(192);
    expect(metadata.height).toBe(208);
    expect(readPetAssetFile).not.toHaveBeenCalled();
  });

  it("generates a cached webp idle strip from the spritesheet", async () => {
    const source = await createTestSpritesheet();

    vi.mocked(readPetSpritesheetAsset).mockResolvedValueOnce({
      buffer: source,
      contentType: "image/webp",
      filename: "spritesheet.webp",
    });

    const response = await GET(
      new Request("http://localhost:3000/api/assets/asset_1/idle-strip.webp"),
      {
        params: Promise.resolve({
          assetId: "asset_1",
          file: "idle-strip.webp",
        }),
      },
    );
    const metadata = await sharp(Buffer.from(await response.arrayBuffer()))
      .metadata();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe(ASSET_CACHE_CONTROL);
    expect(metadata.width).toBe(1152);
    expect(metadata.height).toBe(208);
    expect(readPetAssetFile).not.toHaveBeenCalled();
  });

  it.each([
    ["pet.json", "application/json; charset=utf-8"],
    ["spritesheet.webp", "image/webp"],
    ["pet.zip", "application/zip"],
  ])("serves cached existing asset file %s", async (file, contentType) => {
    vi.mocked(readPetAssetFile).mockResolvedValueOnce({
      buffer: Buffer.from("asset-body"),
      contentType,
    });

    const response = await GET(
      new Request(`http://localhost:3000/api/assets/asset_1/${file}`),
      {
        params: Promise.resolve({
          assetId: "asset_1",
          file,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(response.headers.get("Cache-Control")).toBe(ASSET_CACHE_CONTROL);
    expect(await response.text()).toBe("asset-body");
    expect(readPetAssetFile).toHaveBeenCalledWith({
      assetId: "asset_1",
      filename: file,
    });
    expect(readPetSpritesheetAsset).not.toHaveBeenCalled();
  });

  it("keeps 404 for an explicitly missing asset", async () => {
    vi.mocked(readPetAssetFile).mockRejectedValueOnce(new PetAssetNotFoundError("Asset not found."));
    const response = await GET(new Request("http://localhost/api/assets/a/pet.json"), {
      params: Promise.resolve({ assetId: "a", file: "pet.json" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("does not report a storage failure as a missing asset", async () => {
    vi.mocked(readPetAssetFile).mockRejectedValueOnce(new Error("synthetic private storage failure"));
    const response = await GET(new Request("http://localhost/api/assets/a/pet.json"), {
      params: Promise.resolve({ assetId: "a", file: "pet.json" }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "asset_unavailable" });
  });

  it("does not report an unreadable stored image as a missing asset", async () => {
    vi.mocked(readPetSpritesheetAsset).mockResolvedValueOnce({
      buffer: Buffer.from("not an image"), contentType: "image/webp", filename: "spritesheet.webp",
    });
    const response = await GET(new Request("http://localhost/api/assets/a/preview.webp"), {
      params: Promise.resolve({ assetId: "a", file: "preview.webp" }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "asset_unavailable" });
  });
});

async function createTestSpritesheet(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1536,
      height: 1872,
      channels: 4,
      background: { r: 255, g: 189, b: 74, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
}

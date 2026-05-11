import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { ASSET_CACHE_CONTROL } from "@/lib/pets/asset-urls";

describe("GET /api/assets/:assetId/:file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

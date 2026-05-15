import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const repositoryMocks = vi.hoisted(() => ({
  getApprovedPetBySlug: vi.fn(),
}));

const assetMocks = vi.hoisted(() => ({
  readPetSpritesheetAsset: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  getApprovedPetBySlug: repositoryMocks.getApprovedPetBySlug,
}));

vi.mock("@/lib/pets/assets-repository", () => ({
  readPetSpritesheetAsset: assetMocks.readPetSpritesheetAsset,
}));

const approvedPet = {
  id: "pet_1",
  slug: "orbit-otter",
  displayName: "Orbit Otter",
  description: "Demo pet",
  spritesheetUrl: "/api/assets/a/spritesheet.webp",
  petJsonUrl: "/api/assets/a/pet.json",
  zipUrl: "/api/assets/a/pet.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: ["space", "friendly", "orbital", "extra"],
  status: "approved" as const,
  ownerName: "Creator",
  contactEmail: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

describe("GET /card/[file]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns a sprite-only GIF by default for approved pets", async () => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    assetMocks.readPetSpritesheetAsset.mockResolvedValueOnce({
      buffer: await createTestSpritesheet(),
      contentType: "image/webp",
      filename: "spritesheet.webp",
    });
    const { GET } = await import("@/app/card/[file]/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ file: "orbit-otter.gif" }),
    });
    const body = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(body, { animated: true }).metadata();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(metadata.format).toBe("gif");
    expect(metadata.width).toBe(384);
    expect(metadata.pages).toBe(6);
    expect(metadata.pageHeight).toBe(416);
    expect(response.headers.get("X-Codex-Pet-Width")).toBe("384");
    expect(response.headers.get("X-Codex-Pet-Height")).toBe("416");
    expect(repositoryMocks.getApprovedPetBySlug).toHaveBeenCalledWith(
      "orbit-otter",
    );
    expect(assetMocks.readPetSpritesheetAsset).toHaveBeenCalledWith({
      assetId: "a",
    });
  });

  it("returns a full card when mode=card is requested", async () => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    assetMocks.readPetSpritesheetAsset.mockResolvedValueOnce({
      buffer: await createTestSpritesheet(),
      contentType: "image/webp",
      filename: "spritesheet.webp",
    });
    const { GET } = await import("@/app/card/[file]/route");

    const response = await GET(
      new Request("https://pets.example/card/orbit-otter.gif?mode=card&state=review"),
      {
        params: Promise.resolve({ file: "orbit-otter.gif" }),
      },
    );
    const body = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(body, { animated: true }).metadata();

    expect(response.status).toBe(200);
    expect(metadata.width).toBe(640);
    expect(metadata.pageHeight).toBe(360);
    expect(response.headers.get("X-Codex-Pet-Width")).toBeNull();
    expect(response.headers.get("X-Codex-Pet-Height")).toBeNull();
  });

  it("returns 404 for non-gif files", async () => {
    const { GET } = await import("@/app/card/[file]/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ file: "orbit-otter.png" }),
    });

    expect(response.status).toBe(404);
    expect(repositoryMocks.getApprovedPetBySlug).not.toHaveBeenCalled();
  });

  it("returns 404 for missing pets", async () => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/card/[file]/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ file: "missing.gif" }),
    });

    expect(response.status).toBe(404);
    expect(assetMocks.readPetSpritesheetAsset).not.toHaveBeenCalled();
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

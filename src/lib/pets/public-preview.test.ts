import sharp from "sharp";
import { readFileSync } from "node:fs";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {PetAssetNotFoundError} from "./asset-errors";

const mocks = vi.hoisted(() => ({pet: vi.fn(), asset: vi.fn(), configured: vi.fn()}));
vi.mock("./repository", () => ({getPetBySlug: mocks.pet}));
vi.mock("./assets-repository", () => ({readPetSpritesheetAsset: mocks.asset}));
vi.mock("./mock-data", () => ({isMockPetsDataSource: () => false}));
vi.mock("@/lib/ydb/client", () => ({isYdbConfigured: mocks.configured}));
import {readApprovedPetPreview, renderPetPoster} from "./public-preview";

const pet = {id: "pet_1", status: "approved", spritesheetUrl: "/api/assets/a/spritesheet.webp"};
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
  mocks.configured.mockReturnValue(true); mocks.pet.mockResolvedValue(pet);
});

export async function atlas(rows = 9, format: "png" | "webp" = "webp") {
  const red = await sharp({create: {width: 192, height: 208, channels: 4, background: "#ff0000"}}).png().toBuffer();
  const image = sharp({create: {width: 1536, height: rows * 208, channels: 4, background: "#0000ff"}}).composite([{input: red, left: 0, top: 0}]);
  return format === "png" ? image.png().toBuffer() : image.webp({lossless: true}).toBuffer();
}

it.each([[9,"png"],[9,"webp"],[11,"png"],[11,"webp"]] as const)("extracts only first idle cell from %i-row %s", async (rows, format) => {
  const result = await renderPetPoster(await atlas(rows, format));
  const meta = await sharp(result).metadata();
  expect(meta).toMatchObject({format: "webp", width: 192, height: 208});
  const {data} = await sharp(result).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  for (let i=0; i<data.length; i+=4) expect([...data.subarray(i,i+4)]).toEqual([255,0,0,255]);
});

it.each([null, {...pet,status:"pending"}, {...pet,status:"rejected"}, {...pet,status:"deleted"}])("does not read an unpublished asset: %j", async value => {
  mocks.pet.mockResolvedValue(value);
  await expect(readApprovedPetPreview("boba")).rejects.toMatchObject({status:404});
  expect(mocks.asset).not.toHaveBeenCalled();
});

it.each(["../boba", " boba", "boba/preview", "", "https://evil.test"])('rejects slug %s', async slug => {
  await expect(readApprovedPetPreview(slug)).rejects.toMatchObject({status:404});
  expect(mocks.pet).not.toHaveBeenCalled();
});

it("reads again before returning the bytes and keeps the legacy slug", async () => {
  mocks.asset.mockResolvedValue({buffer: await atlas()});
  const result = await readApprovedPetPreview("legacy-");
  expect(result.bytes.length).toBeGreaterThan(0); expect(result.etag).toMatch(/^"[a-f0-9]{64}"$/);
  expect(mocks.pet.mock.calls).toEqual([["legacy-"],["legacy-"]]);
  expect(mocks.asset).toHaveBeenCalledWith({assetId:"a"});
});

it.each(["rejected","deleted"])("does not release bytes if status becomes %s during reading", async status => {
  mocks.asset.mockResolvedValue({buffer:await atlas()});
  mocks.pet.mockResolvedValueOnce(pet).mockResolvedValueOnce({...pet,status});
  await expect(readApprovedPetPreview("boba")).rejects.toMatchObject({status:404});
});

it.each([{...pet,id:"pet_2"},{...pet,spritesheetUrl:"/api/assets/b/spritesheet.webp"}])("rejects a changed source", async value => {
  mocks.asset.mockResolvedValue({buffer:await atlas()});
  mocks.pet.mockResolvedValueOnce(pet).mockResolvedValueOnce(value);
  await expect(readApprovedPetPreview("boba")).rejects.toMatchObject({status:409});
});

it("never reads an external source", async () => {
  mocks.pet.mockResolvedValue({...pet,spritesheetUrl:"https://evil.test/api/assets/a/spritesheet.webp"});
  await expect(readApprovedPetPreview("boba")).rejects.toMatchObject({status:422});
  expect(mocks.asset).not.toHaveBeenCalled();
});

it("distinguishes unavailable configuration/storage from missing data", async () => {
  mocks.configured.mockReturnValue(false);
  await expect(readApprovedPetPreview("boba")).rejects.toMatchObject({status:503});
  mocks.configured.mockReturnValue(true); mocks.asset.mockRejectedValue(new PetAssetNotFoundError("private"));
  await expect(readApprovedPetPreview("boba")).rejects.toMatchObject({status:404});
  mocks.asset.mockRejectedValue(new Error("private database detail"));
  await expect(readApprovedPetPreview("boba")).rejects.toMatchObject({status:503});
});

it("rejects invalid dimensions, bytes and an invisible first frame", async () => {
  for (const bytes of [Buffer.from("bad"), await sharp({create:{width:10,height:10,channels:4,background:"red"}}).png().toBuffer(), await sharp({create:{width:1536,height:1872,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer()]) {
    await expect(renderPetPoster(bytes)).rejects.toMatchObject({status:422});
  }
});

it("rejects multi-frame WebP even when its first page has valid atlas dimensions", async () => {
  const pixels = Buffer.alloc(1536 * 1872 * 2 * 4, 255);
  pixels.fill(30, 1536 * 1872 * 4);
  const animated = await sharp(pixels, {
    raw: { width: 1536, height: 1872 * 2, channels: 4, pageHeight: 1872 },
  }).webp({ lossless: true, delay: [100, 100] }).toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);
  await expect(renderPetPoster(animated)).rejects.toMatchObject({ status: 422 });
});

it("revalidates concurrent requests without a shared rendered cache", async () => {
  mocks.asset.mockResolvedValue({ buffer: await atlas() });
  const results = await Promise.all([readApprovedPetPreview("boba"), readApprovedPetPreview("boba")]);
  expect(results[0].etag).toBe(results[1].etag);
  expect(mocks.asset).toHaveBeenCalledTimes(2);
  expect(mocks.pet).toHaveBeenCalledTimes(4);
});

it.each(["/codex-pets", "/api", "/api/assets"])("supports persisted root-relative assets under base %s", async (basePath) => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
  const { readApprovedPetPreview: read } = await import("./public-preview");
  mocks.asset.mockResolvedValue({ buffer: await atlas() });
  for (const spritesheetUrl of ["/api/assets/a/spritesheet.webp", `${basePath}/api/assets/a/spritesheet.webp`]) {
    mocks.pet.mockResolvedValue({ ...pet, spritesheetUrl });
    expect((await read("boba")).bytes.length).toBeGreaterThan(0);
  }
  mocks.pet.mockResolvedValue({ ...pet, spritesheetUrl: "https://pets.example/api/assets/a/spritesheet.webp" });
  await expect(read("boba")).rejects.toMatchObject({ status: 422 });
});

it("rejects animated PNG even when Sharp exposes only the first frame", async () => {
  // Two complete atlas-sized red/blue frames with acTL, fcTL and fdAT chunks.
  const animated = readFileSync(new URL("./__fixtures__/animated-atlas.png", import.meta.url));
  expect((await sharp(animated).metadata()).format).toBe("png");
  await expect(renderPetPoster(animated)).rejects.toMatchObject({ status: 422 });
});

it("rejects corruption below the poster instead of serving a valid-looking first cell", async () => {
  const width = 1536, height = 1872;
  const pixels = Buffer.alloc(width * height * 4);
  let seed = 123;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    pixels[offset] = seed >>> 24;
    pixels[offset + 3] = 255;
  }
  const valid = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 1 }).toBuffer();
  const corrupt = Buffer.from(valid);
  let damaged = false;
  for (let offset = 8; offset < corrupt.length;) {
    const length = corrupt.readUInt32BE(offset);
    if (corrupt.toString("ascii", offset + 4, offset + 8) === "IDAT" && offset > corrupt.length * 0.7) {
      // Preserve valid PNG framing/CRC; damage the compressed pixels after the first row.
      corrupt.fill(255, offset + 8, offset + 8 + length);
      let crc = -1;
      for (const byte of corrupt.subarray(offset + 4, offset + 8 + length)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
      corrupt.writeUInt32BE((crc ^ -1) >>> 0, offset + 8 + length);
      damaged = true;
      break;
    }
    offset += length + 12;
  }
  expect(damaged).toBe(true);
  await expect(sharp(corrupt).raw().toBuffer()).rejects.toThrow();
  mocks.asset.mockResolvedValue({ buffer: corrupt });
  const { GET } = await import("@/app/pets/[slug]/preview.webp/route");
  const response = await GET(new Request("https://pets.example/pets/boba/preview.webp"), {
    params: Promise.resolve({ slug: "boba" }),
  });
  expect(response.status).toBe(422);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

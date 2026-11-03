import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { Ydb, type Session } from "ydb-sdk";

const mocks = vi.hoisted(() => ({ query: vi.fn<Session["executeQuery"]>(), pet: vi.fn() }));
vi.mock("@/lib/ydb/client", async original => ({
  ...await original<typeof import("@/lib/ydb/client")>(),
  isYdbConfigured: () => true,
  withSession: async (read: (session: Pick<Session, "executeQuery">) => Promise<unknown>) =>
    read({ executeQuery: mocks.query }),
}));
vi.mock("@/lib/pets/repository", () => ({ getPetBySlug: mocks.pet }));
vi.mock("@/lib/pets/mock-data", () => ({ isMockPetsDataSource: () => false }));
import { GET, HEAD } from "./route";

const approved = { id: "pet-a", status: "approved", spritesheetUrl: "/api/assets/source/spritesheet.png" };
const context = { params: Promise.resolve({ slug: "boba" }) };
const request = (method = "GET", etag?: string) => new Request("https://pets.example/pets/boba/preview.webp", {
  method, headers: etag ? { "If-None-Match": etag } : {},
});

async function storedSheet(extension: "png" | "webp") {
  const image = sharp({ create: { width: 1536, height: 1872, channels: 4, background: "red" } });
  const sheet = await (extension === "png" ? image.png() : image.webp({ lossless: true })).toBuffer();
  const columns: Record<string, Ydb.IValue> = {
    spritesheet_bytes: { bytesValue: sheet }, spritesheet_ext: { textValue: extension },
    pet_json_bytes: { bytesValue: Buffer.from("{}") }, zip_bytes: { bytesValue: Buffer.from("unused ZIP") },
  };
  // Return only projected columns, like YDB, so both traffic and column offsets are tested.
  mocks.query.mockImplementation(async sql => {
    if (typeof sql !== "string") throw new Error("Expected SQL text");
    const projection = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/)?.[1].split(",").map(value => value.trim());
    if (!projection) throw new Error("Expected a SELECT projection");
    return Ydb.Table.ExecuteQueryResult.create({ resultSets: [{ rows: [{ items: projection.map(name => {
      if (!(name in columns)) throw new Error(`Unexpected column ${name}`);
      return columns[name];
    }) }] }] });
  });
  mocks.pet.mockResolvedValue({ ...approved, spritesheetUrl: `/api/assets/source/spritesheet.${extension}` });
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
  await storedSheet("png");
});
afterEach(() => vi.unstubAllEnvs());

it.each(["png", "webp"] as const)("GET, HEAD and 304 read only the %s sheet", async extension => {
  await storedSheet(extension);
  const first = await GET(request(), context);
  expect(first.status).toBe(200);
  expect((await sharp(Buffer.from(await first.arrayBuffer())).metadata()).format).toBe("webp");
  const etag = first.headers.get("etag");
  expect(etag).toBeTruthy();
  const head = await HEAD(request("HEAD"), context);
  expect(head.status).toBe(200);
  expect(head.headers.get("etag")).toBe(etag);
  expect((await head.arrayBuffer()).byteLength).toBe(0);
  const conditional = await GET(request("GET", etag!), context);
  expect(conditional.status).toBe(304);
  expect((await conditional.arrayBuffer()).byteLength).toBe(0);
  expect(mocks.query).toHaveBeenCalledTimes(3);
  expect(mocks.pet).toHaveBeenCalledTimes(6);
  for (const [sql] of mocks.query.mock.calls) expect(sql).not.toMatch(/pet_json_bytes|zip_bytes/);
});

it.each([null, "pending", "rejected", "deleted"])("does not read assets for status %s", async status => {
  mocks.pet.mockResolvedValue(status === null ? null : { ...approved, status });
  for (const [method, handle] of [["GET", GET], ["HEAD", HEAD]] as const) {
    const response = await handle(request(method, '"old-etag"'), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(mocks.query).not.toHaveBeenCalled();
});

it.each(["GET", "HEAD"])("rechecks publication before conditional %s response", async method => {
  const first = await GET(request(), context);
  const etag = first.headers.get("etag");
  expect(etag).toBeTruthy();
  vi.clearAllMocks();
  mocks.pet.mockResolvedValueOnce(approved).mockResolvedValueOnce({ ...approved, status: "pending" });
  const response = await (method === "GET" ? GET : HEAD)(request(method, etag!), context);
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.pet).toHaveBeenCalledTimes(2);
});

it("keeps missing assets and storage errors distinct", async () => {
  mocks.query.mockResolvedValueOnce(Ydb.Table.ExecuteQueryResult.create({ resultSets: [{ rows: [] }] }));
  expect((await GET(request(), context)).status).toBe(404);
  mocks.query.mockRejectedValueOnce(new Error("private database diagnostic"));
  const response = await GET(request(), context);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private database");
});

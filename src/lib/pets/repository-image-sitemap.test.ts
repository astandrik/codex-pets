import { beforeEach, expect, it, vi } from "vitest";
import { Ydb, type Session } from "ydb-sdk";
import { TypedValues } from "@/lib/ydb/client";
import { listApprovedPetSitemapEntries } from "./repository";
import { GET } from "@/app/sitemap-images.xml/route";

type SessionWork = (session: Pick<Session, "executeQuery" | "streamExecuteScanQuery">) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  withSession: vi.fn<(work: SessionWork) => Promise<unknown>>(),
  executeQuery: vi.fn<Session["executeQuery"]>(),
  streamExecuteScanQuery: vi.fn<Session["streamExecuteScanQuery"]>(),
}));
vi.mock("@/lib/ydb/client", async original => ({
  ...await original<typeof import("@/lib/ydb/client")>(),
  isYdbConfigured: () => true,
  withSession: mocks.withSession,
}));
vi.mock("./mock-data", async original => ({
  ...await original<typeof import("./mock-data")>(),
  isMockPetsDataSource: () => false,
}));

const rows = (count: number, start = 0) => Array.from({ length: count }, (_, index) => ({
  items: [`pet-${start + index}`, "2026-01-01T00:00:00Z", "", ""].map(textValue => ({ textValue })),
}));
const chunk = (count: number, start = 0, truncated = false) =>
  Ydb.Table.ExecuteScanQueryPartialResult.create({ resultSet: { rows: rows(count, start), truncated } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.withSession.mockImplementation(work => work(mocks));
  mocks.executeQuery.mockResolvedValue(Ydb.Table.ExecuteQueryResult.create({
    resultSets: [{ rows: rows(1000), truncated: true }],
  }));
  mocks.streamExecuteScanQuery.mockImplementation(async (_query, consumer) => {
    consumer(chunk(1000));
    consumer(chunk(501, 1000));
  });
});

it("reads all approved entries in one streamed query beyond the Table API cap", async () => {
  const entries = await listApprovedPetSitemapEntries({ requireComplete: true });
  expect(entries).toHaveLength(1501);
  expect(entries.at(-1)?.slug).toBe("pet-1500");
  expect(mocks.executeQuery).not.toHaveBeenCalled();
  expect(mocks.streamExecuteScanQuery).toHaveBeenCalledTimes(1);
  const [sql, , parameters] = mocks.streamExecuteScanQuery.mock.calls[0];
  expect(sql).toMatch(/SELECT slug, created_at, updated_at, approved_at/);
  expect(sql).toMatch(/WHERE status = \$status/);
  expect(parameters).toEqual({ $status: TypedValues.utf8("approved") });
});

it("wires the full result into the real image sitemap route", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect((await response.text()).match(/<image:image>/g)).toHaveLength(1501);
  expect(mocks.executeQuery).not.toHaveBeenCalled();
});

it("keeps the ordinary sitemap reader on its existing query path", async () => {
  expect(await listApprovedPetSitemapEntries()).toHaveLength(1000);
  expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
  expect(mocks.streamExecuteScanQuery).not.toHaveBeenCalled();
});

it("returns 503 instead of a partial sitemap when a stream reports truncation", async () => {
  mocks.streamExecuteScanQuery.mockImplementation(async (_query, consumer) => {
    consumer(chunk(1000, 0, true));
    consumer(chunk(1, 1000));
  });
  expect((await GET()).status).toBe(503);
});

it("rejects a streamed catalog exceeding the sitemap URL limit", async () => {
  mocks.streamExecuteScanQuery.mockImplementation(async (_query, consumer) => {
    consumer(chunk(50_001));
  });
  expect((await GET()).status).toBe(503);
});

it("returns 503 when streaming fails after delivering some rows", async () => {
  mocks.streamExecuteScanQuery.mockImplementation(async (_query, consumer) => {
    consumer(chunk(4));
    throw new Error("private stream details");
  });
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
});

it("does not mix partial rows from a failed session with its retry", async () => {
  mocks.withSession.mockImplementation(async work => {
    try { return await work(mocks); } catch { return work(mocks); }
  });
  mocks.streamExecuteScanQuery.mockImplementationOnce(async (_query, consumer) => {
    consumer(chunk(4, 100));
    throw new Error("retry session");
  }).mockImplementationOnce(async (_query, consumer) => { consumer(chunk(2)); });
  const entries = await listApprovedPetSitemapEntries({ requireComplete: true });
  expect(entries.map(entry => entry.slug)).toEqual(["pet-0", "pet-1"]);
});

it("accepts a genuine empty streamed result", async () => {
  mocks.streamExecuteScanQuery.mockImplementation(async (_query, consumer) => {
    consumer(Ydb.Table.ExecuteScanQueryPartialResult.create({}));
    consumer(chunk(0));
  });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("<url>");
});

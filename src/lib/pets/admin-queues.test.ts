import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  beginTransaction: vi.fn(async () => ({ id: "queue-snapshot" })),
  rollbackTransaction: vi.fn(),
}));
vi.mock("@/lib/ydb/client", async (original) => ({
  ...await original<typeof import("@/lib/ydb/client")>(),
  isYdbConfigured: () => true,
  withSession: (run: (session: typeof db) => unknown) => run(db),
  withSessionOnce: (run: (session: typeof db) => unknown) => run(db),
}));
vi.mock("@/lib/auth/repository", () => ({
  listPublicUserProfilesByIds: async () => new Map(),
}));

import { listPendingPets } from "./repository";
import { listGenerationRequests } from "./generation-requests-repository";

const result = (values: string[][]) => ({
  resultSets: [{ rows: values.map(values => ({ items: values.map(textValue => ({ textValue })) })) }],
});

// The external YDB boundary is faked; query contracts and the real row decoding,
// snapshot control, count/offset handling and page enrichment remain exercised.
function queueDatabase(kind: "submissions" | "requests", size: number) {
  const records = Array.from({ length: size }, (_, index) => {
    const id = String(index).padStart(3, "0");
    return kind === "submissions"
      ? [`pet-${id}`, `id-${id}`, `Pet ${id}`, "description", "/sprite.webp", "/pet.json", "/pet.zip", "webp", "creature", "[]", "pending", "", "", "", "private@example.test", "", "2026-01-01", "2026-01-01", "", "", "", ""]
      : [`req-${id}`, "pending", "creature", `Pet ${id}`, "prompt", "private@example.test", "", "", "", "", "", "2026-01-01", "2026-01-01", "", "", "", "", ""];
  });
  const offsets: number[] = [];
  db.executeQuery.mockImplementation(async (sql, params, control) => {
    if (sql.includes("codex_pet_metrics")) return result([]);
    expect(control).toMatchObject({ txId: "queue-snapshot" });
    if (sql === "SELECT 1;") {
      expect(control.commitTx).toBe(true);
      return result([]);
    }
    if (sql.includes("COUNT(*)")) {
      expect(sql).not.toContain("LIMIT");
      expect(sql).toContain(kind === "submissions" ? "WHERE status = $status" : "WHERE status != $deleted_status");
      return { resultSets: [{ rows: [{ items: [{ uint64Value: String(size) }] }] }] };
    }
    expect(sql).toContain("LIMIT $limit OFFSET $offset");
    expect(Number(params.$limit.value.uint64Value)).toBe(50);
    if (kind === "submissions") {
      expect(sql).toContain("WHERE status = $status");
      expect(params.$status.value.textValue).toBe("pending");
      expect(sql).toContain("ORDER BY created_at ASC, slug ASC");
    } else {
      expect(sql).toContain("WHERE r.status != $deleted_status");
      expect(params.$deleted_status.value.textValue).toBe("deleted");
      expect(sql).toContain("WHEN r.status = $pending_status THEN 0");
      expect(sql).toContain("WHEN r.status = $in_progress_status THEN 0");
      expect(sql).toContain("r.created_at DESC, r.id ASC");
      expect(sql).toContain("LEFT JOIN codex_pet_generation_request_images");
    }
    const offset = Number(params.$offset.value.uint64Value);
    offsets.push(offset);
    return result(records.slice(offset, offset + 50));
  });
  return offsets;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CODEX_PETS_DATA_SOURCE", "ydb");
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
  { kind: "submissions" as const, list: listPendingPets },
  { kind: "requests" as const, list: listGenerationRequests },
])("$kind pagination", ({ kind, list }) => {
  it.each([201, 251])("reaches all %i records with an uncapped total and bounded queries", async size => {
    const offsets = queueDatabase(kind, size);
    const ids: string[] = [];
    const pageCount = size === 201 ? 5 : 6;
    for (let page = 1; page <= pageCount; page++) {
      const result = await list(page);
      expect(result.pagination).toMatchObject({ page, pageSize: 50, totalItems: size, totalPages: pageCount });
      expect(result.items).toHaveLength(page === pageCount ? 1 : 50);
      ids.push(...result.items.map(item => item.id));
    }
    expect(ids).toHaveLength(size);
    expect(new Set(ids).size).toBe(size);
    expect(ids.at(-1)).toBe(`${kind === "submissions" ? "id" : "req"}-${size - 1}`);
    expect(offsets).toEqual(size === 201 ? [0, 50, 100, 150, 200] : [0, 50, 100, 150, 200, 250]);
  });

  it("clamps a stale page after the last record is moderated", async () => {
    const offsets = queueDatabase(kind, 200);
    const result = await list(5);
    expect(result.pagination).toMatchObject({ page: 4, totalItems: 200, totalPages: 4 });
    expect(result.items).toHaveLength(50);
    expect(offsets).toEqual([150]);
  });

  it("returns an empty first page for an empty queue", async () => {
    queueDatabase(kind, 0);
    expect(await list(99)).toMatchObject({ items: [], pagination: { page: 1, totalItems: 0, totalPages: 1 } });
  });
});

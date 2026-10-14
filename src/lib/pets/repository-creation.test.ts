import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatusCode, YdbError } from "@/lib/ydb/client";
import { createPendingPet, type CreatePendingPetInput } from "@/lib/pets/repository";

const mocks = vi.hoisted(() => ({ withSessionOnce: vi.fn(), withSession: vi.fn() }));
vi.mock("@/lib/ydb/client", async original => ({
  ...await original<typeof import("@/lib/ydb/client")>(),
  isYdbConfigured: () => true,
  withSessionOnce: mocks.withSessionOnce,
  withSession: mocks.withSession,
}));
class Conflict extends YdbError { static status = StatusCode.ABORTED; }
type Stored = Record<string, string | boolean>;
const columns = ["slug", "id", "display_name", "description", "spritesheet_url", "pet_json_url", "zip_url", "spritesheet_ext", "kind", "tags_json", "status", "owner_id", "owner_email", "owner_name", "contact_email", "rejection_reason", "created_at", "updated_at", "approved_at", "rejected_at", "public_email_requested", "public_author_email"];
const rows = (values: Stored[], names = columns) => ({ resultSets: [{ rows: values.map(row => ({ items: names.map(name => typeof row[name] === "boolean" ? { boolValue: row[name] } : { textValue: row[name] ?? "" }) })) }] });
const input: CreatePendingPetInput = {
  petJson: { id: "lumi", displayName: "Lumi", description: "A synthetic pet", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" },
  ownerId: "", ownerEmail: null, ownerName: null, contactEmail: null, kind: "creature", tags: [], spritesheetExt: "webp",
  petJsonUrl: "/api/assets/test/pet.json", spritesheetUrl: "/api/assets/test/spritesheet.webp", zipUrl: "/api/assets/test/pet.zip",
};

function database() {
  const catalog = new Map<string, Stored>();
  const inserts: Stored[] = [];
  const queries: Array<{ sql: string; transaction?: string }> = [];
  let version = 0; let transactions = 0; let loseAck = false; let forceAbort = 0;
  function paramsOf(params: Record<string, { value: { textValue?: string; boolValue?: boolean } }>): Stored {
    return Object.fromEntries(Object.entries(params).map(([key, value]) => [key.slice(1), value.value.textValue ?? value.value.boolValue ?? ""]));
  }
  mocks.withSessionOnce.mockImplementation(async callback => {
    const txId = `tx-${++transactions}`; const readVersion = version; const pending: Stored[] = [];
    return callback({
      beginTransaction: async () => ({ id: txId }),
      rollbackTransaction: async () => undefined,
      executeQuery: async (sql: string, params: Record<string, { value: { textValue?: string; boolValue?: boolean } }>, control: { txId: string; commitTx?: boolean }) => {
        expect(control.txId).toBe(txId); queries.push({ sql, transaction: txId });
        if (control.commitTx) {
          if (forceAbort-- > 0 || version !== readVersion) throw new Conflict("conflict");
          for (const row of pending) {
            expect(catalog.has(String(row.slug))).toBe(false);
            catalog.set(String(row.slug), row);
          }
          version++;
          if (loseAck) { loseAck = false; throw new Error("lost commit acknowledgement"); }
          return rows([]);
        }
        if (sql.includes("SELECT slug FROM codex_pets")) {
          const wanted = new Set(Object.values(paramsOf(params)));
          return rows([...catalog.values()].filter(row => wanted.has(row.slug)), ["slug"]);
        }
        expect(sql).toContain("INSERT INTO codex_pets");
        expect(sql).not.toContain("UPSERT INTO codex_pets");
        const row = paramsOf(params); inserts.push(row); pending.push(row); return rows([]);
      },
    });
  });
  mocks.withSession.mockImplementation(async callback => callback({ executeQuery: async (sql: string, params: Record<string, { value: { textValue?: string; boolValue?: boolean } }>) => {
    queries.push({ sql });
    expect(sql).toContain("WHERE id = $id");
    const id = paramsOf(params).id;
    return rows([...catalog.values()].filter(row => row.id === id));
  } }));
  return { catalog, inserts, queries, loseAck: () => { loseAck = true; }, forceAbort: () => { forceAbort = 1; } };
}

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("classic ZIP creation reserves a unique catalog slug atomically", () => {
  it("reserves every moderation status and never overwrites old rows", async () => {
    const db = database();
    ["pending", "approved", "rejected", "deleted"].forEach((status, index) => { const slug = index ? `lumi-${index + 1}` : "lumi"; db.catalog.set(slug, { slug, id: `old-${index}`, status }); });
    const before = structuredClone(db.catalog);
    expect((await createPendingPet(input)).slug).toBe("lumi-5");
    for (const [slug, row] of before) expect(db.catalog.get(slug)).toEqual(row);
    expect(db.queries.filter(query => query.sql.includes("SELECT slug FROM")).every(query => query.transaction && !query.sql.includes("status"))).toBe(true);
  });
  it("serializes two creations of one slug and chooses a suffix after conflict", async () => {
    const db = database();
    const created = await Promise.all([createPendingPet(input), createPendingPet(input)]);
    expect(created.map(pet => pet.slug).sort()).toEqual(["lumi", "lumi-2"]);
    expect(db.catalog.size).toBe(2);
    expect(new Set(created.map(pet => pet.id)).size).toBe(2);
  });
  it("keeps one chosen identity while replaying a known ABORTED transaction", async () => {
    const db = database(); db.forceAbort();
    const pet = await createPendingPet(input);
    expect(db.inserts).toHaveLength(2);
    expect(new Set(db.inserts.map(row => row.id))).toEqual(new Set([pet.id]));
    expect(db.catalog.size).toBe(1);
  });
  it("reads back this call's exact identity after a lost commit acknowledgement", async () => {
    const db = database(); db.loseAck();
    const pet = await createPendingPet(input);
    expect(db.catalog.size).toBe(1); expect(db.inserts).toHaveLength(1);
    expect(pet.id).toBe(db.inserts[0].id);
    expect(db.queries.filter(query => !query.transaction)).toHaveLength(1);
  });
  it("keeps classic 48-character URLs and reserves suffix space on collision", async () => {
    const db = database(); const long = "a".repeat(48);
    db.catalog.set(long, { slug: long, id: "old", status: "deleted" });
    const pet = await createPendingPet({ ...input, petJson: { ...input.petJson, id: long } });
    expect(pet.slug).toBe(`${"a".repeat(46)}-2`);
  });
});

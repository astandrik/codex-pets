import { beforeEach, describe, expect, it, vi } from "vitest";
import { YdbError, StatusCode } from "@/lib/ydb/client";

const session = vi.hoisted(() => ({ beginTransaction: vi.fn(), executeQuery: vi.fn(), rollbackTransaction: vi.fn(), commitTransaction: vi.fn() }));
vi.mock("@/lib/ydb/client", async (original) => ({
  ...await original<typeof import("@/lib/ydb/client")>(),
  withSession: (fn: (value: typeof session) => Promise<unknown>) => fn(session),
  withSessionOnce: (fn: (value: typeof session) => Promise<unknown>) => fn(session),
}));
class Conflict extends YdbError { static status = StatusCode.ABORTED; }

beforeEach(() => {
  vi.clearAllMocks();
  session.beginTransaction.mockImplementation(async () => ({ id: "tx-" + session.beginTransaction.mock.calls.length }));
  session.executeQuery.mockReset().mockResolvedValue({ resultSets: [] });
  session.rollbackTransaction.mockResolvedValue(undefined);
  session.commitTransaction.mockRejectedValue(new Error("Transaction not found"));
});

describe("generation serializable transaction contention", () => {
  it("writes permanent assets, a pending pet and its receipt in the same transaction", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    const identity = { id: "pet_demo", slug: "demo", createdAt: "2026-10-11T09:00:00.000Z" };
    await generationStore.transaction(async tx => {
      await tx.saveSubmission({ identity, assets: { assetId: "asset_demo", petJsonBuffer: Buffer.from("json"), spritesheetBuffer: Buffer.from("sprite"), zipBuffer: Buffer.from("zip"), spritesheetExt: "webp" }, pet: {
        petJson: { id: "demo", displayName: "Demo", description: "Synthetic pet", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" },
        ownerId: "", ownerEmail: null, ownerName: null, contactEmail: null, publicEmailRequested: false, kind: "creature", tags: [],
        petJsonUrl: "/api/assets/asset_demo/pet.json", spritesheetUrl: "/api/assets/asset_demo/spritesheet.webp", zipUrl: "/api/assets/asset_demo/pet.zip", spritesheetExt: "webp",
      } });
      await tx.putJob({ id: "a".repeat(64), displayName: "Demo", prompt: "", status: "completed", worker: "", createdAt: 0, expiresAt: Date.UTC(2026, 9, 12), promptRevision: "test", pipelineVersion: 2, stages: [], submission: { petId: identity.id, slug: identity.slug, submittedAt: identity.createdAt } });
    });
    const [assetWrite, petWrite, jobWrite, commit] = session.executeQuery.mock.calls;
    expect(assetWrite[0]).toContain("INSERT INTO codex_pet_assets");
    expect(assetWrite[0]).not.toContain("expires_at");
    expect(assetWrite[1].$zip_bytes.value.bytesValue).toEqual(Buffer.from("zip"));
    expect(petWrite[0]).toContain("INSERT INTO codex_pets");
    expect(petWrite[1]).toMatchObject({ $status: { value: { textValue: "pending" } }, $public_email_requested: { value: { boolValue: false } }, $public_author_email: { value: { textValue: "" } }, $approved_at: { value: { textValue: "" } } });
    expect(jobWrite[0]).toContain("codex_pet_generation_jobs");
    for (const query of [assetWrite, petWrite, jobWrite]) expect(query[2]).toEqual({ txId: "tx-1" });
    expect(commit).toEqual(["SELECT 1;", {}, { txId: "tx-1", commitTx: true }]);
  });
  it("reads catalog reservations for all statuses inside the same transaction", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    session.executeQuery.mockResolvedValueOnce({ resultSets: [{ rows: [{ items: [{ textValue: "lumi" }] }] }] });
    await expect(generationStore.transaction(tx => tx.listTakenSlugs(["lumi", "lumi-2"]))).resolves.toEqual(["lumi"]);
    const [read] = session.executeQuery.mock.calls;
    expect(read[0]).toContain("SELECT slug FROM codex_pets WHERE");
    expect(read[0]).not.toContain("status");
    expect(read[2]).toEqual({ txId: "tx-1" });
  });

  it("repeats the complete operation after ABORTED and commits the new transaction", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    session.executeQuery.mockRejectedValueOnce(new Conflict("locks invalidated"));
    const operation = vi.fn().mockResolvedValue("accepted");
    await expect(generationStore.transaction(operation)).resolves.toBe("accepted");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(session.beginTransaction).toHaveBeenCalledTimes(2);
    expect(session.executeQuery).toHaveBeenLastCalledWith("SELECT 1;", {}, { txId: "tx-2", commitTx: true });
    expect(session.commitTransaction).not.toHaveBeenCalled();
  });
  it("does not retry an unknown outcome or a non-contention failure", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    const operation = vi.fn().mockResolvedValue("accepted");
    session.executeQuery.mockRejectedValueOnce(new Error("network outcome unknown"));
    await expect(generationStore.transaction(operation)).rejects.toThrow("network outcome unknown");
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("bounds sustained contention to five attempts", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    session.executeQuery.mockRejectedValue(new Conflict("locks invalidated"));
    const operation = vi.fn().mockResolvedValue("accepted");
    await expect(generationStore.transaction(operation)).rejects.toBeInstanceOf(Conflict);
    expect(operation).toHaveBeenCalledTimes(5);
  });
});

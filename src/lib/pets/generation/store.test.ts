import { beforeEach, describe, expect, it, vi } from "vitest";
import { YdbError, StatusCode, TypedValues } from "@/lib/ydb/client";
import {randomUUID} from "node:crypto";
import {CONTINUATION_STATES} from "./continuation-model";
import type {AnimationAttempt} from "./model";

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

describe("production generation store read contracts", () => {
  const now = Date.UTC(2026, 9, 14, 12);
  const id = "b".repeat(64);
  const currentJob = {
    id, prompt: "synthetic private prompt", displayName: "Synthetic", status: "queued" as const,
    createdAt: now, expiresAt: now + 60_000, worker: "", promptRevision: "test",
    pipelineVersion: 2, stages: [],
  };
  const textResult = (text: string) => ({ resultSets: [{ rows: [{ items: [{ textValue: text }] }] }] });

  it("round-trips current jobs through the real serialized SDK boundary", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    await generationStore.transaction((tx) => tx.putJob(currentJob));
    const [, params] = session.executeQuery.mock.calls[0];
    const serialized = params.$payload.value.textValue;
    expect(JSON.parse(serialized)).toEqual(currentJob);
    expect(params.$expires).toEqual(TypedValues.timestamp(new Date(currentJob.expiresAt)));
    session.executeQuery.mockResolvedValueOnce(textResult(serialized));
    await expect(generationStore.readJob(id)).resolves.toEqual(currentJob);
  });

  it("round-trips all 561 bounded policy-2 attempts through the store codec", async () => {
    const {generationStore} = await import("./store");
    const attempts = CONTINUATION_STATES.flatMap(state => Array.from({length: 51}, (_, index): AnimationAttempt => ({
      state, ordinal: index + 1, token: randomUUID(), reason: index ? "moderation" : "initial",
      status: "failed", reservedAt: now, notBefore: now, startedAt: now, finishedAt: now,
      failure: {code: "provider_rejected", providerFailure: {httpStatus: 400, code: "moderation_blocked", moderationStage: "output"}},
    })));
    const job = {...currentJob, animationRepair: {policy: 2 as const, maxAttempts: 51, phase: "stopped" as const,
      pending: [], issues: [], attempts}};
    await generationStore.transaction(tx => tx.putJob(job));
    const serialized = session.executeQuery.mock.calls[0][1].$payload.value.textValue;
    session.executeQuery.mockResolvedValueOnce(textResult(serialized));
    const read = await generationStore.readJob(id);
    expect(read).toEqual(job);expect(read!.animationRepair!.attempts).toHaveLength(561);
  });

  it("normalizes legacy rows without pipeline, worker or stage fields", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    const legacy: Partial<typeof currentJob> = { ...currentJob };
    delete legacy.pipelineVersion;
    delete legacy.stages;
    delete legacy.worker;
    session.executeQuery.mockResolvedValueOnce(textResult(JSON.stringify(legacy)));
    await expect(generationStore.readJob(id)).resolves.toEqual({
      ...legacy, pipelineVersion: 1, stages: [], worker: "",
    });
  });

  it("distinguishes missing jobs from malformed persisted data", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    await expect(generationStore.readJob(id)).resolves.toBeNull();
    session.executeQuery.mockResolvedValueOnce(textResult("not-json"));
    await expect(generationStore.readJob(id)).rejects.toBeInstanceOf(SyntaxError);
    session.executeQuery.mockResolvedValueOnce(textResult(JSON.stringify({ id })));
    await expect(generationStore.readJob(id)).rejects.toThrow();
  });

  it("decodes binary artifacts and sends an exclusive expiry cutoff", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    session.executeQuery.mockResolvedValueOnce({ resultSets: [{ rows: [{ items: [{ bytesValue: Uint8Array.from([0, 255, 17]) }] }] }] });
    await expect(generationStore.readArtifact(id, "pet.zip", now)).resolves.toEqual(Buffer.from([0, 255, 17]));
    const [sql, params] = session.executeQuery.mock.calls[0];
    expect(sql).toMatch(/expires_at\s*>\s*\$now/);
    expect(params.$now).toEqual(TypedValues.timestamp(new Date(now)));
    expect(params.$id).toEqual(TypedValues.utf8(id));
    expect(params.$kind).toEqual(TypedValues.utf8("pet.zip"));
    await expect(generationStore.readArtifact(id, "pet.zip", now)).resolves.toBeNull();
  });

  it("reads ledger payloads in the transaction with the same expiry boundary", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    session.executeQuery.mockResolvedValueOnce(textResult('{"revision":2}'));
    await expect(generationStore.transaction((tx) => tx.getLedger("scheduler", now))).resolves.toBe('{"revision":2}');
    const [sql, params, control] = session.executeQuery.mock.calls[0];
    expect(sql).toContain("codex_pet_generation_quotas");
    expect(sql).toMatch(/expires_at\s*>\s*\$now/);
    expect(params.$now).toEqual(TypedValues.timestamp(new Date(now)));
    expect(control).toEqual({ txId: "tx-1" });
    await expect(generationStore.transaction((tx) => tx.getLedger("absent", now))).resolves.toBeNull();
  });

  it("cleans exactly the three generation tables at an inclusive expiry cutoff", async () => {
    const { generationStore, GENERATION_TABLES } = await import("@/lib/pets/generation/store");
    await generationStore.cleanup(now);
    const calls = session.executeQuery.mock.calls;
    expect(calls).toHaveLength(3);
    for (const [index, table] of Object.values(GENERATION_TABLES).entries()) {
      expect(calls[index][0]).toContain(`DELETE FROM ${table} WHERE expires_at <= $now`);
      expect(calls[index][1].$now).toEqual(TypedValues.timestamp(new Date(now)));
    }
  });

  it("enforces service expiry even while a serialized row still exists in YDB", async () => {
    const { generationStore } = await import("@/lib/pets/generation/store");
    const { createGenerationService } = await import("@/lib/pets/generation/service");
    session.executeQuery.mockResolvedValue(textResult(JSON.stringify(currentJob)));
    let clock = now;
    const secret = vi.fn(() => "synthetic-secret");
    const service = createGenerationService(generationStore, {
      enabled: () => false, secret, now: () => clock,
    });
    const result = await service.get(id);
    expect(result).toMatchObject({ generationId: id, status: "queued", expiresAt: new Date(currentJob.expiresAt).toISOString() });
    expect(JSON.stringify(result)).not.toContain(currentJob.prompt);
    clock = currentJob.expiresAt;
    await expect(service.get(id)).rejects.toMatchObject({ code: "generation_expired" });
    expect(secret).not.toHaveBeenCalled();
  });
});

it("publishes snapshot TTLs without reading or rewriting binary payloads",async()=>{
  const {generationStore}=await import("@/lib/pets/generation/store");const id="c".repeat(64),now=Date.UTC(2026,9,22),expiresAt=now+86400000;
  session.executeQuery.mockResolvedValueOnce({resultSets:[{rows:[{items:[{textValue:"stage-base.png"}]}]}]});
  await generationStore.transaction(async tx=>{expect(await tx.hasArtifact(id,"stage-base.png",now)).toBe(true);await tx.setArtifactExpiry(id,["stage-base.png","stage-idle.png"],expiresAt);});
  const calls=session.executeQuery.mock.calls.slice(0,-1);expect(calls).toHaveLength(3);
  expect(calls[0][0]).toContain("SELECT kind");expect(calls[0][0]).toContain("expires_at>$now");
  for(const [query,parameters,control]of calls){expect(query).not.toMatch(/\bbytes\b/);expect(parameters).not.toHaveProperty("$bytes");expect(control).toEqual({txId:"tx-1"});}
  for(const [,parameters]of calls.slice(1))expect(parameters.$expires).toEqual(TypedValues.timestamp(new Date(expiresAt)));
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCardMetadataRequest } from "./card-provider";
import { cardMetadataRecordSchema } from "./card-metadata";
import { attachResultJournal } from "./checkpoint-journal";
import { FileResultJournal } from "./result-journal";
import { journalRecordDirectory } from "./result-journal.test-utils";
import { checkpointJobHash, recoverResult } from "./result-checkpoint-recovery";
import { taskFixture } from "./task-pool.test-utils";
import { createSpriteGenerationWorker } from "./sprite-worker";
import { createGenerationService } from "./service";
import { MemoryStore } from "./test-store";
import { LEASE_MS } from "./model";

const frames = Array(4).fill("data:image/png;base64,YQ==");
// Captured from the pre-PR provider at 490f487, not derived from current instructions.
const legacyRequestHash = "b36f5881c159e7fafa8a5f3bfa175eab90d16446cc9741c61994d233dc8cd741";
const clarityRequestHash = "208ff6eaa328cc47b88db3c94e42bac7697ea0b5a678f9204a949052899eda9e";
const compactRequestHash = "8c51cc49a64d85cedd11cde379541f3853b55d1af7c8c9bd501481cf899b28e1";
const response = { fields: { displayName: "Blue-Caped Imp", description: "A red imp wearing a blue cape.", tags: ["red", "imp", "cape"] },
  responseHash: "b".repeat(64), inputTokens: 10, outputTokens: 10, costUsd: .002 };
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture(policy: 1 | 2 | 3 = 1, capacityBytes?: number) {
  const f = await taskFixture(20), target = f.store.jobs.get(f.jobs[0].id)!;
  target.cardMetadata = { policy, state: "pending", revision: 0, edited: false };
  const historical = ["c", "d", "e"].map((letter, index) => ({ jobId: letter.repeat(64), owner: "historical", leaseId: `historical-${index}`,
    key: `old-call-${index}`, startedAt: f.clock.now - 1000, dispatched: true, unknown: true }));
  const scheduler = f.store.ledger.get("scheduler")!;
  scheduler.value = JSON.stringify({ ...JSON.parse(scheduler.value), queue: [target.id], providerSlots: historical });
  const budget = f.store.ledger.get("budget")!, savedBudget = JSON.parse(budget.value);
  savedBudget.spent["2026-11-01"] = 7_000_000;
  for (const slot of historical) savedBudget.reservations[slot.jobId] = { remainingMicroUsd: 0, unknown: true };
  budget.value = JSON.stringify(savedBudget);
  const receipt = [...f.store.ledger].find(([, record]) => JSON.parse(record.value).id === target.id)!;
  const counts = { images: 0, metadata: 0, packages: 0 };
  const requests: string[] = [];
  const run = createSpriteGenerationWorker({ service: f.service, store: f.store, now: () => f.clock.now,
    cardProvider: { prepare: async job => buildCardMetadataRequest(job, frames), generate: async request => {
      counts.metadata++; requests.push(request.requestHash); return response;
    } },
    renderer: { open: async () => ({ prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("saved atlas"),
      generate: async name => { counts.images++; return { bytes: Buffer.from(name), generationMs: 1,
        usage: { textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: .01 } }; } }) },
    build: async () => { counts.packages++; return { "pet.zip": Buffer.from("saved package") }; } });
  for (let n = 0; n < 20 && f.store.jobs.get(target.id)?.status !== "processing"; n++) { await run("images"); f.clock.now += 250; }
  expect(counts.images).toBe(12);
  const completed = structuredClone(f.store.jobs.get(target.id)!);
  const directory = await mkdtemp(path.join(tmpdir(), "card-metadata-resume-")); directories.push(directory);
  const journal = await FileResultJournal.open(directory, { capacityBytes });
  // Keep the database-only transition to reproduce legacy workers without the journal cleanup hook.
  const legacyDefer = f.service.deferUnsentCardMetadata;
  attachResultJournal(f.service, f.store, { journal, now: () => f.clock.now,
    retry: { attempts: 2, wait: async () => {}, random: () => 0 } });
  const claim = async (hash?: string) => {
    const job = (await f.service.claim("old-worker"))!;
    return f.service.beginCardMetadata(job, hash ?? buildCardMetadataRequest(job, frames).requestHash);
  };
  const finish = async () => {
    for (let n = 0; n < 5 && !["completed", "failed"].includes(f.store.jobs.get(target.id)!.status); n++) { await run("replacement"); f.clock.now += 250; }
    const saved = f.store.jobs.get(target.id)!;
    expect(saved).toMatchObject({ id: completed.id, expiresAt: completed.expiresAt, createdAt: completed.createdAt, status: "completed" });
    expect(saved.stages).toEqual(completed.stages);
    expect(await f.store.readArtifact(target.id, "source.png", f.clock.now)).toEqual(Buffer.from("saved atlas"));
    expect(counts).toEqual({ images: 12, metadata: 1, packages: 1 });
    expect(f.store.ledger.get(receipt[0])).toEqual(receipt[1]);
    const currentBudget = JSON.parse(f.store.ledger.get("budget")!.value);
    expect(currentBudget.spent["2026-11-01"]).toBe(7_122_000);
    for (const slot of historical) expect(currentBudget.reservations[slot.jobId]).toEqual({ remainingMicroUsd: 0, unknown: true });
    const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
    expect(state.providerSlots).toEqual(historical); expect(state.pauseReason).toBeUndefined();
    expect(await journal.list()).toEqual([]);
  };
  return { ...f, target, completed, journal, directory, legacyDefer, claim, finish, run, counts, requests, historical };
}

describe("metadata policy and unsent journal recovery", () => {
  it("pins both older requests and admits new tasks with the compact naming policy", async () => {
    const input = { prompt: "Synthetic pet", requestId: randomUUID() }, store = new MemoryStore();
    const service = createGenerationService(store, { enabled: () => true, secret: () => "metadata-policy-test-secret", automaticCardMetadata: () => true });
    const accepted = await service.generate(input, "203.0.113.11"), before = structuredClone(store.ledger);
    const job = store.jobs.get(accepted.generationId)!;
    expect(job.cardMetadata?.policy).toBe(3);
    expect(buildCardMetadataRequest(job, frames).requestHash).toBe(compactRequestHash);
    expect(() => cardMetadataRecordSchema.parse({ ...job.cardMetadata, policy: 4 })).toThrow();

    for (const [policy, hash] of [[3, compactRequestHash], [2, clarityRequestHash], [1, legacyRequestHash]] as const) {
      const stored = store.jobs.get(accepted.generationId)!;
      stored.cardMetadata = cardMetadataRecordSchema.parse({ ...stored.cardMetadata, policy });
      expect((await service.generate(input, "203.0.113.11")).generationId).toBe(accepted.generationId);
      expect(store.jobs.get(accepted.generationId)?.cardMetadata?.policy).toBe(policy);
      expect(buildCardMetadataRequest(store.jobs.get(accepted.generationId)!, frames).requestHash).toBe(hash);
      expect(store.ledger).toEqual(before);
      expect(store.jobs.size).toBe(1);
    }
  });

  it.each([[1, legacyRequestHash], [2, clarityRequestHash]] as const)("resumes policy %s's saved intent without repeating paid images", async (policy, hash) => {
    const f = await fixture(policy), job = await f.claim(hash);
    await f.service.completeTask(job, { eligibleAt: f.clock.now });
    expect(f.store.jobs.get(job.id)?.cardMetadata?.state).toBe("inflight");
    await f.finish(); expect(f.requests).toEqual([hash]);
  });

  it("reclaims a legacy pending reservation after restart with a one-slot journal", async () => {
    const f = await fixture(1, FileResultJournal.reservationBytes), job = await f.claim(legacyRequestHash);
    await f.service.authorizeCardMetadata(job);
    await f.legacyDefer(job); // The old implementation committed pending without touching the journal.
    await f.service.completeTask(job, { eligibleAt: f.clock.now });
    expect(await f.journal.list()).toHaveLength(1);
    await f.finish(); expect(f.requests).toEqual([legacyRequestHash]);
  });

  it.each([1, 2, 3] as const)("releases a policy %s reservation immediately after confirmed defer and repeats safely", async policy => {
    const f = await fixture(policy, FileResultJournal.reservationBytes), job = await f.claim();
    await f.service.authorizeCardMetadata(job);
    await f.service.deferUnsentCardMetadata(job);
    expect(await f.journal.list()).toEqual([]);
    await f.service.deferUnsentCardMetadata(job);
    expect(await f.journal.list()).toEqual([]);
    await f.service.completeTask(job, { eligibleAt: f.clock.now });
    await f.finish();
  });

  it.each(["aborted", "lost-ack"])("recovers a %s defer write without losing its reservation or issuing a call", async failure => {
    const f = await fixture(2), job = await f.claim(); await f.service.authorizeCardMetadata(job);
    const transact = f.store.transaction.bind(f.store); let injected = false;
    vi.spyOn(f.store, "transaction").mockImplementation(operation => transact(async tx => {
      let deferred = false;
      const result = await operation({ ...tx, putJob: async current => {
        if (!injected && current.cardMetadata?.state === "pending") { injected = true; deferred = true; if (failure === "aborted") throw Error("ABORTED"); }
        return tx.putJob(current);
      } });
      return { result, deferred };
    }).then(({ result, deferred }) => { if (deferred && failure === "lost-ack") throw Error("lost commit ACK"); return result; }));
    await f.service.deferUnsentCardMetadata(job);
    expect(injected).toBe(true); expect(f.counts.metadata).toBe(0); expect(await f.journal.list()).toEqual([]);
    vi.restoreAllMocks(); await f.service.completeTask(job, { eligibleAt: f.clock.now }); await f.finish();
  });

  it("retains an interrupted cleanup for safe reclaim on the next lease", async () => {
    const f = await fixture(2, FileResultJournal.reservationBytes), job = await f.claim(); await f.service.authorizeCardMetadata(job);
    const release = vi.spyOn(f.journal, "releaseUnsent").mockRejectedValueOnce(Error("local IO"));
    await f.service.deferUnsentCardMetadata(job);
    expect(f.counts.metadata).toBe(0); expect(release).toHaveBeenCalledTimes(1);
    expect(await f.journal.list()).toHaveLength(1);
    release.mockRestore(); await f.service.completeTask(job, { eligibleAt: f.clock.now }); await f.finish();
  });

  it("repeats defer after losing the cleanup acknowledgement without allocating another call", async () => {
    const f = await fixture(2), job = await f.claim(); await f.service.authorizeCardMetadata(job);
    const release = f.journal.releaseUnsent.bind(f.journal);
    vi.spyOn(f.journal, "releaseUnsent").mockImplementationOnce(async (...args) => { await release(...args); throw Error("cleanup ACK lost"); });
    await f.service.deferUnsentCardMetadata(job);
    await f.service.deferUnsentCardMetadata(job);
    expect(await f.journal.list()).toEqual([]);
    await f.service.completeTask(job, { eligibleAt: f.clock.now }); await f.finish();
  });

  it("does not release a retained result or let a different or expired lease defer it", async () => {
    const f = await fixture(2), job = await f.claim(); await f.service.authorizeCardMetadata(job);
    const key = (await f.journal.list())[0];
    await f.journal.publish(key, { kind: "metadata", result: response });
    await expect(f.service.deferUnsentCardMetadata(job)).rejects.toThrow();
    expect(await f.journal.read(key, f.clock.now)).not.toBeNull();
    await expect(f.service.deferUnsentCardMetadata({ ...job, worker: "other" })).rejects.toThrow();
    f.clock.now += LEASE_MS + 1;
    await expect(f.service.deferUnsentCardMetadata(job)).rejects.toMatchObject({ code: "stale_worker" });
    expect(await f.journal.list()).toEqual([key]);
  });

  it("preserves the old unknown permit and journal reservation without another call", async () => {
    const f = await fixture(), job = await f.claim(legacyRequestHash); await f.service.authorizeCardMetadata(job);
    const key = (await f.journal.list())[0], row = f.store.ledger.get("scheduler")!, state = JSON.parse(row.value);
    state.providerSlots.find((slot: { leaseId: string }) => slot.leaseId === job.workerLeaseId).unknown = true;
    row.value = JSON.stringify(state);
    await expect(f.service.deferUnsentCardMetadata(job)).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(await f.journal.list()).toEqual([key]); expect(f.counts.metadata).toBe(0);
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toEqual(state.providerSlots);
    expect(f.store.jobs.get(job.id)?.cardMetadata?.state).toBe("inflight");
    f.clock.now += LEASE_MS + 1;
    for (let n = 0; n < 3 && f.store.jobs.get(job.id)?.status !== "completed"; n++) await f.run("unknown-recovery");
    expect(f.store.jobs.get(job.id)).toMatchObject({ status: "completed", cardMetadata: { state: "failed", error: "outcome_unknown" } });
    expect(f.counts).toEqual({ images: 12, metadata: 0, packages: 1 });
    const current = JSON.parse(f.store.ledger.get("scheduler")!.value);
    expect(current.providerSlots).toHaveLength(4); expect(current.pauseReason).toBe("outcome_unknown");
    expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(7_120_000);
    expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[job.id].unknown).toBe(true);
    expect(await f.journal.list()).toEqual([key]);
  });

  it.each([1, 2, 3] as const)("recovers a saved policy %s journal response once without replaying the provider", async policy => {
    const f = await fixture(policy), current = f.store.jobs.get(f.target.id)!;
    current.nameSource = "user"; current.displayName = "Мятня";
    const job = await f.claim(); await f.service.authorizeCardMetadata(job);
    const key = (await f.journal.list())[0]; await f.journal.publish(key, { kind: "metadata", result: response });
    f.clock.now += LEASE_MS + 1; vi.stubEnv("PET_GENERATION_DRAIN", "true");
    expect(await f.service.claim("lease-cleanup")).toBeNull();
    const record = (await f.journal.read(key, f.clock.now))!;
    const options = { expectedRevision: JSON.parse(f.store.ledger.get("scheduler")!.value).revision,
      expectedJobHash: checkpointJobHash(f.store.jobs.get(job.id)), now: () => f.clock.now, apply: true };
    expect(await recoverResult(f.store, record, options)).toMatchObject({ mode: "metadata", applied: true });
    expect(await recoverResult(f.store, record, options)).toMatchObject({ mode: "noop", applied: false });
    await f.journal.confirm(key, record.fingerprint); vi.stubEnv("PET_GENERATION_DRAIN", "false");
    expect(await f.run("package-recovered")).toBe("completed");
    expect(f.store.jobs.get(job.id)).toMatchObject({ id: job.id, expiresAt: job.expiresAt, displayName: "Мятня",
      cardMetadata: { policy, state: "completed", requestHash: job.cardMetadata!.requestHash } });
    expect(f.store.jobs.get(job.id)!.stages).toEqual(f.completed.stages);
    expect(await f.store.readArtifact(job.id, "source.png", f.clock.now)).toEqual(Buffer.from("saved atlas"));
    expect(f.counts).toEqual({ images: 12, metadata: 0, packages: 1 });
    const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
    expect(state.providerSlots).toEqual(f.historical); expect(state.pauseReason).toBe("outcome_unknown");
    expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(7_122_000);
    expect(await f.journal.list()).toEqual([]);
  });

  it("does not clear a corrupt reservation or change its database intent", async () => {
    const f = await fixture(2), job = await f.claim(); await f.service.authorizeCardMetadata(job);
    const key = (await f.journal.list())[0], directory = await journalRecordDirectory(f.directory, key);
    const filename = path.join(directory, "intent.json"), intent = JSON.parse(await readFile(filename, "utf8"));
    intent.checksum = "0".repeat(64); await writeFile(filename, JSON.stringify(intent));
    const before = f.store.ledger.get("scheduler")!.value;
    await expect(f.service.deferUnsentCardMetadata(job)).rejects.toMatchObject({ code: "journal_corrupt" });
    expect(f.store.ledger.get("scheduler")!.value).toBe(before);
    expect(f.store.jobs.get(job.id)?.cardMetadata?.state).toBe("inflight"); expect(f.counts.metadata).toBe(0);
  });

  it("never removes a replacement reservation when cleanup races the next lease", async () => {
    const f = await fixture(2), job = await f.claim(); await f.service.authorizeCardMetadata(job);
    const key = (await f.journal.list())[0], release = f.journal.releaseUnsent.bind(f.journal);
    let replacementLease: string | undefined;
    vi.spyOn(f.journal, "releaseUnsent").mockImplementationOnce(async (oldKey, identity) => {
      f.clock.now += LEASE_MS + 1;
      const next = await f.claim(); replacementLease = next.workerLeaseId;
      await f.service.authorizeCardMetadata(next);
      return release(oldKey, identity);
    });
    await f.service.deferUnsentCardMetadata(job);
    expect((await f.journal.reservationIdentity(key)).leaseId).toBe(replacementLease);
    expect(await f.journal.list()).toEqual([key]); expect(f.counts.metadata).toBe(0);
  });
});

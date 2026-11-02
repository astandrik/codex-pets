import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {expect, it} from "vitest";

const enabled = process.env.PET_GENERATION_YDB_INTEGRATION === "1";
it.skipIf(!enabled)("enforces two claims and the configured call cap across real Node processes and serializable YDB transactions", async () => {
  const endpoint = new URL(process.env.YDB_PETS_ENDPOINT ?? "invalid:");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
      !/^\/local\/codex_parallelism_test_[a-z0-9]+$/.test(process.env.YDB_PETS_DATABASE ?? "")) throw Error("Disposable local database required");
  const callLimit = Number(process.env.PET_GENERATION_PROVIDER_CALLS ?? "11");
  if (!Number.isInteger(callLimit) || callLimit < 1 || callLimit > 22) throw Error("Invalid test call limit");
  const {generationStore} = await import("./store");
  const {createGenerationService} = await import("./service");
  const {changeSchedulerState} = await import("./scheduler-state");
  const {destroyYdbDriver} = await import("@/lib/ydb/client");
  try {
    expect(await generationStore.transaction(tx => tx.getLedger("scheduler", Date.now()))).toBeNull();
    const service = createGenerationService(generationStore, {enabled: () => true,
      secret: () => "isolated-local-scheduler-test-secret", automaticAnimationRepair: () => true});
    for (let i = 0; i < 3; i++) await service.generate({prompt: "Synthetic pet", requestId: randomUUID()}, "203.0.113.12");
    const state = await generationStore.transaction(tx => tx.getLedger("scheduler", Date.now()));
    const previousDrain = process.env.PET_GENERATION_DRAIN;
    process.env.PET_GENERATION_DRAIN = "true";
    try { await changeSchedulerState(generationStore, {action: "activate", expectedRevision: JSON.parse(state!).revision, activeLimit: 2, providerLimit: callLimit, apply: true, now: Date.now()}); }
    finally { if (previousDrain === undefined) delete process.env.PET_GENERATION_DRAIN; else process.env.PET_GENERATION_DRAIN = previousDrain; }
    const results = await Promise.all(["a", "b", "c"].map(async owner => {
      const result = await promisify(execFile)(process.execPath, ["scripts/lib/generation-scheduler-probe.mjs", owner], {
        encoding: "utf8", env: {NODE_ENV: "test", PATH: process.env.PATH, YDB_PETS_ENDPOINT: process.env.YDB_PETS_ENDPOINT, YDB_PETS_DATABASE: process.env.YDB_PETS_DATABASE,
          YDB_ANONYMOUS_CREDENTIALS: "1", PET_GENERATION_ACTIVE_JOBS: "2", PET_GENERATION_PROVIDER_CALLS: String(callLimit)}, timeout: 45000});
      return JSON.parse(result.stdout.split("\n").find(line => line.startsWith("PROBE:"))!.slice(6));
    }));
    expect(results.filter(r => r.claimed)).toHaveLength(2);
    const current = JSON.parse((await generationStore.transaction(tx => tx.getLedger("scheduler", Date.now())))!);
    expect(current.active).toHaveLength(2);
    expect(current.providerSlots).toHaveLength(callLimit);
    expect(current.providerLimit).toBe(callLimit);
    expect(new Set(current.providerSlots.map((s: {jobId: string; key: string}) => s.jobId + s.key)).size).toBe(callLimit);
    const marker = "test-rollback-" + randomUUID();
    await expect(generationStore.transaction(async tx => {await tx.putLedger(marker, "test", Date.now() + 60000); throw Error("rollback");})).rejects.toThrow("rollback");
    expect(await generationStore.transaction(tx => tx.getLedger(marker, Date.now()))).toBeNull();
  } finally { await destroyYdbDriver(); }
}, 60000);

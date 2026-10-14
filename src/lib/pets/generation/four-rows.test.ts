import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGenerationService } from "./service";
import { createSpriteGenerationWorker } from "./sprite-worker";
import { LEASE_MS, type StageName } from "./model";
import { MemoryStore } from "./test-store";

const usage = { textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: 0.04 };
const rows: StageName[] = ["idle", "running", "running-left", "running-right"];
async function fixture(limit = 50) {
  const store = new MemoryStore(), clock = { now: Date.parse("2026-10-12T08:00:00Z") };
  const service = createGenerationService(store, { secret: () => "four-row-test-secret-at-least-32-characters", enabled: () => true, now: () => clock.now, budgetUsd: () => limit });
  const accepted = await service.generate({ prompt: "Synthetic four-row fixture", requestId: randomUUID() }, "203.0.113.73");
  const generate = vi.fn(async (name: StageName) => ({ bytes: Buffer.from(name), usage, generationMs: 1 }));
  const worker = createSpriteGenerationWorker({ service, store, now: () => clock.now, renderer: { open: async () => ({ prepare: async () => undefined, generate, compose: async () => Buffer.from("atlas"), cleanup: async () => undefined }) }, build: async () => ({ "pet.zip": Buffer.from("zip") }) });
  return { store, clock, service, accepted, generate, worker };
}
const budget = (store: MemoryStore) => JSON.parse(store.ledger.get("budget")!.value);

describe("four-row admission and durable fallback", () => {
  it.each([{ limit: 50, attempts:[11] }, { limit: 6, attempts:[11] }, { limit: 3, attempts:[11] }])("funds one batch with limit $limit using $attempts", async ({ limit, attempts }) => {
    const f = await fixture(limit), begin = f.service.beginStages, sizes: number[] = [];
    vi.spyOn(f.service, "beginStages").mockImplementation((job, names) => { sizes.push(names.length); return begin(job, names); });
    expect(await f.worker("owner")).toBe("completed");
    expect(sizes.slice(0, attempts.length)).toEqual(attempts);
    expect(f.generate.mock.calls.map(call => call[0])).toHaveLength(12);
    expect(new Set(f.generate.mock.calls.map(call => call[0])).size).toBe(12);
    expect(budget(f.store).spent["2026-10-12"]).toBe(480000);
    expect(budget(f.store).reservations).toEqual({});
  });
  it("accepts four durable intents without requiring a monetary envelope", async () => {
    const f = await fixture(.1), job = (await f.service.claim("owner"))!;
    await f.service.beginStage(job, "base");
    await f.service.saveStage(job, "base", Buffer.from("base"), { usage, generationMs: 1 });
    await f.service.beginStages(job, rows);
    expect((await f.store.readJob(job.id))?.stages).toHaveLength(5);
    expect(budget(f.store).reservations[job.id]).toEqual({remainingMicroUsd:0,unknown:false});
  });
  it("keeps three unknown outcomes without holding funds after one result and across midnight", async () => {
    const f = await fixture(), job = (await f.service.claim("old"))!;
    await f.service.beginStage(job, "base");
    await f.service.saveStage(job, "base", Buffer.from("base"), { usage, generationMs: 1 });
    await f.service.beginStages(job, rows);
    expect(budget(f.store).reservations[job.id]).toEqual({unknown:false,remainingMicroUsd:0});
    await f.service.saveStage(job, "running-right", Buffer.from("running-right"), { usage, generationMs: 1 });
    f.clock.now += LEASE_MS + 1;
    expect(await f.service.claim("replacement")).toBeNull();
    expect(await f.service.get(job.id)).toMatchObject({ status: "failed", error: { code: "outcome_unknown" } });
    f.clock.now += 86400000;
    await f.store.cleanup(f.clock.now);
    expect(budget(f.store).reservations[job.id]).toEqual({ unknown: true, remainingMicroUsd:0 });
  });
  it("resumes four saved rows without repeating them", async () => {
    const f = await fixture(), job = (await f.service.claim("old"))!;
    await f.service.beginStage(job, "base");
    await f.service.saveStage(job, "base", Buffer.from("base"), { usage, generationMs: 1 });
    await f.service.beginStages(job, rows);
    await Promise.all([...rows].reverse().map(name => f.service.saveStage(job, name, Buffer.from(name), { usage, generationMs: 1 })));
    f.clock.now += LEASE_MS + 1;
    expect(await f.worker("replacement")).toBe("completed");
    expect(f.generate.mock.calls.map(call => call[0])).toEqual(["waving", "jumping", "waiting", "failed", "review", "look-0-157", "look-180-337"]);
  });
  it("never falls back after an unknown intent response without a persisted result", async () => {
    const f = await fixture(), begin = vi.spyOn(f.service, "beginStages").mockRejectedValueOnce(Error("synthetic lost response before commit"));
    expect(await f.worker("owner")).toBe("failed");
    expect(begin).toHaveBeenCalledTimes(1);
    expect(f.generate.mock.calls.map(call => call[0])).toEqual(["base"]);
    expect(await f.service.get(f.accepted.generationId)).toMatchObject({ error: { code: "outcome_unknown" } });
  });
});

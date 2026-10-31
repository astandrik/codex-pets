import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGenerationService } from "./service";
import { DAY, LEASE_MS, WAIT_MS } from "./model";
import { MemoryStore } from "./test-store";

function fixture(budgetUsd = 50) {
  const store = new MemoryStore();
  const config = { now: Date.parse("2026-10-10T10:00:00Z"), enabled: true };
  const service = createGenerationService(store, { now: () => config.now, enabled: () => config.enabled, secret: () => "test-secret-at-least-32-characters-long", budgetUsd: () => budgetUsd });
  const input = () => ({ requestId: randomUUID(), prompt: "A private moss dragon" });
  return { store, config, service, input };
}
const usage = { textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: 0.04 };

describe("durable row generation", () => {
  it("saves a row atomically and resumes without starting that paid stage again", async () => {
    const f = fixture(); const accepted = await f.service.generate(f.input(), "203.0.113.1");
    const job = (await f.service.claim("first"))!;
    await f.service.beginStage(job, "base");
    await f.service.saveStage(job, "base", Buffer.from("base image"), { usage, generationMs: 15 });
    f.config.now += LEASE_MS + 1;
    const resumed = (await f.service.claim("second"))!;
    expect(resumed.id).toBe(job.id);
    expect(resumed.stages[0]).toMatchObject({ name: "base", status: "completed" });
    await expect(f.service.beginStage(resumed, "base")).rejects.toMatchObject({ code: "stage_already_completed" });
    await f.service.beginStage(resumed, "idle");
    expect((await f.service.get(accepted.generationId)).progress).toMatchObject({ completedSteps: 1, totalSteps: 12 });
    expect(JSON.stringify(await f.service.get(accepted.generationId))).not.toContain("private moss");
  });
  it("fences stale workers and rejects stages out of sequence", async () => {
    const f = fixture(); await f.service.generate(f.input(), "203.0.113.1");
    const job = (await f.service.claim("first"))!;
    await expect(f.service.beginStage(job, "idle")).rejects.toMatchObject({ code: "invalid_stage" });
    f.config.now += LEASE_MS + 1;
    const resumed = (await f.service.claim("second"))!;
    expect(resumed).not.toBeNull();
    await expect(f.service.beginStage(job, "base")).rejects.toMatchObject({ code: "stale_worker" });
    await expect(f.service.heartbeat(job)).rejects.toMatchObject({ code: "stale_worker" });
  });
  it("does not repay an abandoned inflight request and pauses subsequent paid work", async () => {
    const f = fixture(); await f.service.generate(f.input(), "203.0.113.1");
    const job = (await f.service.claim("first"))!;
    await f.service.beginStage(job, "base");
    f.config.now += LEASE_MS + 1;
    expect(await f.service.claim("second")).toBeNull();
    expect(await f.service.get(job.id)).toMatchObject({ status: "failed", error: { code: "outcome_unknown" } });
    await expect(f.service.generate(f.input(), "203.0.113.2")).rejects.toMatchObject({ code: "generation_paused" });
  });
  it("renews ownership and disables the next paid stage without losing saved rows", async () => {
    const f = fixture(); await f.service.generate(f.input(), "203.0.113.1");
    const job = (await f.service.claim("first"))!;
    f.config.now += LEASE_MS - 1;
    await f.service.heartbeat(job);
    await f.service.beginStage(job, "base");
    f.config.enabled = false;
    await f.service.saveStage(job, "base", Buffer.from("base"), { usage, generationMs: 10 });
    await expect(f.service.beginStage(job, "idle")).rejects.toMatchObject({ code: "generation_disabled" });
    expect(await f.store.readArtifact(job.id, "stage-base.png", f.config.now)).not.toBeNull();
  });
});

describe("durable spending accounting", () => {
  it("admits queued tasks without withholding money", async () => {
    const f = fixture(4);
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => f.service.generate(f.input(), "203.0.113." + (i+1))));
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(4);
    expect(results.filter(x => x.status === "rejected").map(x => x.reason.code)).toEqual([]);
    expect(f.store.jobs.size).toBe(4);
  });
  it("clears known failure tracking but retains unknown accounting across midnight", async () => {
    const f = fixture(2); await f.service.generate(f.input(), "203.0.113.1");
    const first = (await f.service.claim("first"))!;
    await f.service.fail(first, "provider_rejected");
    await f.service.generate(f.input(), "203.0.113.2");
    const second = (await f.service.claim("second"))!;
    await f.service.beginStage(second, "base");
    await f.service.fail(second, "outcome_unknown");
    f.config.now += DAY;
    // Pause and unknown-outcome accounting do not reset with the date or artifact TTL.
    await f.store.cleanup(f.config.now);
    await expect(f.service.generate(f.input(), "203.0.113.3")).rejects.toMatchObject({ code: "generation_paused" });
    const billing = JSON.parse(f.store.ledger.get("budget")!.value);
    expect(billing.reservations[second.id]).toMatchObject({ remainingMicroUsd:0, unknown: true });
  });
  it("expires queued work without a call, clears its prompt and releases its reserve", async () => {
    const f = fixture(2); const accepted = await f.service.generate(f.input(), "203.0.113.1");
    f.config.now += WAIT_MS;
    expect(await f.service.claim("worker")).toBeNull();
    expect((await f.store.readJob(accepted.generationId))?.prompt).toBe("");
    await expect(f.service.generate(f.input(), "203.0.113.2")).resolves.toMatchObject({ status: "queued" });
  });
});

it("releases expired never-started reservations even after physical TTL cleanup",async()=>{
  const f=fixture(2);await f.service.generate(f.input(),"203.0.113.1");f.config.now+=DAY+1;
  await f.store.cleanup(f.config.now);expect(await f.service.claim("worker")).toBeNull();
  await expect(f.service.generate(f.input(),"203.0.113.2")).resolves.toMatchObject({status:"queued"});
});

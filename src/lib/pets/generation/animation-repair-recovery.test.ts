import {randomUUID} from "node:crypto";
import {expect, it} from "vitest";
import {createGenerationService} from "./service";
import {GenerationError, LEASE_MS} from "./model";
import {MemoryStore} from "./test-store";

const usage = {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04};
async function fixture() {
  const store = new MemoryStore(), clock = {now: Date.parse("2026-10-31T12:00:00Z")};
  const service = createGenerationService(store, {now: () => clock.now, enabled: () => true,
    automaticAnimationRepair: () => true, secret: () => "animation-repair-recovery-test-secret"});
  const accepted = await service.generate({requestId: randomUUID(), prompt: "Synthetic"}, "203.0.113.24");
  let job = (await service.claim("first"))!;
  job = await service.beginStage(job, "base");
  job = await service.saveStage(job, "base", Buffer.from("base"), {usage, generationMs: 1});
  job = await service.beginStage(job, "idle");
  return {store, clock, service, job, accepted, token: job.animationRepair!.attempts[0].token};
}

it("resumes a reserved but unsent attempt with the same token after worker expiry", async () => {
  const f = await fixture(); f.clock.now += LEASE_MS + 1;
  const resumed = (await f.service.claim("replacement"))!;
  expect(resumed.worker).toBe("replacement");
  expect(resumed.animationRepair!.attempts[0].token).toBe(f.token);
  await f.service.startAnimationAttempt(resumed, "idle", f.token);
  await expect(f.service.startAnimationAttempt(f.job, "idle", f.token)).rejects.toMatchObject({code: "stale_worker"});
});

it("does not replay a started attempt after worker expiry", async () => {
  const f = await fixture(); await f.service.startAnimationAttempt(f.job, "idle", f.token);
  f.clock.now += LEASE_MS + 1;
  expect(await f.service.claim("replacement")).toBeNull();
  expect((await f.store.readJob(f.job.id))?.status).toBe("failed");
  expect((await f.store.readJob(f.job.id))?.animationRepair?.attempts).toHaveLength(1);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.job.id].unknown).toBe(true);
});

it("keeps the scheduler inflight while an invalid completed row is being regenerated", async () => {
  const f = await fixture(); await f.service.startAnimationAttempt(f.job, "idle", f.token);
  await f.service.saveAnimationAttempt(f.job, "idle", f.token, Buffer.from("idle"), {usage, generationMs: 1});
  await f.service.planAnimationRepair(f.job, [{state: "idle", kind: "invalid"}]);
  const next = await f.service.reserveAnimationAttempt(f.job, "idle", "quality");
  f.clock.now += 5000; await f.service.startAnimationAttempt(f.job, "idle", next.attempt.token);
  expect((await f.store.readJob(f.job.id))?.stages.every(s => s.status === "completed")).toBe(true);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).active.inflight).toBe(true);
  f.clock.now += LEASE_MS + 1;
  expect(await f.service.claim("replacement")).toBeNull();
});

it("does not reinterpret missing usage as free quality retries", async () => {
  const f = await fixture(); await f.service.startAnimationAttempt(f.job, "idle", f.token);
  await f.service.saveAnimationAttempt(f.job, "idle", f.token, Buffer.from("idle"), {generationMs: 1});
  const result = await f.service.planAnimationRepair(f.job, [{state: "idle", kind: "invalid"}]);
  expect(result.states).toBeNull();
  expect(result.job.animationRepair?.phase).toBe("stopped");
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.job.id].unknown).toBe(true);
});

it("cannot mark reserved work complete or overwrite an expired task", async () => {
  const f = await fixture();
  await expect(f.service.completeAnimationRepair(f.job)).rejects.toMatchObject({code: "invalid_stage"});
  f.clock.now = f.job.expiresAt + 1;
  await expect(f.service.startAnimationAttempt(f.job, "idle", f.token)).rejects.toMatchObject({code: "stale_worker"});
  expect((await f.store.readJob(f.job.id))?.animationRepair?.attempts[0].status).toBe("reserved");
});

it("does not authorize a paid call when its stage checkpoint is missing", async () => {
  const f = await fixture();
  await f.store.transaction(async tx => {
    const job = (await tx.getJob(f.job.id))!;
    await tx.putJob({...job, stages: job.stages.filter(s => s.name !== "idle")});
  });
  await expect(f.service.startAnimationAttempt(f.job, "idle", f.token)).rejects.toMatchObject({code: "invalid_stage"});
});

it.each(["reserved", "started", "mismatched failure"])("keeps the queue paused when a quality attempt has %s evidence", async evidence => {
  const f = await fixture();
  await f.service.startAnimationAttempt(f.job, "idle", f.token);
  await f.service.saveAnimationAttempt(f.job, "idle", f.token, Buffer.from("idle"), {usage, generationMs: 1});
  await f.service.planAnimationRepair(f.job, [{state: "idle", kind: "invalid"}]);
  const {attempt} = await f.service.reserveAnimationAttempt(f.job, "idle", "quality");
  f.clock.now += 5000;
  const diagnostic = {boundary: "provider_cli", reason: "process_exit"} as const;
  if (evidence !== "reserved") await f.service.startAnimationAttempt(f.job, "idle", attempt.token);
  if (evidence === "mismatched failure") {
    await f.service.failAnimationAttempt(f.job, "idle", attempt.token,
      new GenerationError("outcome_unknown", undefined, undefined, undefined, diagnostic, {kind: "http_error", httpStatus: 500}));
  }
  await f.service.fail(f.job, "outcome_unknown", undefined, diagnostic, [], [{stage: "idle", cause: {kind: "http_error", httpStatus: 520}}]);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
  expect(await f.service.claim("replacement")).toBeNull();
});

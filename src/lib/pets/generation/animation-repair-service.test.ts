import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {createGenerationService} from "./service";
import {GenerationError} from "./model";
import {MemoryStore} from "./test-store";

const usage = {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04};
async function fixture() {
  const store = new MemoryStore();
  const config = {now: Date.parse("2026-10-31T12:00:00Z"), enabled: true, repair: true, budget: 50};
  const service = createGenerationService(store, {now: () => config.now, enabled: () => config.enabled,
    automaticAnimationRepair: () => config.repair, budgetUsd: () => config.budget, secret: () => "animation-repair-service-test-secret"});
  const result = await service.generate({prompt: "Synthetic character", requestId: randomUUID()}, "203.0.113.22");
  let job = (await service.claim("owner"))!;
  job = await service.beginStage(job, "base");
  job = await service.saveStage(job, "base", Buffer.from("base"), {usage, generationMs: 1});
  job = await service.beginStage(job, "idle");
  const current = () => store.readJob(result.generationId).then(value => value!);
  return {store, config, service, job, current};
}

describe("durable animation attempts", () => {
  it("reserves the initial attempt together with its stage and starts it once", async () => {
    const f = await fixture();
    const first = f.job.animationRepair!.attempts[0];
    expect(first).toMatchObject({state: "idle", ordinal: 1, status: "reserved"});
    await f.service.startAnimationAttempt(f.job, "idle", first.token);
    await expect(f.service.startAnimationAttempt(f.job, "idle", first.token)).rejects.toMatchObject({code: "invalid_stage"});
  });

  it("accounts a saved token once, while identical bytes from a new attempt cost again", async () => {
    const f = await fixture();
    const first = f.job.animationRepair!.attempts[0];
    await f.service.startAnimationAttempt(f.job, "idle", first.token);
    await f.service.saveAnimationAttempt(f.job, "idle", first.token, Buffer.from("same"), {usage, generationMs: 1});
    await f.service.saveAnimationAttempt(f.job, "idle", first.token, Buffer.from("same"), {usage, generationMs: 1});
    const planned = await f.service.planAnimationRepair(f.job, [{state: "idle", kind: "invalid", frame: 1}]);
    const {attempt} = await f.service.reserveAnimationAttempt(planned.job, "idle", "quality");
    f.config.now += 5000;
    await f.service.startAnimationAttempt(f.job, "idle", attempt.token);
    await f.service.saveAnimationAttempt(f.job, "idle", attempt.token, Buffer.from("same"), {usage, generationMs: 2});
    const budget = JSON.parse(f.store.ledger.get("budget")!.value);
    expect(budget.spent["2026-10-31"]).toBe(120000);
    expect((await f.current()).animationRepair!.attempts.map(a => a.status)).toEqual(["saved", "saved"]);
  });

  it("reuses an unstarted reservation and preserves expiry", async () => {
    const f = await fixture();
    const first = f.job.animationRepair!.attempts[0];
    await f.service.startAnimationAttempt(f.job, "idle", first.token);
    await f.service.failAnimationAttempt(f.job, "idle", first.token, new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "provider_cli", reason: "process_exit"}, {kind: "remote_disconnected"}));
    const a = await f.service.reserveAnimationAttempt(f.job, "idle", "transport");
    const b = await f.service.reserveAnimationAttempt(f.job, "idle", "transport");
    expect(a.attempt.token).toBe(b.attempt.token);
    expect((await f.current()).animationRepair!.attempts).toHaveLength(2);
    expect((await f.current()).expiresAt).toBe(f.job.expiresAt);
    await expect(f.service.startAnimationAttempt(f.job, "idle", a.attempt.token)).rejects.toMatchObject({code: "invalid_stage"});
    f.config.now += 5000; f.config.repair = false;
    await expect(f.service.startAnimationAttempt(f.job, "idle", a.attempt.token)).rejects.toMatchObject({code: "generation_disabled"});
  });

  it("caps mixed retries at four and does not free an ambiguous started slot", async () => {
    const f = await fixture();
    let attempt = f.job.animationRepair!.attempts[0];
    for (let n = 1; n <= 4; n++) {
      await f.service.startAnimationAttempt(f.job, "idle", attempt.token);
      await f.service.failAnimationAttempt(f.job, "idle", attempt.token, new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "provider_cli", reason: "process_exit"}, {kind: "remote_disconnected"}));
      if (n < 4) { ({attempt} = await f.service.reserveAnimationAttempt(f.job, "idle", "transport")); f.config.now += 5000; }
    }
    await expect(f.service.reserveAnimationAttempt(f.job, "idle", "transport")).rejects.toMatchObject({code: "invalid_stage"});
    expect((await f.current()).animationRepair!.attempts).toHaveLength(4);
  });

  it("checks the current budget at start and cannot save another token", async () => {
    const f = await fixture();
    const first = f.job.animationRepair!.attempts[0];
    f.config.budget = .04;
    await expect(f.service.startAnimationAttempt(f.job, "idle", first.token)).rejects.toMatchObject({code: "budget_exhausted"});
    await expect(f.service.saveAnimationAttempt(f.job, "idle", randomUUID(), Buffer.from("bad"), {usage, generationMs: 1})).rejects.toMatchObject({code: "invalid_stage"});
    expect(await f.store.readArtifact(f.job.id, "stage-idle.png", f.config.now)).toBeNull();
  });
});

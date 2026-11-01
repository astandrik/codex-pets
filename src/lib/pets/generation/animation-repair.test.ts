import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {createGenerationService} from "./service";
import {GenerationError, jobSchema} from "./model";
import * as repairPolicy from "./animation-repair";
import {MemoryStore} from "./test-store";

const now = Date.parse("2026-10-31T12:00:00Z");

describe("animation failure retry eligibility", () => {
  it.each([
    {code: "provider_rejected", httpStatus: 400, providerCode: "moderation_blocked", stage: "output" as const, expected: "moderation"},
    {code: "provider_rejected", httpStatus: 400, providerCode: "moderation_blocked", stage: "input" as const, expected: undefined},
    {code: "provider_rejected", httpStatus: 400, providerCode: "moderation_blocked", stage: "unknown" as const, expected: undefined},
    {code: "provider_rejected", httpStatus: 400, providerCode: "moderation_blocked", stage: undefined, expected: undefined},
    {code: "provider_rejected", httpStatus: 400, providerCode: "content_policy_violation", stage: "output" as const, expected: undefined},
    {code: "provider_rejected", httpStatus: 403, providerCode: "moderation_blocked", stage: "output" as const, expected: undefined},
    {code: "invalid_stage", httpStatus: 400, providerCode: "moderation_blocked", stage: "output" as const, expected: undefined},
  ])("classifies $code $providerCode/$stage/$httpStatus as $expected", ({code, httpStatus, providerCode, stage, expected}) => {
    const failure = new GenerationError(code, undefined, {httpStatus, code: providerCode, ...(stage ? {moderationStage: stage} : {})});
    expect(repairPolicy.animationFailureRetryReason(failure)).toBe(expected);
  });
  it("retains transport eligibility without accepting arbitrary provider failures", () => {
    expect(repairPolicy.animationFailureRetryReason(new GenerationError("outcome_unknown", undefined, undefined, undefined, undefined, {kind: "http_error", httpStatus: 500}))).toBe("transport");
    expect(repairPolicy.animationFailureRetryReason(new GenerationError("provider_rejected", undefined, undefined, undefined, undefined, {kind: "remote_disconnected"}))).toBeUndefined();
  });
});
async function fixture(enabled = true) {
  const store = new MemoryStore();
  const config = {enabled};
  const service = createGenerationService(store, {
    now: () => now, enabled: () => true, secret: () => "automatic-repair-test-secret-32-characters",
    automaticAnimationRepair: () => config.enabled,
  });
  const input = {requestId: randomUUID(), prompt: "Synthetic test character"};
  const accepted = await service.generate(input, "203.0.113.21");
  const job = (await store.readJob(accepted.generationId))!;
  return {store, config, service, input, job};
}

describe("automatic animation repair policy", () => {
  it("freezes four-attempt policy on a new task without extra quota or expiry", async () => {
    const {job, store} = await fixture();
    expect(job.animationRepair).toEqual({policy: 1, maxAttempts: 4, phase: "initial", pending: [], issues: [], attempts: []});
    expect(job.expiresAt).toBe(now + 86_400_000);
    expect(store.jobs.size).toBe(1);
    expect([...store.ledger.keys()].filter(key => key.startsWith("request:"))).toHaveLength(1);
  });

  it("keeps legacy tasks and replay unchanged when the flag later changes", async () => {
    const f = await fixture(false);
    expect(f.job.animationRepair).toBeUndefined();
    f.config.enabled = true;
    const replay = await f.service.generate(f.input, "203.0.113.21");
    expect(replay.generationId).toBe(f.job.id);
    expect((await f.store.readJob(f.job.id))!.animationRepair).toBeUndefined();
    expect(f.store.jobs.size).toBe(1);
  });

  it("preserves enabled policy on replay after disabling", async () => {
    const f = await fixture();
    f.config.enabled = false;
    await f.service.generate(f.input, "203.0.113.21");
    expect((await f.store.readJob(f.job.id))!.animationRepair?.maxAttempts).toBe(4);
  });

  it.each([0, 5])("rejects persisted attempt ordinal %i", async ordinal => {
    const {job} = await fixture();
    const attempt = {state: "failed", ordinal, token: randomUUID(), reason: "initial", status: "reserved", reservedAt: now, notBefore: now};
    expect(jobSchema.safeParse({...job, animationRepair: {policy: 1, maxAttempts: 4, phase: "initial", pending: [], issues: [], attempts: [attempt]}}).success).toBe(false);
  });

  it("rejects duplicate attempts, repeated tokens, gaps and invalid transitions", async () => {
    const {job} = await fixture();
    const first = {state: "failed", ordinal: 1, token: randomUUID(), reason: "initial", status: "reserved", reservedAt: now, notBefore: now};
    for (const attempts of [
      [first, first],
      [first, {...first, state: "idle"}],
      [{...first, ordinal: 2}],
      [{...first, status: "saved"}],
      [{...first, state: "base"}],
    ]) {
      expect(jobSchema.safeParse({...job, animationRepair: {policy: 1, maxAttempts: 4, phase: "initial", pending: [], issues: [], attempts}}).success).toBe(false);
    }
  });
});

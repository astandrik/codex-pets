import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {CONTINUATION_STATES, continuationInputSchema} from "./continuation-model";
import {animationRepairSchema, GenerationError, jobSchema, LEASE_MS} from "./model";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {continuationFixture} from "./continuation-fixture.test-utils";
import {animationRepairProgressText} from "./animation-repair-progress";

afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED", "true");
  const f = await continuationFixture(["waving"]);
  const settings = {automatic: true, budget: 50};
  const service = createGenerationService(f.store, {now: () => f.config.now, enabled: () => true,
    automaticAnimationRepair: () => settings.automatic, budgetUsd: () => settings.budget, secret: () => "continuation-test-secret"});
  return {...f, service, settings};
}

it.each([{retries: 0, calls: 1}, {retries: 1, calls: 2}, {retries: 5, calls: 6}, {retries: 50, calls: 51}])(
  "limits a selected row to $calls calls for $retries extra retries", async ({retries, calls}) => {
    const f = await fixture(), source = structuredClone(await f.store.readJob(f.job.id));
    const input = {...await f.input("regenerate", ["waving"]), maxRetries: retries};
    const accepted = await f.service.continueGeneration(f.job.id, input, "203.0.113.10");
    const id = accepted.generation!.generationId;
    expect((await f.store.readJob(id))!.animationRepair).toMatchObject({policy: 2, maxAttempts: calls});
    let count = 0;
    const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.config.now,
      wait: async ms => {f.config.now += ms;}, renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {},
        compose: async () => f.image, generate: async name => {
          expect(name).toBe("waving");count++;
          throw new GenerationError("provider_rejected", undefined, {httpStatus: 400, code: "moderation_blocked", moderationStage: "output"},
            undefined, {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 400});
        }})}, build: async () => ({"pet.zip": Buffer.from("unused")})});
    expect(await worker("owner")).toBe("failed");
    expect(count).toBe(calls);
    const job = jobSchema.parse(JSON.parse(JSON.stringify(await f.store.readJob(id))));
    expect(job.animationRepair!.attempts).toHaveLength(calls);
    expect(await f.store.readJob(f.job.id)).toEqual(source);
    const replay = await f.service.continueGeneration(f.job.id, input, "203.0.113.10");
    expect(replay.generation!.generationId).toBe(id);expect(f.store.jobs.size).toBe(2);
    expect(JSON.parse(f.store.ledger.get("day:2026-10-22")!.value)).toBe(1);
    expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[id].unknown).toBe(true);
  });

it("advertises limits only when enabled and preserves legacy policy on omission", async () => {
  const f = await fixture();
  expect((await f.service.getContinuationOptions(f.job.id)).regenerationRetries).toEqual({min: 0, default: 5, max: 50});
  const body = await f.input("regenerate", ["waving"]);
  expect(continuationInputSchema.parse(body)).not.toHaveProperty("maxRetries");
  const accepted = await f.service.continueGeneration(f.job.id, body, "203.0.113.10");
  expect((await f.store.readJob(accepted.generation!.generationId))!.animationRepair).toMatchObject({policy: 1, maxAttempts: 4});
  f.settings.automatic = false;
  expect((await f.service.getContinuationOptions(f.job.id)).regenerationRetries).toBeUndefined();
  expect((await f.service.continueGeneration(f.job.id, body, "203.0.113.10")).operation.id).toBe(body.requestId);
});

it("binds the explicit count to the receipt and replays after flag-off", async () => {
  const f = await fixture(), body = {...await f.input("regenerate", ["waving"]), maxRetries: 5};
  const accepted = await f.service.continueGeneration(f.job.id, body, "203.0.113.10");
  f.settings.automatic = false;
  expect((await f.service.continueGeneration(f.job.id, body, "203.0.113.10")).generation!.generationId).toBe(accepted.generation!.generationId);
  await expect(f.service.continueGeneration(f.job.id, {...body, maxRetries: 6}, "203.0.113.10")).rejects.toMatchObject({code: "request_id_conflict"});
  expect(f.store.jobs.size).toBe(2);
});

it("does not admit an explicit count when automatic repair is disabled during artifact checks", async () => {
  const f = await fixture(), transaction = f.store.transaction.bind(f.store);
  f.store.transaction = run => transaction(tx => run({...tx, hasArtifact: async (...args) => {
    const result = await tx.hasArtifact(...args);f.settings.automatic = false;return result;
  }}));
  const body = {...await f.input("regenerate", ["waving"]), maxRetries: 50};
  await expect(f.service.continueGeneration(f.job.id, body, "203.0.113.10")).rejects.toMatchObject({code: "generation_disabled"});
  expect(f.store.jobs.size).toBe(1);
  expect(f.store.ledger.has("day:2026-10-22")).toBe(false);
  expect((await f.service.findContinuation(f.job.id, body.requestId)).operation.state).toBe("rejected");
});

it.each([-1, 51, 1.5, "5", null, Number.NaN])("rejects invalid count %s before preparation", async maxRetries => {
  const f = await fixture();
  await expect(f.service.continueGeneration(f.job.id, {...await f.input("regenerate", ["waving"]), maxRetries}, "203.0.113.10")).rejects.toMatchObject({code: "invalid_argument"});
  expect(f.store.jobs.size).toBe(1);expect(f.store.ledger.size).toBe(0);
});

it("rejects the count on rebuild and new explicit requests with repair disabled", async () => {
  const f = await fixture();
  await expect(f.service.continueGeneration(f.job.id, {...await f.input("rebuild"), maxRetries: 0}, "203.0.113.10")).rejects.toMatchObject({code: "invalid_argument"});
  f.settings.automatic = false;
  await expect(f.service.continueGeneration(f.job.id, {...await f.input("regenerate", ["waving"]), maxRetries: 5}, "203.0.113.10")).rejects.toMatchObject({code: "generation_disabled"});
  expect(f.store.jobs.size).toBe(1);expect(f.store.ledger.size).toBe(0);
});

it("round-trips a maximal journal and rejects records above the saved cap", () => {
  const attempts = CONTINUATION_STATES.flatMap(state => Array.from({length: 51}, (_, i) => ({state, ordinal: i + 1,
    token: randomUUID(), reason: i ? "moderation" : "initial", status: "failed", reservedAt: i, notBefore: i,
    startedAt: i, finishedAt: i, failure: {code: "provider_rejected"}})));
  const value = {policy: 2, maxAttempts: 51, phase: "initial", pending: [], issues: [], attempts};
  expect(animationRepairSchema.parse(JSON.parse(JSON.stringify(value))).attempts).toHaveLength(561);
  expect(animationRepairSchema.safeParse({...value, maxAttempts: 50}).success).toBe(false);
  expect(animationRepairSchema.safeParse({...value, policy: 1}).success).toBe(false);
  expect(animationRepairSchema.safeParse({...value, attempts: [...attempts, attempts[0]]}).success).toBe(false);
});

it("shares six saved attempts across transport, moderation and quality failures", async () => {
  const f = await fixture();
  const accepted = await f.service.continueGeneration(f.job.id, {...await f.input("regenerate", ["waving"]), maxRetries: 5}, "203.0.113.10");
  let calls = 0;
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.config.now,
    wait: async ms => {f.config.now += ms;}, renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {},
      generate: async () => {
        if (++calls === 1) throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});
        if (calls === 2) throw new GenerationError("provider_rejected", undefined, {httpStatus: 400, code: "moderation_blocked", moderationStage: "output"});
        return {bytes: f.image, generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04}};
      },
      compose: async () => {throw new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
        {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined, [{state: "waving", kind: "invalid"}]);}
    })}});
  expect(await worker("owner")).toBe("failed");expect(calls).toBe(6);
  const job = (await f.store.readJob(accepted.generation!.generationId))!;
  expect(job.animationRepair!.attempts.map(a => a.reason)).toEqual(["initial", "transport", "moderation", "quality", "quality", "quality"]);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-10-22"]).toBe(160000);
  expect(animationRepairProgressText({maxAttempts: 6, phase: "repairing", rows: [{state: "waving", attempts: 6, retrying: true}]})).toContain("retry 5 of 5");
});

it("rechecks budget before a configured repeat", async () => {
  const f = await fixture();
  const accepted = await f.service.continueGeneration(f.job.id, {...await f.input("regenerate", ["waving"]), maxRetries: 50}, "203.0.113.10");
  let calls = 0;
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.config.now,
    wait: async ms => {f.config.now += ms;f.settings.budget = 0;}, renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => f.image,
      generate: async () => {calls++;throw new GenerationError("provider_rejected", undefined, {httpStatus: 400, code: "moderation_blocked", moderationStage: "output"});}})}});
  expect(await worker("owner")).toBe("failed");expect(calls).toBe(1);
  expect((await f.store.readJob(accepted.generation!.generationId))!.error).toBe("budget_exhausted");
});

it("resumes a stored policy-2 attempt after worker replacement", async () => {
  const f = await fixture(), input = {...await f.input("regenerate", ["waving"]), maxRetries: 5};
  const accepted = await f.service.continueGeneration(f.job.id, input, "203.0.113.10");
  let job = (await f.service.claim("old-worker"))!;
  job = await f.service.beginStages(job, ["waving"]);
  const token = job.animationRepair!.attempts[0].token;
  await f.service.startAnimationAttempt(job, "waving", token);
  await f.service.failAnimationAttempt(job, "waving", token, new GenerationError("provider_rejected", undefined,
    {httpStatus: 400, code: "moderation_blocked", moderationStage: "output"}));
  f.store.jobs.set(job.id, jobSchema.parse(JSON.parse(JSON.stringify(await f.store.readJob(job.id)))));
  f.config.now += LEASE_MS + 1;const calls: number[] = [];
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.config.now, wait: async ms => {f.config.now += ms;},
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => f.image,
      generate: async (_name, context) => {calls.push(context!.attempt);return {bytes: f.image, generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04}};}})},
    build: async () => ({"pet.zip": Buffer.from("zip")})});
  expect(await worker("replacement")).toBe("completed");expect(calls).toEqual([2]);
  expect((await f.store.readJob(job.id))!.animationRepair!.maxAttempts).toBe(6);
  expect((await f.service.continueGeneration(f.job.id, input, "203.0.113.10")).generation!.generationId).toBe(accepted.generation!.generationId);
});

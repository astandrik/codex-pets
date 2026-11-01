import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {GenerationError, LEASE_MS, STAGE_NAMES, jobSchema, type GenerationJob} from "./model";
import {MemoryStore} from "./test-store";
import {continuationFixture} from "./continuation-fixture.test-utils";

afterEach(() => vi.unstubAllEnvs());

const usage = {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04};
const outputFailure = () => new GenerationError("provider_rejected", undefined,
  {httpStatus: 400, code: "moderation_blocked", moderationStage: "output"}, undefined,
  {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 400});
async function fixture(serialized = false) {
  const store = new MemoryStore(), clock = {now: Date.parse("2026-11-01T12:00:00Z"), enabled: true};
  if (serialized) {
    const parse = (job: GenerationJob | null) => job && jobSchema.parse(JSON.parse(JSON.stringify(job)));
    const read = store.readJob.bind(store), transaction = store.transaction.bind(store);
    store.readJob = async id => parse(await read(id));
    store.transaction = operation => transaction(tx => operation({...tx, getJob: async id => parse(await tx.getJob(id))}));
  }
  const service = createGenerationService(store, {now: () => clock.now, enabled: () => true,
    automaticAnimationRepair: () => clock.enabled, secret: () => "output-moderation-fixture-secret"});
  const input = {requestId: randomUUID(), prompt: "Synthetic character"};
  const accepted = await service.generate(input, "203.0.113.60");
  const calls: {name: string; attempt: number | undefined; prompt: string}[] = [];
  const policy = {through: 1};
  const generate = vi.fn(async (name: string, context?: {attempt: number}, prompt = input.prompt) => {
    calls.push({name, attempt: context?.attempt, prompt});
    const count = calls.filter(c => c.name === name).length;
    if (name === "failed" && count <= policy.through) throw outputFailure();
    return {bytes: Buffer.from(name + count), usage, generationMs: 1};
  });
  const compose = vi.fn(async () => Buffer.from("atlas"));
  const worker = createSpriteGenerationWorker({service, store, now: () => clock.now, wait: async ms => {clock.now += ms;},
    renderer: {open: async job => ({prepare: async () => {}, cleanup: async () => {},
      generate: (name, context) => generate(name, context, job.prompt), compose})},
    build: async () => ({"pet.zip": Buffer.from("zip")})});
  return {store, clock, service, input, id: accepted.generationId, calls, policy, generate, compose, worker};
}

async function mixedFailureFixture(serialized = false) {
  const f = await fixture(serialized);
  const next = await f.service.generate({requestId: randomUUID(), prompt: "Next pet"}, "203.0.113.61");
  f.generate.mockImplementation(async (name, context, prompt = f.input.prompt) => {
    f.calls.push({name, attempt: context?.attempt, prompt});
    if (name === "failed") throw outputFailure();
    if (name === "waving") throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
      {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});
    return {bytes: Buffer.from(name + "1"), usage, generationMs: 1};
  });
  return {...f, next};
}

it.each([false, true])("advances the queue after four recorded output and HTTP520 failures (JSON persistence: %s)", async serialized => {
  const f = await mixedFailureFixture(serialized);
  expect(await f.worker("owner")).toBe("failed");
  for (const name of ["failed", "waving"]) {
    expect(f.calls.filter(c => c.name === name).map(c => c.attempt)).toEqual([1, 2, 3, 4]);
  }
  const failed = structuredClone((await f.store.readJob(f.id))!);
  for (const name of STAGE_NAMES.filter(n => n !== "failed" && n !== "waving")) {
    expect(f.calls.filter(c => c.name === name)).toHaveLength(1);
    expect(await f.store.readArtifact(f.id, `stage-${name}.png`, f.clock.now)).toEqual(Buffer.from(name + "1"));
  }
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent["2026-11-01"]).toBe(400000);
  expect(budget.reservations[f.id]).toEqual({remainingMicroUsd: 0, unknown: true});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({active: null, queue: [f.next.generationId]});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
  expect((await f.service.generate(f.input, "203.0.113.60")).generationId).toBe(f.id);
  expect(f.store.jobs.size).toBe(2);
  f.generate.mockImplementation(async name => ({bytes: Buffer.from(name), usage, generationMs: 1}));
  expect(await f.worker("next-owner")).toBe("completed");
  expect((await f.store.readJob(f.next.generationId))!.status).toBe("completed");
  expect(await f.store.readJob(f.id)).toEqual(failed);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(880000);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.id].unknown).toBe(true);
});

it.each(["input", "unknown", undefined] as const)("keeps mixed failures paused without stored output provenance: %s", async stage => {
  const f = await mixedFailureFixture(true), fail = f.service.fail;
  vi.spyOn(f.service, "fail").mockImplementationOnce(async (...args) => {
    await f.store.transaction(async tx => {
      const job = (await tx.getJob(f.id))!;
      const attempt = job.animationRepair!.attempts.filter(a => a.state === "failed").at(-1)!;
      if (stage === undefined) delete attempt.failure!.providerFailure;
      else attempt.failure!.providerFailure!.moderationStage = stage;
      await tx.putJob(job);
    });
    return fail(...args);
  });
  expect(await f.worker("owner")).toBe("failed");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
  expect(await f.worker("next-owner")).toBe("idle");
  expect((await f.store.readJob(f.next.generationId))!.status).toBe("queued");
});

it.each([false, true])("keeps mixed failures paused with inconsistent output HTTP provenance (stored cause changed: %s)", async changeStoredCause => {
  const f = await mixedFailureFixture(), fail = f.service.fail;
  vi.spyOn(f.service, "fail").mockImplementationOnce(async (...args) => {
    if (changeStoredCause) await f.store.transaction(async tx => {
      const job = (await tx.getJob(f.id))!;
      job.animationRepair!.attempts.filter(a => a.state === "failed").at(-1)!.failure!.cliCause = {kind: "http_error", httpStatus: 520};
      await tx.putJob(job);
    });
    args[5] = args[5]?.map(entry => entry.stage === "failed"
      ? {stage: entry.stage, cause: {kind: "http_error", httpStatus: 520}} : entry);
    return fail(...args);
  });
  expect(await f.worker("owner")).toBe("failed");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
  expect(await f.worker("next-owner")).toBe("idle");
});

it("keeps mixed failures paused when a sibling checkpoint is unconfirmed", async () => {
  const f = await mixedFailureFixture(), save = f.service.saveAnimationAttempt;
  vi.spyOn(f.service, "saveAnimationAttempt").mockImplementation((...args) => {
    if (args[1] === "running") throw Error("checkpoint unavailable");
    return save(...args);
  });
  expect(await f.worker("owner")).toBe("failed");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
  expect(await f.worker("next-owner")).toBe("idle");
});

it("retries confirmed output moderation with the same request and preserves other rows", async () => {
  const f = await fixture();
  expect(await f.worker("owner")).toBe("completed");
  expect(f.calls.filter(c => c.name === "failed")).toEqual([
    {name: "failed", attempt: 1, prompt: f.input.prompt}, {name: "failed", attempt: 2, prompt: f.input.prompt},
  ]);
  for (const name of STAGE_NAMES.filter(n => n !== "failed")) {
    expect(f.calls.filter(c => c.name === name)).toHaveLength(1);
    expect(await f.store.readArtifact(f.id, `stage-${name}.png`, f.clock.now)).toEqual(Buffer.from(name + "1"));
  }
  const job = (await f.store.readJob(f.id))!;
  expect(job.animationRepair!.attempts.filter(a => a.state === "failed").map(a => a.reason)).toEqual(["initial", "moderation"]);
  expect((await f.service.generate(f.input, "203.0.113.60")).generationId).toBe(f.id);
  expect(f.store.jobs.size).toBe(1);
  expect(job.expiresAt - job.createdAt).toBe(86400000);
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent["2026-11-01"]).toBe(480000);
  expect(budget.reservations[f.id]).toEqual({remainingMicroUsd: 0, unknown: true});
});

it("stops after four output refusals without blocking the next job", async () => {
  const f = await fixture(); f.policy.through = 10;
  const next = await f.service.generate({requestId: randomUUID(), prompt: "Next pet"}, "203.0.113.61");
  expect(await f.worker("owner")).toBe("failed");
  expect(f.calls.filter(c => c.name === "failed").map(c => c.attempt)).toEqual([1, 2, 3, 4]);
  const failed = structuredClone((await f.store.readJob(f.id))!);
  expect(failed.error).toBe("provider_rejected");
  expect(failed.providerFailure?.moderationStage).toBe("output");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(440000);
  f.policy.through = 0;
  expect(await f.worker("next-owner")).toBe("completed");
  expect((await f.store.readJob(next.generationId))!.status).toBe("completed");
  expect(await f.store.readJob(f.id)).toEqual(failed);
});

it("shares four slots across transport, moderation and quality retries", async () => {
  const f = await fixture();
  f.generate.mockImplementation(async (name, context, prompt = f.input.prompt) => {
    f.calls.push({name, attempt: context?.attempt, prompt});
    const count = f.calls.filter(c => c.name === name).length;
    if (name === "failed" && count === 1) throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
      {boundary: "provider_cli", reason: "process_exit"}, {kind: "remote_disconnected"});
    if (name === "failed" && count === 2) throw outputFailure();
    return {bytes: Buffer.from(name + count), usage, generationMs: 1};
  });
  f.compose.mockImplementation(async () => {
    if (f.calls.filter(c => c.name === "failed").length < 4) throw new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
      {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined, [{state: "failed", kind: "invalid"}]);
    return Buffer.from("atlas");
  });
  expect(await f.worker("owner")).toBe("completed");
  expect(f.calls.filter(c => c.name === "failed").map(c => c.attempt)).toEqual([1, 2, 3, 4]);
  const job = (await f.store.readJob(f.id))!;
  expect(job.animationRepair!.attempts.filter(a => a.state === "failed").map(a => a.reason)).toEqual(["initial", "transport", "moderation", "quality"]);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(520000);
});

it("retains the original saved-row hash when a quality retry is refused by output moderation", async () => {
  const f = await fixture();
  f.generate.mockImplementation(async (name, context, prompt = f.input.prompt) => {
    f.calls.push({name, attempt: context?.attempt, prompt});
    const count = f.calls.filter(c => c.name === name).length;
    if (name === "failed" && count === 2) throw outputFailure();
    return {bytes: Buffer.from(name + count), usage, generationMs: 1};
  });
  f.compose.mockImplementation(async () => {
    if (f.calls.filter(c => c.name === "failed").length < 3) throw new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
      {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined, [{state: "failed", kind: "invalid"}]);
    return Buffer.from("atlas");
  });
  expect(await f.worker("owner")).toBe("completed");
  const attempts = (await f.store.readJob(f.id))!.animationRepair!.attempts.filter(a => a.state === "failed");
  expect(attempts.map(a => a.reason)).toEqual(["initial", "quality", "moderation"]);
  expect(attempts[2].sourceSha256).toBe(attempts[0].resultSha256);
  expect(await f.store.readArtifact(f.id, "stage-failed.png", f.clock.now)).toEqual(Buffer.from("failed3"));
});

it.each(["input", "unknown", undefined])("does not retry a moderation refusal with stage %s", async stage => {
  const f = await fixture();
  f.generate.mockImplementation(async (name, context, prompt = f.input.prompt) => {
    f.calls.push({name, attempt: context?.attempt, prompt});
    if (name === "failed") throw new GenerationError("provider_rejected", undefined,
      {httpStatus: 400, code: "moderation_blocked", ...(stage ? {moderationStage: stage} : {})});
    return {bytes: Buffer.from(name), usage, generationMs: 1};
  });
  expect(await f.worker("owner")).toBe("failed");
  expect(f.calls.filter(c => c.name === "failed")).toHaveLength(1);
});

it.each([false, true])("reconciles a lost output-failure ACK before retrying (JSON persistence: %s)", async serialized => {
  const f = await fixture(serialized), fail = f.service.failAnimationAttempt;
  vi.spyOn(f.service, "failAnimationAttempt").mockImplementationOnce(async (...args) => {await fail(...args);throw Error("lost failure ACK");});
  expect(await f.worker("owner")).toBe("completed");
  expect(f.calls.filter(c => c.name === "failed")).toHaveLength(2);
});

it.each([false, true])("keeps the pause when stored moderation provenance disagrees (JSON persistence: %s)", async serialized => {
  const f = await fixture(serialized), fail = f.service.failAnimationAttempt;
  vi.spyOn(f.service, "failAnimationAttempt").mockImplementationOnce(async (...args) => {
    await fail(...args);
    await f.store.transaction(async tx => {
      const job = (await tx.getJob(f.id))!;
      job.animationRepair!.attempts.find(a => a.token === args[2])!.failure!.providerFailure!.moderationStage = "input";
      await tx.putJob(job);
    });
    throw Error("lost failure ACK");
  });
  expect(await f.worker("owner")).toBe("failed");
  expect(f.calls.filter(c => c.name === "failed")).toHaveLength(1);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
});

it.each([false, true])("resumes output refusal with the committed reservation (JSON persistence: %s)", async serialized => {
  const f = await fixture(serialized);let job = (await f.service.claim("before-crash"))!;
  job = await f.service.beginStage(job, "base");job = await f.service.saveStage(job, "base", Buffer.from("base"), {usage, generationMs: 1});
  job = await f.service.beginStages(job, STAGE_NAMES.filter(n => n !== "base"));
  for (const name of STAGE_NAMES.filter(n => n !== "base")) {
    const token = job.animationRepair!.attempts.find(a => a.state === name)!.token;
    await f.service.startAnimationAttempt(job, name, token);
    if (name === "failed") await f.service.failAnimationAttempt(job, name, token, outputFailure());
    else await f.service.saveAnimationAttempt(job, name, token, Buffer.from(name), {usage, generationMs: 1});
  }
  f.clock.now += LEASE_MS + 1; f.policy.through = 0;
  let reserved = "";const reserve = f.service.reserveAnimationAttempt;
  vi.spyOn(f.service, "reserveAnimationAttempt").mockImplementationOnce(async (...args) => {
    const result = await reserve(...args);reserved = result.attempt.token;throw Error("lost reservation ACK");
  });
  expect(await f.worker("replacement")).toBe("completed");
  expect(f.calls).toEqual([{name: "failed", attempt: 2, prompt: f.input.prompt}]);
  const attempts = (await f.store.readJob(f.id))!.animationRepair!.attempts.filter(a => a.state === "failed");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toMatchObject({token: reserved, ordinal: 2, reason: "moderation", status: "saved"});
});

it("keeps base refusal and disabled additional attempts terminal", async () => {
  const base = await fixture();base.generate.mockRejectedValue(outputFailure());
  expect(await base.worker("owner")).toBe("failed");expect(base.generate).toHaveBeenCalledTimes(1);
  const disabled = await fixture();disabled.clock.enabled = false;
  expect(await disabled.worker("owner")).toBe("failed");
  expect(disabled.calls.filter(c => c.name === "failed")).toHaveLength(1);
});

it("retries only the selected continuation row and preserves its source", async () => {
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED", "true");
  const f = await continuationFixture(["waving"]);
  const service = createGenerationService(f.store, {now: () => f.config.now, enabled: () => true,
    automaticAnimationRepair: () => true, secret: () => "continuation-test-secret"});
  const source = structuredClone(await f.store.readJob(f.job.id));
  const accepted = await service.continueGeneration(f.job.id, await f.input("regenerate", ["waving"]), "203.0.113.62");
  const calls: string[] = [];
  const worker = createSpriteGenerationWorker({service, store: f.store, now: () => f.config.now, wait: async ms => {f.config.now += ms;},
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => f.image,
      generate: async name => {calls.push(name);if (calls.length === 1) throw outputFailure();return {bytes: f.image, usage, generationMs: 1};}})},
    build: async () => ({"pet.zip": Buffer.from("zip")})});
  expect(await worker("owner")).toBe("completed");
  expect(calls).toEqual(["waving", "waving"]);
  expect(await f.store.readJob(f.job.id)).toEqual(source);
  expect((await f.store.readJob(accepted.generation!.generationId))!.animationRepair!.attempts.map(a => a.reason)).toEqual(["initial", "moderation"]);
});

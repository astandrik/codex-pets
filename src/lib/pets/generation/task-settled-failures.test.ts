import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {GenerationError, STAGE_NAMES} from "./model";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {taskFixture} from "./task-pool.test-utils";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});

it.each([
  {repair: false, rejected: "idle", transport: "waiting", attempts: 2, code: "provider_rejected", httpStatus: 400},
  {repair: false, rejected: "waiting", transport: "idle", attempts: 2, code: "provider_rejected", httpStatus: 400},
  {repair: true, rejected: "idle", transport: "waiting", attempts: 4, code: "provider_rejected", httpStatus: 400},
  {repair: true, rejected: "waiting", transport: "idle", attempts: 4, code: "provider_rejected", httpStatus: 400},
  {repair: false, rejected: "idle", transport: "waiting", attempts: 2, code: "provider_rate_limited", httpStatus: 429},
  {repair: false, rejected: "waiting", transport: "idle", attempts: 2, code: "provider_rate_limited", httpStatus: 429},
  {repair: true, rejected: "idle", transport: "waiting", attempts: 4, code: "provider_rate_limited", httpStatus: 429},
  {repair: true, rejected: "waiting", transport: "idle", attempts: 4, code: "provider_rate_limited", httpStatus: 429},
])("keeps recorded rejection and HTTP520 failures local: $repair / $rejected / $code", async ({repair, rejected, transport, attempts, code, httpStatus}) => {
  const f = await taskFixture(20, repair), id = f.jobs[0].id;
  f.saved(0, STAGE_NAMES.filter(name => name !== rejected && name !== transport));
  const saved = structuredClone(f.store.jobs.get(id)!.stages);
  const row = f.store.ledger.get("scheduler")!;
  row.value = JSON.stringify({...JSON.parse(row.value), queue: [id]});
  const calls: {id: string; stage: string}[] = [];
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    renderer: {open: async job => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => {throw Error("No assembly expected");},
      generate: async stage => {
        calls.push({id: job.id, stage});
        if (job.id === id && stage === rejected) throw new GenerationError(code, undefined,
          httpStatus === 400 ? {httpStatus, code: "moderation_blocked", moderationStage: "input"} : {httpStatus}, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus});
        if (job.id === id && stage === transport) throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});
        return {bytes: Buffer.from(stage), generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .01}};
      }})}});
  for (let step = 0; step < 20 && f.store.jobs.get(id)?.status !== "failed"; step++) {
    await run(`worker-${step}`); f.clock.now += 5000;
  }
  expect(f.store.jobs.get(id)).toMatchObject({id, status: "failed", expiresAt: f.jobs[0].expiresAt});
  expect(f.store.jobs.get(id)!.stages.filter(stage => stage.status === "completed")).toEqual(saved);
  expect(calls.filter(call => call.id === id && call.stage === rejected)).toHaveLength(1);
  expect(calls.filter(call => call.id === id && call.stage === transport)).toHaveLength(attempts);
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.providerSlots).toEqual([]);
  expect(state.pauseReason).toBeUndefined();
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent["2026-11-01"] ?? 0).toBe(0);
  expect(budget.reservations[id].unknown).toBe(true);

  const input = {requestId: randomUUID(), prompt: "Unrelated synthetic parent"};
  const peer = await f.service.generate(input, "203.0.113.20");
  expect(await run("peer")).toBe("yielded");
  expect(calls.filter(call => call.id === peer.generationId)).toEqual([{id: peer.generationId, stage: "base"}]);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(10000);
  const checkpoint = f.store.ledger.get("budget")!.value;
  expect((await f.service.generate(input, null)).generationId).toBe(peer.generationId);
  expect(f.store.ledger.get("budget")!.value).toBe(checkpoint);
  expect(f.store.jobs.size).toBe(4);
});

it("keeps an unconfirmed intent paused even beside a recorded input rejection", async () => {
  const f = await taskFixture(20, true), id = f.jobs[0].id;
  f.saved(0, STAGE_NAMES.filter(name => name !== "idle" && name !== "waiting"));
  const row = f.store.ledger.get("scheduler")!;
  row.value = JSON.stringify({...JSON.parse(row.value), queue: [id]});
  const start = f.service.startAnimationAttempt;
  vi.spyOn(f.service, "startAnimationAttempt").mockImplementation((job, stage, token) => {
    if (stage === "waiting") throw new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "intent", reason: "unconfirmed_write"});
    return start(job, stage, token);
  });
  let calls = 0;
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => {throw Error("No assembly expected");},
      generate: async stage => {
        calls++; expect(stage).toBe("idle");
        throw new GenerationError("provider_rejected", undefined, {httpStatus: 400, code: "moderation_blocked", moderationStage: "input"}, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 400});
      }})}});
  await run("idle"); await run("waiting"); await run("finalizer");
  expect(calls).toBe(1);
  expect(f.store.jobs.get(id)).toMatchObject({error: "outcome_unknown", failureDiagnostic: {boundary: "intent", reason: "unconfirmed_write"}});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({pauseReason: "outcome_unknown", providerSlots: []});
});

it("keeps the pause when a rejected row no longer matches its saved provider evidence", async () => {
  const f = await taskFixture(20, true), id = f.jobs[0].id;
  f.saved(0, STAGE_NAMES.filter(name => name !== "idle" && name !== "waiting"));
  const row = f.store.ledger.get("scheduler")!;
  row.value = JSON.stringify({...JSON.parse(row.value), queue: [id]});
  const idle = (await f.service.claim("idle"))!;
  let waiting = (await f.service.claim("waiting"))!;
  await f.service.beginStage(idle, "idle"); await f.service.beginStage(waiting, "waiting");
  const idleToken = f.store.jobs.get(id)!.animationRepair!.attempts.find(a => a.state === "idle")!.token;
  let waitingToken = f.store.jobs.get(id)!.animationRepair!.attempts.find(a => a.state === "waiting")!.token;
  await f.service.startAnimationAttempt(idle, "idle", idleToken);
  await f.service.startAnimationAttempt(waiting, "waiting", waitingToken);
  const rejection = new GenerationError("provider_rejected", undefined, {httpStatus: 400, code: "moderation_blocked", moderationStage: "input"}, undefined,
    {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 400});
  await f.service.failAnimationAttempt(idle, "idle", idleToken, rejection);
  await f.service.completeTask(idle, {error: rejection});
  const transport = new GenerationError("outcome_unknown", undefined, undefined, undefined,
    {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});
  for (let attempt = 1; attempt <= 4; attempt++) {
    await f.service.failAnimationAttempt(waiting, "waiting", waitingToken, transport);
    if (attempt < 4) {
      const next = await f.service.reserveAnimationAttempt(waiting, "waiting", "transport");
      await f.service.completeTask(waiting, {eligibleAt: next.attempt.notBefore}); f.clock.now += 5000;
      waiting = (await f.service.claim(`waiting-${attempt}`))!; waitingToken = next.attempt.token;
      await f.service.startAnimationAttempt(waiting, "waiting", waitingToken);
    }
  }
  await f.service.completeTask(waiting, {error: transport});
  await f.store.transaction(async tx => {
    const job = (await tx.getJob(id))!;
    delete job.animationRepair!.attempts.find(a => a.state === "idle")!.failure!.providerFailure;
    await tx.putJob(job);
  });
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    renderer: {open: async () => {throw Error("No new provider calls");}}});
  expect(await run("finalizer")).toBe("failed");
  expect(f.store.jobs.get(id)?.error).toBe("outcome_unknown");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({pauseReason: "outcome_unknown", providerSlots: []});
});

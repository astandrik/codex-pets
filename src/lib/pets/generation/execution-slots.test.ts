import {afterEach, expect, it, vi} from "vitest";
import {GenerationError, STAGE_NAMES, type GenerationJob} from "./model";
import {parallelFixture} from "./parallel-fixture.test-utils";

afterEach(() => vi.unstubAllEnvs());

async function rows(f: Awaited<ReturnType<typeof parallelFixture>>, owner: string) {
  let job = (await f.service.claim(owner))!;
  await f.service.beginStage(job, "base");
  await f.service.authorizeStage(job, "base");
  await f.service.saveStage(job, "base", Buffer.from("base"), {generationMs: 1, usage: {textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: 0.01}});
  job = await f.service.beginStages(job, STAGE_NAMES.slice(1));
  return job;
}
const token = (job: GenerationJob, index: number) => job.animationRepair!.attempts[index].token;

it("limits two jobs to eleven starts in total and admits a waiter after a saved result", async () => {
  const f = await parallelFixture(), a = await rows(f, "a"), b = await rows(f, "b");
  for (let i = 0; i < 10; i++) await f.service.startAnimationAttempt(a, a.animationRepair!.attempts[i].state, token(a, i));
  await f.service.startAnimationAttempt(b, "idle", token(b, 0));
  await expect(f.service.startAnimationAttempt(b, "running", token(b, 1))).rejects.toMatchObject({name: "WorkerYield"});
  const before = (await f.store.readJob(b.id))!.animationRepair!.attempts[1];
  expect(before.status).toBe("reserved");
  await f.service.saveAnimationAttempt(a, "idle", token(a, 0), Buffer.from("idle"), {generationMs: 1});
  await expect(f.service.startAnimationAttempt(b, "running", token(b, 1))).resolves.toBeDefined();
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toHaveLength(11);
});

it("keeps unknown outcomes fenced instead of freeing a slot on lease expiry", async () => {
  const f = await parallelFixture(), a = await rows(f, "a");
  await f.service.startAnimationAttempt(a, "idle", token(a, 0));
  await f.service.failAnimationAttempt(a, "idle", token(a, 0), new GenerationError("outcome_unknown"));
  await expect(f.service.yield(a)).rejects.toMatchObject({code: "outcome_unknown"});
  f.clock.now += 11 * 60_000;
  expect(await f.service.claim("replacement")).toBeNull();
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toHaveLength(1);
});

it.each(["stage", "retry", "card"])("does not bypass a full pool via %s authorisation", async kind => {
  const f = await parallelFixture(), a = await rows(f, "a"), b = await rows(f, "b");
  for (const attempt of a.animationRepair!.attempts) await f.service.startAnimationAttempt(a, attempt.state, attempt.token);
  if (kind === "stage") await expect(f.service.authorizeStage(b, "idle")).rejects.toMatchObject({name: "WorkerYield"});
  if (kind === "retry") {
    await f.service.recordRowAttemptFailure(b, "idle", 1, new GenerationError("outcome_unknown", undefined, undefined, undefined,
      {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520}));
    const retry = await f.service.beginRowRetry(b, "idle");
    f.clock.now = retry.notBefore;
    await expect(f.service.authorizeRowRetry(b, "idle", retry.token)).rejects.toMatchObject({name: "WorkerYield"});
  }
  if (kind === "card") {
    const card = {policy: 1 as const, state: "inflight" as const, revision: 0, edited: false, requestHash: "a".repeat(64), startedAt: f.clock.now};
    await f.store.transaction(async tx => tx.putJob({...b, status: "processing", cardMetadata: card}));
    await expect(f.service.authorizeCardMetadata({...b, status: "processing", cardMetadata: card})).rejects.toMatchObject({name: "WorkerYield"});
  }
});

it("does not treat unstarted capacity waiters as unknown paid calls after a recorded transport refusal", async () => {
  const f = await parallelFixture(), a = await rows(f, "a");
  await f.service.startAnimationAttempt(a, "idle", token(a, 0));
  const diagnostic = {boundary: "provider_cli", reason: "process_exit"} as const;
  const cause = {kind: "http_error", httpStatus: 520} as const;
  await f.service.failAnimationAttempt(a, "idle", token(a, 0), new GenerationError("outcome_unknown", undefined, undefined, undefined, diagnostic, cause));
  await f.service.fail(a, "outcome_unknown", undefined, diagnostic, [{stage: "idle", diagnostic}], [{stage: "idle", cause}]);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
  expect((await f.service.claim("b"))?.id).toBe(f.b.generationId);
});

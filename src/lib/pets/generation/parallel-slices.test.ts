import {afterEach, expect, it, vi} from "vitest";
import {parallelFixture} from "./parallel-fixture.test-utils";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {GenerationError, STAGE_NAMES} from "./model";

afterEach(() => vi.unstubAllEnvs());
it.each([1, 4, 6, 51])("advances peers while preserving a stored cap of %i attempts", async maxAttempts => {
  const f = await parallelFixture();
  await f.store.transaction(async tx => {
    const job = (await tx.getJob(f.a.generationId))!;
    job.animationRepair = {...job.animationRepair!, policy: maxAttempts === 4 ? 1 : 2, maxAttempts};
    await tx.putJob(job);
  });
  const calls: {id: string; name: string; attempt?: number}[] = [];
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    wait: async () => {throw Error("No sleeping with an active job");},
    renderer: {open: async job => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("atlas"),
      generate: async (name, context) => {
        calls.push({id: job.id, name, attempt: context?.attempt});
        if (job.id === f.a.generationId && name === "failed") throw new GenerationError("provider_rejected", undefined,
          {httpStatus: 400, code: "moderation_blocked", moderationStage: "output"}, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 400});
        return {bytes: Buffer.from(name), generationMs: 1, usage: {textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: .01}};
      }})}, build: async () => ({"pet.zip": Buffer.from("zip")})});
  const original = structuredClone((await f.store.readJob(f.a.generationId))!);
  const outcomes: string[] = [];
  for (let i = 0; i < 2 * maxAttempts + 24; i++) {
    outcomes.push(...await Promise.all([worker("left"), worker("right")]));
    f.clock.now += 5000;
    if ((await f.store.readJob(f.a.generationId))?.status === "failed" &&
        (await f.store.readJob(f.b.generationId))?.status === "completed" &&
        (await f.store.readJob(f.c.generationId))?.status === "completed") break;
  }
  expect(outcomes).toContain("yielded");
  expect((await f.store.readJob(f.b.generationId))?.status).toBe("completed");
  expect((await f.store.readJob(f.c.generationId))?.status).toBe("completed");
  const attempts = calls.filter(c => c.id === f.a.generationId && c.name === "failed");
  expect(attempts.map(a => a.attempt)).toEqual(Array.from({length: maxAttempts}, (_, i) => i + 1));
  if (maxAttempts > 1) expect(calls.findIndex(c => c.id === f.b.generationId)).toBeLessThan(calls.lastIndexOf(attempts.at(-1)!));
  for (const name of STAGE_NAMES.filter(n => n !== "failed")) expect(calls.filter(c => c.id === f.a.generationId && c.name === name)).toHaveLength(1);
  expect(await f.store.readJob(f.a.generationId)).toMatchObject({id: original.id, expiresAt: original.expiresAt, createdAt: original.createdAt});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent["2026-11-01"]).toBe(350000);
  expect(budget.reservations[f.a.generationId].unknown).toBe(true);
});

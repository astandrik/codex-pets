import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {baseRetryFixture} from "./base-retry-fixture.test-utils";
import {baseRetryEligibility} from "./base-retry-model";
import {GenerationError, jobSchema} from "./model";
import {createSpriteGenerationWorker} from "./sprite-worker";

beforeEach(() => {
  vi.stubEnv("PET_GENERATION_BASE_RETRY_ENABLED", "true");
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function inputRefusedFixture() {
  const f = await baseRetryFixture();
  f.store.jobs.get(f.id)!.providerFailure = {httpStatus: 400, code: "moderation_blocked", moderationStage: "input"};
  return f;
}

it("offers an input-refused base and its saved input without changing the job or ledger", async () => {
  const f = await inputRefusedFixture();
  const before = structuredClone({job: f.store.jobs.get(f.id), ledger: [...f.store.ledger]});
  expect(await f.service.get(f.id)).toMatchObject({canRetryBase: true, canContinue: false});
  expect(await f.service.getBaseRetryOptions(f.id)).toMatchObject({inputState: "saved", prompt: "Original input", displayName: "Pet name"});
  expect(await f.service.getBaseRetryReference(f.id, f.reference!.metadata.sha256)).toEqual(f.reference!.bytes);
  expect({job: f.store.jobs.get(f.id), ledger: [...f.store.ledger]}).toEqual(before);
});

it("preserves input and one admission when an input-refused manual retry is double-submitted or replayed", async () => {
  const f = await inputRefusedFixture(), input = {...await f.input(), maxRetries: 5};
  const source = structuredClone(f.store.jobs.get(f.id));
  const [first, duplicate] = await Promise.all([
    f.service.retryBaseGeneration(f.id, input, "203.0.113.8"),
    f.service.retryBaseGeneration(f.id, input, "203.0.113.8"),
  ]);
  expect(duplicate.generation.generationId).toBe(first.generation.generationId);
  const child = f.store.jobs.get(first.generation.generationId)!;
  expect(child).toMatchObject({prompt: "Original input", displayName: "Pet name", baseRetrySourceId: f.id, baseRepair: {maxAttempts: 6}});
  expect(await f.store.readArtifact(child.id, "reference.png", f.config.now)).toEqual(f.reference!.bytes);
  expect(f.store.jobs.get(f.id)).toEqual(source);
  const admitted = structuredClone([...f.store.ledger]);
  f.config.retry = false; f.config.review = false; f.config.enabled = false;
  expect((await f.service.findBaseRetry(f.id, input.requestId)).generation.generationId).toBe(child.id);
  expect((await f.service.retryBaseGeneration(f.id, input, null)).generation.generationId).toBe(child.id);
  expect([...f.store.ledger]).toEqual(admitted);
  expect(f.store.jobs.size).toBe(2);
});

it("stops automatic input retries but permits the next explicit retry from an early-stopped child", async () => {
  const f = await inputRefusedFixture();
  const accepted = await f.service.retryBaseGeneration(f.id, {...await f.input(), maxRetries: 5}, "203.0.113.8");
  const generate = vi.fn(async () => {
    throw new GenerationError("provider_rejected", undefined,
      {httpStatus: 400, code: "moderation_blocked", moderationStage: "input"}, undefined,
      {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 400});
  });
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.config.now,
    renderer: {open: async () => ({generate, prepare: async () => undefined, compose: async () => { throw Error("unexpected assembly"); }, cleanup: async () => undefined})}});
  expect(await worker("owner")).toBe("failed");
  expect(generate).toHaveBeenCalledTimes(1);
  const child = structuredClone(f.store.jobs.get(accepted.generation.generationId)!);
  expect(jobSchema.safeParse(child).success).toBe(true);
  expect(child.baseRepair).toMatchObject({phase: "stopped", maxAttempts: 6});
  expect(child.baseRepair!.attempts).toHaveLength(1);
  expect(baseRetryEligibility(child)).toBe(true);
  expect(await f.service.get(child.id)).toHaveProperty("canRetryBase", true);
  const options = await f.service.getBaseRetryOptions(child.id);
  if ("existingGeneration" in options) throw Error("unexpected receipt");
  const request = {requestId: randomUUID(), sourceRevision: options.sourceRevision, mode: "saved" as const, maxRetries: 5};
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  const next = await f.service.retryBaseGeneration(child.id, request, "203.0.113.8");
  expect((await f.service.retryBaseGeneration(child.id, request, "203.0.113.8")).generation.generationId).toBe(next.generation.generationId);
  expect(f.store.jobs.size).toBe(3);
  expect(f.store.jobs.get(child.id)).toEqual(child);
  const afterBudget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(afterBudget.spent).toEqual(budget.spent);
  for (const [id, reservation] of Object.entries(budget.reservations)) expect(afterBudget.reservations[id]).toEqual(reservation);
  expect(afterBudget.reservations[next.generation.generationId]).toEqual({remainingMicroUsd: 0, unknown: false});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).queue).toEqual([next.generation.generationId]);
});

it("keeps unknown provenance and inconsistent input-refusal diagnostics ineligible", async () => {
  const f = await inputRefusedFixture(), job = f.store.jobs.get(f.id)!;
  for (const providerFailure of [
    {httpStatus: 400, code: "moderation_blocked", moderationStage: "unknown" as const},
    {httpStatus: 400, code: "moderation_blocked"},
    {httpStatus: 500, code: "moderation_blocked", moderationStage: "input" as const},
    {httpStatus: 400, code: "unrecognized", moderationStage: "input" as const},
  ]) expect(baseRetryEligibility({...job, providerFailure})).toBe(false);
  expect(baseRetryEligibility({...job, failureDiagnostic: {boundary: "checkpoint", reason: "io_error"}})).toBe(false);
});

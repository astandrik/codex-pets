import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {StatusCode, YdbError} from "@/lib/ydb/client";
import {taskFixture} from "@/lib/pets/generation/task-pool.test-utils";
import {FileResultJournal} from "@/lib/pets/generation/result-journal";
import {attachResultJournal} from "@/lib/pets/generation/checkpoint-journal";
import {createSpriteGenerationWorker} from "@/lib/pets/generation/sprite-worker";
import {GenerationError, STAGE_NAMES} from "@/lib/pets/generation/model";
import {createWorkerContext, withWorkerContext} from "@/lib/pets/generation/worker-diagnostics";

type Kind = "animation" | "base" | "row";
class Aborted extends YdbError {static status = StatusCode.ABORTED;}
const folders: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) await rm(folder, {recursive: true, force: true});
});
async function fixture(kind: Kind, mode: "before" | "rollback" | "after", error: Error = new Aborted("reservation aborted"), quality = false) {
  const f = await taskFixture(20, kind !== "row"), id = f.jobs[0].id;
  if (kind === "animation") f.saved(0, STAGE_NAMES.filter(stage => stage !== "idle"));
  if (kind === "base") f.store.jobs.set(id, {...f.jobs[0], reviewBase: true, baseRetrySourceId: "b".repeat(64),
    baseRepair: {policy: 1, maxAttempts: 4, phase: "active", attempts: []}});
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...JSON.parse(f.store.ledger.get("scheduler")!.value), queue: [id]});
  const folder = await mkdtemp(path.join(tmpdir(), "reservation-recovery-")); folders.push(folder);
  const journal = await FileResultJournal.open(folder);
  let reservations = 0, atFaultBudget = "", faulted = false;
  const faultAt = kind === "row" || quality ? 1 : 2;
  const intercept = async <T>(run: () => Promise<T>) => {
    reservations++;
    if (reservations !== faultAt) return run();
    atFaultBudget = f.store.ledger.get("budget")!.value; faulted = true;
    if (mode === "rollback") {
      const transaction = f.store.transaction.bind(f.store);
      vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(async tx => {
        await operation(tx); throw error;
      }));
      return run();
    }
    if (mode === "after") await run();
    throw error;
  };
  if (kind === "animation") {
    const original = f.service.reserveAnimationAttempt.bind(f.service);
    vi.spyOn(f.service, "reserveAnimationAttempt").mockImplementation((...args) => intercept(() => original(...args)));
  } else if (kind === "base") {
    const original = f.service.reserveBaseAttempt.bind(f.service);
    vi.spyOn(f.service, "reserveBaseAttempt").mockImplementation((...args) => intercept(() => original(...args)));
  } else {
    const original = f.service.beginRowRetry.bind(f.service);
    vi.spyOn(f.service, "beginRowRetry").mockImplementation((...args) => intercept(() => original(...args)));
  }
  let calls = 0, composes = 0;
  const generate = vi.fn(async () => {
    calls++;
    if (!quality && calls <= (kind === "row" ? 1 : 2)) throw kind === "row"
      ? new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520})
      : new GenerationError("provider_rejected", undefined, {httpStatus: 400, code: "moderation_blocked", moderationStage: "output"}, undefined,
        {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 400});
    return {bytes: Buffer.from("saved-" + calls), generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .01}};
  });
  const events: {error: unknown; phase: string; secondary: boolean}[] = [];
  const run = createSpriteGenerationWorker({store: f.store, service: attachResultJournal(f.service, f.store, {journal, now: () => f.clock.now}), now: () => f.clock.now,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, generate, compose: async () => {
      composes++;
      if (quality && composes === 1) throw new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
        {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined, [{state: "idle", kind: "invalid"}]);
      return Buffer.from("atlas");
    }})}, build: async () => ({})});
  async function step() {
    const context = createWorkerContext("test", (error, context, secondary) => events.push({error, phase: context.phase, secondary}));
    return withWorkerContext(context, () => run("test", context));
  }
  const job = () => f.store.jobs.get(id)!;
  const attempts = () => kind === "base" ? job().baseRepair!.attempts : kind === "animation"
    ? job().animationRepair!.attempts.filter(attempt => attempt.state === "idle") : job().rowRetries ?? [];
  const state = () => JSON.parse(f.store.ledger.get("scheduler")!.value);
  return {...f, id, journal, generate, events, step, job, attempts, state, error,
    faulted: () => faulted, reservations: () => reservations, atFaultBudget: () => atFaultBudget};
}

it.each(["animation", "base"] as const)("defers an aborted %s retry reservation without repeating a paid attempt", async kind => {
  const f = await fixture(kind, "rollback"), initial = f.job();
  expect(await f.step()).toBe("yielded"); f.clock.now += 5001;
  const oldTokens = f.attempts().map(attempt => attempt.token);
  expect(await f.step()).toBe("yielded");
  expect(f.faulted()).toBe(true);
  expect(f.attempts()).toHaveLength(2);
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.state().pauseReason).toBeUndefined();
  expect(f.store.ledger.get("budget")!.value).toBe(f.atFaultBudget());
  expect(f.events).toContainEqual({error: f.error, phase: "intent", secondary: false});
  f.clock.now += 5001; expect(await f.step()).toBe("yielded");
  const token = f.attempts()[2].token;
  expect(f.generate).toHaveBeenCalledTimes(2);
  f.clock.now += 5001; expect(await f.step()).toBe("yielded");
  expect(f.generate).toHaveBeenCalledTimes(3);
  expect(f.attempts()[2]).toMatchObject({token, ordinal: 3, status: "saved"});
  expect(f.attempts().slice(0, 2).map(attempt => attempt.token)).toEqual(oldTokens);
  expect(f.job()).toMatchObject({id: initial.id, createdAt: initial.createdAt, expiresAt: initial.expiresAt});
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(10000);
  expect(f.state().pauseReason).toBeUndefined();
  expect(await f.journal.list()).toEqual([]);
});

it.each(["animation", "base"] as const)("reuses a committed %s retry reservation after its acknowledgement is lost", async kind => {
  const f = await fixture(kind, "after", Error("lost reservation acknowledgement"));
  await f.step(); f.clock.now += 5001;
  expect(await f.step()).toBe("yielded");
  expect(f.attempts()).toHaveLength(3);
  const token = f.attempts()[2].token;
  f.clock.now += 5001;
  expect(await f.step()).toBe("yielded");
  expect(f.attempts()[2]).toMatchObject({token, ordinal: 3, status: "saved"});
  expect(f.generate).toHaveBeenCalledTimes(3);
  expect(f.reservations()).toBe(2);
  expect(f.state().pauseReason).toBeUndefined();
});

it.each(["animation", "base", "row"] as const)("keeps ambiguous %s reservation outcomes blocked", async kind => {
  const f = await fixture(kind, "before", Error("unknown database outcome"));
  await f.step();
  if (kind !== "row") {f.clock.now += 5001; await f.step();}
  await f.step();
  expect(f.job()).toMatchObject({status: "failed", error: "outcome_unknown"});
  expect(f.state().pauseReason).toBe("outcome_unknown");
  expect(f.generate).toHaveBeenCalledTimes(kind === "row" ? 1 : 2);
});

it.each(["rollback", "after"] as const)("recovers an ordinary transport retry reservation (%s)", async mode => {
  const f = await fixture("row", mode, mode === "rollback" ? new Aborted("reservation aborted") : Error("lost reservation acknowledgement"));
  expect(await f.step()).toBe("yielded");
  expect(f.generate).toHaveBeenCalledTimes(1);
  if (mode === "rollback") {f.clock.now += 5001; expect(await f.step()).toBe("yielded");}
  const retry = f.job().rowRetries![0];
  expect(retry.state).toBe("waiting");
  f.clock.now = retry.notBefore + 1;
  expect(await f.step()).toBe("yielded");
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.job().rowRetries![0]).toMatchObject({token: retry.token, state: "completed"});
  expect(f.job().rowAttemptLogs).toHaveLength(1);
  expect(f.state().pauseReason).toBeUndefined();
});

it("preserves a saved image while its quality retry reservation is deferred", async () => {
  const f = await fixture("animation", "rollback", new Aborted("quality reserve aborted"), true);
  await f.step(); const original = f.job().stages.find(stage => stage.name === "idle")!;
  await f.step();
  expect(await f.step()).toBe("yielded");
  expect(f.faulted()).toBe(true);
  expect(f.job().stages).toContainEqual(original);
  expect(f.attempts()).toHaveLength(1);
  expect(f.generate).toHaveBeenCalledTimes(1);
  f.clock.now += 5001; await f.step(); f.clock.now += 5001; await f.step();
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.attempts()[1]).toMatchObject({ordinal: 2, reason: "quality", sourceSha256: original.sha256, status: "saved"});
  expect(f.state().pauseReason).toBeUndefined();
});

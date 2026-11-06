import {afterEach, expect, it, vi} from "vitest";
import {taskFixture} from "./task-pool.test-utils";
import {GenerationError, STAGE_NAMES} from "./model";
import {createSpriteGenerationWorker} from "./sprite-worker";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});
const diagnostic = {boundary: "provider_cli", reason: "process_exit"} as const;

it.each([
  {errno: 8, legacy: false, lateCertificate: false}, {errno: 1, legacy: false, lateCertificate: false},
  {errno: 8, legacy: true, lateCertificate: false}, {errno: 1, legacy: true, lateCertificate: false},
  {errno: 1, legacy: false, lateCertificate: true}, {errno: 1, legacy: true, lateCertificate: true},
])("finishes TLS errno=$errno and HTTP520 siblings (legacy=$legacy, certificate last=$lateCertificate)", async ({errno, legacy, lateCertificate}) => {
  const f = await taskFixture(20, true);
  f.saved(0, STAGE_NAMES.filter(stage => !["idle", "waving"].includes(stage)));
  const id = f.jobs[0].id, identity = structuredClone(f.jobs[0]);
  const artifacts = new Map(f.store.artifacts);
  const initial = JSON.parse(f.store.ledger.get("scheduler")!.value);
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...initial, queue: [id]});
  if (legacy) {
    f.store.jobs.get(id)!.status = "queued"; f.store.jobs.get(id)!.stages = [];
    f.store.ledger.get("scheduler")!.value = JSON.stringify({revision: 0, queue: [id], active: null});
  }
  const calls: string[] = [];
  const failures: string[] = [];
  let releaseCertificate = () => {};
  const certificateGate = new Promise<void>(resolve => {releaseCertificate = resolve;});
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    wait: async ms => {f.clock.now += ms;}, renderer: {open: async () => ({
      generate: async name => {
        calls.push(name);
        if (name === "idle") {
          if (lateCertificate) await certificateGate;
          failures.push(name);
          throw new GenerationError("provider_not_sent", undefined, undefined, undefined, diagnostic,
            {kind: "tls_error", errno, requestSent: false});
        }
        if (name === "waving") {
          failures.push(name);
          if (calls.filter(stage => stage === "waving").length === 4) releaseCertificate();
          throw new GenerationError("outcome_unknown", undefined, undefined, undefined, diagnostic,
            {kind: "http_error", httpStatus: 520});
        }
        return {bytes: Buffer.from(name), generationMs: 1, usage: {textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: .01}};
      }, prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("atlas"),
    })}});
  async function drive(owner: string) {
    for (let n = 0; n < 30 && f.store.jobs.get(id)!.status !== "failed"; n++) {
      await run(owner); f.clock.now += 5001;
    }
  }
  try {await Promise.all(legacy ? [drive("legacy")] : [drive("first"), drive("second")]);}
  finally {releaseCertificate();}
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value), job = f.store.jobs.get(id)!;
  expect(calls.filter(stage => stage === "idle")).toHaveLength(errno === 8 ? 4 : 1);
  expect(calls.filter(stage => stage === "waving")).toHaveLength(4);
  if (errno === 1) expect(failures.indexOf("idle") > failures.lastIndexOf("waving")).toBe(lateCertificate);
  expect(job).toMatchObject({status: "failed", id: identity.id, createdAt: identity.createdAt, expiresAt: identity.expiresAt});
  expect(state.providerSlots ?? []).toEqual([]);
  expect(state.pauseReason).toBeUndefined();
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.reservations[id].unknown).toBe(true);
  expect(budget.spent["2026-11-01"] ?? 0).toBe(legacy ? 100000 : 0);
  if (!legacy) expect(f.store.artifacts).toEqual(artifacts);
  const next = f.jobs[1].id;
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...state, queue: [next]});
  expect((await f.service.claim("next-owner"))?.id).toBe(next);
});

it.each([false, true])("preserves a real unknown sibling despite a saved certificate failure (legacy=%s)", async legacy => {
  const f = await taskFixture(20, true), id = f.jobs[0].id;
  f.saved(0, STAGE_NAMES.filter(stage => !["idle", "waving"].includes(stage)));
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...state, queue: [id]});
  if (legacy) {
    f.store.jobs.get(id)!.status = "queued"; f.store.jobs.get(id)!.stages = [];
    f.store.ledger.get("scheduler")!.value = JSON.stringify({revision: 0, queue: [id], active: null});
  }
  const calls: string[] = [];
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    wait: async ms => {f.clock.now += ms;}, renderer: {open: async () => ({
      generate: async name => {
        calls.push(name);
        if (name === "idle") throw new GenerationError("provider_not_sent", undefined, undefined, undefined, diagnostic,
          {kind: "tls_error", errno: 1, requestSent: false});
        if (name === "waving") throw new GenerationError("outcome_unknown", undefined, undefined, undefined, diagnostic,
          {kind: "tls_error", errno: 8});
        return {bytes: Buffer.from(name), generationMs: 1, usage: {textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: .01}};
      }, prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("atlas"),
    })}});
  for (let n = 0; n < 15 && f.store.jobs.get(id)!.status !== "failed"; n++) await run("owner");
  const closed = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(f.store.jobs.get(id)!.error).toBe("outcome_unknown");
  expect(closed.pauseReason).toBe("outcome_unknown");
  if (!legacy) expect(closed.providerSlots.some((slot: {unknown?: boolean}) => slot.unknown)).toBe(true);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[id].unknown).toBe(true);
  await run("another-owner");
  expect(calls.filter(stage => stage === "idle")).toHaveLength(1);
  expect(calls.filter(stage => stage === "waving")).toHaveLength(1);
});

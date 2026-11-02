import {afterEach, expect, it, vi} from "vitest";
import {parallelFixture} from "./parallel-fixture.test-utils";
import {STAGE_NAMES} from "./model";
import {changeSchedulerState} from "./scheduler-state";

afterEach(() => vi.unstubAllEnvs());

async function preparePair(f: Awaited<ReturnType<typeof parallelFixture>>) {
  const jobs = [];
  for (const owner of ["a", "b"]) {
    let job = (await f.service.claim(owner))!;
    await f.service.beginStage(job, "base"); await f.service.authorizeStage(job, "base");
    await f.service.saveStage(job, "base", Buffer.from("base"), {generationMs: 1});
    job = await f.service.beginStages(job, STAGE_NAMES.slice(1)); jobs.push(job);
  }
  return jobs;
}

it("defaults an existing v2 scheduler to eleven calls", async () => {
  const f = await parallelFixture();
  await f.service.claim("existing");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerLimit).toBe(11);
});

it.each([1, 11, 16, 22])("enforces a shared limit of %i across two jobs", async limit => {
  const f = await parallelFixture();
  vi.stubEnv("PET_GENERATION_PROVIDER_CALLS", String(limit));
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...state, providerLimit: limit});
  const jobs = await preparePair(f);
  const starts = await Promise.allSettled(jobs.flatMap(job => job.animationRepair!.attempts.map(attempt =>
    f.service.startAnimationAttempt(job, attempt.state, attempt.token))));
  expect(starts.filter(s => s.status === "fulfilled")).toHaveLength(limit);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toHaveLength(limit);
  expect(starts.filter(s => s.status === "rejected").every(s => s.status === "rejected" && s.reason.name === "WorkerYield")).toBe(true);
});

it.each(["0", "23", "1.5", "invalid", ""])("blocks claims for invalid configuration %j", async value => {
  const f = await parallelFixture(); vi.stubEnv("PET_GENERATION_PROVIDER_CALLS", value);
  await expect(f.service.claim("invalid")).rejects.toMatchObject({code: "generation_not_configured"});
});

it("changes the canonical limit with CAS", async () => {
  const f = await parallelFixture(); vi.stubEnv("PET_GENERATION_DRAIN", "true");
  let state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  await changeSchedulerState(f.store, {action: "limit", expectedRevision: state.revision, providerLimit: 22, now: f.clock.now, apply: true});
  state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.providerLimit).toBe(22); expect(state.activeLimit).toBe(2);
  await expect(changeSchedulerState(f.store, {action: "limit", expectedRevision: state.revision, providerLimit: 23, now: f.clock.now, apply: true})).rejects.toThrow();
  const updated = await changeSchedulerState(f.store, {action: "limit", expectedRevision: state.revision, providerLimit: 11, now: f.clock.now, apply: true});
  expect(updated).toMatchObject({providerLimit: 11});
});

it("keeps all22 outstanding permits when the canonical limit is reduced to11", async () => {
  const f = await parallelFixture(); vi.stubEnv("PET_GENERATION_PROVIDER_CALLS", "22");
  const initial = JSON.parse(f.store.ledger.get("scheduler")!.value);
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...initial, providerLimit: 22});
  const jobs = await preparePair(f);
  for (const job of jobs) for (const attempt of job.animationRepair!.attempts) await f.service.startAnimationAttempt(job, attempt.state, attempt.token);
  const before = JSON.parse(f.store.ledger.get("scheduler")!.value);
  const budget = f.store.ledger.get("budget")!.value;
  vi.stubEnv("PET_GENERATION_DRAIN", "true");
  await changeSchedulerState(f.store, {action: "limit", expectedRevision: before.revision, providerLimit: 11, now: f.clock.now, apply: true});
  const after = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(after.providerLimit).toBe(11); expect(after.providerSlots).toEqual(before.providerSlots);
  expect(after.providerSlots).toHaveLength(22); expect(f.store.ledger.get("budget")!.value).toBe(budget);
});

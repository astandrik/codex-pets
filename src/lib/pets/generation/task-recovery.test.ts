import {afterEach, expect, it, vi} from "vitest";
import {taskFixture} from "./task-pool.test-utils";
import {GenerationError, LEASE_MS, STAGE_NAMES} from "./model";
import {createSpriteGenerationWorker} from "./sprite-worker";

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it.each([true, false])("prefers the unresolved write over exhausted HTTP 520 retries; automatic repair=%s", async automaticRepair => {
  const f = await taskFixture(20, automaticRepair);
  const totalAttempts = automaticRepair ? 4 : 2;
  const id = f.jobs[0].id;
  f.saved(0, STAGE_NAMES.filter(name => name !== "idle" && name !== "waiting"));
  const row = f.store.ledger.get("scheduler")!;
  row.value = JSON.stringify({...JSON.parse(row.value), queue: [id]});
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementation(operation => transaction(tx => operation({...tx,
    putArtifact: async (jobId, kind, bytes, expiresAt) => {
      if (jobId === id && kind === "stage-waiting.png") throw Error("Synthetic checkpoint failure");
      return tx.putArtifact(jobId, kind, bytes, expiresAt);
    }})));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let started!: () => void, finishWaiting!: () => void;
  const waitingStarted = new Promise<void>(resolve => {started = resolve;});
  const waitingResult = new Promise<void>(resolve => {finishWaiting = resolve;});
  const calls: {stage: string; attempt?: number}[] = [];
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => {throw Error("Must not assemble");},
      generate: async (stage, context) => {
        calls.push({stage, attempt: context?.attempt});
        if (stage === "idle") throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});
        expect(stage).toBe("waiting");started();await waitingResult;
        return {bytes: Buffer.from("waiting image"), generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04}};
      }})}});
  expect(await run("idle-1")).toBe("yielded");
  const pending = run("waiting");
  await waitingStarted;
  const waitingToken = f.store.jobs.get(id)!.animationRepair?.attempts.find(a => a.state === "waiting")!.token;
  for (let attempt = 2; attempt <= totalAttempts; attempt++) {
    f.clock.now += 5000;
    expect(await run(`idle-${attempt}`)).toBe(attempt === totalAttempts ? "failed" : "yielded");
  }
  finishWaiting();expect(await pending).toBe("failed");
  expect(await run("finalizer")).toBe("failed");
  expect(await run("again")).toBe("idle");
  expect(calls.filter(call => call.stage === "idle").map(call => call.attempt)).toEqual(automaticRepair ? [1, 2, 3, 4] : [undefined, undefined]);
  expect(calls.filter(call => call.stage === "waiting")).toEqual([{stage: "waiting", attempt: automaticRepair ? 1 : undefined}]);
  expect(f.store.jobs.get(id)).toMatchObject({id, expiresAt: f.jobs[0].expiresAt, status: "failed", error: "outcome_unknown",
    failureDiagnostic: {boundary: "checkpoint", reason: "unconfirmed_write"},
    stageFailureDiagnostics: [
      {stage: "idle", diagnostic: {boundary: "provider_cli", reason: "process_exit"}},
      {stage: "waiting", diagnostic: {boundary: "checkpoint", reason: "unconfirmed_write"}},
    ]});
  if (automaticRepair) expect(f.store.jobs.get(id)!.animationRepair!.attempts.find(a => a.state === "waiting")).toMatchObject({token: waitingToken, ordinal: 1, status: "started"});
  expect(f.store.jobs.get(id)!.stages.filter(s => s.status === "completed")).toHaveLength(10);
  expect(f.store.jobs.size).toBe(3);
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent).toEqual({});
  expect(budget.reservations[id].unknown).toBe(true);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({pauseReason: "outcome_unknown", providerSlots: [{key: automaticRepair ? `attempt:${waitingToken}` : "stage:waiting", unknown: true}]});
  expect((await f.service.get(id)).error?.message).toContain("Saving the generation result");
});
it("keeps the primary checkpoint failure when an earlier sibling stops because of the pause", async () => {
  const f = await taskFixture(20, true);
  f.saved(0, STAGE_NAMES.filter(name => name !== "idle" && name !== "waiting"));
  const row = f.store.ledger.get("scheduler")!;
  row.value = JSON.stringify({...JSON.parse(row.value), queue: [f.jobs[0].id]});
  const idle = (await f.service.claim("idle"))!, waiting = (await f.service.claim("waiting"))!;
  expect(idle.workerTask?.stage).toBe("idle");
  expect(waiting.workerTask?.stage).toBe("waiting");
  await f.service.beginStage(waiting, "waiting");
  const token = f.store.jobs.get(waiting.id)!.animationRepair!.attempts.find(a => a.state === "waiting")!.token;
  await f.service.startAnimationAttempt(waiting, "waiting", token);
  await f.service.completeTask(waiting, {error: new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "checkpoint", reason: "unconfirmed_write"})});
  await f.service.completeTask(idle, {error: new GenerationError("generation_paused")});
  const {createSpriteGenerationWorker} = await import("./sprite-worker");
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    renderer: {open: async () => {throw Error("Must not call provider");}}});
  expect(await run("finalizer")).toBe("failed");
  expect(f.store.jobs.get(waiting.id)).toMatchObject({error: "outcome_unknown", failureDiagnostic: {boundary: "checkpoint", reason: "unconfirmed_write"},
    stageFailureDiagnostics: [{stage: "waiting", diagnostic: {boundary: "checkpoint", reason: "unconfirmed_write"}}]});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({pauseReason: "outcome_unknown", providerSlots: [{unknown: true}]});
});
it("reclaims an unsent task with the same operation but a new fenced lease",async()=>{
  const f=await taskFixture();
  const row=f.store.ledger.get("scheduler")!;
  row.value=JSON.stringify({...JSON.parse(row.value),queue:[f.jobs[0].id]});
  const first=(await f.service.claim("old"))!;
  const budget=f.store.ledger.get("budget")!.value;
  f.clock.now+=LEASE_MS+1;
  const next=(await f.service.claim("new"))!;
  expect(next.workerTask?.key).toBe(first.workerTask?.key);
  expect(next.workerLeaseId).not.toBe(first.workerLeaseId);
  expect(f.store.ledger.get("budget")!.value).toBe(budget);
  await expect(f.service.beginStage(first,"base")).rejects.toMatchObject({code:"stale_worker"});
});
it("retains dispatched permits and marks unknown expenses instead of replaying",async()=>{
  const f=await taskFixture();const first=(await f.service.claim("old"))!;
  await f.service.beginStage(first,"base");await f.service.authorizeStage(first,"base");
  f.clock.now+=LEASE_MS+1;
  expect(await f.service.claim("new")).toMatchObject({workerTask:{kind:"fail"}});
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state).toMatchObject({pauseReason:"outcome_unknown"});
  expect(state.providerSlots.find((s:{leaseId:string})=>s.leaseId===first.workerLeaseId)).toMatchObject({unknown:true});
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[first.id].unknown).toBe(true);
});
it("does not let one animation lease write another animation",async()=>{
  const f=await taskFixture();f.saved(0,["base"]);
  const state=f.store.ledger.get("scheduler")!;state.value=JSON.stringify({...JSON.parse(state.value),queue:[f.jobs[0].id]});
  const a=(await f.service.claim("a"))!,b=(await f.service.claim("b"))!;
  expect(a.id).toBe(b.id);expect(a.workerTask?.stage).not.toBe(b.workerTask?.stage);
  await expect(f.service.beginStage(a,b.workerTask!.stage!)).rejects.toMatchObject({code:"invalid_stage"});
  await f.service.beginStage(a,a.workerTask!.stage!);await f.service.beginStage(b,b.workerTask!.stage!);
  await f.service.heartbeat(a);await f.service.heartbeat(b);
  const saved=JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(saved.tasks.filter((t:{status:string})=>t.status==="running")).toHaveLength(2);
});
it("reports a lost dispatched task as failed while retaining the unknown permit",async()=>{
  const f=await taskFixture();
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[f.jobs[0].id]});
  const first=(await f.service.claim("dead"))!;
  await f.service.beginStage(first,"base");await f.service.authorizeStage(first,"base");
  f.clock.now+=LEASE_MS+1;
  const {createSpriteGenerationWorker}=await import("./sprite-worker");
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>{throw Error("Must not call provider");}}});
  expect(await run("recovery")).toBe("failed");
  expect(f.store.jobs.get(first.id)).toMatchObject({status:"failed",error:"outcome_unknown"});
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.providerSlots).toHaveLength(1);expect(state.providerSlots[0].unknown).toBe(true);
  expect(await run("again")).toBe("idle");
});
it("retains unknown spend when the parent expires during a dispatched call",async()=>{
  const f=await taskFixture();const first=(await f.service.claim("old"))!;
  await f.service.beginStage(first,"base");await f.service.authorizeStage(first,"base");
  f.clock.now=first.expiresAt+1;await f.store.cleanup(f.clock.now);
  await f.service.claim("after-expiry");
  const budget=JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.reservations[first.id]).toMatchObject({unknown:true});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots.find((s:{jobId:string})=>s.jobId===first.id)).toMatchObject({unknown:true});
});
it("does not erase a deferred task's wake time while reconciling the queue",async()=>{
  const f=await taskFixture();const row=f.store.ledger.get("scheduler")!;
  row.value=JSON.stringify({...JSON.parse(row.value),queue:[f.jobs[0].id]});
  const first=(await f.service.claim("first"))!;
  await f.service.completeTask(first,{eligibleAt:f.clock.now+5000});
  expect(await f.service.claim("early")).toBeNull();
  f.clock.now+=5000;
  expect((await f.service.claim("ready"))?.workerTask?.key).toBe(first.workerTask?.key);
});
it("binds the writable stage to the stored task rather than caller fields",async()=>{
  const f=await taskFixture();f.saved(0,["base"]);
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[f.jobs[0].id]});
  const a=(await f.service.claim("same"))!,b=(await f.service.claim("same"))!;
  const forged={...a,workerTask:{...a.workerTask!,stage:b.workerTask!.stage}};
  await expect(f.service.beginStage(forged,b.workerTask!.stage!)).rejects.toMatchObject({code:"stale_worker"});
  expect(f.store.jobs.get(a.id)?.stages.map(s=>s.name)).toEqual(["base"]);
});
it("rechecks the reduced limit before dispatching already claimed tasks",async()=>{
  const f=await taskFixture(20);const claimed=[];
  for(let i=0;i<3;i++){const job=(await f.service.claim(String(i)))!;await f.service.beginStage(job,"base");claimed.push(job);}
  const {changeSchedulerState}=await import("./scheduler-state");
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);
  vi.stubEnv("PET_GENERATION_DRAIN","true");
  await changeSchedulerState(f.store,{action:"limit",expectedRevision:state.revision,providerLimit:1,now:f.clock.now,apply:true});
  vi.stubEnv("PET_GENERATION_PROVIDER_CALLS","1");vi.stubEnv("PET_GENERATION_DRAIN","false");
  const outcomes=await Promise.allSettled(claimed.map(job=>f.service.authorizeStage(job,"base")));
  expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots.filter((s:{dispatched:boolean})=>s.dispatched)).toHaveLength(1);
});
it("holds an unsent claim when runtime and persisted limits no longer match",async()=>{
  const f=await taskFixture(20);const job=(await f.service.claim("old-config"))!;
  await f.service.beginStage(job,"base");
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),providerLimit:1});
  await expect(f.service.authorizeStage(job,"base")).rejects.toMatchObject({name:"WorkerYield"});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots[0].dispatched).toBe(false);
});

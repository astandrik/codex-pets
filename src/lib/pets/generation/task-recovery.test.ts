import {afterEach, expect, it, vi} from "vitest";
import {taskFixture} from "./task-pool.test-utils";
import {LEASE_MS} from "./model";

afterEach(()=>vi.unstubAllEnvs());
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

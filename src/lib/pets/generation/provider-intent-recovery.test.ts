import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {YdbError, StatusCode} from "@/lib/ydb/client";
import {attachResultJournal} from "./checkpoint-journal";
import {FileResultJournal} from "./result-journal";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {LEASE_MS, STAGE_NAMES} from "./model";
import {taskFixture} from "./task-pool.test-utils";
import {createWorkerContext, withWorkerContext, type WorkerContext} from "./worker-diagnostics";
import {runWorkerPool} from "./worker-runner";

class Aborted extends YdbError {static status = StatusCode.ABORTED;}
const folders: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) await rm(folder, {recursive:true, force:true});
});

async function fixture(kind: "animation" | "base") {
  const f = await taskFixture(20, true), id = f.jobs[0].id;
  if (kind === "animation") f.saved(0, STAGE_NAMES.filter(name => name !== "idle"));
  else f.store.jobs.set(id, {...f.jobs[0], reviewBase:true, baseRetrySourceId:"b".repeat(64), baseRepair:{policy:1, maxAttempts:4, phase:"active", attempts:[]}});
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...JSON.parse(f.store.ledger.get("scheduler")!.value), queue:[id]});
  const folder = await mkdtemp(path.join(tmpdir(), "provider-intent-")); folders.push(folder);
  const journal = await FileResultJournal.open(folder);
  function intercept(start: (run: () => Promise<unknown>) => Promise<unknown>) {
    if (kind === "animation") {
      const original = f.service.startAnimationAttempt.bind(f.service);
      f.service.startAnimationAttempt = (job, name, token) => start(() => original(job, name, token)) as ReturnType<typeof original>;
    } else {
      const original = f.service.startBaseAttempt.bind(f.service);
      f.service.startBaseAttempt = (job, token) => start(() => original(job, token)) as ReturnType<typeof original>;
    }
  }
  const generate = vi.fn(async () => ({bytes:Buffer.from("received image"), generationMs:1, usage:{textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:0.04}}));
  function worker(cleanup = async () => {}) {
    const service = attachResultJournal(f.service, f.store, {journal, now:()=>f.clock.now});
    return createSpriteGenerationWorker({service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({prepare:async()=>{},cleanup,compose:async()=>Buffer.from("atlas"),generate})}});
  }
  const current = () => f.store.jobs.get(id)!;
  const attempt = () => kind === "animation" ? current().animationRepair!.attempts.find(a=>a.state==="idle")! : current().baseRepair!.attempts[0];
  const scheduler = () => JSON.parse(f.store.ledger.get("scheduler")!.value);
  return {...f,id,journal,intercept,worker,generate,current,attempt,scheduler};
}

it.each(["animation", "base"] as const)("defers an aborted %s start with the same token, then charges one provider call", async kind => {
  const f = await fixture(kind); let first = true;
  f.intercept(async run => {if (first) {first=false; throw new Aborted("start transaction aborted");} return run();});
  const run = f.worker(), original = structuredClone(f.current());
  const originalBudget = f.store.ledger.get("budget")!.value;
  const events: {error:unknown;phase:WorkerContext["phase"]}[] = [];
  const context = createWorkerContext("first", (error,context)=>events.push({error,phase:context.phase}));
  expect(await withWorkerContext(context,()=>run("first",context))).toBe("yielded");
  const token = f.attempt().token;
  expect(f.attempt()).toMatchObject({ordinal:1,status:"reserved"});
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.scheduler().pauseReason).toBeUndefined();
  expect(f.store.ledger.get("budget")!.value).toBe(originalBudget);
  expect(events).toContainEqual({error:expect.any(Aborted),phase:"intent"});
  f.clock.now += 5001;
  expect(await run("replacement")).toBe("yielded");
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.attempt()).toMatchObject({token,ordinal:1,status:"saved"});
  expect(f.current()).toMatchObject({id:original.id,createdAt:original.createdAt,expiresAt:original.expiresAt});
  if (kind === "animation") for (const stage of original.stages) expect(f.current().stages).toContainEqual(stage);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(40000);
  expect(f.scheduler().pauseReason).toBeUndefined();
  expect(await f.journal.list()).toEqual([]);
});

it.each(["animation", "base"] as const)("reads back a committed %s start before making its one provider call", async kind => {
  const f = await fixture(kind);
  f.intercept(async run => {await run(); throw Error("start acknowledgement lost");});
  expect(await f.worker()("owner")).toBe("yielded");
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.attempt()).toMatchObject({ordinal:1,status:"saved"});
  expect(f.scheduler().pauseReason).toBeUndefined();
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(40000);
  expect(await f.journal.list()).toEqual([]);
});

it("keeps an ambiguous uncommitted start paused rather than assuming it rolled back", async () => {
  const f = await fixture("animation"); f.intercept(async()=>{throw Error("unknown start outcome");});
  const run = f.worker(); await run("owner"); await run("finalizer");
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.current()).toMatchObject({status:"failed",error:"outcome_unknown"});
  expect(f.attempt()).toMatchObject({ordinal:1,status:"reserved"});
  expect(f.scheduler().pauseReason).toBe("outcome_unknown");
});

it("retains the primary aborted start and secondary readback error without calling the provider", async () => {
  const f = await fixture("animation"), primary = new Aborted("start aborted"), secondary = Error("readback unavailable");
  f.intercept(async()=>{vi.spyOn(f.store,"transaction").mockRejectedValueOnce(secondary); throw primary;});
  const events: {error:unknown;secondary:boolean}[] = [];
  const run=f.worker(),context=createWorkerContext("owner",(error,_context,secondary)=>events.push({error,secondary}));
  await withWorkerContext(context,()=>run("owner",context));
  await run("finalizer");
  expect(events).toContainEqual({error:primary,secondary:false});
  expect(events).toContainEqual({error:secondary,secondary:true});
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.scheduler().pauseReason).toBe("outcome_unknown");
});

it("does not use a committed authorization after its lease expires",async()=>{
  const f=await fixture("animation");
  f.intercept(async run=>{await run();f.clock.now+=LEASE_MS+1;throw Error("lost acknowledgement");});
  await expect(f.worker()("expired-owner")).rejects.toMatchObject({code:"stale_worker"});
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.attempt()).toMatchObject({ordinal:1,status:"started"});
  expect(f.scheduler().providerSlots).toHaveLength(1);
});

it("does not call the provider when the lease expires during start readback",async()=>{
  const f=await fixture("animation");
  f.intercept(async run=>{
    await run();
    const transaction=f.store.transaction.bind(f.store);
    vi.spyOn(f.store,"transaction").mockImplementationOnce(async operation=>{
      const result=await transaction(operation);f.clock.now+=LEASE_MS+1;return result;
    });
    throw Error("lost acknowledgement");
  });
  await expect(f.worker()("expired-during-readback")).rejects.toMatchObject({code:"stale_worker"});
  expect(f.generate).not.toHaveBeenCalled();
});

it("preserves a completed sibling while returning the aborted stage to the queue",async()=>{
  const f=await fixture("animation");let first=true;
  f.current().stages=f.current().stages.filter(s=>s.name!=="running");
  f.store.artifacts.delete(f.id+":stage-running.png");
  const start=f.service.startAnimationAttempt.bind(f.service);
  f.service.startAnimationAttempt=async(job,name,token)=>{
    if(name==="idle"&&first){first=false;throw new Aborted("start aborted");}
    return start(job,name,token);
  };
  const run=f.worker();
  expect(await Promise.all([run("first"),run("second")])).toEqual(["yielded","yielded"]);
  expect(f.generate).toHaveBeenCalledTimes(1);
  const sibling=f.current().stages.find(s=>s.name==="running")!;
  expect({status:sibling.status,calls:f.generate.mock.calls}).toEqual({status:"completed",calls:[["running",{attempt:1}]]});
  const token=f.attempt().token;f.clock.now+=5001;
  await run("retry");
  expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.current().stages).toContainEqual(sibling);
  expect(f.attempt()).toMatchObject({token,ordinal:1,status:"saved"});
  expect(f.scheduler().pauseReason).toBeUndefined();
});

it("does not use an authorization whose slot was marked unknown",async()=>{
  const f=await fixture("animation");
  f.intercept(async run=>{
    await run();
    await f.store.transaction(async tx=>{
      const state=JSON.parse((await tx.getLedger("scheduler",f.clock.now))!);
      state.providerSlots[0].unknown=true;
      await tx.putLedger("scheduler",JSON.stringify(state),f.clock.now+86400000);
    });
    throw Error("acknowledgement lost");
  });
  const run=f.worker();await run("owner");await run("finalizer");
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.scheduler().providerSlots).toHaveLength(1);
  expect(f.scheduler().providerSlots[0].unknown).toBe(true);
  expect(f.scheduler().pauseReason).toBe("outcome_unknown");
});

it("does not clear another job's unknown slot when deferring a known aborted start",async()=>{
  const f=await fixture("animation");
  const old={jobId:f.jobs[1].id,owner:"old-owner",leaseId:"old-lease",key:"attempt:old",startedAt:f.clock.now-1000,dispatched:true,unknown:true};
  f.store.ledger.get("scheduler")!.value=JSON.stringify({...f.scheduler(),providerSlots:[old]});
  f.intercept(async()=>{throw new Aborted("start aborted");});
  expect(await f.worker()("owner")).toBe("yielded");
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.scheduler().providerSlots).toEqual([old]);
  expect(f.scheduler().pauseReason).toBeUndefined();
});

it("reports a cleanup failure after the start conflict was safely deferred",async()=>{
  const f=await fixture("animation"),primary=new Aborted("start aborted"),cleanup=Error("cleanup failed");
  f.intercept(async()=>{throw primary;});
  const events:{error:unknown;phase:WorkerContext["phase"]}[]=[];
  await runWorkerPool({maxActiveJobs:1,once:true,signal:new AbortController().signal,
    runOnce:f.worker(async()=>{throw cleanup;}),
    onError:(error,context)=>events.push({error,phase:context.phase})});
  expect(events).toEqual([{error:primary,phase:"intent"},{error:cleanup,phase:"workspace_cleanup"}]);
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.scheduler().pauseReason).toBeUndefined();
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGenerationService } from "./service";
import { MemoryStore } from "./test-store";
import { LEASE_MS } from "./model";

const usage = { textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: 0.04 };
async function fixture(budgetUsd = 50) {
  const store = new MemoryStore(); const config = { now: Date.parse("2026-10-12T08:00:00Z"), enabled: true };
  const service = createGenerationService(store, { now: () => config.now, enabled: () => config.enabled, secret: () => "parallel-test-secret-at-least-32-characters", budgetUsd: () => budgetUsd });
  await service.generate({ requestId: randomUUID(), prompt: "Synthetic pet" }, "203.0.113.12");
  const job = (await service.claim("owner"))!;
  await service.beginStage(job, "base");
  await service.saveStage(job, "base", Buffer.from("base"), { usage, generationMs: 1 });
  return { store, config, service, job };
}
const scheduler = (f: Awaited<ReturnType<typeof fixture>>) => JSON.parse(f.store.ledger.get("scheduler")!.value);

describe("durable pairs of rows", () => {
  it("records both intents atomically and keeps a sibling inflight after reverse completion", async () => {
    const f = await fixture();
    await f.service.beginStages(f.job, ["idle", "running"]);
    expect((await f.store.readJob(f.job.id))?.stages.slice(1).map(x => [x.name,x.status])).toEqual([["idle","inflight"],["running","inflight"]]);
    await expect(f.service.beginStages(f.job,["running-left","running-right"])).rejects.toMatchObject({code:"invalid_stage"});
    await f.service.saveStage(f.job,"running",Buffer.from("running"),{usage,generationMs:2});
    expect(scheduler(f).active.inflight).toBe(true);
    await expect(f.service.saveSource(f.job,Buffer.from("premature"),{generationMs:0})).rejects.toMatchObject({code:"invalid_stage"});
    await f.service.saveStage(f.job,"idle",Buffer.from("idle"),{usage,generationMs:3});
    expect(scheduler(f).active.inflight).toBe(false);
    expect((await f.store.readJob(f.job.id))?.stages.map(x=>x.name)).toEqual(["base","idle","running"]);
    const budget=JSON.parse(f.store.ledger.get("budget")!.value);
    expect(budget.spent["2026-10-12"]).toBe(120000);
    expect(budget.reservations[f.job.id].remainingMicroUsd).toBe(0);
  });
  it("fences the owner before each paid call and honors disable and budget checks", async () => {
    const f=await fixture();await f.service.beginStages(f.job,["idle","running"]);
    await expect(f.service.authorizeStage(f.job,"idle")).resolves.toBeUndefined();
    await expect(f.service.authorizeStage({...f.job,worker:"other"},"idle")).rejects.toMatchObject({code:"stale_worker"});
    await expect(f.service.authorizeStage(f.job,"jumping")).rejects.toMatchObject({code:"invalid_stage"});
    f.config.enabled=false;await expect(f.service.authorizeStage(f.job,"running")).rejects.toMatchObject({code:"generation_disabled"});
    f.config.enabled=true;const budget=JSON.parse(f.store.ledger.get('budget')!.value);budget.spent['2026-10-12']=50_000_001;
    f.store.ledger.set('budget',{value:JSON.stringify(budget),expiresAt:Date.UTC(2099,0)});
    await expect(f.service.authorizeStage(f.job,"idle")).rejects.toMatchObject({code:"budget_exhausted"});
  });
  it("preserves the unresolved sibling and unknown accounting on lease takeover instead of repaying",async()=>{
    const f=await fixture();await f.service.beginStages(f.job,["idle","running"]);
    await f.service.saveStage(f.job,"running",Buffer.from("running"),{usage,generationMs:2});
    f.config.now+=LEASE_MS+1;
    expect(await f.service.claim("replacement")).toBeNull();
    expect(await f.service.get(f.job.id)).toMatchObject({status:"failed",error:{code:"outcome_unknown"}});
    expect(await f.store.readArtifact(f.job.id,"stage-running.png",f.config.now)).toEqual(Buffer.from("running"));
    expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.job.id]).toMatchObject({unknown:true,remainingMicroUsd:0});
    expect(scheduler(f).pauseReason).toBe("outcome_unknown");
  });
  it("rejects skipped, repeated or oversized batches without leaving intents",async()=>{
    const f=await fixture();
    for(const names of [[],["base"],["running"],["idle","idle"],["idle","running","running-left","running-right","waving","jumping","waiting","failed","review","look-0-157","look-180-337","idle"]] as const){
      await expect(f.service.beginStages(f.job,[...names])).rejects.toBeDefined();
      expect((await f.store.readJob(f.job.id))?.stages).toHaveLength(1);
    }
  });
  it("records actual costs while retaining unknown accounting without monetary holds",async()=>{
    const f=await fixture();await f.service.beginStages(f.job,["idle","running"]);
    let budget=JSON.parse(f.store.ledger.get('budget')!.value);
    expect(budget.reservations[f.job.id].inflight).toBeUndefined();
    await f.service.saveStage(f.job,"idle",Buffer.from("idle"),{usage:{...usage,costUsd:1.96},generationMs:1});
    budget=JSON.parse(f.store.ledger.get('budget')!.value);
    expect(budget.reservations[f.job.id].remainingMicroUsd).toBe(0);
    expect(budget.reservations[f.job.id].inflight).toBeUndefined();
    await f.service.fail(f.job,"outcome_unknown");f.config.now+=86400000;
    await f.store.cleanup(f.config.now);
    budget=JSON.parse(f.store.ledger.get('budget')!.value);
    expect(budget.reservations[f.job.id]).toEqual({remainingMicroUsd:0,unknown:true});
  });

  it("admits another task without withholding funds while retaining the active owner",async()=>{
    const f=await fixture(6);await f.service.beginStages(f.job,["idle","running"]);
    const input=()=>({requestId:randomUUID(),prompt:"Another synthetic task"});
    await f.service.generate(input(),"203.0.113.13");
    expect(f.store.jobs.size).toBe(2);
    await f.service.saveStage(f.job,"idle",Buffer.from("idle"),{usage,generationMs:1});
    await f.service.generate(input(),"203.0.113.13");
    const budget=JSON.parse(f.store.ledger.get('budget')!.value);
    expect(budget.reservations[f.job.id].inflight).toBeUndefined();
    expect(await f.service.claim("second-worker")).toBeNull();
  });

});

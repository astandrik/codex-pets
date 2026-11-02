import {afterEach, expect, it, vi} from "vitest";
import {taskFixture} from "./task-pool.test-utils";
import {STAGE_NAMES} from "./model";
import {runWorkerPool} from "./worker-runner";
import {createSpriteGenerationWorker} from "./sprite-worker";

afterEach(() => vi.unstubAllEnvs());
it("starts the 15 real stage handlers before any provider response completes", async () => {
  const f = await taskFixture(); f.saved(0, STAGE_NAMES.slice(0,9)); f.saved(2,["base"]);
  const calls: {id:string; name:string}[] = [];
  let release!: () => void;
  const barrier = new Promise<void>(resolve => {release=resolve;});
  const run = createSpriteGenerationWorker({service:f.service, store:f.store, now:()=>f.clock.now,
    renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),
      generate:async name=>{calls.push({id:job.id,name});await barrier;return {bytes:Buffer.from(name),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}};}})},
    build:async()=>({"pet.zip":Buffer.from("zip")})});
  const controller=new AbortController();
  const pending=runWorkerPool({maxActiveJobs:20,signal:controller.signal,runOnce:async owner=>{const result=await run(owner);f.clock.now+=250;return result;},delay:async()=>50});
  try {
    await vi.waitFor(()=>expect(calls).toHaveLength(15),{timeout:1500,interval:10});
    expect(f.jobs.map(j=>calls.filter(c=>c.id===j.id).length)).toEqual([3,1,11]);
    expect(new Set(calls.map(c=>`${c.id}:${c.name}`)).size).toBe(15);
  } finally {controller.abort();release();await pending;}
});

it("preserves every sibling result and schedules exactly one assembly per parent", async()=>{
  const f=await taskFixture();f.saved(0,STAGE_NAMES.slice(0,9));f.saved(2,["base"]);
  const calls:string[]=[];const assemblies:string[]=[];
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>{assemblies.push(job.id);return Buffer.from("atlas");},
      generate:async name=>{calls.push(`${job.id}:${name}`);return {bytes:Buffer.from(name),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}};}})},
    build:async()=>({"pet.zip":Buffer.from("zip")})});
  for(let i=0;i<80&&!f.jobs.every(j=>f.store.jobs.get(j.id)?.status==="completed");i++){
    await Promise.all(Array.from({length:20},(_,n)=>run(`pool-${n}`)));f.clock.now+=5000;
  }
  expect(f.jobs.map(j=>f.store.jobs.get(j.id)?.status)).toEqual(["completed","completed","completed"]);
  expect(f.jobs.map(j=>f.store.jobs.get(j.id)?.stages.length)).toEqual([12,12,12]);
  expect(calls).toHaveLength(26);expect(new Set(calls).size).toBe(26);
  expect(assemblies.sort()).toEqual(f.jobs.map(j=>j.id).sort());
  const budget=JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent["2026-11-01"]).toBe(260000);
  expect(budget.reservations).toEqual({});
});

it("retries only the failed animation four times while other parents finish",async()=>{
  const f=await taskFixture(20,true);const calls:{id:string;name:string;attempt:number|undefined}[]=[];
  const {GenerationError}=await import("./model");
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),
      generate:async(name,context)=>{calls.push({id:job.id,name,attempt:context?.attempt});
        if(job.id===f.jobs[0].id&&name==="failed")throw new GenerationError("provider_rejected",undefined,{httpStatus:400,code:"moderation_blocked",moderationStage:"output"},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:400});
        return {bytes:Buffer.from(name),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}};}})},
    build:async()=>({"pet.zip":Buffer.from("zip")})});
  for(let i=0;i<100&&!f.jobs.every(j=>["completed","failed"].includes(f.store.jobs.get(j.id)!.status));i++){
    await Promise.all(Array.from({length:20},(_,n)=>run(`pool-${n}`)));f.clock.now+=5000;
  }
  expect(f.jobs.map(j=>f.store.jobs.get(j.id)?.status)).toEqual(["failed","completed","completed"]);
  expect(calls.filter(c=>c.id===f.jobs[0].id&&c.name==="failed").map(c=>c.attempt)).toEqual([1,2,3,4]);
  for(const name of STAGE_NAMES.filter(n=>n!=="failed"))expect(calls.filter(c=>c.id===f.jobs[0].id&&c.name===name)).toHaveLength(1);
  const budget=JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent["2026-11-01"]).toBe(350000);
  expect(budget.reservations[f.jobs[0].id].unknown).toBe(true);
  expect(f.store.jobs.get(f.jobs[0].id)?.stageFailureDiagnostics).toEqual([{stage:"failed",diagnostic:{boundary:"provider_cli",reason:"process_exit"}}]);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({providerSlots:[]});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});

it("keeps configured base retries in the same parent and still waits for approval",async()=>{
  const f=await taskFixture();
  const first=f.store.jobs.get(f.jobs[0].id)!;
  first.reviewBase=true;first.baseRetrySourceId="f".repeat(64);
  first.baseRepair={policy:1,maxAttempts:4,phase:"active",attempts:[]};
  const {GenerationError}=await import("./model");let baseCalls=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),
      generate:async name=>{if(job.id===first.id){expect(name).toBe("base");baseCalls++;if(baseCalls<4)throw new GenerationError("provider_rejected",undefined,{httpStatus:400,code:"moderation_blocked",moderationStage:"output"},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:400});}
        return {bytes:Buffer.from(name),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}};}})},build:async()=>({"pet.zip":Buffer.from("zip")})});
  for(let i=0;i<100&&f.store.jobs.get(first.id)?.status!=="awaiting_confirmation";i++){
    await Promise.all(Array.from({length:20},(_,n)=>run(`base-${n}`)));f.clock.now+=5000;
  }
  expect(f.store.jobs.get(first.id)).toMatchObject({status:"awaiting_confirmation",expiresAt:first.expiresAt,baseRepair:{maxAttempts:4,phase:"complete"}});
  expect(baseCalls).toBe(4);
  expect(f.store.jobs.get(first.id)?.stages.map(s=>s.name)).toEqual(["base"]);
});

it("counts metadata in the same pool and builds only after metadata completes",async()=>{
  const f=await taskFixture(1);
  const target=f.store.jobs.get(f.jobs[0].id)!;target.cardMetadata={policy:1,state:"pending",revision:0,edited:false};
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[target.id]});
  const order:string[]=[];const {buildCardMetadataRequest}=await import("./card-provider");
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    cardProvider:{prepare:async job=>buildCardMetadataRequest(job,Array(4).fill("data:image/png;base64,YQ==")),
      generate:async()=>{order.push("metadata");expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toHaveLength(1);
        return {fields:{displayName:"Test",description:"Synthetic pet",tags:["a","b","c"]},responseHash:"a".repeat(64),inputTokens:1,outputTokens:1,costUsd:.002};}},
    renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>{order.push("compose");return Buffer.from("atlas");},
      generate:async name=>({bytes:Buffer.from(name),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}})})},
    build:async job=>{expect(job.cardMetadata?.state).toBe("completed");order.push("package");return {"pet.zip":Buffer.from("zip")};}});
  for(let i=0;i<30&&f.store.jobs.get(target.id)?.status!=="completed";i++){await run("only");f.clock.now+=5000;}
  expect(f.store.jobs.get(target.id)?.status).toBe("completed");expect(order).toEqual(["compose","metadata","package"]);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(122000);
});

it("keeps the accepted metadata after a lost write acknowledgement without paying twice",async()=>{
  const f=await taskFixture(1);f.saved(0,STAGE_NAMES);
  const target=f.store.jobs.get(f.jobs[0].id)!;target.status="processing";target.cardMetadata={policy:1,state:"pending",revision:0,edited:false};
  f.store.artifacts.set(`${target.id}:source.png`,{bytes:Buffer.from("atlas"),expiresAt:target.expiresAt});
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[target.id]});
  const {buildCardMetadataRequest}=await import("./card-provider");let calls=0;
  const save=f.service.saveCardMetadata;
  vi.spyOn(f.service,"saveCardMetadata").mockImplementationOnce(async(...args)=>{await save(...args);throw Error("lost ACK");});
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    cardProvider:{prepare:async job=>buildCardMetadataRequest(job,Array(4).fill("data:image/png;base64,YQ==")),generate:async()=>{
      calls++;return {fields:{displayName:"Test",description:"Synthetic pet",tags:["a","b","c"]},responseHash:"a".repeat(64),inputTokens:1,outputTokens:1,costUsd:.002};}},
    renderer:{open:async()=>{throw Error("not needed");}},build:async()=>({"pet.zip":Buffer.from("zip")})});
  for(let i=0;i<5&&f.store.jobs.get(target.id)?.status!=="completed";i++){await run("worker");f.clock.now+=5000;}
  expect(f.store.jobs.get(target.id)?.status).toBe("completed");expect(calls).toBe(1);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(2000);
});

it("returns an authorized but unsent task on shutdown without creating another request",async()=>{
  const f=await taskFixture(1);const target=f.jobs[0];
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[target.id]});
  let stopped=false,calls=0;const authorize=f.service.authorizeStage;
  vi.spyOn(f.service,"authorizeStage").mockImplementationOnce(async(...args)=>{await authorize(...args);stopped=true;});
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,stopping:()=>stopped,
    renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),generate:async name=>{calls++;return {bytes:Buffer.from(name),generationMs:1};}})},
    build:async()=>({"pet.zip":Buffer.from("zip")})});
  expect(await run("stopping")).toBe("yielded");expect(calls).toBe(0);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toEqual([]);
  const ledgerKeys=[...f.store.ledger.keys()].filter(key=>!key.startsWith("generation-results:")).sort();stopped=false;
  expect(await run("resumed")).toBe("yielded");expect(calls).toBe(1);
  expect([...f.store.ledger.keys()].filter(key=>!key.startsWith("generation-results:")).sort()).toEqual(ledgerKeys);
  expect(f.store.jobs.get(target.id)).toMatchObject({id:target.id,expiresAt:target.expiresAt});
});

it("recovers local packaging failure without repeating images or marking unknown spending",async()=>{
  const f=await taskFixture(1);f.saved(0,STAGE_NAMES);
  const target=f.store.jobs.get(f.jobs[0].id)!;target.status="processing";
  f.store.artifacts.set(`${target.id}:source.png`,{bytes:Buffer.from("atlas"),expiresAt:target.expiresAt});
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[target.id]});
  let builds=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:{open:async()=>{throw Error("Must not regenerate images");}},
    build:async()=>{if(++builds===1)throw Error("temporary local IO");return {"pet.zip":Buffer.from("zip")};}});
  expect(await run("first")).toBe("yielded");f.clock.now+=5000;
  expect(await run("second")).toBe("completed");
  expect(f.store.jobs.get(target.id)?.status).toBe("completed");
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.pauseReason).toBeUndefined();expect(state.heavy).toBeNull();
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[target.id]).toBeUndefined();
});

it("requeues an unacknowledged pre-dispatch failure without spending or changing identity",async()=>{
  const f=await taskFixture(1);const target=f.jobs[0];
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[target.id]});
  vi.spyOn(f.service,"beginStage").mockRejectedValueOnce(Error("temporary database failure"));let calls=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),generate:async name=>{calls++;return {bytes:Buffer.from(name),generationMs:1};}})},build:async()=>({})});
  expect(await run("first")).toBe("yielded");expect(calls).toBe(0);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[target.id].unknown).toBe(false);
  f.clock.now+=5000;expect(await run("next")).toBe("yielded");expect(calls).toBe(1);
  expect(f.store.jobs.get(target.id)).toMatchObject({id:target.id,expiresAt:target.expiresAt});
});
it("packages a saved atlas after uncertain metadata without retrying or freeing its unknown permit",async()=>{
  const f=await taskFixture(1);f.saved(0,STAGE_NAMES);
  const target=f.store.jobs.get(f.jobs[0].id)!;target.status="processing";target.cardMetadata={policy:1,state:"pending",revision:0,edited:false};
  f.store.artifacts.set(`${target.id}:source.png`,{bytes:Buffer.from("atlas"),expiresAt:target.expiresAt});
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[target.id]});
  const {buildCardMetadataRequest}=await import("./card-provider");const {GenerationError}=await import("./model");let calls=0,packages=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    cardProvider:{prepare:async job=>buildCardMetadataRequest(job,Array(4).fill("data:image/png;base64,YQ==")),generate:async()=>{calls++;throw new GenerationError("outcome_unknown");}},
    renderer:{open:async()=>{throw Error("No image regeneration");}},build:async()=>{packages++;return {"pet.zip":Buffer.from("zip")};}});
  for(let i=0;i<5&&f.store.jobs.get(target.id)?.status!=="completed";i++){await run("worker");f.clock.now+=250;}
  expect(f.store.jobs.get(target.id)).toMatchObject({status:"completed",cardMetadata:{state:"failed",error:"outcome_unknown"}});
  expect(calls).toBe(1);expect(packages).toBe(1);
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.pauseReason).toBe("outcome_unknown");expect(state.providerSlots).toHaveLength(1);expect(state.providerSlots[0].unknown).toBe(true);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[target.id].unknown).toBe(true);
});
it("packages the saved atlas when the budget blocks optional metadata",async()=>{
  const f=await taskFixture(1, false, 50);f.saved(0,STAGE_NAMES);
  const target=f.store.jobs.get(f.jobs[0].id)!;target.status="processing";target.cardMetadata={policy:1,state:"pending",revision:0,edited:false};
  f.store.artifacts.set(`${target.id}:source.png`,{bytes:Buffer.from("atlas"),expiresAt:target.expiresAt});
  const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[target.id]});
  const budget=f.store.ledger.get("budget")!;budget.value=JSON.stringify({...JSON.parse(budget.value),spent:{"2026-11-01":50_000_000}});
  const {buildCardMetadataRequest}=await import("./card-provider");let calls=0,packages=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    cardProvider:{prepare:async job=>buildCardMetadataRequest(job,Array(4).fill("data:image/png;base64,YQ==")),generate:async()=>{calls++;throw Error("No budget for metadata");}},
    renderer:{open:async()=>{throw Error("No image regeneration");}},build:async()=>{packages++;return {"pet.zip":Buffer.from("zip")};}});
  for(let i=0;i<5&&f.store.jobs.get(target.id)?.status!=="completed";i++){await run("worker");f.clock.now+=250;}
  expect(f.store.jobs.get(target.id)).toMatchObject({status:"completed",cardMetadata:{state:"failed",error:"budget_exhausted"}});
  expect(calls).toBe(0);expect(packages).toBe(1);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(50_000_000);
});

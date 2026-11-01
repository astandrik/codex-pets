import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {createGenerationWorker} from "./worker";
import {buildCardMetadataRequest} from "./card-provider";
import {GenerationError, LEASE_MS, type GenerationJob} from "./model";
import {MemoryStore} from "./test-store";
import {generateRepairAnimation} from "./animation-repair-worker";
import type {CliCause} from "./cli-cause";

const initial = Date.parse("2026-11-01T10:00:00Z");
const usage = {textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.01};
const input = () => ({requestId:randomUUID(),prompt:"Synthetic late-result test"});
function fixture(repair=false,card=false) {
  const store=new MemoryStore(), clock={now:initial};
  const service=createGenerationService(store,{enabled:()=>true,secret:()=>"late-result-test-secret",now:()=>clock.now,automaticAnimationRepair:()=>repair,automaticCardMetadata:()=>card});
  const state=()=>JSON.parse(store.ledger.get("scheduler")!.value);
  const budget=()=>JSON.parse(store.ledger.get("budget")!.value);
  return {store,clock,service,state,budget};
}
type Fixture = ReturnType<typeof fixture>;
function worker(f:Fixture,generate:(name:string,job:GenerationJob)=>Promise<{bytes:Buffer;generationMs:number;usage?:typeof usage}>, card?:Parameters<typeof createSpriteGenerationWorker>[0]["cardProvider"]) {
  return createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,cardProvider:card,wait:async ms=>{f.clock.now+=ms;},
    renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),generate:name=>generate(name,job)})},
    build:async()=>({"pet.zip":Buffer.from("zip")})});
}
afterEach(()=>vi.restoreAllMocks());

const capturedFailure = (cause:CliCause) => new GenerationError("outcome_unknown",undefined,undefined,undefined,
  {boundary:"provider_cli",reason:"process_exit",exitCode:1},cause);

it("preserves an unknown result when expiry prevents the first row retry",async()=>{
  const f=fixture(), request=input(), old=await f.service.generate(request,"203.0.113.1");
  f.clock.now=Date.parse(old.expiresAt)-10;
  const next=await f.service.generate(input(),"203.0.113.2");
  let calls=0;
  const run=worker(f,async()=>{calls++;f.clock.now+=20;throw capturedFailure({kind:"remote_disconnected"});});
  expect(await run("owner")).toBe("failed");
  expect(f.state()).toMatchObject({active:null,pauseReason:"outcome_unknown"});
  expect(f.budget().reservations[old.generationId]).toEqual({remainingMicroUsd:0,unknown:true});
  expect(await run("next-owner")).toBe("idle");expect(calls).toBe(1);
  expect((await f.service.get(next.generationId)).status).toBe("queued");
  await expect(f.service.generate(request,"203.0.113.1")).rejects.toMatchObject({code:"generation_expired"});
  expect(f.store.jobs.size).toBe(2);
});

it.each([false,true].flatMap(removed=>([{kind:"remote_disconnected"},{kind:"incomplete_response"},
  {kind:"http_error",httpStatus:500},{kind:"http_error",httpStatus:520}] satisfies CliCause[]).map(cause=>({cause,removed}))))(
  "isolates the last captured $cause.kind $cause.httpStatus failure after expiry, removed=$removed",async({cause,removed})=>{
    const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");
    f.clock.now=Date.parse(old.expiresAt)-5010;
    const next=await f.service.generate(input(),"203.0.113.2");
    let calls=0;
    const run=worker(f,async(name,job)=>{
      if(job.id===old.generationId){if(++calls===2){f.clock.now+=20;if(removed)await f.store.cleanup(f.clock.now);}throw capturedFailure(cause);}
      return{bytes:Buffer.from(name),generationMs:1,usage};
    });
    expect(await run("owner")).toBe("failed");expect(calls).toBe(2);
    expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
    expect(f.budget().reservations[old.generationId]).toEqual({remainingMicroUsd:0,unknown:true});
    expect(await f.store.readArtifact(old.generationId,"stage-base.png",f.clock.now)).toBeNull();
    if(removed)expect(f.store.jobs.has(old.generationId)).toBe(false);
    expect(await run("next-owner")).toBe("completed");
    expect((await f.service.get(next.generationId)).status).toBe("completed");
  });

it.each(["waiting","authorized"])("preserves unknown outcome when expiry crosses retry %s",async phase=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");
  f.clock.now=Date.parse(old.expiresAt)-5010;
  if(phase==="waiting"){
    const begin=f.service.beginRowRetry;
    vi.spyOn(f.service,"beginRowRetry").mockImplementationOnce(async(...args)=>{const retry=await begin(...args);f.clock.now+=5020;return retry;});
  }else{
    const authorize=f.service.authorizeRowRetry;
    vi.spyOn(f.service,"authorizeRowRetry").mockImplementationOnce(async(...args)=>{await authorize(...args);f.clock.now+=20;});
  }
  let calls=0;
  const run=worker(f,async()=>{calls++;throw capturedFailure({kind:"http_error",httpStatus:520});});
  expect(await run("owner")).toBe("failed");expect(calls).toBe(1);
  expect(f.state()).toMatchObject({active:null,pauseReason:"outcome_unknown"});
  expect(f.budget().reservations[old.generationId].unknown).toBe(true);
});

it.each([false,true])("isolates the fourth recorded repair failure after expiry, removed=%s",async removed=>{
  const f=fixture(true), old=await f.service.generate(input(),"203.0.113.1");
  f.clock.now=Date.parse(old.expiresAt)-15010;
  const next=await f.service.generate(input(),"203.0.113.2");
  let calls=0;
  const run=worker(f,async(name,job)=>{
    if(job.id===old.generationId&&name==="waving"){
      if(++calls===4){f.clock.now+=20;if(removed)await f.store.cleanup(f.clock.now);}
      throw capturedFailure({kind:"http_error",httpStatus:520});
    }
    return{bytes:Buffer.from(name),generationMs:1,usage};
  });
  expect(await run("owner")).toBe("failed");expect(calls).toBe(4);
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
  expect(f.budget().reservations[old.generationId].unknown).toBe(true);
  expect(await run("next-owner")).toBe("completed");
  expect((await f.service.get(next.generationId)).status).toBe("completed");
});

it("keeps a late terminal repair paused when its failure receipt cannot be confirmed",async()=>{
  const f=fixture(true), old=await f.service.generate(input(),"203.0.113.1");
  f.clock.now=Date.parse(old.expiresAt)-15010;
  const transaction=f.store.transaction.bind(f.store);let writes=2,calls=0;
  vi.spyOn(f.store,"transaction").mockImplementation(op=>transaction(tx=>op({...tx,getLedger:async(key,now)=>{
    if(writes&&f.clock.now>=Date.parse(old.expiresAt)&&key.startsWith("generation-results:")){
      writes--;throw Error("failure receipt unavailable");
    }
    return tx.getLedger(key,now);
  }})));
  const run=worker(f,async name=>{
    if(name==="waving"){
      if(++calls===4)f.clock.now+=20;
      throw capturedFailure({kind:"http_error",httpStatus:520});
    }
    return{bytes:Buffer.from(name),generationMs:1,usage};
  });
  expect(await run("owner")).toBe("failed");expect(calls).toBe(4);expect(writes).toBe(0);
  expect(f.state()).toMatchObject({active:null,pauseReason:"outcome_unknown"});
  expect(f.budget().reservations[old.generationId].unknown).toBe(true);
});

it("does not let a terminal repair hide an expired first attempt in another animation",async()=>{
  const f=fixture(true), old=await f.service.generate(input(),"203.0.113.1");
  f.clock.now=Date.parse(old.expiresAt)-15010;
  let release!:()=>void,waving=0,failed=0;
  const terminal=new Promise<void>(resolve=>{release=resolve;});
  const run=worker(f,async name=>{
    if(name==="waving"){
      if(++waving===4){f.clock.now+=20;release();}
      throw capturedFailure({kind:"http_error",httpStatus:520});
    }
    if(name==="failed"){failed++;await terminal;throw capturedFailure({kind:"remote_disconnected"});}
    return{bytes:Buffer.from(name),generationMs:1,usage};
  });
  expect(await run("owner")).toBe("failed");expect(waving).toBe(4);expect(failed).toBe(1);
  expect(f.state()).toMatchObject({active:null,pauseReason:"outcome_unknown"});
  expect(f.budget().reservations[old.generationId].unknown).toBe(true);
});

it("does not let an exhausted sibling hide an unfinished retry with the same provider error",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");
  f.clock.now=Date.parse(old.expiresAt)-5010;
  const failure=capturedFailure({kind:"http_error",httpStatus:520});
  let release!:()=>void,waving=0,failed=0;
  const terminal=new Promise<void>(resolve=>{release=resolve;});
  const run=worker(f,async name=>{
    if(name==="waving"){
      if(++waving===2){f.clock.now+=20;release();}
      throw failure;
    }
    if(name==="failed"){failed++;await terminal;throw failure;}
    return{bytes:Buffer.from(name),generationMs:1,usage};
  });
  expect(await run("owner")).toBe("failed");expect(waving).toBe(2);expect(failed).toBe(1);
  expect(f.state()).toMatchObject({active:null,pauseReason:"outcome_unknown"});
  expect(f.budget().reservations[old.generationId].unknown).toBe(true);
});

it.each([false,true])("retains missing usage for a late single-image response, physically removed=%s",async removed=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");
  f.store.jobs.get(old.generationId)!.pipelineVersion=1;f.clock.now=Date.parse(old.expiresAt)-10;
  let calls=0,original:GenerationJob|undefined;
  const run=createGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    generate:async job=>{original=job;calls++;f.clock.now+=20;if(removed)await f.store.cleanup(f.clock.now);return{bytes:Buffer.from("legacy"),generationMs:20};}});
  expect(await run("owner")).toBe("failed");expect(calls).toBe(1);
  expect(f.budget().reservations[old.generationId]).toEqual({remainingMicroUsd:0,unknown:true});
  expect(f.budget().spent).toEqual({});
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
  expect(await f.store.readArtifact(old.generationId,"source.png",f.clock.now)).toBeNull();
  const ledger=structuredClone([...f.store.ledger]);
  await expect(f.service.saveSource(original!,Buffer.from("legacy"),{generationMs:20})).rejects.toMatchObject({code:"generation_expired"});
  expect([...f.store.ledger]).toEqual(ledger);
});

it.each([false,true])("accounts a known late base response and immediately releases fresh work, physically removed=%s",async removed=>{
  const f=fixture(), request=input(), old=await f.service.generate(request,"203.0.113.1");
  f.clock.now=Date.parse(old.expiresAt)-10;
  const fresh=await f.service.generate(input(),"203.0.113.2");
  const calls:string[]=[];
  const run=worker(f,async(name,job)=>{
    calls.push(job.id+":"+name);
    if(job.id===old.generationId){f.clock.now+=20;if(removed)await f.store.cleanup(f.clock.now);}
    return{bytes:Buffer.from(name),generationMs:20,usage};
  });
  expect(await run("owner")).toBe("failed");
  expect(f.budget().spent).toEqual({"2026-11-02":10000});
  expect(f.state()).toMatchObject({active:null});expect(f.state().pauseReason).toBeUndefined();
  expect(await f.store.readArtifact(old.generationId,"stage-base.png",f.clock.now)).toBeNull();
  await expect(f.service.generate(request,"203.0.113.1")).rejects.toMatchObject({code:"generation_expired"});
  expect(f.store.jobs.size).toBe(removed?1:2);
  expect(await run("fresh-owner")).toBe("completed");
  expect((await f.service.get(fresh.generationId)).status).toBe("completed");
  expect(calls.filter(c=>c.startsWith(old.generationId))).toHaveLength(1);
});

it("does not count a late result twice after a lost transaction acknowledgement",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const transaction=f.store.transaction.bind(f.store);let lost=false,calls=0;
  vi.spyOn(f.store,"transaction").mockImplementation(async operation=>{
    const result=await transaction(operation);
    if(!lost&&f.clock.now>Date.parse(old.expiresAt)&&f.budget().spent["2026-11-02"]===10000){lost=true;throw Error("lost cost ACK");}
    return result;
  });
  const run=worker(f,async name=>{calls++;f.clock.now+=20;return{bytes:Buffer.from(name),generationMs:20,usage};});
  expect(await run("owner")).toBe("failed");
  expect(lost).toBe(true);expect(calls).toBe(1);expect(f.budget().spent).toEqual({"2026-11-02":10000});
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
});

it.each([false,true])("waits for all late parallel row results before releasing the slot, repair=%s",async repair=>{
  const f=fixture(repair), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  let rows=0,ready!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{ready=resolve;}),last=new Promise<void>(resolve=>{release=resolve;});
  const run=worker(f,async name=>{
    if(name!=="base"){
      rows++;if(rows===11){f.clock.now+=20;ready();}
      await started;if(name==="review")await last;
    }
    return{bytes:Buffer.from(name),generationMs:20,usage};
  });
  const completion=run("owner");
  await started;
  try {expect((await f.service.claim("other"))).toBeNull();expect(f.state().active.id).toBe(old.generationId);}
  finally {release();}
  expect(await completion).toBe("failed");
  expect(rows).toBe(11);expect(f.budget().spent).toEqual({"2026-11-02":120000});
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
});

it("accounts late card metadata without retaining the expired result",async()=>{
  const f=fixture(false,true), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  let cards=0;
  const run=worker(f,async name=>({bytes:Buffer.from(name),generationMs:1,usage}),{
    prepare:async()=>buildCardMetadataRequest({prompt:"Synthetic",displayName:"Synthetic"},Array(4).fill("data:image/png;base64,YQ==")),
    generate:async()=>{cards++;f.clock.now+=20;return{fields:{displayName:"Synthetic",description:"Synthetic result",tags:["cat"]},responseHash:"b".repeat(64),inputTokens:1,outputTokens:1,costUsd:.005};},
  });
  expect(await run("owner")).toBe("failed");expect(cards).toBe(1);
  expect(f.budget().spent).toEqual({"2026-11-02":125000});
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
  await expect(f.service.get(old.generationId)).rejects.toMatchObject({code:"generation_expired"});
  expect(await f.store.readArtifact(old.generationId,"pet.zip",f.clock.now)).toBeNull();
});

it("keeps unknown outcomes paused rather than treating expiry as known success",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const run=worker(f,async()=>{f.clock.now+=20;throw new GenerationError("outcome_unknown");});
  expect(await run("owner")).toBe("failed");
  expect(f.state()).toMatchObject({active:null,pauseReason:"outcome_unknown"});
  expect(f.budget().reservations[old.generationId].unknown).toBe(true);
});

it("rejects a late response after another owner takes the active slot",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const run=worker(f,async name=>{
    f.clock.now+=20;const state=f.state();state.active.owner="replacement";f.store.ledger.get("scheduler")!.value=JSON.stringify(state);
    return{bytes:Buffer.from(name),generationMs:20,usage};
  });
  await expect(run("old-owner")).rejects.toMatchObject({code:"stale_worker"});
  expect(f.state().active.owner).toBe("replacement");expect(f.budget().spent).toEqual({});
});

it("renews only the owned lease after expiry without recreating data or authorizing new calls",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  let job=(await f.service.claim("owner"))!;job=await f.service.beginStage(job,"base");
  f.clock.now+=20;await f.store.cleanup(f.clock.now);
  await f.service.heartbeat(job);
  expect(f.state().active.until).toBe(f.clock.now+LEASE_MS);expect(f.store.jobs.has(job.id)).toBe(false);
  await expect(f.service.authorizeStage(job,"base")).rejects.toMatchObject({code:"stale_worker"});
});

it("never renews or settles an expired worker lease",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  let job=(await f.service.claim("owner"))!;job=await f.service.beginStage(job,"base");
  f.clock.now+=LEASE_MS+1;const before=structuredClone([...f.store.ledger]);
  await expect(f.service.heartbeat(job)).rejects.toMatchObject({code:"stale_worker"});
  await expect(f.service.saveStage(job,"base",Buffer.from("late"),{generationMs:1,usage})).rejects.toMatchObject({code:"stale_worker"});
  await expect(f.service.finishExpiredGeneration(job,false)).rejects.toMatchObject({code:"stale_worker"});
  expect([...f.store.ledger]).toEqual(before);
});

it("deduplicates a pre-expiry cost whose acknowledgement is lost after physical cleanup",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const tx=f.store.transaction.bind(f.store);let lost=false;
  vi.spyOn(f.store,"transaction").mockImplementation(async op=>{
    const result=await tx(op);
    if(!lost&&f.budget().spent["2026-11-02"]===10000){lost=true;f.clock.now+=20;await f.store.cleanup(f.clock.now);throw Error("late acknowledgement");}
    return result;
  });
  const run=worker(f,async name=>({bytes:Buffer.from(name),generationMs:1,usage}));
  expect(await run("owner")).toBe("failed");expect(lost).toBe(true);
  expect(f.budget().spent).toEqual({"2026-11-02":10000});expect(f.state().active).toBeNull();
});

it("replays expired finalization without clearing a subsequently claimed task",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const fresh=await f.service.generate(input(),"203.0.113.2");
  const tx=f.store.transaction.bind(f.store);let lost=false;
  vi.spyOn(f.store,"transaction").mockImplementation(async op=>{
    const result=await tx(op);
    if(!lost&&f.clock.now>Date.parse(old.expiresAt)&&f.state().active===null){
      lost=true;await f.service.claim("next-owner");throw Error("lost finalization ACK");
    }
    return result;
  });
  const run=worker(f,async name=>{f.clock.now+=20;return{bytes:Buffer.from(name),generationMs:20,usage};});
  expect(await run("owner")).toBe("failed");expect(lost).toBe(true);
  expect(f.state().active).toMatchObject({id:fresh.generationId,owner:"next-owner"});
  expect(f.budget().spent).toEqual({"2026-11-02":10000});
});

it("retains an unknown cost without pausing after a confirmed late success",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const run=worker(f,async name=>{f.clock.now+=20;return{bytes:Buffer.from(name),generationMs:20};});
  expect(await run("owner")).toBe("failed");
  expect(f.budget().reservations[old.generationId].unknown).toBe(true);
  expect(f.budget().spent).toEqual({});expect(f.state().pauseReason).toBeUndefined();
});

it("rejects conflicting late results after finalization without changing another task",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  let original:GenerationJob|undefined;
  const run=worker(f,async(name,job)=>{original=job;f.clock.now+=20;return{bytes:Buffer.from(name),generationMs:20,usage};});
  expect(await run("owner")).toBe("failed");
  await f.service.generate(input(),"203.0.113.2");await f.service.claim("next");
  const before=structuredClone([...f.store.ledger]);
  await expect(f.service.saveStage(original!,"base",Buffer.from("different"),{generationMs:1,usage})).rejects.toMatchObject({code:"stage_conflict"});
  expect([...f.store.ledger]).toEqual(before);
});

it("does not poison accounting with invalid late usage",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  let job=(await f.service.claim("owner"))!;job=await f.service.beginStage(job,"base");f.clock.now+=20;
  const before=structuredClone([...f.store.ledger]);
  await expect(f.service.saveStage(job,"base",Buffer.from("late"),{generationMs:1,usage:{...usage,costUsd:NaN}})).rejects.toMatchObject({code:"invalid_provider_result"});
  expect([...f.store.ledger]).toEqual(before);
});

it("does not begin a provider call if expiry passes after authorization",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const authorize=f.service.authorizeStage;
  vi.spyOn(f.service,"authorizeStage").mockImplementationOnce(async(...args)=>{await authorize(...args);f.clock.now+=20;});
  let calls=0;const run=worker(f,async name=>{calls++;return{bytes:Buffer.from(name),generationMs:1,usage};});
  expect(await run("owner")).toBe("failed");expect(calls).toBe(0);
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
});

it("does not begin metadata after an authorization crosses expiry",async()=>{
  const f=fixture(false,true), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const authorize=f.service.authorizeCardMetadata;
  vi.spyOn(f.service,"authorizeCardMetadata").mockImplementationOnce(async(...args)=>{await authorize(...args);f.clock.now+=20;});
  let calls=0;
  const run=worker(f,async name=>({bytes:Buffer.from(name),generationMs:1,usage}),{
    prepare:async()=>buildCardMetadataRequest({prompt:"Synthetic",displayName:"Synthetic"},Array(4).fill("data:image/png;base64,YQ==")),
    generate:async()=>{calls++;return{fields:{description:"Synthetic",tags:["cat"]},responseHash:"b".repeat(64),inputTokens:1,outputTokens:1,costUsd:.01};},
  });
  expect(await run("owner")).toBe("failed");expect(calls).toBe(0);
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
});

it("does not begin a repair call after its durable start crosses expiry",async()=>{
  const f=fixture(true), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const start=f.service.startAnimationAttempt;
  vi.spyOn(f.service,"startAnimationAttempt").mockImplementationOnce(async(...args)=>{const result=await start(...args);f.clock.now+=20;return result;});
  let rows=0;
  const run=worker(f,async name=>{if(name!=="base")rows++;return{bytes:Buffer.from(name),generationMs:1,usage};});
  expect(await run("owner")).toBe("failed");expect(rows).toBe(0);
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
});

it("also settles a late response in the legacy single-image worker",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");
  f.store.jobs.get(old.generationId)!.pipelineVersion=1;f.clock.now=Date.parse(old.expiresAt)-10;
  const run=createGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    generate:async()=>{f.clock.now+=20;return{bytes:Buffer.from("legacy"),generationMs:20,usage};}});
  expect(await run("owner")).toBe("failed");
  expect(f.state().active).toBeNull();expect(f.state().pauseReason).toBeUndefined();
  expect(f.budget().spent).toEqual({"2026-11-02":10000});
});

it("accounts the response without writing artifacts if expiry crosses the checkpoint read",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  let job=(await f.service.claim("owner"))!;job=await f.service.beginStage(job,"base");
  const tx=f.store.transaction.bind(f.store);
  vi.spyOn(f.store,"transaction").mockImplementationOnce(op=>tx(t=>op({...t,getJob:async id=>{const result=await t.getJob(id);f.clock.now+=20;return result;}})));
  await expect(f.service.saveStage(job,"base",Buffer.from("late"),{generationMs:1,usage})).rejects.toMatchObject({code:"generation_expired"});
  expect(f.store.artifacts.has(job.id+":stage-base.png")).toBe(false);
  expect(f.budget().spent).toEqual({"2026-11-02":10000});
});

it("does not rewrite the job if its lifetime ends while the heartbeat reads it",async()=>{
  const f=fixture(), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const job=(await f.service.claim("owner"))!, tx=f.store.transaction.bind(f.store);let jobWrites=0;
  vi.spyOn(f.store,"transaction").mockImplementationOnce(op=>tx(t=>op({...t,
    getJob:async id=>{const result=await t.getJob(id);f.clock.now+=20;return result;},
    putJob:async value=>{jobWrites++;await t.putJob(value);},
  })));
  await f.service.heartbeat(job);
  expect(jobWrites).toBe(0);expect(f.state().active.until).toBe(f.clock.now+LEASE_MS);
});

it("does not bill the aggregate repair summary again when composition finishes after expiry",async()=>{
  const f=fixture(true), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const complete=f.service.completeAnimationRepair;
  vi.spyOn(f.service,"completeAnimationRepair").mockImplementation(async job=>{const result=await complete(job);f.clock.now+=20;return result;});
  const run=worker(f,async name=>({bytes:Buffer.from(name),generationMs:1,usage}));
  expect(await run("owner")).toBe("failed");
  expect(f.budget().spent).toEqual({"2026-11-02":120000});
  expect(f.state().pauseReason).toBeUndefined();
});

it("retains uncertainty when recording a late repair result fails twice",async()=>{
  const f=fixture(true), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  let job=(await f.service.claim("owner"))!;job=await f.service.beginStage(job,"base");
  job=await f.service.saveStage(job,"base",Buffer.from("base"),{generationMs:1,usage});job=await f.service.beginStage(job,"idle");
  const tx=f.store.transaction.bind(f.store);let failures=2;
  vi.spyOn(f.store,"transaction").mockImplementation(op=>tx(t=>op({...t,getLedger:async(key,now)=>{
    if(failures&&f.clock.now>=Date.parse(old.expiresAt)&&key.startsWith("generation-results:")){failures--;throw Error("result ledger unavailable");}
    return t.getLedger(key,now);
  }})));
  const session={prepare:async()=>{},compose:async()=>Buffer.from("atlas"),cleanup:async()=>{},generate:async()=>{f.clock.now+=20;return{bytes:Buffer.from("idle"),generationMs:20,usage};}};
  await expect(generateRepairAnimation({service:f.service,store:f.store,now:()=>f.clock.now,wait:async()=>{},checkLease:()=>{},mutate:run=>run()},job,"idle",session)).rejects.toMatchObject({code:"outcome_unknown"});
  expect(failures).toBe(0);
});

it("keeps unknown metadata accounting after cleanup and two result-write failures",async()=>{
  const f=fixture(false,true), old=await f.service.generate(input(),"203.0.113.1");f.clock.now=Date.parse(old.expiresAt)-10;
  const tx=f.store.transaction.bind(f.store);let failures=2;
  vi.spyOn(f.store,"transaction").mockImplementation(op=>tx(t=>op({...t,getLedger:async(key,now)=>{
    if(failures&&f.clock.now>=Date.parse(old.expiresAt)&&key.startsWith("generation-results:")){failures--;throw Error("result ledger unavailable");}
    return t.getLedger(key,now);
  }})));
  const run=worker(f,async name=>({bytes:Buffer.from(name),generationMs:1,usage}),{
    prepare:async()=>buildCardMetadataRequest({prompt:"Synthetic",displayName:"Synthetic"},Array(4).fill("data:image/png;base64,YQ==")),
    generate:async()=>{f.clock.now+=20;await f.store.cleanup(f.clock.now);return{fields:{description:"Synthetic",tags:["cat"]},responseHash:"b".repeat(64),inputTokens:1,outputTokens:1,costUsd:.005};},
  });
  expect(await run("owner")).toBe("failed");
  expect(failures).toBe(0);expect(f.state().pauseReason).toBe("outcome_unknown");
  expect(f.budget().reservations[old.generationId].unknown).toBe(true);
});

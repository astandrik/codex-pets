import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {DAY,jobSchema} from "./model";
import {continuationFixture} from "./continuation-fixture.test-utils";

describe("generation continuation contract", () => {
  beforeEach(() => vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());
  it("offers rebuild and all eleven strips for a saved failed job", async () => {
    const {service, job} = await continuationFixture();
    const options = await service.getContinuationOptions(job.id);
    expect(options.canRebuild).toBe(true);expect(options.strips).toHaveLength(11);expect(options.requiredStates).toEqual([]);
  });
  it("rebuild keeps ID/TTL, charges no attempt and enqueues only once", async () => {
    const f = await continuationFixture();const body = await f.input("rebuild");
    const [a,b] = await Promise.all([f.service.continueGeneration(f.job.id,body,"127.0.0.1"),f.service.continueGeneration(f.job.id,body,"127.0.0.1")]);
    expect(a.generation?.generationId).toBe(f.job.id);expect(b.operation.id).toBe(a.operation.id);
    const job = f.store.jobs.get(f.job.id)!;expect(job.expiresAt).toBe(f.job.expiresAt);expect(job.continuation?.generationStages).toEqual([]);expect(job.rebuildHistory).toHaveLength(1);
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).queue).toEqual([f.job.id]);
    expect([...f.store.ledger.keys()].some(k => k.startsWith("day:"))).toBe(false);
  });
  it("requires missing and known invalid strips without silently adding paid work", async () => {
    const f = await continuationFixture(["running-right", "look-0-157"]);
    expect((await f.service.getContinuationOptions(f.job.id)).requiredStates).toEqual(["running-right","look-0-157"]);
    await expect(f.service.continueGeneration(f.job.id,await f.input("regenerate",["running-right"]),"127.0.0.1")).rejects.toMatchObject({code:"continuation_selection_conflict"});
    expect([...f.store.ledger.keys()].some(k => k.startsWith("day:"))).toBe(false);
  });
  it("paid recovery snapshots reusable images and consumes one attempt", async () => {
    const f = await continuationFixture(["running-right"]);const body = await f.input("regenerate",["running-right"]);
    const first = await f.service.continueGeneration(f.job.id,body,"127.0.0.1");const again = await f.service.continueGeneration(f.job.id,body,"127.0.0.1");
    expect(again.generation?.generationId).toBe(first.generation?.generationId);
    const child = f.store.jobs.get(first.generation!.generationId)!;expect(child.id).not.toBe(f.job.id);expect(child.expiresAt-child.createdAt).toBe(DAY);
    expect(child.continuation?.generationStages).toEqual(["running-right"]);expect(child.reference).toBeUndefined();expect(child.stages.every(s => !s.usage)).toBe(true);
    expect(f.store.jobs.get(f.job.id)?.status).toBe("failed");
    expect(await f.store.readArtifact(child.id,"stage-base.png",f.config.now)).toEqual(f.image);
    expect(JSON.parse(f.store.ledger.get("day:2026-10-22")!.value)).toBe(1);
  });
  it("rejects changed source and expired source before charging", async () => {
    const f = await continuationFixture();const body=await f.input("regenerate",["idle"]);
    f.store.jobs.set(f.job.id,{...f.job,displayName:"Changed"});
    await expect(f.service.continueGeneration(f.job.id,body,"127.0.0.1")).rejects.toMatchObject({code:"continuation_source_conflict"});
    f.config.now+=DAY;
    await expect(f.service.getContinuationOptions(f.job.id)).rejects.toMatchObject({code:"generation_expired"});
  });
  it("does not clear unknown costs when restoring rebuild tracking", async () => {
    const f=await continuationFixture();const reserve={remainingMicroUsd:0,unknown:true};f.store.ledger.set("budget",{value:JSON.stringify({spent:{"2026-10-22":12345},reservations:{[f.job.id]:reserve}}),expiresAt:f.config.now+100*DAY});
    await f.service.continueGeneration(f.job.id,await f.input("rebuild"),"127.0.0.1");
    const budget=JSON.parse(f.store.ledger.get("budget")!.value);expect(budget.reservations[f.job.id]).toEqual(reserve);expect(budget.spent["2026-10-22"]).toBe(12345);
  });
  it("forbids new continuations when disabled", async () => {
    const f=await continuationFixture();const body=await f.input("rebuild");vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","false");
    await expect(f.service.continueGeneration(f.job.id,body,"127.0.0.1")).rejects.toMatchObject({code:"continuation_disabled"});
  });
});

describe("continuation recovery boundaries",()=>{
  beforeEach(()=>vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true"));
  afterEach(()=>vi.unstubAllEnvs());
  it("does not generate with a missing or corrupt base",async()=>{
    for(const corrupt of [false,true]){
      const f=await continuationFixture();if(corrupt)f.store.artifacts.set(f.job.id+":stage-base.png",{bytes:Buffer.from("bad"),expiresAt:f.job.expiresAt});else f.store.artifacts.delete(f.job.id+":stage-base.png");
      await expect(f.service.getContinuationOptions(f.job.id)).rejects.toMatchObject({code:"saved_stage_unavailable"});
      expect(f.store.ledger.size).toBe(0);
    }
  });
  it("marks corrupt rows and diagnosed rows as mandatory",async()=>{
    const f=await continuationFixture();f.store.artifacts.set(f.job.id+":stage-idle.png",{bytes:Buffer.from("broken"),expiresAt:f.job.expiresAt});
    f.store.jobs.set(f.job.id,{...f.job,assemblyIssues:[{state:"running-right",kind:"sparse",frame:2,actual:10,expected:200}]});
    expect((await f.service.getContinuationOptions(f.job.id)).requiredStates).toEqual(["idle","running-right"]);
  });
  it("prevents two different paid requests on the same source",async()=>{
    const f=await continuationFixture();const a=await f.input("regenerate",["idle"]),b={...a,requestId:randomUUID()};
    const results=await Promise.allSettled([f.service.continueGeneration(f.job.id,a,"127.0.0.1"),f.service.continueGeneration(f.job.id,b,"127.0.0.1")]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(f.store.jobs.size).toBe(2);expect(JSON.parse(f.store.ledger.get("day:2026-10-22")!.value)).toBe(1);
  });
  it("recovers a lost final commit acknowledgement without another attempt",async()=>{
    const f=await continuationFixture();const body=await f.input("regenerate",["idle"]),real=f.store.transaction.bind(f.store);let lost=false;
    vi.spyOn(f.store,"transaction").mockImplementation(async operation=>{const value=await real(operation);if(!lost&&f.store.jobs.size===2){lost=true;throw Error("lost ACK");}return value;});
    const receipt=await f.service.continueGeneration(f.job.id,body,"127.0.0.1");expect(lost).toBe(true);expect(receipt.generation).toBeDefined();
    expect((await f.service.findContinuation(f.job.id,body.requestId)).generation?.generationId).toBe(receipt.generation?.generationId);
    expect(JSON.parse(f.store.ledger.get("day:2026-10-22")!.value)).toBe(1);
  });
  it("cleans incomplete copies on failure and consumes no quota",async()=>{
    const f=await continuationFixture(),body=await f.input("regenerate",["idle"]),real=f.store.transaction.bind(f.store);let copied=0;
    vi.spyOn(f.store,"transaction").mockImplementation(operation=>real(tx=>operation({...tx,putArtifact:async(...args)=>{if(++copied===3)throw Error("snapshot failed");await tx.putArtifact(...args);}})));
    await expect(f.service.continueGeneration(f.job.id,body,"127.0.0.1")).rejects.toThrow("snapshot failed");
    expect(f.store.jobs.size).toBe(1);expect(f.store.artifacts.size).toBe(12);expect(f.store.ledger.has("day:2026-10-22")).toBe(false);
    expect((await f.service.findContinuation(f.job.id,body.requestId)).operation.state).toBe("rejected");
  });
  it("retains accepted receipt after parent expiry and feature disable",async()=>{
    const f=await continuationFixture();f.config.now+=60_000;const body=await f.input("regenerate",["idle"]);const receipt=await f.service.continueGeneration(f.job.id,body,"127.0.0.1");
    f.config.now=f.job.expiresAt+1;await f.store.cleanup(f.config.now);vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","false");
    expect((await f.service.findContinuation(f.job.id,body.requestId)).generation?.generationId).toBe(receipt.generation?.generationId);
    expect((await f.service.continueGeneration(f.job.id,body,"127.0.0.1")).generation?.generationId).toBe(receipt.generation?.generationId);
  });
  it("rejects conflicts for reused UUID and never resets card uncertainty",async()=>{
    const f=await continuationFixture();f.store.jobs.set(f.job.id,{...f.job,cardMetadata:{policy:1,state:"inflight",revision:0,edited:false}});
    const body=await f.input("regenerate",["idle"]);const receipt=await f.service.continueGeneration(f.job.id,body,"127.0.0.1");
    expect(f.store.jobs.get(receipt.generation!.generationId)?.cardMetadata).toMatchObject({state:"failed",error:"outcome_unknown"});
    await expect(f.service.continueGeneration(f.job.id,{...body,states:["waving"]},"127.0.0.1")).rejects.toMatchObject({code:"request_id_conflict"});
  });
  it("enforces three rebuilds and their thirty-second cooldown",async()=>{
    const f=await continuationFixture();
    for(let i=0;i<3;i++){
      const receipt=await f.service.continueGeneration(f.job.id,await f.input("rebuild"),"127.0.0.1");expect(receipt.generation?.generationId).toBe(f.job.id);
      const saved=f.store.jobs.get(f.job.id)!;f.store.jobs.set(f.job.id,{...saved,status:"failed",error:"invalid_sprite_extraction"});f.store.ledger.delete("scheduler");
      if(i===0)await expect(f.service.continueGeneration(f.job.id,await f.input("rebuild"),"127.0.0.1")).rejects.toMatchObject({code:"continuation_cooldown"});
      f.config.now+=30_000;
    }
    await expect(f.service.continueGeneration(f.job.id,await f.input("rebuild"),"127.0.0.1")).rejects.toMatchObject({code:"continuation_limit"});
  });
  it("does not copy all binaries into the final admission transaction",async()=>{
    const f=await continuationFixture();const padded=Buffer.concat([f.image,Buffer.alloc(5*1024*1024)]);const {createHash}=await import("node:crypto");
    f.job.stages=f.job.stages.map(s=>s.name==="base"?s:{...s,sha256:createHash("sha256").update(padded).digest("hex")});f.store.jobs.set(f.job.id,structuredClone(f.job));for(const s of f.job.stages)if(s.name!=="base")f.store.artifacts.set(f.job.id+":stage-"+s.name+".png",{bytes:padded,expiresAt:f.job.expiresAt});
    const real=f.store.transaction.bind(f.store);const sizes:number[]=[];let finalBytes=-1;
    vi.spyOn(f.store,"transaction").mockImplementation(operation=>real(async tx=>{let bytes=0;const result=await operation({...tx,putArtifact:async(...args)=>{bytes+=args[2].length;await tx.putArtifact(...args);},putJob:async job=>{if(job.id!==f.job.id)finalBytes=bytes;await tx.putJob(job);}});sizes.push(bytes);return result;}));
    await f.service.continueGeneration(f.job.id,await f.input("regenerate",["idle"]),"127.0.0.1");
    expect(sizes.reduce((a,b)=>a+b,0)).toBeGreaterThan(50*1024*1024);expect(Math.max(...sizes)).toBeLessThan(8*1024*1024);expect(finalBytes).toBe(0);
  });
});

it("resumes expired preparation with the same UUID after a process interruption",async()=>{
 vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
 try{
  const f=await continuationFixture(),body=await f.input("regenerate",["idle"]),real=f.store.transaction.bind(f.store);let crashed=false;
  const spy=vi.spyOn(f.store,"transaction").mockImplementation(async operation=>{
   if(crashed)throw Error("process interrupted");let copied=false;
   const result=await real(tx=>operation({...tx,putArtifact:async(...args)=>{await tx.putArtifact(...args);copied=true;}}));
   if(copied){crashed=true;throw Error("process interrupted");}return result;
  });
  await expect(f.service.continueGeneration(f.job.id,body,"127.0.0.1")).rejects.toThrow("process interrupted");
  spy.mockRestore();f.config.now+=5*60_000+1;
  const resumed=await f.service.continueGeneration(f.job.id,body,"127.0.0.1");expect(resumed.operation.state).toBe("accepted");expect(f.store.jobs.size).toBe(2);expect(JSON.parse(f.store.ledger.get("day:2026-10-22")!.value)).toBe(1);
 }finally{vi.unstubAllEnvs();}
});
it("charges the day of final admission if midnight is crossed during reads",async()=>{
 vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
 try{
  const f=await continuationFixture();f.config.now=Date.parse("2026-10-22T20:59:59.999Z");const body=await f.input("regenerate",["idle"]);const real=f.store.transaction.bind(f.store);let dayReads=0;
  vi.spyOn(f.store,"transaction").mockImplementation(operation=>real(tx=>operation({...tx,getLedger:async(key,now)=>{const result=await tx.getLedger(key,now);if(key.startsWith("day:")&&++dayReads===2)f.config.now+=2;return result;}})));
  await f.service.continueGeneration(f.job.id,body,"127.0.0.1");expect(f.store.ledger.has("day:2026-10-22")).toBe(false);expect(JSON.parse(f.store.ledger.get("day:2026-10-23")!.value)).toBe(1);
 }finally{vi.restoreAllMocks();vi.unstubAllEnvs();}
});

it.each(["missing", "corrupt"])("requires every unavailable row when a failed revision atlas is %s",async damage=>{
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
  try {
    const f=await continuationFixture();
    f.store.jobs.set(f.job.id,{...f.job,pipelineVersion:3,animationAnatomyPolicy:1,stages:f.job.stages.filter(s=>s.name==="idle"),animationRevision:{policy:1,sourceGenerationId:"b".repeat(64),sourceMetadataRevision:0,selectedStates:["idle","waving"],baseSha256:f.job.stages[0].sha256!,sourceAtlasSha256:"f".repeat(64),corrections:{idle:["Turn slowly"]}}});
    if(damage==="corrupt")f.store.artifacts.set(f.job.id+":revision-source.webp",{bytes:Buffer.from("broken"),expiresAt:f.job.expiresAt});
    const options=await f.service.getContinuationOptions(f.job.id);
    expect(options.canRebuild).toBe(false);
    expect(options.requiredStates).toEqual(options.strips.filter(s=>s.state!=="idle").map(s=>s.state));
    await expect(f.service.continueGeneration(f.job.id,await f.input("regenerate",["waving"]),"127.0.0.1")).rejects.toMatchObject({code:"continuation_selection_conflict"});
    expect(f.store.ledger.size).toBe(0);
  } finally {vi.unstubAllEnvs();}
});
it("late cleanup of an expired preparation cannot unlock a newer operation",async()=>{
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
  try {
    const f=await continuationFixture(),body=await f.input("regenerate",["idle"]),second={...body,requestId:randomUUID()},real=f.store.transaction.bind(f.store);
    let firstTarget="",secondTarget="",releaseFirst:()=>void=()=>{},releaseSecond:()=>void=()=>{},seenFirst:()=>void=()=>{},seenSecond:()=>void=()=>{};
    const firstSeen=new Promise<void>(r=>{seenFirst=r;}),secondSeen=new Promise<void>(r=>{seenSecond=r;});
    const firstGate=new Promise<void>(r=>{releaseFirst=r;}),secondGate=new Promise<void>(r=>{releaseSecond=r;});
    vi.spyOn(f.store,"transaction").mockImplementation(async operation=>{
      let written="";const result=await real(tx=>operation({...tx,putArtifact:async(...args)=>{written=args[0];await tx.putArtifact(...args);}}));
      if(written&&!firstTarget){firstTarget=written;seenFirst();await firstGate;throw Error("old connection lost");}
      if(written&&written!==firstTarget&&!secondTarget){secondTarget=written;seenSecond();await secondGate;}
      return result;
    });
    const first=f.service.continueGeneration(f.job.id,body,"127.0.0.1").catch(e=>e);
    await firstSeen;f.config.now+=5*60_000+1;
    const next=f.service.continueGeneration(f.job.id,second,"127.0.0.1");
    await secondSeen;releaseFirst();const oldResult=await first;
    const locked=(await f.service.getContinuationOptions(f.job.id)).activeRequestId;
    releaseSecond();await next;
    expect(oldResult).toBeInstanceOf(Error);expect(locked).toBe(second.requestId);expect(f.store.jobs.size).toBe(2);
  } finally {vi.restoreAllMocks();vi.unstubAllEnvs();}
});
it("can rebuild a failed paid continuation without changing its TTL or charging again",async()=>{
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
  try {
    const f=await continuationFixture(),result=await f.service.continueGeneration(f.job.id,await f.input("regenerate",["idle"]),"127.0.0.1");
    const child=f.store.jobs.get(result.generation!.generationId)!;
    await f.store.transaction(async tx=>{await tx.putJob({...child,status:"failed",error:"invalid_sprite_extraction",stages:[...child.stages,{name:"idle",status:"completed",startedAt:f.config.now,sha256:f.job.stages[0].sha256}]});await tx.putArtifact(child.id,"stage-idle.png",f.image,child.expiresAt);});
    f.store.ledger.delete("scheduler");
    const options=await f.service.getContinuationOptions(child.id);
    const retry=await f.service.continueGeneration(child.id,{requestId:randomUUID(),mode:"rebuild",sourceRevision:options.sourceRevision},null);
    expect(jobSchema.parse(f.store.jobs.get(child.id)).continuation?.mode).toBe("rebuild");expect(retry.generation?.generationId).toBe(child.id);expect(f.store.jobs.get(child.id)?.expiresAt).toBe(child.expiresAt);expect(JSON.parse(f.store.ledger.get("day:2026-10-22")!.value)).toBe(1);
  } finally {vi.unstubAllEnvs();}
});

import {afterEach,expect,it,vi} from "vitest";
import {taskFixture} from "./task-pool.test-utils";
import {createSpriteGenerationWorker,type SpriteRenderer} from "./sprite-worker";
import {GenerationError,LEASE_MS,type StageName} from "./model";
import {changeSchedulerState} from "./scheduler-state";
import {runWorkerPool} from "./worker-runner";

afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
const image=()=>({bytes:Buffer.from("synthetic"),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}});
function renderer(generate:(id:string,name:StageName)=>Promise<ReturnType<typeof image>>):SpriteRenderer {
  return {open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),generate:name=>generate(job.id,name)})};
}
function terminalFailure(){return new GenerationError("provider_rejected",undefined,{httpStatus:400,code:"moderation_blocked",moderationStage:"input"},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:400});}
function onlyFirst(f:Awaited<ReturnType<typeof taskFixture>>){const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[f.jobs[0].id]});}

it("retains terminal finalization while other parents advance without resending the base",async()=>{
  const f=await taskFixture();let rejectedCalls=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:renderer(async id=>{if(id===f.jobs[0].id){rejectedCalls++;throw terminalFailure();}return image();}),build:async()=>({"pet.zip":Buffer.from("zip")})});
  for(let i=0;i<12;i++){await run(`worker-${i}`);f.clock.now+=250;}
  expect(rejectedCalls).toBe(1);expect(f.store.jobs.get(f.jobs[0].id)).toMatchObject({status:"failed",error:"provider_rejected"});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});
it("does not resend a durable terminal failure after worker loss before task completion",async()=>{
  const f=await taskFixture();onlyFirst(f);const job=(await f.service.claim("dead"))!;
  await f.service.beginStage(job,"base");await f.service.authorizeStage(job,"base");await f.service.recordRowAttemptFailure(job,"base",1,terminalFailure());
  f.clock.now+=LEASE_MS+1;let calls=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:renderer(async()=>{calls++;return image();}),build:async()=>({})});
  await run("replacement");await run("finalizer");
  expect(calls).toBe(0);expect(f.store.jobs.get(job.id)).toMatchObject({status:"failed",error:"provider_rejected"});
});
it("recovers an eligible transport retry reservation without repeating the first attempt",async()=>{
  const f=await taskFixture();onlyFirst(f);const job=(await f.service.claim("dead"))!;
  await f.service.beginStage(job,"base");await f.service.authorizeStage(job,"base");
  await f.service.recordRowAttemptFailure(job,"base",1,new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:520}));
  f.clock.now+=LEASE_MS+1;let calls=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:renderer(async()=>{calls++;return image();}),build:async()=>({})});
  expect(await run("reserve")).toBe("yielded");expect(calls).toBe(0);
  const token=f.store.jobs.get(job.id)!.rowRetries![0].token;
  f.clock.now+=5000;await run("retry");
  expect(calls).toBe(1);expect(f.store.jobs.get(job.id)!.rowRetries![0]).toMatchObject({token,state:"completed"});
});
it("resumes a base-review job after a permitted scheduler downgrade",async()=>{
  const f=await taskFixture();onlyFirst(f);f.store.jobs.get(f.jobs[0].id)!.reviewBase=true;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:renderer(async()=>image()),build:async()=>({"pet.zip":Buffer.from("zip")})});
  await run("base");await run("review");expect(f.store.jobs.get(f.jobs[0].id)?.status).toBe("awaiting_confirmation");
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);vi.stubEnv("PET_GENERATION_DRAIN","true");
  await changeSchedulerState(f.store,{action:"downgrade",expectedRevision:state.revision,now:f.clock.now,apply:true});vi.stubEnv("PET_GENERATION_DRAIN","false");
  await f.service.confirm(f.jobs[0].id,{});expect(await run("legacy")).toBe("completed");
});
it.each([false,true])("does not write the unchanged idle scheduler with drain=%s",async drain=>{
  vi.useFakeTimers();const f=await taskFixture();vi.stubEnv("PET_GENERATION_DRAIN",String(drain));const row=f.store.ledger.get("scheduler")!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[]});
  const controller=new AbortController();const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:renderer(async()=>{throw Error("No work");})});
  const pending=runWorkerPool({maxActiveJobs:20,signal:controller.signal,runOnce:run,delay:()=>f.service.nextWakeDelay()});
  try{await vi.advanceTimersByTimeAsync(0);const before=f.store.ledger.get("scheduler")!.value;await vi.advanceTimersByTimeAsync(1000);expect(f.store.ledger.get("scheduler")!.value).toBe(before);}
  finally{controller.abort();await pending;}
});
it("persists real queue expiry but not subsequent idle polls",async()=>{
  const f=await taskFixture();onlyFirst(f);f.store.jobs.get(f.jobs[0].id)!.expiresAt=f.clock.now+1;f.clock.now+=2;
  expect(await f.service.claim("expiry")).toBeNull();const after=f.store.ledger.get("scheduler")!.value;
  expect(JSON.parse(after).queue).toEqual([]);expect(JSON.parse(after).revision).toBeGreaterThan(0);
  await f.service.claim("idle");expect(f.store.ledger.get("scheduler")!.value).toBe(after);
});
it("does not make a third transport call after a durable second refusal",async()=>{
  const f=await taskFixture();onlyFirst(f);const job=(await f.service.claim("dead"))!;
  const failure=new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:520});
  await f.service.beginStage(job,"base");await f.service.authorizeStage(job,"base");await f.service.recordRowAttemptFailure(job,"base",1,failure);
  const retry=await f.service.beginRowRetry(job,"base");await f.service.completeTask(job,{eligibleAt:retry.notBefore});f.clock.now+=5000;
  const second=(await f.service.claim("second"))!;
  await f.service.authorizeRowRetry(second,"base",retry.token);await f.service.recordRowAttemptFailure(second,"base",2,failure);
  f.clock.now+=LEASE_MS+1;let calls=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:renderer(async()=>{calls++;return image();}),build:async()=>({})});
  await run("replacement");await run("finalizer");
  expect(calls).toBe(0);expect(f.store.jobs.get(job.id)).toMatchObject({status:"failed",error:"outcome_unknown",rowRetries:[{token:retry.token}]});
  expect(f.store.jobs.get(job.id)!.rowAttemptLogs).toHaveLength(2);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[job.id].unknown).toBe(true);
});
it("can rebuild a v3-origin parent after downgrade without another image call",async()=>{
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
  const {continuationFixture}=await import("./continuation-fixture.test-utils");const f=await continuationFixture();
  f.store.jobs.set(f.job.id,{...f.job,executionVersion:3});
  f.store.ledger.set("scheduler",{expiresAt:f.config.now+86400000,value:JSON.stringify({version:3,revision:0,activeLimit:2,providerLimit:20,active:[],queue:[],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null})});
  vi.stubEnv("PET_GENERATION_DRAIN","true");await changeSchedulerState(f.store,{action:"downgrade",expectedRevision:0,now:f.config.now,apply:true});vi.stubEnv("PET_GENERATION_DRAIN","false");
  const input=await f.input("rebuild");await f.service.continueGeneration(f.job.id,input,"203.0.113.8");let calls=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>f.image,generate:async()=>{calls++;return image();}})},build:async()=>({"pet.zip":Buffer.from("zip")})});
  expect(await run("legacy")).toBe("completed");expect(calls).toBe(0);
  expect((await f.service.continueGeneration(f.job.id,input,null)).generation?.generationId).toBe(f.job.id);
});

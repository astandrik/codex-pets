import {randomUUID} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {continuationFixture} from "./continuation-fixture.test-utils";
import {baseRetryFixture} from "./base-retry-fixture.test-utils";
import {latestAnimationAttempt} from "./animation-repair";
import {latestBaseAttempt} from "./base-repair";
import {GenerationError,LEASE_MS} from "./model";
import type {FailureDiagnostic} from "./failure-diagnostic";

type Kind = "animation" | "base";
type Boundary = "before" | "during" | "after";
type FailureOrigin = "provider_cli" | "checkpoint" | "missing";
const usage={textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.01};
function failure(origin:FailureOrigin){
  let diagnostic:FailureDiagnostic|undefined;
  if(origin==="checkpoint")diagnostic={boundary:"checkpoint",reason:"unconfirmed_write"};
  if(origin==="provider_cli")diagnostic={boundary:"provider_cli",reason:"process_exit"};
  return new GenerationError("outcome_unknown",undefined,undefined,undefined,diagnostic,{kind:"http_error",httpStatus:520});
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

async function prepare(kind:Kind,limit:number,pending:boolean,origin:FailureOrigin){
  const f=await (async()=>{
    if(kind==="base"){
      const f=await baseRetryFixture(false,false),input={...await f.input(),maxRetries:limit-1};
      const accepted=await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");
      return{...f,id:accepted.generation.generationId,expires:Date.parse(accepted.generation.expiresAt),
        replay:async()=>(await f.service.retryBaseGeneration(f.id,input,"203.0.113.8")).generation.generationId};
    }
    vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
    const f=await continuationFixture(["idle"]);
    const service=createGenerationService(f.store,{enabled:()=>true,automaticAnimationRepair:()=>true,
      now:()=>f.config.now,secret:()=>"continuation-test-secret"});
    const input={...await f.input("regenerate",["idle"]),...(limit!==4?{maxRetries:limit-1}:{})};
    const accepted=await service.continueGeneration(f.job.id,input,"203.0.113.10");
    return{...f,service,id:accepted.generation!.generationId,expires:Date.parse(accepted.generation!.expiresAt),
      replay:async()=>(await service.continueGeneration(f.job.id,input,"203.0.113.10")).generation!.generationId};
  })();
  f.config.now=f.expires-LEASE_MS-(limit-1)*5000-20_000;
  let job=(await f.service.claim("original-owner"))!;
  job=kind==="base"?await f.service.beginStage(job,"base"):await f.service.beginStages(job,["idle"]);
  const failedAttempts=pending?limit-1:limit;
  for(let i=0;i<failedAttempts;i++){
    const current=(await f.store.readJob(f.id))!;
    if(kind==="base"){
      const attempt=latestBaseAttempt(current)!;
      await f.service.startBaseAttempt(job,attempt.token);
      await f.service.failBaseAttempt(job,attempt.token,failure(origin));
      if(pending||i+1<failedAttempts){const retry=await f.service.reserveBaseAttempt(job,"transport");f.config.now=retry.attempt.notBefore;}
    }else{
      const attempt=latestAnimationAttempt(current,"idle")!;
      await f.service.startAnimationAttempt(job,"idle",attempt.token);
      await f.service.failAnimationAttempt(job,"idle",attempt.token,failure(origin));
      if(pending||i+1<failedAttempts){const retry=await f.service.reserveAnimationAttempt(job,"idle","transport");f.config.now=retry.attempt.notBefore;}
    }
  }
  f.config.now=f.expires-10;
  const beforeReplay=f.store.jobs.size;
  expect(await f.replay()).toBe(f.id);expect(f.store.jobs.size).toBe(beforeReplay);
  const current=(await f.store.readJob(f.id))!;
  const last=kind==="base"?latestBaseAttempt(current):latestAnimationAttempt(current,"idle");
  expect(last).toMatchObject({ordinal:limit,status:pending?"reserved":"failed"});
  const next=await f.service.generate({requestId:randomUUID(),prompt:"Next synthetic job"},"203.0.113.20");
  return{...f,next,lastToken:last!.token};
}

async function check(kind:Kind,limit:number,pending:boolean,boundary:Boundary,remove=false,origin:FailureOrigin="provider_cli"){
  const f=await prepare(kind,limit,pending,origin),read=f.store.readJob.bind(f.store);
  const shouldPause=pending||origin!=="provider_cli";
  let crossed=false,oldCalls=0;
  vi.spyOn(f.store,"readJob").mockImplementation(async id=>{
    const value=await read(id);
    if(boundary!=="before"&&!crossed&&id===f.id){
      crossed=true;
      const expire=()=>{f.config.now=f.expires+1;if(remove)void f.store.cleanup(f.config.now);};
      if(boundary==="during")expire();
      else queueMicrotask(()=>queueMicrotask(expire));
    }
    return value;
  });
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,wait:async ms=>{f.config.now+=ms;},
    renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),
      generate:async name=>{if(job.id===f.id)oldCalls++;return{bytes:Buffer.from(name),generationMs:1,usage};}})},
    build:async()=>({"pet.zip":Buffer.from("zip")})});
  expect(await run("replacement-owner")).toBe("failed");
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.active).toBeNull();
  expect(state.pauseReason).toBe(shouldPause?"outcome_unknown":undefined);
  expect(oldCalls).toBe(0);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.id].unknown).toBe(true);
  expect(await run("next-owner")).toBe(shouldPause?"idle":"completed");
  expect((await f.service.get(f.next.generationId)).status).toBe(shouldPause?"queued":"completed");
  const old=await read(f.id);
  if(old){
    expect(old.expiresAt).toBe(f.expires);
    expect((kind==="base"?latestBaseAttempt(old):latestAnimationAttempt(old,"idle"))?.token).toBe(f.lastToken);
  }else expect(remove).toBe(true);
}

it.each((["animation","base"] as const).flatMap(kind=>[1,4,6].flatMap(limit=>(["during","after"] as const).map(boundary=>({kind,limit,boundary})))))
  ("does not pause for an exhausted $kind attempt at limit $limit when expiry is $boundary the read",async({kind,limit,boundary})=>{
    await check(kind,limit,false,boundary);
  });

it.each(["animation","base"] as const)("does not revive an exhausted %s retry after physical TTL cleanup",async kind=>{
  await check(kind,4,false,"during",true);
});

it.each(["animation","base"] as const)("keeps completed terminal %s failures local before expiry",async kind=>{
  await check(kind,4,false,"before");
});

it.each(["checkpoint","missing"] as const)("does not discard an unclassified final animation outcome with %s diagnostics",async origin=>{
  await check("animation",4,false,"during",false,origin);
});

it.each((["animation","base"] as const).flatMap(kind=>[2,6].flatMap(limit=>(["during","after"] as const).map(boundary=>({kind,limit,boundary})))))
  ("keeps the pause for a pending final $kind retry at limit $limit when expiry is $boundary the read",async({kind,limit,boundary})=>{
    await check(kind,limit,true,boundary);
  });

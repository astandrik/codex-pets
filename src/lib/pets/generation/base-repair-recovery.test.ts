import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import {baseRetryFixture} from "./base-retry-fixture.test-utils";
import {continuationFixture} from "./continuation-fixture.test-utils";
import {CONTINUATION_STATES} from "./continuation-model";
import {jobSchema,GenerationError,LEASE_MS,type AnimationAttempt} from "./model";
import {canResumeBaseRepair} from "./base-repair";
import {canResumeAnimationRepair} from "./animation-repair";
import {createSpriteGenerationWorker} from "./sprite-worker";
import type {FailureDiagnostic} from "./failure-diagnostic";

it.each([
 {withBase:false,status:"started" as const}, {withBase:true,status:"started" as const},
 {withBase:false,status:"unknown" as const}, {withBase:true,status:"unknown" as const},
])("quarantines $status animation quality outcome with completed base audit=$withBase",async({withBase,status})=>{
 const f=await continuationFixture(),now=f.config.now,base=f.job.stages[0];
 const attempts:AnimationAttempt[]=CONTINUATION_STATES.map(state=>{
  const stage=f.job.stages.find(stage=>stage.name===state)!;
  return {state,ordinal:1,token:randomUUID(),reason:"initial",status:"saved",reservedAt:now-10000,notBefore:now-10000,startedAt:now-10000,finishedAt:now-10000,resultSha256:stage.sha256,generationMs:1,usage:stage.usage};
 });
 attempts.push({state:"idle",ordinal:2,token:randomUUID(),reason:"quality",status,reservedAt:now-9000,notBefore:now-4000,startedAt:now-4000,sourceSha256:base.sha256,
  ...(status==="unknown"?{finishedAt:now-1000,failure:{code:"outcome_unknown",diagnostic:{boundary:"provider_cli",reason:"process_exit"},cliCause:{kind:"unclassified"}}}:{})});
 const job=jobSchema.parse({...f.job,status:"generating",error:undefined,worker:"old",leaseUntil:now-1,
  animationRepair:{policy:1,maxAttempts:4,phase:"repairing",pending:["idle"],issues:[],attempts},
  ...(withBase?{baseRetrySourceId:"c".repeat(64),baseRepair:{policy:1,maxAttempts:6,phase:"complete",attempts:[{ordinal:1,token:randomUUID(),reason:"initial",status:"saved",reservedAt:now-10000,notBefore:now-10000,startedAt:now-10000,finishedAt:now-10000,resultSha256:base.sha256,generationMs:1,usage:base.usage}]}}:{})});
 await f.store.transaction(async tx=>{
  await tx.putJob(job);
  await tx.putLedger("scheduler",JSON.stringify({revision:0,queue:[],active:{id:job.id,owner:"old",until:now-1,inflight:true}}),Date.UTC(2099,0,1));
  await tx.putLedger("budget",JSON.stringify({spent:{},reservations:{[job.id]:{remainingMicroUsd:0,unknown:false}}}),Date.UTC(2099,0,1));
 });
 expect(canResumeAnimationRepair(job)).toBe(false);
 let opened=0,calls=0;
 const worker=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,renderer:{open:async()=>{
  opened++;return {prepare:async()=>undefined,generate:async()=>{calls++;throw Error("unexpected provider");},compose:async()=>f.image,cleanup:async()=>undefined};
 }}});
 expect(await worker("new")).toBe("idle");
 const state=JSON.parse(f.store.ledger.get("scheduler")!.value),current=f.store.jobs.get(job.id)!;
 expect(state.active).toBeNull();expect(state.pauseReason).toBe("outcome_unknown");
 expect(current.error).toBe("outcome_unknown");expect(current.status).toBe("failed");
 expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[job.id]).toEqual({remainingMicroUsd:0,unknown:true});
 expect(current.baseRepair).toEqual(job.baseRepair);expect(current.animationRepair!.attempts.at(-1)).toEqual(attempts.at(-1));
 expect(current.stages.find(stage=>stage.name==="idle")).toEqual(job.stages.find(stage=>stage.name==="idle"));
 expect(opened).toBe(0);expect(calls).toBe(0);expect(canResumeBaseRepair(job)).toBe(false);
});

it("finalizes checkpointed input moderation after restart without another call or charge",async()=>{
 const f=await baseRetryFixture();
 const reply=await f.service.retryBaseGeneration(f.id,{...await f.input(),maxRetries:5},"203.0.113.8");
 let job=(await f.service.claim("old"))!;
 job=await f.service.beginStage(job,"base");const token=job.baseRepair!.attempts[0].token;
 await f.service.startBaseAttempt(job,token);
 await f.service.failBaseAttempt(job,token,new GenerationError("provider_rejected",undefined,
  {httpStatus:400,code:"moderation_blocked",moderationStage:"input"},undefined,
  {boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:400}));
 const recorded=structuredClone(f.store.jobs.get(job.id)!.baseRepair);
 const spent=JSON.parse(f.store.ledger.get("budget")!.value).spent;
 const next=await f.service.generate({requestId:randomUUID(),prompt:"Next unaffected job"},"203.0.113.9");
 f.config.now+=LEASE_MS+1;
 let calls=0;
 const worker=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,renderer:{open:async()=>({
  prepare:async()=>undefined,generate:async()=>{calls++;throw Error("unexpected provider");},compose:async()=>Buffer.from("unused"),cleanup:async()=>undefined,
 })}});
 expect(await worker("new")).toBe("failed");expect(calls).toBe(0);
 const current=f.store.jobs.get(reply.generation.generationId)!;
 expect(current.status).toBe("failed");expect(current.error).toBe("provider_rejected");
 expect(current.providerFailure?.moderationStage).toBe("input");
 expect(current.baseRepair).toEqual({...recorded,phase:"stopped"});
 const scheduler=JSON.parse(f.store.ledger.get("scheduler")!.value),budget=JSON.parse(f.store.ledger.get("budget")!.value);
 expect(scheduler.active).toBeNull();expect(scheduler.pauseReason).toBeUndefined();
 expect(budget.spent).toEqual(spent);expect(budget.reservations[current.id]).toBeUndefined();
 expect((await f.service.claim("next"))?.id).toBe(next.generationId);
});

it.each([
 {diagnostic:{boundary:"provider_cli",reason:"process_exit"} as FailureDiagnostic,cliCause:{kind:"timeout" as const}},
 {diagnostic:{boundary:"renderer_process",reason:"process_timeout",elapsedMs:230000} as FailureDiagnostic,cliCause:undefined},
])("preserves recorded timeout diagnostics from $diagnostic.boundary without retrying",async({diagnostic,cliCause})=>{
 const f=await baseRetryFixture(),input={...await f.input(),maxRetries:5};
 const reply=await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");
 const before=structuredClone(JSON.parse(f.store.ledger.get("budget")!.value).spent);
 const generate=vi.fn(async()=>{throw new GenerationError("outcome_unknown",undefined,undefined,undefined,diagnostic,cliCause);});
 const worker=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,renderer:{open:async()=>({
  generate,prepare:async()=>undefined,compose:async()=>{throw Error("must not compose an unknown base");},cleanup:async()=>undefined,
 })}});
 expect(await worker("owner")).toBe("failed");
 const job=f.store.jobs.get(reply.generation.generationId)!,attempt=job.baseRepair!.attempts[0];
 expect(generate).toHaveBeenCalledTimes(1);expect(job.baseRepair!.attempts).toHaveLength(1);
 expect(attempt.status).toBe("unknown");expect(attempt.failure?.diagnostic).toEqual(diagnostic);
 expect(job.failureDiagnostic).toEqual(diagnostic);expect(job.stageFailureDiagnostics).toEqual([{stage:"base",diagnostic}]);
 const scheduler=JSON.parse(f.store.ledger.get("scheduler")!.value),budget=JSON.parse(f.store.ledger.get("budget")!.value);
 expect(scheduler.active).toBeNull();expect(scheduler.pauseReason).toBe("outcome_unknown");
 expect(budget.spent).toEqual(before);expect(budget.reservations[job.id]).toEqual({remainingMicroUsd:0,unknown:true});
 expect((await f.service.findBaseRetry(f.id,input.requestId)).generation.generationId).toBe(job.id);
 expect(await worker("restarted")).toBe("idle");expect(generate).toHaveBeenCalledTimes(1);
 expect((await f.store.readJob(job.id))?.baseRepair?.attempts[0].token).toBe(attempt.token);
});

it("keeps the checkpoint diagnostic when a timeout failure cannot be recorded",async()=>{
 const f=await baseRetryFixture();
 const reply=await f.service.retryBaseGeneration(f.id,{...await f.input(),maxRetries:5},"203.0.113.8");
 const generate=vi.fn(async()=>{throw new GenerationError("outcome_unknown",undefined,undefined,undefined,
  {boundary:"renderer_process",reason:"process_timeout",elapsedMs:230000});});
 vi.spyOn(f.service,"failBaseAttempt").mockRejectedValue(Error("checkpoint unavailable"));
 const worker=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,renderer:{open:async()=>({
  generate,prepare:async()=>undefined,compose:async()=>{throw Error("must not compose an unknown base");},cleanup:async()=>undefined,
 })}});
 expect(await worker("owner")).toBe("failed");expect(generate).toHaveBeenCalledTimes(1);
 const job=f.store.jobs.get(reply.generation.generationId)!;
 expect(job.baseRepair!.attempts).toHaveLength(1);expect(job.baseRepair!.attempts[0].status).toBe("started");
 expect(job.baseRepair!.attempts[0].failure).toBeUndefined();
 expect(job.failureDiagnostic).toEqual({boundary:"checkpoint",reason:"unconfirmed_write"});
 expect(job.stageFailureDiagnostics).toEqual([{stage:"base",diagnostic:job.failureDiagnostic}]);
 expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
 expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[job.id]).toEqual({remainingMicroUsd:0,unknown:true});
});

import {repairGenerationTotals} from "./animation-repair-worker";
import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import {baseRetryFixture} from "./base-retry-fixture.test-utils";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {GenerationError,jobSchema,LEASE_MS} from "./model";
import {baseRetryEligibility} from "./base-retry-model";

const usage={textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.04};
const moderation=()=>new GenerationError("provider_rejected",undefined,{httpStatus:400,code:"moderation_blocked",moderationStage:"output"},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:400});
const transport=()=>new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:520});
const limited=()=>new GenerationError("provider_rate_limited",undefined,{httpStatus:429},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:429});
async function fixture(maxRetries:number,successAt=Infinity,startAt?:number){
 const f=await baseRetryFixture();
 if(startAt!==undefined)f.config.now=startAt;
 const input={...await f.input(),maxRetries};
 const reply=await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");
 const calls:number[]=[],waits:number[]=[];
 const generate=vi.fn(async(name:string,context?:{attempt:number})=>{expect(name).toBe("base");calls.push(context?.attempt??0);if(calls.length<successAt)throw [moderation,transport,limited][(calls.length-1)%3]();return {bytes:Buffer.from("base"),usage,generationMs:7};});
 const worker=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,wait:async ms=>{waits.push(ms);f.config.now+=ms;},renderer:{open:async()=>({generate,prepare:async()=>undefined,compose:async()=>{throw Error("must await confirmation");},cleanup:async()=>undefined})}});
 const current=()=>f.store.jobs.get(reply.generation.generationId)!;
 return {...f,input,reply,calls,waits,generate,worker,current};
}
it.each([0,1,5,50])("uses one common exact call limit with %i retries, then releases queue",async retries=>{
 const f=await fixture(retries);expect(await f.worker("owner")).toBe("failed");
 expect(f.calls).toEqual(Array.from({length:retries+1},(_,i)=>i+1));
 expect(f.waits).toEqual(Array.from({length:retries},()=>5000));
 expect(f.current().baseRepair).toMatchObject({maxAttempts:retries+1,phase:"stopped"});
 expect(jobSchema.safeParse(f.current()).success).toBe(true);
 const scheduler=JSON.parse(f.store.ledger.get("scheduler")!.value);expect(scheduler.active).toBeNull();expect(scheduler.pauseReason).toBeUndefined();
 expect(baseRetryEligibility(f.current())).toBe(true);
 expect(f.current().rowAttemptLogs).toBeUndefined();
});
it.each([1,3,6])("stops after successful call %i and awaits base confirmation",async successAt=>{
 const f=await fixture(5,successAt);const result=await f.worker("owner");expect(result,JSON.stringify(f.current())).toBe("awaiting_confirmation");
 expect(f.calls).toHaveLength(successAt);expect(f.current().baseRepair?.phase).toBe("complete");
 expect(f.current().stages).toHaveLength(1);
 expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(40000);
 const publicJob=await f.service.get(f.current().id);expect(publicJob.baseRepair).toEqual({maxAttempts:6,attempts:successAt,phase:"complete"});
 expect(JSON.stringify(publicJob)).not.toContain('"token"');
});
it("fingerprints explicit counts, coalesces sources and preserves replay flag-off",async()=>{
 const f=await fixture(5);
 expect(f.reply.generation.baseRepair).toEqual({maxAttempts:6,attempts:0,phase:"active"});
 await expect(f.service.retryBaseGeneration(f.id,{...f.input,maxRetries:1},"203.0.113.8")).rejects.toMatchObject({code:"request_id_conflict"});
 const other=await f.service.retryBaseGeneration(f.id,{...f.input,requestId:randomUUID(),maxRetries:50},"203.0.113.8");expect(other.generation).toEqual(f.reply.generation);
 f.config.retry=false;f.config.review=false;
 expect((await f.service.retryBaseGeneration(f.id,f.input,null)).generation).toEqual(f.reply.generation);
 expect((await f.service.findBaseRetry(f.id,f.input.requestId)).generation).toEqual(f.reply.generation);
});
it.each([-1,51,1.5,"5",null])("rejects invalid count %j without admission",async maxRetries=>{
 const f=await baseRetryFixture();const before=structuredClone([...f.store.ledger]);
 await expect(f.service.retryBaseGeneration(f.id,{...await f.input(),maxRetries},"203.0.113.8")).rejects.toMatchObject({code:"invalid_argument"});
 expect(f.store.jobs.size).toBe(1);expect([...f.store.ledger]).toEqual(before);
});
it("advertises the count only with both feature flags",async()=>{
 const f=await baseRetryFixture();expect(await f.service.getBaseRetryOptions(f.id)).toMatchObject({baseRetries:{min:0,default:5,max:50}});
 f.config.review=false;expect(await f.service.getBaseRetryOptions(f.id)).not.toHaveProperty("baseRetries");
});
it.each(["start","save","reserve","fail"])("handles a lost %s acknowledgement conservatively",async transition=>{
 const f=await fixture(1,transition==="save"?1:Infinity);
 const key={start:"startBaseAttempt",save:"saveBaseAttempt",reserve:"reserveBaseAttempt",fail:"failBaseAttempt"}[transition] as "startBaseAttempt";
 const method=f.service[key];vi.spyOn(f.service,key).mockImplementationOnce(async(...args)=>{const result=await (method as (...args:unknown[])=>Promise<never>)(...args);throw Error("lost ACK "+Boolean(result));});
 expect(await f.worker("owner")).toBe(transition==="save"?"awaiting_confirmation":"failed");
 expect(f.calls).toHaveLength(transition==="start"?0:transition==="save"?1:2);
 expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe(transition==="start"?"outcome_unknown":undefined);
});
it.each(["reserved","failed","exhausted","saved","started"])("recovers %s without replaying ambiguous calls",async state=>{
 const f=await fixture(state==="exhausted"?0:1,1);let job=(await f.service.claim("old"))!;
 job=await f.service.beginStage(job,"base");const first=job.baseRepair!.attempts[0];
 if(state!=="reserved")await f.service.startBaseAttempt(job,first.token);
 if(state==="failed"||state==="exhausted")await f.service.failBaseAttempt(job,first.token,transport());
 if(state==="saved")await f.service.saveBaseAttempt(job,first.token,Buffer.from("base"),{usage,generationMs:7});
 f.config.now+=LEASE_MS+1;
 expect(await f.worker("new")).toBe(state==="started"?"idle":state==="exhausted"?"failed":"awaiting_confirmation");
 expect(f.calls).toHaveLength(["saved","started","exhausted"].includes(state)?0:1);
 if(state!=="started")expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});
it.each(["input","unknown",undefined])("stops without retrying unsupported moderation provenance %s",async stage=>{
 const f=await fixture(5);f.generate.mockRejectedValue(new GenerationError("provider_rejected",undefined,{httpStatus:400,code:"moderation_blocked",...(stage?{moderationStage:stage}:{})}));
 expect(await f.worker("owner")).toBe("failed");expect(f.calls).toHaveLength(0);expect(f.generate).toHaveBeenCalledTimes(1);expect(baseRetryEligibility(f.current())).toBe(false);
});
it("stops and pauses for unclassified provider uncertainty",async()=>{
 const f=await fixture(5);f.generate.mockRejectedValue(new GenerationError("outcome_unknown"));
 expect(await f.worker("owner")).toBe("failed");expect(f.generate).toHaveBeenCalledTimes(1);
 expect(f.current().baseRepair?.attempts[0].status).toBe("unknown");expect(baseRetryEligibility(f.current())).toBe(false);
 expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
});
it.each(["save","fail","reserve"])("stops for uncommitted %s acknowledgement",async transition=>{
 const f=await fixture(5,transition==="save"?1:Infinity);
 if(transition==="save")vi.spyOn(f.service,"saveBaseAttempt").mockRejectedValue(Error("write unavailable"));
 if(transition==="fail")vi.spyOn(f.service,"failBaseAttempt").mockRejectedValue(Error("write unavailable"));
 if(transition==="reserve")vi.spyOn(f.service,"reserveBaseAttempt").mockRejectedValue(Error("write unavailable"));
 expect(await f.worker("owner")).toBe("failed");expect(f.calls).toHaveLength(1);
 expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
});
it("counts each successful token once and retains the unknown spend marker",async()=>{
 const f=await fixture(5,2);expect(await f.worker("owner")).toBe("awaiting_confirmation");
 const budget=JSON.parse(f.store.ledger.get("budget")!.value);
 expect(budget.spent["2026-11-01"]).toBe(40000);expect(budget.reservations[f.current().id]).toEqual({remainingMicroUsd:0,unknown:true});
 expect(f.current().baseRepair?.attempts.map(a=>a.reason)).toEqual(["initial","moderation"]);
});
it("records a rejected 429 at zero spend and waits until its later retryAt",async()=>{
 const f=await fixture(1,1),retryAt=new Date(f.config.now+12000).toISOString();
 f.generate.mockRejectedValueOnce(new GenerationError("provider_rate_limited",retryAt,{httpStatus:429},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:429}));
 expect(await f.worker("owner")).toBe("awaiting_confirmation");expect(f.waits).toEqual([12000]);
 const budget=JSON.parse(f.store.ledger.get("budget")!.value);expect(budget.spent["2026-11-01"]).toBe(40000);expect(budget.reservations[f.current().id]).toBeUndefined();
 expect(repairGenerationTotals(f.current()).usage?.costUsd).toBe(.04);
});
it("checks the budget again before a later reserved call",async()=>{
 const f=await fixture(5);const generate=f.generate.getMockImplementation()!;
 f.generate.mockImplementation(async(...args)=>{try{return await generate(...args);}finally{await f.store.transaction(async tx=>{const raw=JSON.parse((await tx.getLedger("budget",f.config.now))!);raw.spent["2026-11-01"]=50000000;await tx.putLedger("budget",JSON.stringify(raw),Date.UTC(2099,0,1));});}});
 expect(await f.worker("owner")).toBe("failed");expect(f.calls).toHaveLength(1);expect(f.current().error).toBe("budget_exhausted");
 expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});
it.each(["disabled","paused","expired","midnight"])("checks %s after waiting and before the next provider call",async condition=>{
 const f=await fixture(5,Infinity,condition==="midnight"?Date.parse("2026-11-01T20:59:58Z"):undefined),before=f.config.now;
 const start=f.service.startBaseAttempt;
 vi.spyOn(f.service,"startBaseAttempt").mockImplementation(async(...args)=>{
  if(f.calls.length){
   if(condition==="disabled")f.config.enabled=false;
   if(condition==="paused")await f.store.transaction(async tx=>{const raw=JSON.parse((await tx.getLedger("scheduler",f.config.now))!);raw.pauseReason="operator";await tx.putLedger("scheduler",JSON.stringify(raw),Date.UTC(2099,0,1));});
   if(condition==="expired")f.config.now=f.current().expiresAt;
   if(condition==="midnight"){f.config.now=Math.max(f.config.now,Date.parse("2026-11-01T21:00:00Z"));await f.store.transaction(async tx=>{const raw=JSON.parse((await tx.getLedger("budget",f.config.now))!);raw.spent["2026-11-02"]=50000000;await tx.putLedger("budget",JSON.stringify(raw),Date.UTC(2099,0,1));});await f.service.heartbeat(args[0]);}
  }
  return start(...args);
 });
 if(condition==="expired")await expect(f.worker("owner")).rejects.toMatchObject({code:"stale_worker"});
 else {expect(await f.worker("owner")).toBe("failed");expect(f.current().error).toBe(condition==="midnight"?"budget_exhausted":condition==="disabled"?"generation_disabled":"generation_paused");}
 expect(f.calls).toHaveLength(1);expect(f.current().createdAt).toBe(before);expect(f.current().expiresAt-before).toBe(86400000);
});
it("rejects a stale worker after takeover without changing the reserved token",async()=>{
 const f=await fixture(1,1);let job=(await f.service.claim("old"))!;job=await f.service.beginStage(job,"base");const token=job.baseRepair!.attempts[0].token;
 f.config.now+=LEASE_MS+1;const next=(await f.service.claim("new"))!;expect(next.baseRepair!.attempts[0].token).toBe(token);
 await expect(f.service.startBaseAttempt(job,token)).rejects.toMatchObject({code:"stale_worker"});
 await f.service.startBaseAttempt(next,token);await f.service.saveBaseAttempt(next,token,Buffer.from("base"),{usage,generationMs:7});await f.service.saveBaseAttempt(next,token,Buffer.from("base"),{usage,generationMs:7});
 expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(40000);
});
it.each(["intent","checkpoint","lease"])("never retries a transport-shaped failure from %s boundary",async boundary=>{
 const f=await fixture(5);f.generate.mockRejectedValue(new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary,reason:"unconfirmed_write"},{kind:"http_error",httpStatus:520}));
 expect(await f.worker("owner")).toBe("failed");expect(f.generate).toHaveBeenCalledTimes(1);expect(baseRetryEligibility(f.current())).toBe(false);
});
it.each(["wrong token","wrong cause","unavailable readback"])("stops after a failed write acknowledgement with %s",async evidence=>{
 const f=await fixture(5),fail=f.service.failBaseAttempt;
 vi.spyOn(f.service,"failBaseAttempt").mockImplementationOnce(async(...args)=>{
  await fail(...args);
  if(evidence==="unavailable readback")vi.spyOn(f.store,"readJob").mockRejectedValueOnce(Error("unavailable"));
  else await f.store.transaction(async tx=>{const current=(await tx.getJob(args[0].id))!;const a=current.baseRepair!.attempts[0];if(evidence==="wrong token")a.token=randomUUID();else a.failure!.cliCause={kind:"http_error",httpStatus:503};await tx.putJob(current);});
  throw Error("lost failure ack");
 });
 expect(await f.worker("owner")).toBe("failed");expect(f.calls).toHaveLength(1);expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
});
it("recovers an initial stage reservation acknowledgement without changing its token",async()=>{
 const f=await fixture(0,1),begin=f.service.beginStage;let token="";
 vi.spyOn(f.service,"beginStage").mockImplementationOnce(async(...args)=>{const job=await begin(...args);token=job.baseRepair!.attempts[0].token;throw Error("lost initial reservation ACK");});
 expect(await f.worker("owner")).toBe("awaiting_confirmation");expect(f.calls).toEqual([1]);expect(f.current().baseRepair!.attempts[0].token).toBe(token);
});
it("uses an independent count for a new explicit retry of an exhausted child",async()=>{
 const f=await fixture(0);expect(await f.worker("owner")).toBe("failed");
 const options=await f.service.getBaseRetryOptions(f.current().id);if("existingGeneration" in options)throw Error("unexpected existing");
 const next=await f.service.retryBaseGeneration(f.current().id,{requestId:randomUUID(),sourceRevision:options.sourceRevision,mode:"saved",maxRetries:5},"203.0.113.8");
 expect(next.generation.baseRepair).toEqual({maxAttempts:6,attempts:0,phase:"active"});expect(f.current().baseRepair!.attempts).toHaveLength(1);
});
it.each(["expiry","takeover"])("does not call provider when %s happens after the start commit",async condition=>{
 const f=await fixture(0,1),start=f.service.startBaseAttempt;
 vi.spyOn(f.service,"startBaseAttempt").mockImplementationOnce(async(...args)=>{
  const job=await start(...args);
  if(condition==="expiry")f.config.now=job.expiresAt;
  else await f.store.transaction(async tx=>{await tx.putJob({...job,worker:"replacement"});const state=JSON.parse((await tx.getLedger("scheduler",f.config.now))!);state.active.owner="replacement";await tx.putLedger("scheduler",JSON.stringify(state),Date.UTC(2099,0,1));});
  return job;
 });
 await expect(f.worker("owner")).rejects.toMatchObject({code:"stale_worker"});expect(f.calls).toHaveLength(0);
});
it("releases the queue for recorded transport rejection even without optional diagnostic metadata",async()=>{
 const f=await fixture(0);f.generate.mockRejectedValue(new GenerationError("outcome_unknown",undefined,undefined,undefined,undefined,{kind:"remote_disconnected"}));
 expect(await f.worker("owner")).toBe("failed");expect(f.generate).toHaveBeenCalledTimes(1);
 expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});
it("includes failed provider time in journal totals without including retry waits",async()=>{
 const f=await fixture(1,1);
 f.generate.mockImplementationOnce(async()=>{f.config.now+=123;throw moderation();});
 expect(await f.worker("owner")).toBe("awaiting_confirmation");
 expect(f.current().baseRepair!.attempts.map(a=>a.generationMs)).toEqual([123,7]);
 expect(repairGenerationTotals(f.current()).generationMs).toBe(130);
});
it.each([
 new GenerationError("outcome_unknown",undefined,{httpStatus:400,code:"moderation_blocked",moderationStage:"output"},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:520}),
 new GenerationError("provider_rejected",undefined,{httpStatus:400,code:"moderation_blocked",moderationStage:"output"},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:520}),
 new GenerationError("provider_rate_limited",undefined,{httpStatus:429},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:400}),
])("rejects contradictory provider and transport provenance %#",async failure=>{
 const f=await fixture(5);f.generate.mockRejectedValue(failure);
 expect(await f.worker("owner")).toBe("failed");expect(f.generate).toHaveBeenCalledTimes(1);expect(baseRetryEligibility(f.current())).toBe(false);
});
it("retains unknown spend for output moderation even when conflicting metadata blocks retry",async()=>{
 const f=await fixture(5);f.generate.mockRejectedValue(new GenerationError("provider_rejected",undefined,{httpStatus:400,code:"moderation_blocked",moderationStage:"output"},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:520}));
 expect(await f.worker("owner")).toBe("failed");expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.current().id]).toEqual({remainingMicroUsd:0,unknown:true});
});

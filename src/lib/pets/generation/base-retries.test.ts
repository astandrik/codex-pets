import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import {baseRetryFixture} from "./base-retry-fixture.test-utils";
import {DAY} from "./model";

it("exposes only retry availability and lineage, never the private snapshot",async()=>{
 vi.stubEnv("PET_GENERATION_BASE_RETRY_ENABLED","true");vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED","true");
 try{
  const f=await baseRetryFixture();
  expect(await f.service.get(f.id)).toHaveProperty("canRetryBase",true);
  expect(JSON.stringify(await f.service.get(f.id))).not.toContain("Original input");
  const result=await f.service.retryBaseGeneration(f.id,await f.input(),"203.0.113.8");
  expect(await f.service.get(result.generation.generationId)).toHaveProperty("baseRetrySourceId",f.id);
 }finally{vi.unstubAllEnvs();}
});

it("creates one new ordinary task with exact input and unchanged source",async()=>{
 const f=await baseRetryFixture(),before=structuredClone(await f.store.readJob(f.id)),request=await f.input();
 f.config.now+=1000;
 const result=await f.service.retryBaseGeneration(f.id,request,"203.0.113.8");
 const child=(await f.store.readJob(result.generation.generationId))!;
 expect(child).toMatchObject({prompt:"Original input",displayName:"Pet name",nameSource:"user",reviewBase:true,status:"queued",baseRetrySourceId:f.id});
 expect(child.expiresAt).toBe(f.config.now+DAY);
 expect(await f.store.readArtifact(child.id,"reference.png",f.config.now)).toEqual(f.reference!.bytes);
 expect(await f.store.readJob(f.id)).toEqual(before);
 expect([...f.store.ledger].filter(([k])=>k.startsWith("day:")||k.startsWith("ip:")).map(([,v])=>v.value)).toEqual(["2","2"]);
 expect(JSON.parse(f.store.ledger.get("scheduler")!.value).queue).toEqual([child.id]);
 expect(result.requestId).toBe(request.requestId);
 expect(result.reused).toBe(false);
});
it("coalesces different UUIDs/tabs and preserves a failed child's identity",async()=>{
 const f=await baseRetryFixture(),input=await f.input();
 const replies=await Promise.all(Array.from({length:8},()=>f.service.retryBaseGeneration(f.id,{...input,requestId:randomUUID()},"203.0.113.8")));
 expect(new Set(replies.map(r=>r.generation.generationId)).size).toBe(1);
 expect(f.store.jobs.size).toBe(2);
 expect([...f.store.ledger.keys()].filter(k=>k.startsWith("base-retry:"))).toHaveLength(2);
 const id=replies[0].generation.generationId;
 await f.store.transaction(async tx=>{const child=(await tx.getJob(id))!;await tx.putJob({...child,status:"failed",error:"provider_rejected",providerFailure:{httpStatus:400,code:"moderation_blocked",moderationStage:"output"}});});
 expect((await f.service.retryBaseGeneration(f.id,{...input,requestId:randomUUID()},"203.0.113.8")).generation.generationId).toBe(id);
 expect(f.store.jobs.size).toBe(2);
});
it("replays after parent expiry and flag-off without charging again",async()=>{
 const f=await baseRetryFixture(),input=await f.input();f.config.now+=60000;
 const reply=await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");
 f.config.now+=DAY-30000;await f.store.cleanup(f.config.now);f.config.enabled=false;f.config.retry=false;f.config.review=false;
 const before=structuredClone([...f.store.ledger]);
 expect((await f.service.findBaseRetry(f.id,input.requestId)).generation.generationId).toBe(reply.generation.generationId);
 expect((await f.service.getBaseRetryOptions(f.id))).toHaveProperty("existingGeneration.generationId",reply.generation.generationId);
 expect((await f.service.retryBaseGeneration(f.id,input,null)).generation.generationId).toBe(reply.generation.generationId);
 expect([...f.store.ledger]).toEqual(before);
});
it("conflicts on changed input for an accepted UUID",async()=>{
 const f=await baseRetryFixture(),input=await f.input();await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");
 await expect(f.service.retryBaseGeneration(f.id,{...input,sourceRevision:"e".repeat(64)},"203.0.113.8")).rejects.toMatchObject({code:"request_id_conflict"});
 await expect(f.service.findBaseRetry("e".repeat(64),input.requestId)).rejects.toMatchObject({code:"request_id_conflict"});
});
it.each(["legacy-image-only","legacy-text"] as const)("requires an explicit legacy decision: %s",async mode=>{
 const f=await baseRetryFixture(true),input=await f.input(mode);
 await expect(f.service.retryBaseGeneration(f.id,{requestId:input.requestId,sourceRevision:input.sourceRevision,mode:"saved"},"203.0.113.8")).rejects.toMatchObject({code:"base_retry_input_missing"});
 const reply=await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");
 expect((await f.store.readJob(reply.generation.generationId))!.prompt).toBe(mode==="legacy-image-only"?"":"Re-entered description");
});
it("does not turn a corrupt new snapshot into legacy input",async()=>{
 const f=await baseRetryFixture(),input=await f.input();f.store.artifacts.delete(f.id+":generation-input.json");
 await expect(f.service.retryBaseGeneration(f.id,{...input,mode:"legacy-image-only"},"203.0.113.8")).rejects.toMatchObject({code:"base_retry_input_missing"});
 expect(f.store.jobs.size).toBe(1);
});
it.each(["retry","review","enabled","budget","queue","quota","unsafe"])("blocks %s without a partial new task",async gate=>{
 const f=await baseRetryFixture(),input=await f.input();
 if(gate==="retry")f.config.retry=false;if(gate==="review")f.config.review=false;if(gate==="enabled")f.config.enabled=false;if(gate==="budget")f.config.budget=0;
 if(gate==="queue")for(let i=0;i<30;i++)await f.service.generate({requestId:randomUUID(),prompt:"Other task"},"203.0.113.9");
 if(gate==="quota")for(const [key,value] of f.store.ledger)if(key.startsWith("ip:"))value.value="100";
 if(gate==="unsafe")f.store.jobs.get(f.id)!.error="outcome_unknown";
 const count=f.store.jobs.size;
 await expect(f.service.retryBaseGeneration(f.id,input,"203.0.113.8")).rejects.toBeDefined();
 expect(f.store.jobs.size).toBe(count);
 expect([...f.store.ledger.keys()].some(k=>k.startsWith("base-retry:"))).toBe(false);
});
it("rolls back copied input and quota when receipt storage fails",async()=>{
 const f=await baseRetryFixture(),input=await f.input(),before={jobs:structuredClone([...f.store.jobs]),ledger:structuredClone([...f.store.ledger]),artifacts:[...f.store.artifacts]};
 const transaction=f.store.transaction.bind(f.store);
 vi.spyOn(f.store,"transaction").mockImplementation(operation=>transaction(tx=>operation({...tx,putLedger:async(...args)=>{if(args[0].startsWith("base-retry:"))throw Error("failed receipt");return tx.putLedger(...args);}})));
 await expect(f.service.retryBaseGeneration(f.id,input,"203.0.113.8")).rejects.toThrow("failed receipt");
 expect([...f.store.jobs]).toEqual(before.jobs);expect([...f.store.ledger]).toEqual(before.ledger);expect([...f.store.artifacts]).toEqual(before.artifacts);
});

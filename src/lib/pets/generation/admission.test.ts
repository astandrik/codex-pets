import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";
import {readGenerationInput} from "./generation-input";
import {DAY,GenerationError} from "./model";

it("saves accepted input atomically and keeps it after terminal prompt erasure",async()=>{
 const store=new MemoryStore(),now=Date.parse("2026-11-01T10:00:00Z");
 const service=createGenerationService(store,{enabled:()=>true,secret:()=>"test-admission-secret",now:()=>now,baseRetries:()=>true});
 const input={requestId:randomUUID(),prompt:"Exact accepted description",displayName:"Name"};
 const first=await service.generate(input,"203.0.113.2",{reviewBase:true});
 let job=(await store.readJob(first.generationId))!;
 expect(job.retryInput?.policy).toBe(1);
 expect(await readGenerationInput(job,store.readArtifact.bind(store),()=>now)).toEqual({version:1,prompt:input.prompt,displayName:"Name"});
 job=(await service.claim("owner"))!;
 await service.fail(job,"provider_rejected",{httpStatus:400,code:"moderation_blocked",moderationStage:"output"});
 job=(await store.readJob(job.id))!;expect(job.prompt).toBe("");
 expect((await readGenerationInput(job,store.readArtifact.bind(store),()=>now)).prompt).toBe(input.prompt);
 expect((await service.generate(input,"203.0.113.2",{reviewBase:true})).generationId).toBe(job.id);
 expect(await store.readArtifact(job.id,"generation-input.json",now+DAY)).toBeNull();
 expect(JSON.stringify(await service.get(job.id))).not.toContain(input.prompt);
});
it("does not add snapshots to legacy or flag-off admissions",async()=>{
 for(const reviewBase of [false,true]){
  const store=new MemoryStore();const service=createGenerationService(store,{enabled:()=>true,secret:()=>"test-secret",baseRetries:()=>false});
  const accepted=await service.generate({requestId:randomUUID(),prompt:"test"},"203.0.113.3",{reviewBase});
  expect((await store.readJob(accepted.generationId))!.retryInput).toBeUndefined();
  expect(await store.readArtifact(accepted.generationId,"generation-input.json",Date.now())).toBeNull();
 }
});
it("rolls back quota, job and queue if snapshot persistence fails",async()=>{
 const store=new MemoryStore(),tx=store.transaction.bind(store);
 const service=createGenerationService(store,{enabled:()=>true,secret:()=>"test-secret",baseRetries:()=>true});
 vi.spyOn(store,"transaction").mockImplementation(op=>tx(t=>op({...t,putArtifact:async(id,kind,bytes,expires)=>{
  if(kind==="generation-input.json")throw new GenerationError("synthetic_failure");
  return t.putArtifact(id,kind,bytes,expires);
 }})));
 await expect(service.generate({requestId:randomUUID(),prompt:"test"},"203.0.113.4",{reviewBase:true})).rejects.toMatchObject({code:"synthetic_failure"});
 expect(store.jobs.size).toBe(0);expect(store.ledger.size).toBe(0);expect(store.artifacts.size).toBe(0);
});

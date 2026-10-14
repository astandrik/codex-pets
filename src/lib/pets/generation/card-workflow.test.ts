import {randomUUID} from "node:crypto";
import {describe,it,expect} from "vitest";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";
import {STAGE_NAMES,LEASE_MS} from "./model";
const fields={description:"A friendly blue cartoon trolleybus.",tags:["vehicle","cartoon","blue"]};
const result={fields,responseHash:"b".repeat(64),inputTokens:100,outputTokens:50,costUsd:.001};
async function fixture(displayName?:string){
 const store=new MemoryStore(),clock={now:Date.parse("2026-10-12T10:00:00Z")};
 const service=createGenerationService(store,{enabled:()=>true,secret:()=>"card-test-secret".repeat(3),now:()=>clock.now,automaticCardMetadata:()=>true});
 const accepted=await service.generate({prompt:"Synthetic brief",...(displayName===undefined?{}:{displayName}),requestId:randomUUID()},"203.0.113.77");let job=(await service.claim("owner"))!;
 for(const name of STAGE_NAMES){await service.beginStage(job,name);await service.saveStage(job,name,Buffer.from(name),{generationMs:1,usage:{textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.01}});}
 job=await service.saveSource(job,Buffer.from("source"),{generationMs:12});return {store,clock,service,accepted,job};
}
const budget=(store:MemoryStore)=>JSON.parse(store.ledger.get("budget")!.value);
describe("durable automatic card metadata",()=>{
 it("records intent without monetary coverage before one call, fences ownership and settles result once",async()=>{
  const f=await fixture();const job=await f.service.beginCardMetadata(f.job,"a".repeat(64));
  expect(job.cardMetadata).toMatchObject({state:"inflight",requestHash:"a".repeat(64)});expect(budget(f.store).reservations[job.id].remainingMicroUsd).toBe(0);
  await expect(f.service.authorizeCardMetadata({...job,worker:"other"})).rejects.toMatchObject({code:"stale_worker"});
  await f.service.authorizeCardMetadata(job);await f.service.saveCardMetadata(job,result);await f.service.saveCardMetadata(job,result);
  expect((await f.store.readJob(job.id))?.cardMetadata).toMatchObject({state:"completed",fields,revision:0});expect(budget(f.store).spent["2026-10-12"]).toBe(121000);
 });
 it("recovers a card-only unknown outcome without regenerating images and retains its unknown accounting marker",async()=>{
  const f=await fixture();await f.service.beginCardMetadata(f.job,"a".repeat(64));f.clock.now+=LEASE_MS+1;
  const resumed=await f.service.claim("replacement");expect(resumed).toMatchObject({status:"processing",worker:"replacement",cardMetadata:{state:"inflight"}});
  const fallback=await f.service.failCardMetadata(resumed!,"outcome_unknown");await f.service.finish(fallback,{"pet.zip":Buffer.from("usable image package")});
  expect((await f.service.get(f.job.id)).status).toBe("completed");expect(budget(f.store).reservations[f.job.id].unknown).toBe(true);expect(await f.service.claim("another")).toBeNull();
  expect((await f.store.readJob(f.job.id))?.stages).toHaveLength(12);
 });
 it("does not create a second intent after a persisted response",async()=>{
  const f=await fixture();const job=await f.service.beginCardMetadata(f.job,"a".repeat(64));await f.service.saveCardMetadata(job,result);
  await expect(f.service.beginCardMetadata(job,"a".repeat(64))).rejects.toMatchObject({code:"metadata_already_started"});
 });
 it("makes a known failed metadata step editable without changing the image stages or pausing",async()=>{
  const f=await fixture();const job=await f.service.beginCardMetadata(f.job,"a".repeat(64));const failed=await f.service.failCardMetadata(job,"provider_rejected");
  await f.service.finish(failed,{"pet.zip":Buffer.from("package")});const status=await f.service.get(job.id);
  expect(status.metadata).toMatchObject({editable:true,automaticState:"failed",tags:[]});expect(budget(f.store).reservations).toEqual({});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
 });
});

 it("replaces only an omitted name with the saved automatic suggestion",async()=>{
  const f=await fixture();const job=await f.service.beginCardMetadata(f.job,"a".repeat(64));
  const saved=await f.service.saveCardMetadata(job,{...result,fields:{...fields,displayName:"Синебус"}});
  expect(saved.displayName).toBe("Синебус");expect(saved.cardMetadata?.fields?.displayName).toBe("Синебус");
  await f.service.finish(saved,{"pet.zip":Buffer.from("package")});expect((await f.service.get(job.id)).pet?.displayName).toBe("Синебус");
 });
 it.each(["Lumi","Generated pet","Kitty <3","two\nlines","Мятня"])("preserves the explicit name %s even when the model suggests another",async displayName=>{
  const f=await fixture(displayName);const job=await f.service.beginCardMetadata(f.job,"a".repeat(64));
  const saved=await f.service.saveCardMetadata(job,{...result,fields:{...fields,displayName:"Other"}});
  expect(saved.displayName).toBe(displayName);expect(saved.cardMetadata?.fields?.displayName).toBe(displayName);
  const {jobSchema}=await import("./model");expect(jobSchema.parse(saved).displayName).toBe(displayName);
 });
 it("distinguishes an omitted name from an explicitly supplied placeholder for new request IDs",async()=>{
  const store=new MemoryStore(),service=createGenerationService(store,{enabled:()=>true,secret:()=>"test-secret".repeat(4),automaticCardMetadata:()=>true});
  const input={prompt:"A friendly bus",requestId:randomUUID()};const first=await service.generate(input,"203.0.113.1");
  expect((await service.generate(input,"203.0.113.1")).generationId).toBe(first.generationId);
  await expect(service.generate({...input,displayName:"Generated pet"},"203.0.113.1")).rejects.toMatchObject({code:"request_id_conflict"});
 });

import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {MemoryStore} from "./test-store";
import {buildCardMetadataRequest} from "./card-provider";
import {GenerationError,LEASE_MS,type GenerationJob} from "./model";
const fields={displayName:"Bluebell",description:"Friendly cartoon bus.",tags:["vehicle","cartoon","blue"]};
async function fixture(){
 const store=new MemoryStore(),clock={now:Date.parse("2026-10-12T10:00:00Z")};const service=createGenerationService(store,{enabled:()=>true,secret:()=>"card-worker-secret".repeat(3),now:()=>clock.now,automaticCardMetadata:()=>true});
 const accepted=await service.generate({prompt:"Synthetic brief",requestId:randomUUID()},"203.0.113.77");
 const generate=vi.fn(async(name:string)=>({bytes:Buffer.from(name),generationMs:1,usage:{textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.01}}));
 const card={prepare:vi.fn(async()=>buildCardMetadataRequest({prompt:"Synthetic",displayName:"Synthetic"},Array(4).fill("data:image/png;base64,YQ=="))),generate:vi.fn(async()=>({fields,responseHash:"b".repeat(64),inputTokens:100,outputTokens:50,costUsd:.001}))};
 const build=vi.fn(async(job:GenerationJob)=>({"pet.zip":Buffer.from(job.displayName)}));
 const worker=createSpriteGenerationWorker({service,store,now:()=>clock.now,cardProvider:card,renderer:{open:async()=>({generate,prepare:async()=>undefined,compose:async()=>Buffer.from("source"),cleanup:async()=>undefined})},build});
 return {store,clock,service,accepted,generate,card,build,worker};
}
describe("one-shot generated-card worker",()=>{
 it("runs exactly twelve image calls and one metadata call before packaging",async()=>{
  const f=await fixture();expect(await f.worker("owner")).toBe("completed");expect(f.generate).toHaveBeenCalledTimes(12);expect(f.card.generate).toHaveBeenCalledTimes(1);expect(f.build.mock.calls[0][0].cardMetadata?.fields).toEqual(fields);
 });
 it("reconciles lost intent and result acknowledgements without another call",async()=>{
  const f=await fixture(),begin=f.service.beginCardMetadata,save=f.service.saveCardMetadata;
  vi.spyOn(f.service,"beginCardMetadata").mockImplementationOnce(async(...a)=>{await begin(...a);throw Error("lost ACK")});
  vi.spyOn(f.service,"saveCardMetadata").mockImplementationOnce(async(...a)=>{await save(...a);throw Error("lost ACK")});
  expect(await f.worker("owner")).toBe("completed");expect(f.card.generate).toHaveBeenCalledTimes(1);expect((await f.service.get(f.accepted.generationId)).metadata?.description).toBe(fields.description);
 });
 it("keeps the image result when metadata is rejected without replay",async()=>{
  const f=await fixture();f.card.generate.mockRejectedValueOnce(new GenerationError("provider_rejected"));expect(await f.worker("owner")).toBe("completed");expect(f.card.generate).toHaveBeenCalledTimes(1);expect(f.generate).toHaveBeenCalledTimes(12);expect((await f.service.get(f.accepted.generationId)).metadata?.automaticState).toBe("failed");
 });
 it("resumes packaging after a crash without paying for saved metadata again",async()=>{
  const f=await fixture();f.build.mockRejectedValueOnce(Error("local packaging crash"));await expect(f.worker("old")).rejects.toThrow("packaging");f.clock.now+=LEASE_MS+1;
  expect(await f.worker("new")).toBe("completed");expect(f.card.generate).toHaveBeenCalledTimes(1);expect(f.generate).toHaveBeenCalledTimes(12);
 });
});

it("recovers an unresolved metadata intent without any second provider request or image replay",async()=>{
 const f=await fixture(),begin=f.service.beginCardMetadata;
 vi.spyOn(f.service,"beginCardMetadata").mockImplementationOnce(async(...args)=>{await begin(...args);vi.spyOn(f.store,"readJob").mockRejectedValueOnce(Error("read unavailable after lost ACK"));throw Error("lost ACK");});
 await expect(f.worker("old")).rejects.toThrow("read unavailable");f.clock.now+=LEASE_MS+1;
 expect(await f.worker("new")).toBe("completed");expect(f.card.generate).not.toHaveBeenCalled();expect(f.generate).toHaveBeenCalledTimes(12);
 expect((await f.service.get(f.accepted.generationId)).metadata?.automaticState).toBe("failed");
 expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.accepted.generationId].unknown).toBe(true);
});

it("skips the additional paid call when its budget cannot be reserved",async()=>{
 const f=await fixture();vi.spyOn(f.service,"beginCardMetadata").mockRejectedValueOnce(new GenerationError("budget_exhausted"));
 expect(await f.worker("owner")).toBe("completed");expect(f.card.generate).not.toHaveBeenCalled();expect(f.generate).toHaveBeenCalledTimes(12);expect((await f.service.get(f.accepted.generationId)).metadata?.editable).toBe(true);
});

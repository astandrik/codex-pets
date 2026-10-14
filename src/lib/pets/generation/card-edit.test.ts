import JSZip from "jszip";
import sharp from "sharp";
import {beforeAll,describe,it,expect} from "vitest";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";
import {DAY,type GenerationJob} from "./model";
const now=Date.parse("2026-10-12T10:00:00Z"),id="a".repeat(64);let files:Record<string,Buffer>;
const desired={revision:0,description:"A blue cartoon trolleybus with bright windows.",tags:["vehicle","cartoon","blue"]};
beforeAll(async()=>{
 const json=Buffer.from(JSON.stringify({id:"generated-test",displayName:"Test",description:"Original brief",spriteVersionNumber:2,spritesheetPath:"spritesheet.webp"}));
 const cells=Array.from({length:88},(_,i)=>`<rect x="${i%8*192+70}" y="${Math.floor(i/8)*208+70}" width="50" height="50" fill="blue"/>`).join("");
 const sprite=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="2288">${cells}</svg>`)).webp({lossless:true}).toBuffer();
 files={"pet.json":json,"spritesheet.webp":sprite,"pet.zip":await new JSZip().file("pet.json",json).file("spritesheet.webp",sprite).generateAsync({type:"nodebuffer"})};
});
function fixture(){
 const store=new MemoryStore(),clock={now};const job:GenerationJob={id,displayName:"Test",prompt:"",status:"completed",createdAt:now-1000,expiresAt:now+DAY,worker:"",promptRevision:"test",pipelineVersion:2,stages:[]};store.jobs.set(id,job);
 for(const[name,bytes]of Object.entries(files))store.artifacts.set(id+":"+name,{bytes,expiresAt:job.expiresAt});
 const service=createGenerationService(store,{enabled:()=>false,secret:()=>"test-secret".repeat(4),now:()=>clock.now});return{store,service,job,clock};
}
describe("generated metadata editing",()=>{
 it("updates JSON and ZIP atomically while preserving sprite, identity and quota",async()=>{
  const f=fixture(),before=structuredClone(f.store.ledger);const metadata=await f.service.editMetadata(id,desired);expect(metadata).toMatchObject({...desired,revision:1,edited:true});
  const json=await f.store.readArtifact(id,"pet.json",now),zip=await JSZip.loadAsync((await f.store.readArtifact(id,"pet.zip",now))!);
  expect(JSON.parse(json!.toString())).toMatchObject({id:"generated-test",displayName:"Test",description:desired.description,spriteVersionNumber:2});expect(await zip.file("pet.json")!.async("nodebuffer")).toEqual(json);
  expect(await zip.file("spritesheet.webp")!.async("nodebuffer")).toEqual(files['spritesheet.webp']);expect(await f.store.readArtifact(id,"spritesheet.webp",now)).toEqual(files['spritesheet.webp']);expect(f.store.ledger).toEqual(before);
  await expect(f.service.submit(id,null,"edited-pet",0)).rejects.toMatchObject({code:"metadata_conflict"});
  expect(f.store.submissions.size).toBe(0);
  const receipt=await f.service.submit(id,null,"edited-pet",1);expect(receipt.slug).toBe("edited-pet");expect([...f.store.submissions.values()][0].pet.tags).toEqual(desired.tags);
  await expect(f.service.editMetadata(id,{...desired,revision:1,description:"late"})).rejects.toMatchObject({code:"metadata_locked"});
 });
 it("returns the saved revision on repeated content and rejects competing stale edits",async()=>{
  const f=fixture();await f.service.editMetadata(id,desired);expect((await f.service.editMetadata(id,desired)).revision).toBe(1);
  await expect(f.service.editMetadata(id,{...desired,description:"different"})).rejects.toMatchObject({code:"metadata_conflict"});
 });
 it("allows only one of two different edits from the same revision",async()=>{
  const f=fixture();const results=await Promise.allSettled([f.service.editMetadata(id,desired),f.service.editMetadata(id,{...desired,description:"Another description"})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await f.service.get(id)).metadata?.revision).toBe(1);
 });
 it("reconciles a lost commit ACK without another revision or quota change",async()=>{
  const f=fixture(),tx=f.store.transaction.bind(f.store);f.store.transaction=async operation=>{const before=f.store.jobs.get(id)?.cardMetadata?.revision;const value=await tx(operation);if(f.store.jobs.get(id)?.cardMetadata?.revision!==before)throw Error("lost ACK");return value;};const result=await f.service.editMetadata(id,desired);expect(result.revision).toBe(1);expect(f.store.ledger.size).toBe(0);
 });
 it("does not leave a partial package after rollback",async()=>{
  const f=fixture(),tx=f.store.transaction.bind(f.store);f.store.transaction=operation=>tx(t=>operation({...t,putJob:async()=>{throw Error("write failed")}}));
  await expect(f.service.editMetadata(id,desired)).rejects.toThrow();expect(await f.store.readArtifact(id,"pet.json",now)).toEqual(files['pet.json']);expect(await f.store.readArtifact(id,"pet.zip",now)).toEqual(files['pet.zip']);expect(f.store.jobs.get(id)?.cardMetadata).toBeUndefined();
 });
 it("rejects expired, unfinished and malformed edits",async()=>{
  const f=fixture();await expect(f.service.editMetadata(id,{...desired,tags:["x".repeat(41)]})).rejects.toMatchObject({code:"invalid_argument"});
  f.job.status="generating";await expect(f.service.editMetadata(id,desired)).rejects.toMatchObject({code:"generation_not_completed"});f.job.status="completed";f.clock.now+=DAY+1;await expect(f.service.editMetadata(id,desired)).rejects.toMatchObject({code:"generation_expired"});
 });
});

it("rejects Unicode normalization overflow before persisting any record",async()=>{
 const f=fixture();await expect(f.service.editMetadata(id,{...desired,tags:["İ".repeat(40)]})).rejects.toMatchObject({code:"invalid_argument"});
 expect(f.store.jobs.get(id)?.cardMetadata).toBeUndefined();expect(await f.store.readArtifact(id,"pet.zip",now)).toEqual(files['pet.zip']);
});

it("renames a private result consistently without changing its ID or sprite",async()=>{
 const f=fixture(),input={...desired,displayName:"Мятня"};const result=await f.service.editMetadata(id,input);
 expect(result.displayName).toBe("Мятня");expect((await f.service.get(id)).pet?.displayName).toBe("Мятня");
 const zip=await JSZip.loadAsync((await f.store.readArtifact(id,"pet.zip",now))!);
 expect(JSON.parse(await zip.file("pet.json")!.async("string"))).toMatchObject({id:"generated-test",displayName:"Мятня",description:desired.description});
 expect(await zip.file("spritesheet.webp")!.async("nodebuffer")).toEqual(files['spritesheet.webp']);
 const receipt=await f.service.submit(id,null,"myatnya",result.revision);expect(receipt.slug).toBe("myatnya");
 expect([...f.store.submissions.values()][0].pet.petJson.displayName).toBe("Мятня");
 await expect(f.service.editMetadata(id,{...input,revision:result.revision,displayName:"Late"})).rejects.toMatchObject({code:"metadata_locked"});
});
it.each(["", " ", "x".repeat(81)])("rejects invalid edited display name %j without changing the package",async displayName=>{
 const f=fixture();await expect(f.service.editMetadata(id,{...desired,displayName})).rejects.toMatchObject({code:"invalid_argument"});
 expect(await f.store.readArtifact(id,"pet.zip",now)).toEqual(files['pet.zip']);
});

it("keeps an existing accepted name with punctuation when editing only other fields",async()=>{
 const f=fixture();f.job.displayName="Kitty <3";const result=await f.service.editMetadata(id,desired);
 expect(result.displayName).toBe("Kitty <3");
 const {jobSchema}=await import('./model');expect(jobSchema.parse(f.store.jobs.get(id)).displayName).toBe("Kitty <3");
});

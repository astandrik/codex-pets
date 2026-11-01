import {createHash} from "node:crypto";
import sharp from "sharp";
import {describe, expect, it} from "vitest";
import {encodeGenerationInput, readGenerationInput, readSavedGenerationReference} from "./generation-input";
import {jobSchema, type GenerationJob} from "./model";

const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const base: GenerationJob = {id:"a".repeat(64),prompt:"",displayName:"Generated pet",status:"failed",error:"provider_rejected",createdAt:1,expiresAt:100,worker:"",pipelineVersion:2,promptRevision:"test",reviewBase:true,stages:[]};
async function reference() {
  const bytes = await sharp({create:{width:8,height:9,channels:4,background:"red"}}).png().toBuffer();
  return {bytes,metadata:{sha256:hash(bytes),sourceSha256:"b".repeat(64),width:8,height:9,sizeBytes:bytes.length,normalizationVersion:1 as const}};
}
describe("private generation input",()=>{
  it("round-trips the actual accepted text/name and omits request identity",async()=>{
    const encoded=encodeGenerationInput({prompt:"line\r\nline",displayName:"Name"});
    const job=jobSchema.parse({...base,retryInput:{policy:1,sha256:encoded.sha256}});
    expect(await readGenerationInput(job,async()=>encoded.bytes,()=>10)).toEqual({version:1,prompt:"line\r\nline",displayName:"Name"});
    expect(encoded.bytes.toString()).not.toContain("requestId");
  });
  it("keeps image-only input and copies verified reference bytes unchanged",async()=>{
    const ref=await reference(),encoded=encodeGenerationInput({prompt:""},ref);
    const job={...base,reference:ref.metadata,retryInput:{policy:1 as const,sha256:encoded.sha256}};
    expect((await readGenerationInput(job,async()=>encoded.bytes,()=>10)).reference).toEqual({sha256:ref.metadata.sha256,sourceSha256:ref.metadata.sourceSha256});
    expect(await readSavedGenerationReference(job,async()=>ref.bytes,()=>10)).toEqual(ref);
  });
  it.each(["missing","wrong-hash","invalid-json","wrong-version"])("rejects %s snapshots instead of treating them as legacy",async kind=>{
    const encoded=encodeGenerationInput({prompt:"test"});
    const bytes=kind==="missing"?null:kind==="invalid-json"?Buffer.from("{"):kind==="wrong-version"?Buffer.from('{"version":2,"prompt":"test"}'):Buffer.from("changed");
    const job={...base,retryInput:{policy:1 as const,sha256:kind==="wrong-version"||kind==="invalid-json"?hash(bytes!):encoded.sha256}};
    await expect(readGenerationInput(job,async()=>bytes,()=>10)).rejects.toMatchObject({code:"base_retry_input_missing"});
  });
  it("checks snapshot/reference agreement and expiry after IO",async()=>{
    const ref=await reference(),encoded=encodeGenerationInput({prompt:"test"},ref);
    const job={...base,reference:{...ref.metadata,sourceSha256:"c".repeat(64)},retryInput:{policy:1 as const,sha256:encoded.sha256}};
    await expect(readGenerationInput(job,async()=>encoded.bytes,()=>10)).rejects.toMatchObject({code:"base_retry_input_missing"});
    let now=10;
    await expect(readSavedGenerationReference({...base,reference:ref.metadata},async()=>{now=101;return ref.bytes;},()=>now)).rejects.toMatchObject({code:"generation_expired"});
  });
  it("rejects absent or altered reference artifacts; only absent metadata means no image",async()=>{
    expect(await readSavedGenerationReference(base,async()=>null,()=>10)).toBeUndefined();
    const ref=await reference(),job={...base,reference:ref.metadata};
    await expect(readSavedGenerationReference(job,async()=>null,()=>10)).rejects.toMatchObject({code:"saved_stage_unavailable"});
    await expect(readSavedGenerationReference(job,async()=>Buffer.from("bad"),()=>10)).rejects.toMatchObject({code:"saved_stage_unavailable"});
  });
  it("bounds empty/text/name input and preserves old jobs without new metadata",()=>{
    expect(()=>encodeGenerationInput({prompt:""})).toThrow();
    expect(()=>encodeGenerationInput({prompt:"x".repeat(2001)})).toThrow();
    expect(()=>encodeGenerationInput({prompt:"x",displayName:"n".repeat(81)})).toThrow();
    expect(jobSchema.parse(base).retryInput).toBeUndefined();
  });
});

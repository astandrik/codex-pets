import {createHash} from "node:crypto";
import sharp from "sharp";
import {GenerationError,type GenerationInput,type GenerationJob,type GenerationReference} from "@/lib/pets/generation/model";
import {storedGenerationInputSchema,type StoredGenerationInput} from "@/lib/pets/generation/base-retry-model";
import {animatedPng,MAX_REFERENCE_BYTES} from "@/lib/pets/generation/reference-image";

export const GENERATION_INPUT_ARTIFACT = "generation-input.json";
type ReadArtifact = (id:string,kind:string,now:number)=>Promise<Buffer|null>;
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const live=(job:GenerationJob,now:()=>number)=>{if(job.expiresAt<=now())throw new GenerationError("generation_expired");};

export function encodeGenerationInput(input: Omit<GenerationInput,"requestId">,reference?:GenerationReference) {
  const snapshot=storedGenerationInputSchema.parse({version:1,prompt:input.prompt,...(input.displayName!==undefined?{displayName:input.displayName}:{}),...(reference?{reference:{sha256:reference.metadata.sha256,sourceSha256:reference.metadata.sourceSha256}}:{})});
  const bytes=Buffer.from(JSON.stringify(snapshot));
  if(bytes.length>16*1024)throw new GenerationError("invalid_argument");
  return {bytes,sha256:hash(bytes)};
}

export async function readGenerationInput(job:GenerationJob,read:ReadArtifact,now:()=>number):Promise<StoredGenerationInput> {
  live(job,now);
  const bytes=await read(job.id,GENERATION_INPUT_ARTIFACT,now());
  live(job,now);
  if(!job.retryInput || !bytes || bytes.length>16*1024 || hash(bytes)!==job.retryInput.sha256)throw new GenerationError("base_retry_input_missing");
  let value:StoredGenerationInput;
  try {value=storedGenerationInputSchema.parse(JSON.parse(bytes.toString("utf8")));} catch {throw new GenerationError("base_retry_input_missing");}
  if(Boolean(value.reference)!==Boolean(job.reference) || value.reference?.sha256!==job.reference?.sha256 || value.reference?.sourceSha256!==job.reference?.sourceSha256)throw new GenerationError("base_retry_input_missing");
  return value;
}

export async function readSavedGenerationReference(job:GenerationJob,read:ReadArtifact,now:()=>number):Promise<GenerationReference|undefined> {
  live(job,now);
  if(!job.reference)return undefined;
  const bytes=await read(job.id,"reference.png",now());
  live(job,now);
  if(!bytes || bytes.length>MAX_REFERENCE_BYTES || bytes.length!==job.reference.sizeBytes || hash(bytes)!==job.reference.sha256 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || animatedPng(bytes))throw new GenerationError("saved_stage_unavailable");
  try {
    const info=await sharp(bytes,{limitInputPixels:25_000_000,failOn:"warning"}).metadata();
    if(info.format!=="png" || (info.pages??1)!==1 || info.width!==job.reference.width || info.height!==job.reference.height || !info.width || !info.height || info.width>1024 || info.height>1024)throw Error("invalid_reference");
  } catch {throw new GenerationError("saved_stage_unavailable");}
  live(job,now);
  return {bytes,metadata:job.reference};
}

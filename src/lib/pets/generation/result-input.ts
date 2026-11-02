import {createHash} from "node:crypto";
import type {GenerationJob, StageName} from "@/lib/pets/generation/model";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export const resultPromptHash=(job:GenerationJob)=>hash(job.prompt);
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)]));
  return value;
}
export function resultInputHash(job:GenerationJob,stage?:StageName,promptHash=resultPromptHash(job)){
 return hash(JSON.stringify(canonical({pipelineVersion:job.pipelineVersion,promptRevision:job.promptRevision,promptHash,
  reference:job.reference,retryInput:job.retryInput,baseRetrySourceId:job.baseRetrySourceId,
  base:stage!=="base"?job.stages.find(s=>s.name==="base")?.sha256:undefined,baseConfirmedAt:job.baseConfirmedAt,
  continuation:job.continuation,animationRevision:job.animationRevision,
  animationPrompt:job.animationPrompt,animationAnatomyPolicy:job.animationAnatomyPolicy})));
}

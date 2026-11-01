import {z} from "zod";
import {baseRetryInputSchema,digestSchema,type BaseRetryMode} from "@/lib/pets/generation/base-retry-model";
export const BASE_RETRY_PENDING="pets-base-retry-v1:";
const savedSchema=z.object({requestId:z.uuid(),sourceRevision:digestSchema,mode:z.enum(["saved","legacy-image-only","legacy-text"]),fingerprint:digestSchema}).strict();
export type SavedBaseRetryRequest=z.infer<typeof savedSchema>;
export type BaseRetryDraft={sourceRevision:string;mode:BaseRetryMode;prompt?:string};
type StorageReader=Pick<Storage,"getItem">;
export function readBaseRetryRequest(storage:StorageReader,sourceId:string):SavedBaseRetryRequest|null{
  try{const raw=storage.getItem(BASE_RETRY_PENDING+sourceId);if(!raw||raw.length>1024)return null;const result=savedSchema.safeParse(JSON.parse(raw));return result.success?result.data:null;}catch{return null;}
}
export async function prepareBaseRetryRequest(storage:StorageReader&Pick<Storage,"setItem">,sourceId:string,draft:BaseRetryDraft){
  const value=baseRetryInputSchema.parse({requestId:"00000000-0000-4000-8000-000000000000",sourceRevision:draft.sourceRevision,mode:draft.mode,...(draft.mode==="legacy-text"?{prompt:draft.prompt}:{})});
  const bytes=new TextEncoder().encode(JSON.stringify({sourceId,...value,requestId:undefined}));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
  const old=readBaseRetryRequest(storage,sourceId);
  if(old&&(old.sourceRevision!==value.sourceRevision||old.mode!==value.mode||old.fingerprint!==fingerprint))throw Error("base_retry_replay_mismatch");
  const requestId=old?.requestId??crypto.randomUUID();
  const saved={requestId,sourceRevision:value.sourceRevision,mode:value.mode,fingerprint};
  storage.setItem(BASE_RETRY_PENDING+sourceId,JSON.stringify(saved));
  return {input:baseRetryInputSchema.parse({...value,requestId}),isNew:!old,fingerprint};
}
export function clearBaseRetryRequest(storage:StorageReader&Pick<Storage,"removeItem">,sourceId:string,requestId:string){
  if(readBaseRetryRequest(storage,sourceId)?.requestId===requestId)storage.removeItem(BASE_RETRY_PENDING+sourceId);
}

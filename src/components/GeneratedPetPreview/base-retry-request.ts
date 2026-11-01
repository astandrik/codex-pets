import {z} from "zod";
import {baseRetryInputSchema,digestSchema,type BaseRetryMode} from "@/lib/pets/generation/base-retry-model";
export const BASE_RETRY_PENDING="pets-base-retry-v1:";
export const BASE_RETRY_SETTINGS="pets-base-retry-settings-v1:";
const savedSchema=z.object({requestId:z.uuid(),sourceRevision:digestSchema,mode:z.enum(["saved","legacy-image-only","legacy-text"]),fingerprint:digestSchema}).strict();
const settingsSchema=z.object({requestId:z.uuid(),maxRetries:z.number().int().min(0).max(50).nullable()}).strict();
export type SavedBaseRetryRequest=z.infer<typeof savedSchema>;
export type BaseRetryDraft={sourceRevision:string;mode:BaseRetryMode;prompt?:string;maxRetries?:number};
type StorageReader=Pick<Storage,"getItem">;
const settingsKey=(sourceId:string,requestId:string)=>BASE_RETRY_SETTINGS+sourceId+":"+requestId;
function parseSaved(raw:string|null):SavedBaseRetryRequest|null{
  try{if(!raw||raw.length>1024)return null;const result=savedSchema.safeParse(JSON.parse(raw));return result.success?result.data:null;}catch{return null;}
}
export function readBaseRetryRequest(storage:StorageReader,sourceId:string):SavedBaseRetryRequest|null{
  try{return parseSaved(storage.getItem(BASE_RETRY_PENDING+sourceId));}catch{return null;}
}
export function readBaseRetrySettings(storage:StorageReader,sourceId:string,requestId:string):z.infer<typeof settingsSchema>|null{
  try{const raw=storage.getItem(settingsKey(sourceId,requestId));if(!raw||new TextEncoder().encode(raw).length>4096)return null;const result=settingsSchema.safeParse(JSON.parse(raw));return result.success&&result.data.requestId===requestId?result.data:null;}catch{return null;}
}
export async function prepareBaseRetryRequest(storage:StorageReader&Pick<Storage,"setItem"|"removeItem">,sourceId:string,draft:BaseRetryDraft){
  const value=baseRetryInputSchema.parse({requestId:"00000000-0000-4000-8000-000000000000",sourceRevision:draft.sourceRevision,mode:draft.mode,...(draft.mode==="legacy-text"?{prompt:draft.prompt}:{}),...(draft.maxRetries===undefined?{}:{maxRetries:draft.maxRetries})});
  const pointerKey=BASE_RETRY_PENDING+sourceId,previousPointer=storage.getItem(pointerKey),old=parseSaved(previousPointer);
  // Preserve the byte-for-byte legacy hash when no retry count was supplied.
  const bytes=new TextEncoder().encode(JSON.stringify({sourceId,...value,requestId:undefined}));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
  if(storage.getItem(pointerKey)!==previousPointer||old&&(old.sourceRevision!==value.sourceRevision||old.mode!==value.mode||old.fingerprint!==fingerprint))throw Error("base_retry_replay_mismatch");
  const requestId=old?.requestId??crypto.randomUUID();
  const saved={requestId,sourceRevision:value.sourceRevision,mode:value.mode,fingerprint};
  const key=settingsKey(sourceId,requestId),previous=storage.getItem(key),raw=JSON.stringify({requestId,maxRetries:value.maxRetries??null});
  try{
    storage.setItem(key,raw);
    if(storage.getItem(pointerKey)!==previousPointer)throw Error("base_retry_replay_mismatch");
    storage.setItem(pointerKey,JSON.stringify(saved));
  }catch(error){
    try{if(previous!==raw&&storage.getItem(key)===raw){if(previous===null)storage.removeItem(key);else storage.setItem(key,previous);}}catch{/* A failed rollback still blocks POST. */}
    throw error;
  }
  return {input:baseRetryInputSchema.parse({...value,requestId}),isNew:!old,fingerprint};
}
export function clearBaseRetryRequest(storage:StorageReader&Pick<Storage,"removeItem">,sourceId:string,requestId:string){
  storage.removeItem(settingsKey(sourceId,requestId));
  if(readBaseRetryRequest(storage,sourceId)?.requestId===requestId)storage.removeItem(BASE_RETRY_PENDING+sourceId);
}

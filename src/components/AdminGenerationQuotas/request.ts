import { z } from "zod";
import { MAX_EXTRA_ATTEMPTS } from "@/lib/pets/generation/quota-limits";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export const GRANT_STORAGE_KEY = "pets-admin-quota-grant";
const savedSchema = z.object({ hash:z.string().regex(/^[a-f0-9]{64}$/), requestId:z.uuid(),
  amount:z.number().int().min(1).max(MAX_EXTRA_ATTEMPTS),day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),state:z.enum(["pending","completed"]) }).strict();
function read(storage:Storage){
 const text=storage.getItem(GRANT_STORAGE_KEY);if(!text)return null;
 try{return savedSchema.parse(JSON.parse(text));}catch{throw Error('grant_receipt_invalid');}
}
export function readPendingQuotaGrant(storage:Storage){const saved=read(storage);return saved?.state==='pending'?saved:null;}
export function completeQuotaGrant(storage:Storage,requestId:string){
 const saved=read(storage);if(!saved||saved.requestId!==requestId)throw Error('grant_receipt_mismatch');
 storage.setItem(GRANT_STORAGE_KEY,JSON.stringify({...saved,state:'completed'}));
}
export async function prepareQuotaGrant(storage:Storage,body:{ip:string;amount:number;day:string}){
 const input={ip:body.ip.trim(),amount:body.amount,day:body.day};
 const bytes=new TextEncoder().encode(JSON.stringify(input));
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 const saved=read(storage);
 if(saved?.state==='pending'&&saved.hash!==hash)throw Error('pending_grant_mismatch');
 const requestId=saved?.state==='pending'?saved.requestId:crypto.randomUUID();
 storage.setItem(GRANT_STORAGE_KEY,JSON.stringify({hash,requestId,amount:input.amount,day:input.day,state:'pending'}));
 return{...input,requestId};
}

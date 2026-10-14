import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prepareQuotaGrant, completeQuotaGrant, readPendingQuotaGrant, GRANT_STORAGE_KEY } from "./request";
afterEach(()=>vi.unstubAllGlobals());
function fixture(){vi.stubGlobal('crypto',webcrypto);const values=new Map<string,string>();return{values,storage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}}};}
it("preserves an unknown grant across reload and refuses a different amount/day/IP",async()=>{
 const{values,storage}=fixture();const body={ip:'203.0.113.5',amount:100,day:'2026-10-11'};const a=await prepareQuotaGrant(storage,body);
 expect(readPendingQuotaGrant(storage)).toMatchObject({amount:100,day:body.day,requestId:a.requestId});
 expect((await prepareQuotaGrant(storage,body)).requestId).toBe(a.requestId);
 for(const other of [{...body,amount:1},{...body,ip:'203.0.113.6'},{...body,day:'2026-10-12'}])await expect(prepareQuotaGrant(storage,other)).rejects.toThrow('pending_grant_mismatch');
 expect(values.get(GRANT_STORAGE_KEY)).not.toContain(body.ip);
 completeQuotaGrant(storage,a.requestId);expect(readPendingQuotaGrant(storage)).toBeNull();
 expect((await prepareQuotaGrant(storage,{...body,day:'2026-10-12'})).requestId).not.toBe(a.requestId);
});
it("fails before mutation if browser request identity cannot be saved or parsed",async()=>{
 const{storage}=fixture();await expect(prepareQuotaGrant({...storage,setItem:()=>{throw Error('storage disabled');}},{ip:'203.0.113.5',amount:1,day:'2026-10-11'})).rejects.toThrow('storage disabled');
 storage.setItem(GRANT_STORAGE_KEY,'not-json');await expect(prepareQuotaGrant(storage,{ip:'203.0.113.5',amount:1,day:'2026-10-11'})).rejects.toThrow('grant_receipt_invalid');
});
it("starts a new operation for a deliberately repeated grant after a confirmed completion",async()=>{
 const{storage}=fixture();const body={ip:'203.0.113.5',amount:2,day:'2026-10-11'};
 const first=await prepareQuotaGrant(storage,body);completeQuotaGrant(storage,first.requestId);
 const afterReload=await prepareQuotaGrant(storage,body);expect(afterReload.requestId).not.toBe(first.requestId);
 expect((await prepareQuotaGrant(storage,body)).requestId).toBe(afterReload.requestId);
});

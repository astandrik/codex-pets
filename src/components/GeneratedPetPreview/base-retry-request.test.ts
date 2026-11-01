import {webcrypto} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {readBaseRetryRequest,prepareBaseRetryRequest,clearBaseRetryRequest,BASE_RETRY_PENDING} from "./base-retry-request";
afterEach(()=>vi.unstubAllGlobals());
function storage(){const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};}
it("persists only identity/fingerprint and reuses it for unchanged input",async()=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64),body={sourceRevision:"b".repeat(64),mode:"legacy-text" as const,prompt:"Private input"};
 const first=await prepareBaseRetryRequest(s,id,body),second=await prepareBaseRetryRequest(s,id,body);
 expect(first.isNew).toBe(true);expect(second.isNew).toBe(false);expect(second.input.requestId).toBe(first.input.requestId);
 expect([...s.data.values()].join()).not.toContain(body.prompt);
 await expect(prepareBaseRetryRequest(s,id,{...body,prompt:"Changed"})).rejects.toThrow("base_retry_replay_mismatch");
 expect(readBaseRetryRequest(s,id)?.requestId).toBe(first.input.requestId);
});
it("does not clear another tab's request and rejects unwritable storage",async()=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64);
 const a=await prepareBaseRetryRequest(s,id,{sourceRevision:"b".repeat(64),mode:"saved"});
 clearBaseRetryRequest(s,id,"00000000-0000-4000-8000-000000000000");expect(s.data.has(BASE_RETRY_PENDING+id)).toBe(true);
 clearBaseRetryRequest(s,id,a.input.requestId);expect(s.data.size).toBe(0);
 await expect(prepareBaseRetryRequest({...s,setItem:()=>{throw Error("storage");}},id,{sourceRevision:"b".repeat(64),mode:"saved"})).rejects.toThrow("storage");
});

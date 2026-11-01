import {webcrypto} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {readBaseRetryRequest,prepareBaseRetryRequest,clearBaseRetryRequest,BASE_RETRY_PENDING,BASE_RETRY_SETTINGS,readBaseRetrySettings} from "./base-retry-request";
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

it.each([0,1,5,50])("stores retry policy %s separately and binds it to the replay fingerprint",async maxRetries=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64),draft={sourceRevision:"b".repeat(64),mode:"saved" as const,maxRetries};
 const first=await prepareBaseRetryRequest(s,id,draft);
 expect(first.input.maxRetries).toBe(maxRetries);
 expect(JSON.parse(s.getItem(BASE_RETRY_PENDING+id)!)).toEqual({requestId:first.input.requestId,sourceRevision:draft.sourceRevision,mode:"saved",fingerprint:first.fingerprint});
 expect(readBaseRetrySettings(s,id,first.input.requestId)).toEqual({requestId:first.input.requestId,maxRetries});
 await expect(prepareBaseRetryRequest(s,id,{...draft,maxRetries:maxRetries===50?0:50})).rejects.toThrow("base_retry_replay_mismatch");
});
it("preserves the legacy fingerprint and explicitly stores legacy omission",async()=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64),draft={sourceRevision:"b".repeat(64),mode:"saved" as const};
 const a=await prepareBaseRetryRequest(s,id,draft);
 const expected=Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({sourceId:id,sourceRevision:draft.sourceRevision,mode:"saved"})))),x=>x.toString(16).padStart(2,"0")).join("");
 expect(a.fingerprint).toBe(expected);expect(a.input).not.toHaveProperty("maxRetries");
 expect(readBaseRetrySettings(s,id,a.input.requestId)?.maxRetries).toBeNull();
});
it.each(["", "{}", "x".repeat(4097), JSON.stringify({requestId:"00000000-0000-4000-8000-000000000000",maxRetries:51}), JSON.stringify({requestId:"00000000-0000-4000-8000-000000000000",maxRetries:5,extra:true})])("rejects corrupt settings without losing identity",async raw=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64),a=await prepareBaseRetryRequest(s,id,{sourceRevision:"b".repeat(64),mode:"saved"});
 s.setItem(BASE_RETRY_SETTINGS+id+":"+a.input.requestId,raw);
 expect(readBaseRetrySettings(s,id,a.input.requestId)).toBeNull();expect(readBaseRetryRequest(s,id)?.requestId).toBe(a.input.requestId);
});
it.each([false,true])("rolls back only own settings when identity write fails, rollback failure=%s",async rollbackFails=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64);let settingsKey="";
 const failing={...s,setItem:(key:string,value:string)=>{if(key.startsWith(BASE_RETRY_PENDING))throw Error("pointer failed");settingsKey=key;s.setItem(key,value);},removeItem:(key:string)=>{if(rollbackFails)throw Error("rollback failed");s.removeItem(key);}};
 await expect(prepareBaseRetryRequest(failing,id,{sourceRevision:"b".repeat(64),mode:"saved",maxRetries:5})).rejects.toThrow("pointer failed");
 expect(s.getItem(BASE_RETRY_PENDING+id)).toBeNull();expect(s.getItem(settingsKey)===null).toBe(!rollbackFails);
});
it("does not overwrite an operation appearing during the fingerprint digest",async()=>{
 const s=storage(),id="a".repeat(64);vi.stubGlobal("crypto",webcrypto);const foreign=await prepareBaseRetryRequest(s,id,{sourceRevision:"b".repeat(64),mode:"saved",maxRetries:1});const raw=s.getItem(BASE_RETRY_PENDING+id)!;s.removeItem(BASE_RETRY_PENDING+id);
 vi.stubGlobal("crypto",{randomUUID:webcrypto.randomUUID.bind(webcrypto),subtle:{digest:async(...args:Parameters<typeof webcrypto.subtle.digest>)=>{s.setItem(BASE_RETRY_PENDING+id,raw);return webcrypto.subtle.digest(...args);}}});
 await expect(prepareBaseRetryRequest(s,id,{sourceRevision:"b".repeat(64),mode:"saved",maxRetries:5})).rejects.toThrow("base_retry_replay_mismatch");
 expect(readBaseRetryRequest(s,id)?.requestId).toBe(foreign.input.requestId);expect(readBaseRetrySettings(s,id,foreign.input.requestId)?.maxRetries).toBe(1);
});
it("preserves other-tab settings during failed writes and cleanup",async()=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64),draft={sourceRevision:"b".repeat(64),mode:"saved" as const,maxRetries:5};const a=await prepareBaseRetryRequest(s,id,draft),key=BASE_RETRY_SETTINGS+id+":"+a.input.requestId,foreign=JSON.stringify({requestId:a.input.requestId,maxRetries:1});
 const failing={...s,setItem:(k:string,v:string)=>{if(k.startsWith(BASE_RETRY_PENDING)){s.setItem(key,foreign);throw Error("pointer failed");}s.setItem(k,v);}};
 await expect(prepareBaseRetryRequest(failing,id,draft)).rejects.toThrow("pointer failed");expect(s.getItem(key)).toBe(foreign);
 const foreignId="00000000-0000-4000-8000-000000000000";s.setItem(BASE_RETRY_SETTINGS+id+":"+foreignId,JSON.stringify({requestId:foreignId,maxRetries:0}));s.setItem(BASE_RETRY_PENDING+id,JSON.stringify({...readBaseRetryRequest(s,id),requestId:foreignId}));
 clearBaseRetryRequest(s,id,a.input.requestId);expect(readBaseRetryRequest(s,id)?.requestId).toBe(foreignId);expect(readBaseRetrySettings(s,id,foreignId)?.maxRetries).toBe(0);
});

it("restores previous settings after a partial pointer failure",async()=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64),draft={sourceRevision:"b".repeat(64),mode:"saved" as const,maxRetries:5};const a=await prepareBaseRetryRequest(s,id,draft),key=BASE_RETRY_SETTINGS+id+":"+a.input.requestId;s.setItem(key,"previous corrupt settings");
 await expect(prepareBaseRetryRequest({...s,setItem:(k:string,v:string)=>{if(k.startsWith(BASE_RETRY_PENDING))throw Error("pointer failed");s.setItem(k,v);}},id,draft)).rejects.toThrow("pointer failed");expect(s.getItem(key)).toBe("previous corrupt settings");expect(readBaseRetryRequest(s,id)?.requestId).toBe(a.input.requestId);
});
it("rolls back a settings write that mutates and then throws",async()=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64);
 await expect(prepareBaseRetryRequest({...s,setItem:(k:string,v:string)=>{s.setItem(k,v);throw Error("partial write");}},id,{sourceRevision:"b".repeat(64),mode:"saved",maxRetries:5})).rejects.toThrow("partial write");expect(s.data.size).toBe(0);
});
it("preserves a pointer replaced while settings are written",async()=>{
 vi.stubGlobal("crypto",webcrypto);const s=storage(),id="a".repeat(64),draft={sourceRevision:"b".repeat(64),mode:"saved" as const};const foreign=await prepareBaseRetryRequest(s,id,draft),raw=s.getItem(BASE_RETRY_PENDING+id)!;s.removeItem(BASE_RETRY_PENDING+id);
 await expect(prepareBaseRetryRequest({...s,setItem:(k:string,v:string)=>{s.setItem(k,v);if(k.startsWith(BASE_RETRY_SETTINGS))s.setItem(BASE_RETRY_PENDING+id,raw);}},id,{...draft,maxRetries:5})).rejects.toThrow("base_retry_replay_mismatch");expect(readBaseRetryRequest(s,id)?.requestId).toBe(foreign.input.requestId);expect(readBaseRetrySettings(s,id,foreign.input.requestId)?.maxRetries).toBeNull();
});

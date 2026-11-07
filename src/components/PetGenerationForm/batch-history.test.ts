import {describe,expect,it} from 'vitest';
import {createBatch,type ImageBatch} from './batch-model';
import {synchronizeBatchHistory} from './batch-history';
import type {BatchStore} from './batch-store';
import {HISTORY_V2_PREFIX,readGenerationHistory,type HistoryGenerationReference,reconcileGenerationHistoryReceipt,rememberGenerationVersion} from '@/lib/pets/generation/history';

function fixture(){
 const now=Date.parse('2026-11-07T10:00:00Z'),savedAt=now-20000;
 let batch:ImageBatch=createBatch(now);
 const receipt={generationId:'a'.repeat(64),createdAt:new Date(savedAt).toISOString(),expiresAt:new Date(now+86400000-20000).toISOString()};
 batch.items=[{id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'x.png',type:'image/png',state:'accepted',receipt,historyPending:true,historySavedAt:savedAt}];
 const map=new Map<string,string>();let denied=false;
 const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{if(denied)throw Error('quota');map.set(k,v);},removeItem:(k:string)=>{map.delete(k);},key:(i:number)=>[...map.keys()][i]??null,get length(){return map.size;}};
 const store:BatchStore={read:async()=>structuredClone(batch),update:async(id,fn)=>{expect(id).toBe(batch.id);batch=fn(structuredClone(batch));},add:async()=>{},clear:async()=>{},maintain:async()=>{},readFile:async()=>null,readPreview:async()=>null};
 const write=(r:HistoryGenerationReference,s:number,n=Date.now())=>reconcileGenerationHistoryReceipt(r,s,n,storage);
 return {store,storage,map,write,now,savedAt,get:()=>batch,deny:(v:boolean)=>{denied=v;}};
}
describe('durable batch history delivery',()=>{
 it('completes an interrupted history write without changing identity, order or expiry',async()=>{
  const f=fixture();await synchronizeBatchHistory(f.store,f.get().id,f.now,f.write);
  const first=readGenerationHistory(f.now,f.storage).entries[0];
  expect(first.savedAt).toBe(f.savedAt);expect(f.get().items[0].historyPending).toBe(false);
  await synchronizeBatchHistory(f.store,f.get().id,f.now+1000,f.write);
  expect(readGenerationHistory(f.now+1000,f.storage).entries).toEqual([first]);
 });
 it('retries only the local acknowledgement after history succeeded and IndexedDB failed',async()=>{
  const f=fixture(),update=f.store.update;let fail=true;
  f.store.update=async(id,fn,edits)=>{if(fail){fail=false;throw Error('ack failed');}return update(id,fn,edits);};
  await expect(synchronizeBatchHistory(f.store,f.get().id,f.now,f.write)).rejects.toThrow('ack failed');
  const first=f.map.get(HISTORY_V2_PREFIX+'a'.repeat(64));
  expect(first).toBeTruthy();expect(f.get().items[0].historyPending).toBe(true);
  await synchronizeBatchHistory(f.store,f.get().id,f.now+1000,f.write);
  expect(f.map.get(HISTORY_V2_PREFIX+'a'.repeat(64))).toBe(first);expect(f.get().items[0].historyPending).toBe(false);
 });
 it('keeps the receipt and pending flag while localStorage is unavailable',async()=>{
  const f=fixture();f.deny(true);await synchronizeBatchHistory(f.store,f.get().id,f.now,f.write);
  expect(f.get().items[0].receipt?.generationId).toBe('a'.repeat(64));expect(f.get().items[0].historyWarning).toBe(true);
  f.deny(false);await synchronizeBatchHistory(f.store,f.get().id,f.now+1000,f.write);expect(f.get().items[0].historyPending).toBe(false);
 });
 it('does not revive an older family outside the latest 50',async()=>{
  const f=fixture();for(let i=1;i<=50;i++)expect(rememberGenerationVersion({generationId:i.toString(16).padStart(64,'0'),createdAt:new Date(f.now+i).toISOString(),expiresAt:new Date(f.now+86400000).toISOString()},undefined,f.now+100,f.storage)).toBe(true);
  const before=readGenerationHistory(f.now+100,f.storage);
  await synchronizeBatchHistory(f.store,f.get().id,f.now+100,f.write);
  expect(readGenerationHistory(f.now+100,f.storage)).toEqual(before);expect(f.map.has(HISTORY_V2_PREFIX+'a'.repeat(64))).toBe(false);expect(f.get().items[0].historyPending).toBe(false);
 });
 it('only imports legacy receipts that explicitly report a history error',async()=>{
  const f=fixture();delete f.get().items[0].historyPending;delete f.get().items[0].historySavedAt;
  await synchronizeBatchHistory(f.store,f.get().id,f.now,f.write);expect(f.map.size).toBe(0);
  f.get().items[0].historyWarning=true;await synchronizeBatchHistory(f.store,f.get().id,f.now,f.write);expect(f.get().items[0].historyPending).toBe(false);expect(readGenerationHistory(f.now,f.storage).entries).toHaveLength(1);
 });
 it('acknowledges expiration without extending the result or adding a row',async()=>{
  const f=fixture(),expiry=f.get().items[0].receipt!.expiresAt;
  await synchronizeBatchHistory(f.store,f.get().id,f.now+2*86400000,f.write);
  expect(f.get().items[0].receipt!.expiresAt).toBe(expiry);expect(f.get().items[0].historyPending).toBe(false);expect(f.map.size).toBe(0);
 });
});

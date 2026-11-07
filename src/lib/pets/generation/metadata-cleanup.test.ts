import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {applyMetadataCleanup,createCleanupManifest,prepareCleanupBackup,planMetadataCleanup,type RawJob,type CleanupStore} from './metadata-cleanup';
const now=Date.now();
const id='a'.repeat(64);
const bytes=Buffer.from('synthetic PNG bytes');
const hash=createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const payload=`{ "id":"${id}", "unknown":9007199254740993123,"expiresAt":${now+100000},"stages":[{"name":"base","bytes":${JSON.stringify(bytes)},"status":"completed","sha256":"${hash}","usage":{"costUsd":0.1},"opaque":{"bytes":[1,2],"text":"comma, and \\\"quote\\\""}}] }`;
  let row:RawJob={id,payload,expiresMicros:String((now+100000)*1000)};
  let active=false,artifact:Buffer|null=bytes;
  const untouched={uuidReceipt:'same-id',spent:100000,unknownSlots:3,attempts:1};
  const store:CleanupStore={transaction:async operation=>{
    let next=row;
    const result=await operation({read:async()=>next,active:async()=>active,artifact:async()=>artifact?{bytes:artifact,expiresMicros:String((now+100000)*1000)}:null,updatePayload:async(_id,payload)=>{next={...next,payload};}});
    row=next;return result;
  }};
  return {store,row:()=>row,setRow:(value:RawJob)=>{row=value;},setActive:(value:boolean)=>{active=value;},setArtifact:(value:Buffer|null)=>{artifact=value;},untouched};
}
it('cleans only the duplicate bytes and restores the original text exactly',async()=>{
  const f=fixture(),original=f.row();const before=structuredClone(f.untouched);
  const manifest=await createCleanupManifest(f.store,[id],()=>now);
  expect(manifest.entries[0].status).toBe('eligible');
  const backup=await prepareCleanupBackup(f.store,manifest,()=>now);
  expect(await applyMetadataCleanup(f.store,backup,()=>now)).toEqual([id]);
  expect(f.row().expiresMicros).toBe(original.expiresMicros);
  expect(f.row().payload).toContain('9007199254740993123');
  const cleaned=JSON.parse(f.row().payload);
  expect(cleaned.stages[0]).not.toHaveProperty('bytes');
  expect(cleaned.stages[0].opaque.bytes).toEqual([1,2]);
  expect(await applyMetadataCleanup(f.store,backup,()=>now)).toEqual([]);
  expect(f.untouched).toEqual(before);
  expect(await applyMetadataCleanup(f.store,backup,()=>now,true)).toEqual([id]);
  expect(f.row()).toEqual(original);
});
it.each(['first','middle','last'])('preserves valid JSON when bytes is the %s property',async position=>{
  const order=position==='first'?['bytes','name','status','sha256']:position==='last'?['name','status','sha256','bytes']:['name','bytes','status','sha256'];
  const fields:Record<string,unknown>={bytes,name:'base',status:'completed',sha256:hash};
  const payload=JSON.stringify({id,expiresAt:now+1000,stages:[Object.fromEntries(order.map(key=>[key,fields[key]]))]});
  const result=await planMetadataCleanup({id,payload,expiresMicros:String((now+1000)*1000)},async()=>({bytes,expiresMicros:String((now+100000)*1000)}),now,false);
  expect(result.entry.status).toBe('eligible');expect(JSON.parse(result.payload).stages).toEqual([{name:'base',status:'completed',sha256:hash}]);
});
it.each(['active','expired','missing','mismatch'])('skips %s without modifying payload',async reason=>{
  const f=fixture(),row=f.row();
  if(reason==='active')f.setActive(true);
  if(reason==='expired')f.setRow({...row,expiresMicros:String(now*1000)});
  if(reason==='missing')f.setArtifact(null);
  if(reason==='mismatch')f.setArtifact(Buffer.from('different'));
  const manifest=await createCleanupManifest(f.store,[id],()=>now);
  expect(manifest.entries[0].status).toBe('skipped');expect(f.row().payload).toBe(row.payload);
});
it('rejects a corrupt backup before any write and rejects concurrent changes',async()=>{
  const f=fixture();const manifest=await createCleanupManifest(f.store,[id],()=>now);const backup=await prepareCleanupBackup(f.store,manifest,()=>now);
  const original=f.row();const corrupt=structuredClone(backup);corrupt.rows[0].payload+=' ';
  await expect(applyMetadataCleanup(f.store,corrupt,()=>now)).rejects.toThrow('invalid_backup');expect(f.row()).toEqual(original);
  f.setRow({...original,payload:original.payload+' '});
  await expect(applyMetadataCleanup(f.store,backup,()=>now)).rejects.toThrow('job_changed');
  await expect(prepareCleanupBackup(f.store,manifest,()=>now)).rejects.toThrow('job_changed');
});
it('refuses rollback over newer work and never resurrects expired data',async()=>{
  const f=fixture();const backup=await prepareCleanupBackup(f.store,await createCleanupManifest(f.store,[id],()=>now),()=>now);
  await applyMetadataCleanup(f.store,backup,()=>now);f.setRow({...f.row(),payload:f.row().payload+' '});
  await expect(applyMetadataCleanup(f.store,backup,()=>now,true)).rejects.toThrow('job_changed');
  await expect(applyMetadataCleanup(f.store,backup,()=>now+200000,true)).rejects.toThrow('job_changed');
});
it('treats a lost acknowledgement as already applied on the next run',async()=>{
  const f=fixture();const backup=await prepareCleanupBackup(f.store,await createCleanupManifest(f.store,[id],()=>now),()=>now);
  const normal=f.store.transaction;let lose=true;
  f.store.transaction=async fn=>{const value=await normal(fn);if(lose){lose=false;throw Error('lost acknowledgement');}return value;};
  await expect(applyMetadataCleanup(f.store,backup,()=>now)).rejects.toThrow('lost acknowledgement');
  expect(await applyMetadataCleanup(f.store,backup,()=>now)).toEqual([]);
});

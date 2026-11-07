import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {applyMetadataCleanup,createCleanupManifest,prepareCleanupBackup,type CleanupStore,type RawJob} from './metadata-cleanup';

const id='a'.repeat(64);
const bytes=Buffer.from([1,2,3]);
const sha256=createHash('sha256').update(bytes).digest('hex');
function fixture(logicalExpiry=9000,physicalExpiry='9000000',artifactExpiry='9000000') {
  let clock=1000;
  let afterArtifactRead: (()=>void)|undefined;
  let writes=0;
  let row:RawJob={id,expiresMicros:physicalExpiry,payload:JSON.stringify({id,expiresAt:logicalExpiry,stages:[{name:'base',status:'completed',sha256,bytes}],unknown:'preserved'})};
  const store:CleanupStore={transaction:async run=>{
    let proposed=row;
    const value=await run({
      read:async()=>row,
      active:async()=>false,
      artifact:async()=>{afterArtifactRead?.();return {bytes,expiresMicros:artifactExpiry};},
      updatePayload:async(_id,payload)=>{writes++;proposed={...row,payload};},
    });
    row=proposed;return value;
  }};
  return {store,now:()=>clock,row:()=>row,writes:()=>writes,advanceDuringRead:(to:number)=>{afterArtifactRead=()=>{clock=to;};}};
}
it.each([false,true])('rejects a job whose JSON expiry passes during artifact I/O, restore=%s',async restore=>{
  const f=fixture(2000);
  const manifest=await createCleanupManifest(f.store,[id],f.now);
  const backup=await prepareCleanupBackup(f.store,manifest,f.now);
  if(restore)await applyMetadataCleanup(f.store,backup,f.now);
  const before={row:structuredClone(f.row()),writes:f.writes()};
  f.advanceDuringRead(3000);
  await expect(applyMetadataCleanup(f.store,backup,f.now,restore)).rejects.toThrow('job_changed');
  expect(f.row()).toEqual(before.row);expect(f.writes()).toBe(before.writes);
});
it.each([false,true])('rejects an artifact whose TTL passes during I/O, restore=%s',async restore=>{
  const f=fixture(9000,'9000000','2000000');
  const backup=await prepareCleanupBackup(f.store,await createCleanupManifest(f.store,[id],f.now),f.now);
  if(restore)await applyMetadataCleanup(f.store,backup,f.now);
  const before={row:structuredClone(f.row()),writes:f.writes()};
  f.advanceDuringRead(2000);
  await expect(applyMetadataCleanup(f.store,backup,f.now,restore)).rejects.toThrow('job_changed');
  expect(f.row()).toEqual(before.row);expect(f.writes()).toBe(before.writes);
});
it('rejects the native row deadline and preserves sub-millisecond artifact expiry',async()=>{
  const f=fixture(9000,'2000000','1999999');
  const backup=await prepareCleanupBackup(f.store,await createCleanupManifest(f.store,[id],f.now),f.now);
  const before=structuredClone(f.row());f.advanceDuringRead(2000);
  await expect(applyMetadataCleanup(f.store,backup,f.now)).rejects.toThrow('job_changed');
  expect(f.row()).toEqual(before);expect(f.writes()).toBe(0);
});
it('keeps applying and restoring when every deadline remains in the future',async()=>{
  const f=fixture();
  const original=structuredClone(f.row());
  const backup=await prepareCleanupBackup(f.store,await createCleanupManifest(f.store,[id],f.now),f.now);
  f.advanceDuringRead(1500);
  expect(await applyMetadataCleanup(f.store,backup,f.now)).toEqual([id]);
  expect(await applyMetadataCleanup(f.store,backup,f.now)).toEqual([]);
  expect(await applyMetadataCleanup(f.store,backup,f.now,true)).toEqual([id]);
  expect(f.row()).toEqual(original);
});

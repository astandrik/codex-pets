import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runMetadataCleanup,parseMetadataCleanupArgs} from './clean-generation-metadata.mjs';
const dirs=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
it('defaults to dry-run and writes no backup or application data',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'metadata-cleanup-'));dirs.push(dir);
 const ids=path.join(dir,'ids.json');await writeFile(ids,JSON.stringify(['a'.repeat(64)]));
 const apply=vi.fn(),backup=vi.fn();
 const result=await runMetadataCleanup(['--ids-file='+ids],{plan:async()=>({version:1,entries:[]}),apply,backup});
 expect(result.mode).toBe('dry-run');expect(apply).not.toHaveBeenCalled();expect(backup).not.toHaveBeenCalled();
});
it('persists and rereads a private backup before applying and reuses it after a lost response',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'metadata-cleanup-'));dirs.push(dir);
 const manifest={version:1,entries:[]},manifestFile=path.join(dir,'manifest.json'),backupFile=path.join(dir,'backup.json');
 await writeFile(manifestFile,JSON.stringify(manifest),{mode:0o600});
 const checksum=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
 const snapshot={version:1,manifest,rows:[]};
 const backup=vi.fn(async()=>snapshot),apply=vi.fn(async data=>{
  expect(JSON.parse(await readFile(backupFile,'utf8'))).toEqual(data);
  expect((await stat(backupFile)).mode&0o777).toBe(0o600);
  if(apply.mock.calls.length===1)throw Error('lost acknowledgement');
  return [];
 });
 const args=['--apply','--manifest='+manifestFile,'--backup='+backupFile,'--expected-manifest-sha256='+checksum];
 await expect(runMetadataCleanup(args,{backup,apply})).rejects.toThrow('lost acknowledgement');
 expect((await runMetadataCleanup(args,{backup,apply})).changed).toEqual([]);expect(backup).toHaveBeenCalledTimes(1);
 await writeFile(backupFile,JSON.stringify({...snapshot,manifest:{version:1,entries:[{}]}}),{mode:0o600});
 await expect(runMetadataCleanup(args,{backup,apply})).rejects.toThrow('backup_manifest_mismatch');expect(apply).toHaveBeenCalledTimes(2);
});
it('requires exact manifest identity for every mutation',()=>{
 expect(()=>parseMetadataCleanupArgs(['--apply'])).toThrow();
 expect(()=>parseMetadataCleanupArgs(['--scan','--apply'])).toThrow();
 expect(()=>parseMetadataCleanupArgs(['--restore','--manifest=/tmp/m','--backup=/tmp/b'])).toThrow();
});

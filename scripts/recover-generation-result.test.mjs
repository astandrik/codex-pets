import {afterEach,expect,it,vi} from 'vitest';import {parseRecoveryArgs,runRecoveryCommand,writeRecoveryBackup} from './recover-generation-result.mjs';
import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {tmpdir} from 'node:os';import path from 'node:path';
const directories=[],originalOpen=fs.promises.open;
afterEach(async()=>{fs.promises.open=originalOpen;syncBuiltinESMExports();for(const directory of directories.splice(0))await fs.promises.rm(directory,{recursive:true,force:true});});
const record='a'.repeat(64),base=[`--record=${record}`,'--journal-dir=/private/journal'];
it('defaults to dry-run and does not confirm or write backup',async()=>{
 const confirm=vi.fn(),backup=vi.fn(),recover=vi.fn(async()=>({mode:'image',applied:false}));
 const deps={openJournal:async()=>({read:async()=>({identity:{jobId:'id'},fingerprint:'f'}),confirm}),snapshot:async()=>({revision:1,jobHash:'h'}),recover,backup};
 const result=await runRecoveryCommand(base,deps);expect(result.applied).toBe(false);expect(backup).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();expect(recover.mock.calls[0][1].apply).toBe(false);
});
it.each([false,true])('syncs the backup directory before apply and blocks apply on sync failure=%s',async fail=>{
 const directory=await fs.promises.mkdtemp(path.join(tmpdir(),'checkpoint-backup-'));directories.push(directory);const file=path.join(directory,'before.json'),events=[];
 fs.promises.open=async(...args)=>{const handle=await originalOpen(...args);return {writeFile:(...values)=>handle.writeFile(...values),close:()=>handle.close(),sync:async()=>{events.push(args[0]===directory?'directory':'file');if(args[0]===directory&&fail)throw Error('directory fsync failed');await handle.sync();}};};syncBuiltinESMExports();
 const recover=vi.fn(async(_record,options)=>{if(options.apply)events.push('apply');return {mode:'image',applied:Boolean(options.apply)};}),confirm=vi.fn();
 const deps={openJournal:async()=>({read:async()=>({identity:{jobId:'id'},fingerprint:'f'}),confirm}),snapshot:async()=>({revision:1,jobHash:null}),recover,backup:writeRecoveryBackup};
 const operation=runRecoveryCommand([...base,'--apply','--expected-revision=1','--expected-job-hash=absent',`--backup=${file}`],deps);
 if(fail){await expect(operation).rejects.toThrow('directory fsync failed');expect(events).toEqual(['file','directory']);expect(confirm).not.toHaveBeenCalled();}
 else{await operation;expect(events).toEqual(['file','directory','apply']);expect(confirm).toHaveBeenCalledTimes(1);}
});
it('requires explicit expectations and a private backup destination for apply',()=>{
 expect(()=>parseRecoveryArgs([...base,'--apply'])).toThrow();
 expect(parseRecoveryArgs([...base,'--apply','--expected-revision=1','--expected-job-hash=absent','--backup=/private/backup'])).toMatchObject({apply:true,expectedJobHash:null});
 expect(()=>parseRecoveryArgs([...base,'--record=../file'])).toThrow();
});

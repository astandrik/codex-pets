import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {register} from 'node:module';
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
export function parseRecoveryArgs(args){
 const value=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
 const allowed=/^(--apply|--record=[a-f0-9]{64}|--expected-revision=\d+|--expected-job-hash=(absent|[a-f0-9]{64})|--journal-dir=.+|--backup=.+)$/;
 if(args.some(a=>!allowed.test(a))||new Set(args.map(a=>a.split('=')[0])).size!==args.length)throw Error('invalid_arguments');
 const record=value('record'),directory=value('journal-dir'),apply=args.includes('--apply'),revision=value('expected-revision'),jobHash=value('expected-job-hash'),backup=value('backup');
 if(!record||!directory||!path.isAbsolute(directory)||(backup&&!path.isAbsolute(backup))||(apply&&(!revision||!jobHash||!backup))||(!apply&&backup))throw Error('invalid_arguments');
 const expectedRevision=revision===undefined?undefined:Number(revision);
 if(expectedRevision!==undefined&&!Number.isSafeInteger(expectedRevision))throw Error('invalid_arguments');
 return {record,directory,apply,expectedRevision,expectedJobHash:jobHash==='absent'?null:jobHash,backup};
}
export async function runRecoveryCommand(args,deps){
 const options=parseRecoveryArgs(args),journal=await deps.openJournal(options.directory),now=deps.now??Date.now;
 const record=await journal.read(options.record,now());if(!record)throw Error('journal_record_unavailable');
 const snapshot=await deps.snapshot(record.identity.jobId);
 const expected={expectedRevision:options.expectedRevision??snapshot.revision,expectedJobHash:options.expectedJobHash===undefined?snapshot.jobHash:options.expectedJobHash,now};
 const plan=await deps.recover(record,{...expected,apply:false});
 if(options.apply){
  if(plan.mode==='noop'){await journal.confirm(options.record,record.fingerprint);return {...plan,record:options.record};}
  await deps.backup(options.backup,{...snapshot,record:options.record,fingerprint:record.fingerprint,at:now()});
  const result=await deps.recover(record,{...expected,apply:true});
  await journal.confirm(options.record,record.fingerprint);
  return {...result,record:options.record};
 }
 return {...plan,record:options.record,expectedRevision:snapshot.revision,expectedJobHash:snapshot.jobHash??'absent'};
}
async function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src');
 register(new URL('./lib/related-pets-typescript-loader.mjs',import.meta.url),{parentURL:import.meta.url,data:{sourceRootUrl:pathToFileURL(root).href}});
 const load=name=>import(pathToFileURL(path.join(root,name)).href);
 const [{FileResultJournal},{generationStore:store},{recoverResult,checkpointJobHash},{destroyYdbDriver}]=await Promise.all([
  load('lib/pets/generation/result-journal.ts'),load('lib/pets/generation/store.ts'),load('lib/pets/generation/result-checkpoint-recovery.ts'),load('lib/ydb/client.ts')]);
 try{
  const result=await runRecoveryCommand(process.argv.slice(2),{
   openJournal:directory=>FileResultJournal.openExisting(directory),
   snapshot:id=>store.transaction(async tx=>{const now=Date.now(),raw=await tx.getLedger('scheduler',now),job=await tx.getJob(id);return {revision:JSON.parse(raw).revision,jobHash:checkpointJobHash(job),job,scheduler:raw,budget:await tx.getLedger('budget',now)};}),
   recover:(record,options)=>recoverResult(store,record,options),
   backup:async(file,data)=>{
    const parent=await lstat(path.dirname(file));if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o077)!==0)throw Error('backup_requires_private_directory');
    const handle=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    try{await handle.writeFile(JSON.stringify(data));await handle.sync();}finally{await handle.close();}
   }});
  console.log(JSON.stringify(result));
 }catch{console.error(JSON.stringify({error:'checkpoint_recovery_failed'}));process.exitCode=1;}
 finally{await destroyYdbDriver();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

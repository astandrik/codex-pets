// Offline test helper: only a newly-created private test directory is accepted.
import {register,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const [directory,phase]=process.argv.slice(2);
if(!path.isAbsolute(directory)||!path.basename(directory).startsWith('journal-crash-test-')||!['confirm','slot','publish','partial-slot','partial-retired','race'].includes(phase))throw Error('Private crash test directory required');
const root=path.resolve('src');register(new URL('./related-pets-typescript-loader.mjs',import.meta.url),{parentURL:import.meta.url,data:{sourceRootUrl:pathToFileURL(root).href}});
const {FileResultJournal}=await import(pathToFileURL(path.join(root,'lib/pets/generation/result-journal.ts')).href);
const identity={jobId:'a'.repeat(64),inputHash:'f'.repeat(64),promptHash:'f'.repeat(64),createdAt:1000,expiresAt:1000000,operationKey:'attempt:one',receiptKey:'attempt:one',leaseId:'lease',owner:'owner',taskKey:'image:idle',kind:'image',stage:'idle',pipelineVersion:2};
function gate(){let release;const promise=new Promise(r=>{release=r;});return {promise,release};}
async function main(){
 const journal=await FileResultJournal.open(directory,{capacityBytes:FileResultJournal.reservationBytes});const key=await journal.reserve(identity);
 const f=fs.promises,originalRename=f.rename,originalRm=f.rm,originalRmdir=f.rmdir,originalMkdir=f.mkdir;
 if(phase==='race'){
  const fingerprint=await journal.publish(key,{kind:'image',bytes:Buffer.from('old'),generationMs:1});
  const aReady=gate(),aContinue=gate(),bReady=gate(),bContinue=gate(),cReady=gate(),cContinue=gate(),cDone=gate();
  const slot=path.join(directory,'slots','0');let removals=0,claims=0;
  async function claimed(){const n=++claims;if(n===1){bReady.release();await bContinue.promise;}if(n===2){cReady.release();await cContinue.promise;}}
  f.rmdir=async(...args)=>{if(args[0]===slot&&++removals===1){aReady.release();await aContinue.promise;}return originalRmdir(...args);};
  f.mkdir=async(...args)=>{const result=await originalMkdir(...args);if(args[0]===slot)await claimed();return result;};
  f.rename=async(...args)=>{const result=await originalRename(...args);if(args[1]===slot)await claimed();return result;};syncBuiltinESMExports();
  try{
   const a=journal.confirm(key,fingerprint);await aReady.promise;
   const b=journal.reserve({...identity,jobId:'b'.repeat(64),operationKey:'b',receiptKey:'b'});await bReady.promise;
   aContinue.release();await a;
   const c=journal.reserve({...identity,jobId:'c'.repeat(64),operationKey:'c',receiptKey:'c'});c.then(()=>cDone.release(),()=>cDone.release());
   await Promise.race([cReady.promise,cDone.promise]);bContinue.release();await b;cContinue.release();
   const outcomes=await Promise.allSettled([b,c]);
   console.log(JSON.stringify({reservations:(await journal.list()).length,rejected:outcomes.filter(x=>x.status==='rejected').length}));
  }finally{aContinue.release();bContinue.release();cContinue.release();f.rename=originalRename;f.rm=originalRm;f.rmdir=originalRmdir;f.mkdir=originalMkdir;syncBuiltinESMExports();}
  return;
 }
 f.rename=async(...args)=>{if(phase==='publish'&&String(args[1]).endsWith('/ready'))process.exit(73);const result=await originalRename(...args);if(phase==='confirm'&&args[0]===path.join(directory,'records',key))process.exit(73);return result;};
 f.rm=async(...args)=>{
  const target=String(args[0]);
  if(phase==='partial-slot'&&path.dirname(target)===path.join(directory,'slots','0')){await f.unlink(path.join(target,'key'));process.exit(73);}
  if(phase==='partial-retired'&&path.dirname(target)===path.join(directory,'retired')){await f.unlink(path.join(target,'intent.json'));process.exit(73);}
  const result=await originalRm(...args);
  if(phase==='confirm'&&args[0]===path.join(directory,'records',key)||phase==='slot'&&args[0]===path.join(directory,'slots','0'))process.exit(73);
  return result;
 };
 f.rmdir=async(...args)=>{const result=await originalRmdir(...args);if(phase==='slot'&&args[0]===path.join(directory,'slots','0'))process.exit(73);return result;};syncBuiltinESMExports();
 const fingerprint=await journal.publish(key,{kind:'image',bytes:Buffer.from('private synthetic image'),generationMs:1});await journal.confirm(key,fingerprint);
 throw Error('Crash point not reached');
}
await main();

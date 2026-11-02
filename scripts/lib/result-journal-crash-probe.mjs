// Offline test helper: only a newly-created private test directory is accepted.
import {register,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const [directory,phase]=process.argv.slice(2);
if(!path.isAbsolute(directory)||!path.basename(directory).startsWith('journal-crash-test-')||!['confirm','slot','publish','partial-slot','partial-retired','race','reserve','reserve-record','orphan-race','orphan-partial-slot','active-reserve','stale-retire'].includes(phase))throw Error('Private crash test directory required');
const root=path.resolve('src');register(new URL('./related-pets-typescript-loader.mjs',import.meta.url),{parentURL:import.meta.url,data:{sourceRootUrl:pathToFileURL(root).href}});
const {FileResultJournal}=await import(pathToFileURL(path.join(root,'lib/pets/generation/result-journal.ts')).href);
const {journalRecordDirectory}=await import(pathToFileURL(path.join(root,'lib/pets/generation/result-journal.test-utils.ts')).href);
const identity={jobId:'a'.repeat(64),inputHash:'f'.repeat(64),promptHash:'f'.repeat(64),createdAt:1000,expiresAt:1000000,operationKey:'attempt:one',receiptKey:'attempt:one',leaseId:'lease',owner:'owner',taskKey:'image:idle',kind:'image',stage:'idle',pipelineVersion:2};
function gate(){let release;const promise=new Promise(r=>{release=r;});return {promise,release};}
async function main(){
 const journal=await FileResultJournal.open(directory,{capacityBytes:FileResultJournal.reservationBytes});
 const f=fs.promises,originalRename=f.rename,originalRm=f.rm,originalRmdir=f.rmdir,originalMkdir=f.mkdir;
 if(phase==='reserve'||phase==='reserve-record'){
  f.rename=async(...args)=>{const result=await originalRename(...args);if(phase==='reserve'&&args[1]===path.join(directory,'slots','0'))process.exit(73);return result;};
  f.mkdir=async(...args)=>{const result=await originalMkdir(...args);if(phase==='reserve-record'&&(path.dirname(String(args[0]))===path.join(directory,'records')||String(args[0]).endsWith('/record')))process.exit(73);return result;};
  syncBuiltinESMExports();await journal.reserve(identity);throw Error('Reservation crash point not reached');
 }
 if(phase==='active-reserve'){
  const ready=gate(),resume=gate();
  f.rename=async(...args)=>{const result=await originalRename(...args);if(args[1]===path.join(directory,'slots','0')){ready.release();await resume.promise;}return result;};syncBuiltinESMExports();
  try{
   const pending=journal.reserve(identity);await ready.promise;
   const peer=await FileResultJournal.open(directory,{capacityBytes:FileResultJournal.reservationBytes});await peer.expire(identity.createdAt+7*86400000-1);
   const competitor=await peer.reserve({...identity,jobId:'b'.repeat(64)}).then(()=>false,error=>error.code==='journal_capacity');
   resume.release();const key=await pending;console.log(JSON.stringify({competitorBlocked:competitor,identity:await journal.reservationIdentity(key)}));
  }finally{resume.release();f.rename=originalRename;syncBuiltinESMExports();}
  return;
 }
 const key=await journal.reserve(identity),record=await journalRecordDirectory(directory,key);
 if(phase==='stale-retire'){
  let delayed=false;
  async function waitForPeer(){if(delayed)return;delayed=true;process.send({ready:true});await new Promise(resolve=>process.once('message',resolve));}
  const originalLink=f.link;
  f.rename=async(...args)=>{if(args[0]===record)await waitForPeer();return originalRename(...args);};
  f.link=async(...args)=>{if(args[0]===path.join(record,'intent.json'))await waitForPeer();return originalLink(...args);};syncBuiltinESMExports();
  try{await journal.releaseUnsent(key,identity);process.send({done:true});}
  catch(error){process.send({error:error.code??error.message});}
  finally{f.rename=originalRename;f.link=originalLink;syncBuiltinESMExports();process.disconnect();}
  return;
 }
 if(phase==='orphan-partial-slot'){
  await f.rm(path.join(directory,'records',key),{recursive:true,force:true});
  f.rm=async(...args)=>{if(path.dirname(String(args[0]))===path.join(directory,'slots','0')){await f.unlink(path.join(String(args[0]),'key'));process.exit(73);}return originalRm(...args);};
  syncBuiltinESMExports();await journal.expire(identity.createdAt+8*86400000);throw Error('Orphan cleanup crash point not reached');
 }
 if(phase==='race'||phase==='orphan-race'){
  const fingerprint=await journal.publish(key,{kind:'image',bytes:Buffer.from('old'),generationMs:1});
  if(phase==='orphan-race')await f.rm(path.join(directory,'records',key),{recursive:true,force:true});
  const aReady=gate(),aContinue=gate(),bReady=gate(),bContinue=gate(),cReady=gate(),cContinue=gate(),cDone=gate();
  const slot=path.join(directory,'slots','0');let removals=0,claims=0;
  async function claimed(){const n=++claims;if(n===1){bReady.release();await bContinue.promise;}if(n===2){cReady.release();await cContinue.promise;}}
  f.rmdir=async(...args)=>{if(args[0]===slot&&++removals===1){aReady.release();await aContinue.promise;}return originalRmdir(...args);};
  f.mkdir=async(...args)=>{const result=await originalMkdir(...args);if(args[0]===slot)await claimed();return result;};
  f.rename=async(...args)=>{const result=await originalRename(...args);if(args[1]===slot)await claimed();return result;};syncBuiltinESMExports();
  try{
   const a=phase==='orphan-race'?journal.expire(identity.createdAt+8*86400000):journal.confirm(key,fingerprint);await aReady.promise;
   const b=journal.reserve({...identity,jobId:'b'.repeat(64),operationKey:'b',receiptKey:'b'});await bReady.promise;
   aContinue.release();await a;
   const c=journal.reserve({...identity,jobId:'c'.repeat(64),operationKey:'c',receiptKey:'c'});c.then(()=>cDone.release(),()=>cDone.release());
   await Promise.race([cReady.promise,cDone.promise]);bContinue.release();await b;cContinue.release();
   const outcomes=await Promise.allSettled([b,c]);
   console.log(JSON.stringify({reservations:(await journal.list()).length,rejected:outcomes.filter(x=>x.status==='rejected').length}));
  }finally{aContinue.release();bContinue.release();cContinue.release();f.rename=originalRename;f.rm=originalRm;f.rmdir=originalRmdir;f.mkdir=originalMkdir;syncBuiltinESMExports();}
  return;
 }
 f.rename=async(...args)=>{if(phase==='publish'&&String(args[1]).endsWith('/ready'))process.exit(73);const result=await originalRename(...args);if(phase==='confirm'&&args[0]===record)process.exit(73);return result;};
 f.rm=async(...args)=>{
  const target=String(args[0]);
  if(phase==='partial-slot'&&path.dirname(target)===path.join(directory,'slots','0')){await f.unlink(path.join(target,'key'));process.exit(73);}
  if(phase==='partial-retired'&&path.dirname(target)===path.join(directory,'retired')){await f.unlink(path.join(target,'intent.json'));process.exit(73);}
  const result=await originalRm(...args);
  if(phase==='confirm'&&args[0]===record||phase==='slot'&&args[0]===path.join(directory,'slots','0'))process.exit(73);
  return result;
 };
 f.rmdir=async(...args)=>{const result=await originalRmdir(...args);if(phase==='slot'&&args[0]===path.join(directory,'slots','0'))process.exit(73);return result;};syncBuiltinESMExports();
 const fingerprint=await journal.publish(key,{kind:'image',bytes:Buffer.from('private synthetic image'),generationMs:1});await journal.confirm(key,fingerprint);
 throw Error('Crash point not reached');
}
await main();

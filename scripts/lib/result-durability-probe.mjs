// Local integration-only process. No provider or production endpoint is accepted.
import {register} from 'node:module';import {pathToFileURL} from 'node:url';import path from 'node:path';
const endpoint=new URL(process.env.YDB_PETS_ENDPOINT??'invalid:');
if(endpoint.hostname!=='127.0.0.1'||endpoint.port!=='12136'||process.env.YDB_PETS_DATABASE!=='/local'||process.env.PET_GENERATION_DURABILITY_YDB!=='1')throw Error('Isolated durability test YDB required');
const root=path.resolve('src');register(new URL('./related-pets-typescript-loader.mjs',import.meta.url),{parentURL:import.meta.url,data:{sourceRootUrl:pathToFileURL(root).href}});
const load=name=>import(pathToFileURL(path.join(root,'lib/pets/generation',name+'.ts')).href);
const {generationStore:store}=await load('store'),{createGenerationService}=await load('service'),{FileResultJournal}=await load('result-journal');
const {destroyYdbDriver}=await import(pathToFileURL(path.join(root,'lib/ydb/client.ts')).href);
const [owner,run,directory]=process.argv.slice(2);if(!/^[a-z]$/.test(owner)||!run||!path.isAbsolute(directory))throw Error('Invalid test process');
const journal=await FileResultJournal.open(directory),service=createGenerationService(store,{enabled:()=>true,secret:()=>"isolated-durability-test-secret",resultDurability:{journal}});
try{
 const jobs=[];
 for(let n=0;n<10;n++){
  const job=await service.claim(`probe-${owner}-${n}`);if(!job)break;
  await service.beginStage(job,job.workerTask.stage);await service.authorizeStage(job,job.workerTask.stage);jobs.push(job);
 }
 await store.transaction(tx=>tx.putLedger(`test:held:${run}:${owner}`,String(jobs.length),Date.now()+120000));
 const deadline=Date.now()+60000;
 while(Date.now()<deadline&&!await store.transaction(tx=>tx.getLedger(`test:release:${run}`,Date.now())))await new Promise(r=>setTimeout(r,100));
 if(Date.now()>=deadline)throw Error('Release barrier timed out');
 const transaction=store.transaction.bind(store);let lostAck=0;
 store.transaction=async operation=>{
  let resultWrite=false;
  const result=await transaction(tx=>operation({...tx,putArtifact:async(...args)=>{resultWrite=true;return tx.putArtifact(...args);}}));
  if(resultWrite&&lostAck++===0)throw Error('Synthetic lost successful commit acknowledgement');
  return result;
 };
 await Promise.all(jobs.map(job=>service.saveStage(job,job.workerTask.stage,Buffer.alloc(1024*1024,job.workerTask.stage.length),{generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.001}})));
 for(const job of jobs)await service.completeTask(job);
 console.log('PROBE:'+JSON.stringify({received:jobs.length,lostAckInjected:lostAck>0,journalEntries:(await journal.list()).length}));
}finally{await destroyYdbDriver();}

import {expect,it} from 'vitest';import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {FileResultJournal} from './result-journal';
const enabled=process.env.PET_GENERATION_DURABILITY_YDB==='1';
it.skipIf(!enabled)('persists twenty concurrent results across two processes, including lost commit ACKs, exactly once',async()=>{
 const endpoint=new URL(process.env.YDB_PETS_ENDPOINT??'invalid:');
 if(endpoint.hostname!=='127.0.0.1'||endpoint.port!=='12136'||process.env.YDB_PETS_DATABASE!=='/local')throw Error('Dedicated local test endpoint required');
 const {generationStore:store}=await import('./store'),{createGenerationService}=await import('./service'),{destroyYdbDriver}=await import('@/lib/ydb/client');
 const directory=await mkdtemp(path.join(tmpdir(),'durability-ydb-')),run=randomUUID();const service=createGenerationService(store,{enabled:()=>true,secret:()=>"isolated-durability-test-secret"});
 const ids:string[]=[];let children:Promise<unknown>[]=[];
 try{
  await store.transaction(async tx=>{await tx.putLedger('scheduler',JSON.stringify({revision:0,queue:[],active:null}),Date.UTC(2099,0,1));await tx.putLedger('budget',JSON.stringify({spent:{},reservations:{}}),Date.UTC(2099,0,1));});
  for(let n=0;n<3;n++)ids.push((await service.generate({requestId:randomUUID(),prompt:'Synthetic durability'},`203.0.113.${n+1}`)).generationId);
  await store.transaction(async tx=>{
   for(const id of ids){const job=(await tx.getJob(id))!,bytes=Buffer.from('saved base');await tx.putJob({...job,status:'generating',stages:[{name:'base',status:'completed',sha256:createHash('sha256').update(bytes).digest('hex'),startedAt:Date.now()}]});await tx.putArtifact(id,'stage-base.png',bytes,job.expiresAt);}
   await tx.putLedger('scheduler',JSON.stringify({version:3,revision:1,queue:ids,active:[],activeLimit:2,providerLimit:20,providerSlots:[],providerWaiters:[],providerTurn:null,resumes:{},heavy:null,tasks:[],taskTurn:null}),Date.UTC(2099,0,1));
  });
  children=['a','b'].map(owner=>promisify(execFile)(process.execPath,['scripts/lib/result-durability-probe.mjs',owner,run,directory],{encoding:'utf8',timeout:150000,env:{PATH:process.env.PATH,NODE_ENV:'test',PET_GENERATION_DURABILITY_YDB:'1',YDB_ANONYMOUS_CREDENTIALS:'1',YDB_PETS_ENDPOINT:process.env.YDB_PETS_ENDPOINT,YDB_PETS_DATABASE:'/local',PET_GENERATION_PROVIDER_CALLS:'20'}}));
  const joined=Promise.all(children);let childError:unknown;joined.catch(error=>{childError=error;});
  const deadline=Date.now()+40000;let held=false;
  while(Date.now()<deadline&&!childError){held=await store.transaction(async tx=>(await tx.getLedger(`test:held:${run}:a`,Date.now()))!==null&&(await tx.getLedger(`test:held:${run}:b`,Date.now()))!==null);if(held)break;await new Promise(r=>setTimeout(r,100));}
  try{if(childError)throw childError;expect(held).toBe(true);const state=JSON.parse((await store.transaction(tx=>tx.getLedger('scheduler',Date.now())))!);expect(state.providerSlots).toHaveLength(20);}
  finally{await store.transaction(tx=>tx.putLedger(`test:release:${run}`,'1',Date.now()+120000));}
  const results=await joined as {stdout:string}[];
  const proofs=results.map(r=>JSON.parse(r.stdout.split('\n').find(x=>x.startsWith('PROBE:'))!.slice(6)));
  expect(proofs.map(p=>p.received)).toEqual([10,10]);expect(proofs.every(p=>p.lostAckInjected)).toBe(true);
  const budget=JSON.parse((await store.transaction(tx=>tx.getLedger('budget',Date.now())))!);
  expect(Object.values(budget.spent).reduce((sum:number,n)=>sum+Number(n),0)).toBe(20000);
  const journal=await FileResultJournal.openExisting(directory);
  // A peer can still be writing when the first process finishes. Verify/prune only after both joined.
  const {recoverResult,checkpointJobHash}=await import('./result-checkpoint-recovery');
  for(const key of await journal.list()){
   const record=(await journal.read(key))!,snapshot=await store.transaction(async tx=>({state:JSON.parse((await tx.getLedger('scheduler',Date.now()))!),job:await tx.getJob(record.identity.jobId)}));
   expect((await recoverResult(store,record,{expectedRevision:snapshot.state.revision,expectedJobHash:checkpointJobHash(snapshot.job),apply:true})).mode).toBe('noop');
   await journal.confirm(key,record.fingerprint);
  }
  expect(await journal.list()).toEqual([]);
  const jobs=await Promise.all(ids.map(id=>store.readJob(id)));expect(jobs.reduce((sum,j)=>sum+j!.stages.filter(s=>s.status==='completed').length,0)).toBe(23);
 }finally{await Promise.allSettled(children);await destroyYdbDriver();await rm(directory,{recursive:true,force:true});}
},180000);

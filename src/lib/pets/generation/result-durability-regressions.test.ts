import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {FileResultJournal} from '@/lib/pets/generation/result-journal';
import {taskFixture} from '@/lib/pets/generation/task-pool.test-utils';
import {MemoryStore} from '@/lib/pets/generation/test-store';
import {createGenerationService} from '@/lib/pets/generation/service';
import {attachResultJournal} from '@/lib/pets/generation/checkpoint-journal';
import {createSpriteGenerationWorker} from '@/lib/pets/generation/sprite-worker';
import {recoverResult,checkpointJobHash} from '@/lib/pets/generation/result-checkpoint-recovery';
import {GenerationError} from '@/lib/pets/generation/model';
import {createWorkerContext} from '@/lib/pets/generation/worker-diagnostics';
import {journalRecordDirectory} from './result-journal.test-utils';
const directories:string[]=[];
const rename=fs.promises.rename,open=fs.promises.open;
afterEach(async()=>{fs.promises.rename=rename;fs.promises.open=open;syncBuiltinESMExports();vi.restoreAllMocks();vi.unstubAllEnvs();for(const p of directories.splice(0))await fs.promises.rm(p,{recursive:true,force:true});});
async function journal(){const root=await fs.promises.mkdtemp(path.join(tmpdir(),'pr98-review-'));directories.push(root);return {root,journal:await FileResultJournal.open(root)};}
const identity={jobId:'a'.repeat(64),inputHash:'f'.repeat(64),promptHash:'f'.repeat(64),createdAt:1000,expiresAt:1000000,operationKey:'attempt:token',receiptKey:'attempt:token',leaseId:'old-lease',owner:'old-owner',taskKey:'image:idle',kind:'image' as const,stage:'idle' as const,pipelineVersion:2};
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};}
it('stale retirement must not move the replacement record',async()=>{
 const f=await journal(),key=await f.journal.reserve(identity),folder=await journalRecordDirectory(f.root,key),ready=gate(),resume=gate();let paused=false;
 fs.promises.rename=async(...args)=>{if(args[0]===folder&&!paused){paused=true;ready.release();await resume.promise;}return rename(...args);};syncBuiltinESMExports();
 const pending=f.journal.releaseUnsent(key,identity).catch(error=>error);await ready.promise;
 try{
  await f.journal.releaseUnsent(key,identity);const replacement={...identity,leaseId:'new-lease',owner:'new-owner'};
  await f.journal.reserve(replacement);resume.release();const outcome=await pending;
  console.log('retire result:',outcome?.code??'ok');
  expect(await f.journal.reservationIdentity(key)).toEqual(replacement);
 }finally{resume.release();await pending;}
});
it('concurrent confirmation must not fail a healthy journal read',async()=>{
 const f=await journal(),key=await f.journal.reserve(identity),fingerprint=await f.journal.publish(key,{kind:'image',bytes:Buffer.from('received'),generationMs:1});
 const folder=await journalRecordDirectory(f.root,key),ready=gate(),resume=gate();let paused=false;
 fs.promises.open=async(...args)=>{if(args[0]===path.join(folder,'ready','payload')&&!paused){paused=true;ready.release();await resume.promise;}return open(...args);};syncBuiltinESMExports();
 const reading=f.journal.read(key,2000).then(value=>({value}),error=>({error}));await ready.promise;
 try{await f.journal.confirm(key,fingerprint);resume.release();const result=await reading;expect(result).toEqual({value:null});}
 finally{resume.release();await reading;}
});
it('a proven budget refusal must release an image reservation',async()=>{
 const f=await taskFixture(20,false,1),disk=await journal();f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[f.jobs[0].id]});
 const service=attachResultJournal(f.service,f.store,{journal:disk.journal,now:()=>f.clock.now});
 const job=(await service.claim('owner'))!;await service.beginStage(job,'base');
 const budget=JSON.parse(f.store.ledger.get('budget')!.value);budget.spent['2026-11-01']=1e6;f.store.ledger.get('budget')!.value=JSON.stringify(budget);
 await expect(service.authorizeStage(job,'base')).rejects.toMatchObject({code:'budget_exhausted'});
 expect(await disk.journal.list()).toEqual([]);
});
async function version2(){
 vi.stubEnv('PET_GENERATION_ACTIVE_JOBS','2');vi.stubEnv('PET_GENERATION_PROVIDER_CALLS','1');
 const clock={now:Date.parse('2026-11-02T10:00:00Z')},store=new MemoryStore();
 const service=createGenerationService(store,{enabled:()=>true,secret:()=>"synthetic-review-secret",now:()=>clock.now});
 const ids=[];for(let i=0;i<2;i++)ids.push((await service.generate({requestId:randomUUID(),prompt:'Synthetic character'},`203.0.113.${i+1}`)).generationId);
 store.ledger.get('scheduler')!.value=JSON.stringify({version:2,revision:1,activeLimit:2,providerLimit:1,active:[],queue:ids,resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null});
 return {clock,store,service,ids};
}
it('version 2 must reclaim an unsent reservation after yielding for capacity',async()=>{
 const f=await version2(),disk=await journal(),first=(await f.service.claim('first'))!,second=(await f.service.claim('second'))!;
 await f.service.beginStage(first,'base');await f.service.authorizeStage(first,'base');await f.service.beginStage(second,'base');
 const saveFirst=f.service.saveStage.bind(f.service),wrapped=attachResultJournal(f.service,f.store,{journal:disk.journal,now:()=>f.clock.now});
 await expect(wrapped.authorizeStage(second,'base')).rejects.toMatchObject({eligibleAt:expect.any(Number)});
 await wrapped.yield(second,f.clock.now+1);
 await saveFirst(first,'base',Buffer.from('first'),{generationMs:1});
 f.clock.now+=2;const next=(await wrapped.claim('replacement'))!;expect(next.id).toBe(second.id);
 await expect(wrapped.authorizeStage(next,'base')).resolves.toBeUndefined();
});
it('does not apply an unsupported version-2 result without the configured v3 guard',async()=>{
 const f=await version2(),disk=await journal(),wrapped=attachResultJournal(f.service,f.store,{journal:disk.journal,now:()=>f.clock.now,retry:{attempts:1}});
 const job=(await wrapped.claim('owner'))!;await wrapped.beginStage(job,'base');await wrapped.authorizeStage(job,'base');
 const transaction=f.store.transaction.bind(f.store),spy=vi.spyOn(f.store,'transaction').mockImplementation(fn=>transaction(tx=>fn({...tx,putArtifact:async()=>{throw Error('db down');}})));
 await expect(wrapped.saveStage(job,'base',Buffer.from('received'),{generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}})).rejects.toThrow();spy.mockRestore();
 await wrapped.fail(job,'outcome_unknown');const [key]=await disk.journal.list(),record=(await disk.journal.read(key,f.clock.now))!;
 const before=structuredClone(f.store.ledger);
 await expect(recoverResult(f.store,record,{expectedRevision:JSON.parse(f.store.ledger.get('scheduler')!.value).revision,expectedJobHash:checkpointJobHash(f.store.jobs.get(job.id)),now:()=>f.clock.now})).rejects.toMatchObject({code:'stage_conflict'});
 expect(f.store.ledger).toEqual(before);
});
it('restoring the first base must allow automatic animation work after confirmation',async()=>{
 const f=await taskFixture(20,true),id=f.jobs[0].id,disk=await journal();f.store.jobs.set(id,{...f.store.jobs.get(id)!,reviewBase:true});f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const service=attachResultJournal(f.service,f.store,{journal:disk.journal,now:()=>f.clock.now,retry:{attempts:1}}),transaction=f.store.transaction.bind(f.store);
 const spy=vi.spyOn(f.store,'transaction').mockImplementation(fn=>transaction(tx=>fn({...tx,putArtifact:async(id,kind,bytes,expiry)=>{if(kind==='stage-base.png')throw Error('db down');return tx.putArtifact(id,kind,bytes,expiry);}})));
 const run=createSpriteGenerationWorker({service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from('atlas'),generate:async()=>({bytes:Buffer.from('received'),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}})})}});
 expect(await run('first')).toBe('failed');expect(await run('finalizer')).toBe('failed');spy.mockRestore();
 const [key]=await disk.journal.list(),record=(await disk.journal.read(key,f.clock.now))!;
 await recoverResult(f.store,record,{expectedRevision:JSON.parse(f.store.ledger.get('scheduler')!.value).revision,expectedJobHash:checkpointJobHash(f.store.jobs.get(id)),now:()=>f.clock.now,apply:true});
 const state=JSON.parse(f.store.ledger.get('scheduler')!.value);delete state.pauseReason;f.store.ledger.get('scheduler')!.value=JSON.stringify(state);
 await service.confirm(id);console.log('repair phase after restore:',f.store.jobs.get(id)!.animationRepair?.phase);
 const status=await run('animation');console.log('animation continuation:',status,f.store.jobs.get(id)?.error);expect(status).toBe('yielded');
});
it.each([2,3])('reports the primary error when cleanup fails on scheduler v%s',async version=>{
 const f=await taskFixture(),id=f.jobs[0].id;f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 if(version===2){vi.stubEnv('PET_GENERATION_ACTIVE_JOBS','2');vi.stubEnv('PET_GENERATION_PROVIDER_CALLS','1');f.store.ledger.get('scheduler')!.value=JSON.stringify({version:2,revision:1,activeLimit:2,providerLimit:1,active:[],queue:[id],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null});}
 const events:{code:string|undefined;secondary:boolean}[]=[];
 const context=createWorkerContext('owner',(error,_context,secondary)=>events.push({code:error instanceof GenerationError?error.code:undefined,secondary}));
 const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{throw Error('cleanup failed');},compose:async()=>Buffer.from('atlas'),generate:async()=>{throw new GenerationError('provider_rejected');}})}});
 expect(await run('owner',context)).toBe('failed');expect(events).toContainEqual({code:'provider_rejected',secondary:false});
});
it.each(['animation','base'])('releases a %s attempt rejected before dispatch without replacing its token',async kind=>{
 const f=await taskFixture(20,true,1),disk=await journal(),id=f.jobs[0].id;
 if(kind==='animation')f.saved(0,['base']);
 else f.store.jobs.set(id,{...f.store.jobs.get(id)!,reviewBase:true,baseRetrySourceId:'b'.repeat(64),baseRepair:{policy:1,maxAttempts:4,phase:'active',attempts:[]}});
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const service=attachResultJournal(f.service,f.store,{journal:disk.journal,now:()=>f.clock.now}),job=(await service.claim('owner'))!;
 const current=await service.beginStage(job,kind==='base'?'base':'idle'),attempt=kind==='base'?current.baseRepair!.attempts[0]:current.animationRepair!.attempts.find(a=>a.state==='idle')!;
 const budget=JSON.parse(f.store.ledger.get('budget')!.value);budget.spent['2026-11-01']=1e6;f.store.ledger.get('budget')!.value=JSON.stringify(budget);
 await expect(kind==='base'?service.startBaseAttempt(job,attempt.token):service.startAnimationAttempt(job,'idle',attempt.token)).rejects.toMatchObject({code:'budget_exhausted'});
 expect(await disk.journal.list()).toEqual([]);expect(attempt.ordinal).toBe(1);
});
it('retains an image reservation after an ambiguous authorization acknowledgement',async()=>{
 const f=await taskFixture(),disk=await journal(),id=f.jobs[0].id;f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const original=f.service.authorizeStage.bind(f.service);f.service.authorizeStage=async(job,name)=>{await original(job,name);throw Error('lost database acknowledgement');};
 const service=attachResultJournal(f.service,f.store,{journal:disk.journal,now:()=>f.clock.now}),job=(await service.claim('owner'))!;await service.beginStage(job,'base');
 await expect(service.authorizeStage(job,'base')).rejects.toThrow('lost database acknowledgement');expect(await disk.journal.list()).toHaveLength(1);
 expect(JSON.parse(f.store.ledger.get('scheduler')!.value).providerSlots[0].dispatched).toBe(true);
});
it.each([
 {dispatched:false,published:false},
 {dispatched:true,published:false},
 {dispatched:true,published:true},
])('preserves ownership and accounting on queue pause; dispatched=$dispatched published=$published',async({dispatched,published})=>{
 const f=await taskFixture(20,false,1),disk=await journal(),id=f.jobs[0].id;
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const service=attachResultJournal(f.service,f.store,{journal:disk.journal,now:()=>f.clock.now}),job=(await service.claim('owner'))!;
 await service.beginStage(job,'base');
 let savedKey:string|undefined;
 if(dispatched){
  await service.authorizeStage(job,'base');[savedKey]=await disk.journal.list();
  if(published)await disk.journal.publish(savedKey,{kind:'image',bytes:Buffer.from('received before pause'),generationMs:1});
 }
 const state=JSON.parse(f.store.ledger.get('scheduler')!.value);
 const unknown={...state.providerSlots[0],jobId:f.jobs[1].id,key:'stage:base',owner:'other-owner',leaseId:randomUUID(),dispatched:true,unknown:true};
 state.providerSlots.push(unknown);state.pauseReason='outcome_unknown';f.store.ledger.get('scheduler')!.value=JSON.stringify(state);
 const budget=f.store.ledger.get('budget')!.value,jobs=structuredClone(f.store.jobs),schedulerBefore=f.store.ledger.get('scheduler')!.value;
 await expect(service.authorizeStage(job,'base')).rejects.toMatchObject({code:'generation_paused'});
 expect(f.store.ledger.get('scheduler')!.value).toBe(schedulerBefore);expect(f.store.ledger.get('budget')!.value).toBe(budget);expect(f.store.jobs).toEqual(jobs);
 if(dispatched){
  expect(await disk.journal.list()).toEqual([savedKey]);
  expect(await disk.journal.reservationIdentity(savedKey!)).toMatchObject({jobId:id,leaseId:job.workerLeaseId,operationKey:'stage:base'});
  if(published)expect((await disk.journal.read(savedKey!,f.clock.now))?.outcome).toMatchObject({kind:'image',bytes:Buffer.from('received before pause')});
 }else expect(await disk.journal.list()).toEqual([]);
});

import {afterEach,expect,it,vi} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {taskFixture} from './task-pool.test-utils';import {attachResultJournal,journalIdentity,imageOperation} from './checkpoint-journal';import {FileResultJournal} from './result-journal';
import {STAGE_NAMES,LEASE_MS} from './model';import {createSpriteGenerationWorker} from './sprite-worker';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
async function fixture(failures:number,capacity?:number){
 const f=await taskFixture(20,true);f.saved(0,STAGE_NAMES.filter(n=>n!=='idle'));
 const row=f.store.ledger.get('scheduler')!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[f.jobs[0].id]});
 const root=await mkdtemp(path.join(tmpdir(),'checkpoint-integration-'));roots.push(root);const journal=await FileResultJournal.open(root,{capacityBytes:capacity});
 const service=attachResultJournal(f.service,f.store,{journal,now:()=>f.clock.now,retry:{attempts:2,wait:async()=>{},random:()=>0}});
 const tx=f.store.transaction.bind(f.store);let writes=0,calls=0;
 vi.spyOn(f.store,'transaction').mockImplementation(fn=>tx(t=>fn({...t,putArtifact:async(id,kind,bytes,expiresAt)=>{if(kind==='stage-idle.png'&&++writes<=failures)throw Error('synthetic conflict');return t.putArtifact(id,kind,bytes,expiresAt);}})));
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const run=createSpriteGenerationWorker({service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from('atlas'),generate:async()=>{calls++;return {bytes:Buffer.from('received'),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}};}})}});
 return {...f,service,journal,run,calls:()=>calls};
}
it('keeps one provider attempt while retrying the existing save operation and removes acknowledged journal data',async()=>{
 const f=await fixture(3);expect(await f.run('owner')).toBe('yielded');expect(f.calls()).toBe(1);
 expect(f.store.jobs.get(f.jobs[0].id)!.stages.find(s=>s.name==='idle')!.status).toBe('completed');
 expect(await f.journal.list()).toEqual([]);expect(JSON.parse(f.store.ledger.get('budget')!.value).spent['2026-11-01']).toBe(40000);
});
it('retains received bytes and the same operation after all saves fail',async()=>{
 const f=await fixture(100);expect(await f.run('owner')).toBe('failed');expect(f.calls()).toBe(1);
 const keys=await f.journal.list();expect(keys).toHaveLength(1);const record=await f.journal.read(keys[0],f.clock.now);
 expect(record!.outcome).toMatchObject({kind:'image',bytes:Buffer.from('received')});
 expect(record!.identity.operationKey).toMatch(/^attempt:/);expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');
});

it('does not dispatch or fail an attempt when journal capacity is unavailable',async()=>{
 const f=await fixture(0,FileResultJournal.reservationBytes);
 await f.journal.reserve({jobId:'d'.repeat(64),inputHash:'f'.repeat(64),promptHash:'f'.repeat(64),createdAt:f.clock.now,expiresAt:f.clock.now+86400000,operationKey:'other',receiptKey:'other',owner:'o',leaseId:'l',taskKey:'t',kind:'image',stage:'idle',pipelineVersion:2});
 expect(await f.run('owner')).toBe('yielded');expect(f.calls()).toBe(0);
 const attempt=f.store.jobs.get(f.jobs[0].id)!.animationRepair!.attempts.find(a=>a.state==='idle')!;
 expect(attempt.status).toBe('reserved');expect(attempt.ordinal).toBe(1);
});

it('reclaims an unsent reservation after a lease change without changing its attempt token',async()=>{
 const f=await fixture(0);const first=(await f.service.claim('first'))!;
 const initial=await f.service.beginStage(first,'idle');const token=initial.animationRepair!.attempts.find(a=>a.state==='idle')!.token;
 await f.journal.reserve(journalIdentity(initial,imageOperation(initial,'idle'),`attempt:${token}`,'idle'));
 f.clock.now+=LEASE_MS+1;const next=(await f.service.claim('replacement'))!;
 await f.service.startAnimationAttempt(next,'idle',token);
 await f.service.saveAnimationAttempt(next,'idle',token,Buffer.from('late local result'),{generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}});
 expect(f.store.jobs.get(next.id)!.animationRepair!.attempts.find(a=>a.state==='idle')).toMatchObject({token,ordinal:1,status:'saved'});
 expect(await f.journal.list()).toEqual([]);
});
it('uses the authorized retry key when a legacy caller still holds its original batch job',async()=>{
 const f=await fixture(0),id=f.jobs[0].id;
 f.store.jobs.set(id,{...f.store.jobs.get(id)!,status:'queued',stages:[],animationRepair:undefined});
 f.store.ledger.get('scheduler')!.value=JSON.stringify({revision:0,queue:[id],active:null});
 const job=(await f.service.claim('legacy'))!,batch=await f.service.beginStage(job,'base');
 await f.service.authorizeStage(batch,'base');
 const {GenerationError}=await import('./model');
 await f.service.recordRowAttemptFailure(batch,'base',1,new GenerationError('outcome_unknown',undefined,undefined,undefined,{boundary:'provider_cli',reason:'process_exit'},{kind:'http_error',httpStatus:520}));
 const retry=await f.service.beginRowRetry(batch,'base');f.clock.now=retry.notBefore;
 await f.service.authorizeRowRetry(batch,'base',retry.token);
 await f.service.saveStage(batch,'base',Buffer.from('retry result'),{generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}});
 expect(f.store.jobs.get(id)!.stages[0].status).toBe('completed');expect(await f.journal.list()).toEqual([]);
});
it('repeats an acknowledged save without another charge after its journal was removed',async()=>{
 const f=await fixture(0),job=(await f.service.claim('repeat'))!;const current=await f.service.beginStage(job,'idle');
 const token=current.animationRepair!.attempts.find(a=>a.state==='idle')!.token;await f.service.startAnimationAttempt(job,'idle',token);
 const metadata={generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}};
 await f.service.saveAnimationAttempt(job,'idle',token,Buffer.from('same'),metadata);
 expect(await f.journal.list()).toEqual([]);
 await f.service.saveAnimationAttempt(job,'idle',token,Buffer.from('same'),metadata);
 expect(JSON.parse(f.store.ledger.get('budget')!.value).spent['2026-11-01']).toBe(40000);
});

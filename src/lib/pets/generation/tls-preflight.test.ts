import {afterEach,expect,it,vi} from 'vitest';
import {GenerationError,STAGE_NAMES} from './model';
import {readCliCause,isRetryableImageCause,isRetryableImageFailure} from './cli-cause';
import {parseSpritegenReply} from './sprite-renderer';
import {publicGenerationError} from './public-error';
import {baseFailureRetryReason} from './base-repair';
import {animationFailureRetryReason} from './animation-repair';
import {taskFixture} from './task-pool.test-utils';
import {createSpriteGenerationWorker} from './sprite-worker';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {attachResultJournal} from './checkpoint-journal';
import {FileResultJournal} from './result-journal';
import {recoverResult,checkpointJobHash} from './result-checkpoint-recovery';

const cause={kind:'tls_error',errno:8,requestSent:false} as const;
const failure=()=>new GenerationError('provider_not_sent',undefined,undefined,undefined,{boundary:'provider_cli',reason:'process_exit'},cause);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('keeps explicit TLS proof and rejects incomplete or malformed proof',()=>{
 expect(readCliCause(cause)).toEqual(cause);
 expect(readCliCause({...cause,requestSent:true})).toBeUndefined();
 expect(readCliCause({...cause,kind:'remote_disconnected'})).toBeUndefined();
 expect(new GenerationError('provider_not_sent',undefined,undefined,undefined,undefined,{kind:'tls_error',errno:8}).code).toBe('outcome_unknown');
 expect(()=>parseSpritegenReply(JSON.stringify({error:'provider_not_sent',cliCause:cause}))).toThrow('provider_not_sent');
 expect(()=>parseSpritegenReply(JSON.stringify({error:'provider_not_sent',cliCause:{kind:'tls_error',errno:8}}))).toThrow('outcome_unknown');
});
it('retries only proven transient handshake EOF, not certificate or later TLS failures',()=>{
 expect(isRetryableImageFailure(failure())).toBe(true);
 expect(isRetryableImageFailure({...failure(),providerFailure:{httpStatus:520}})).toBe(false);
 expect(isRetryableImageFailure({code:'outcome_unknown',cliCause:cause})).toBe(false);
 expect(isRetryableImageCause({kind:'tls_error',errno:8})).toBe(false);
 expect(isRetryableImageCause({...cause,errno:1})).toBe(false);
 expect(baseFailureRetryReason(failure())).toBe('transport');
 expect(animationFailureRetryReason(failure())).toBe('transport');
 expect(publicGenerationError('provider_not_sent').automaticRetry).toBe(false);
 expect(publicGenerationError('provider_not_sent').message).toContain('before');
});
it('does not pause or charge for a proven unsent base and keeps the same request',async()=>{
 const f=await taskFixture(20);const id=f.jobs[0].id;
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 let calls=0;
 const generate=vi.fn(async()=>{if(++calls===1)throw failure();return {bytes:Buffer.from('base'),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}};});
 const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})}});
 expect(await run('first')).toBe('yielded');
 const state=JSON.parse(f.store.ledger.get('scheduler')!.value);
 let budget=JSON.parse(f.store.ledger.get('budget')!.value);
 expect(state.pauseReason).toBeUndefined();expect(state.providerSlots).toEqual([]);expect(budget.spent['2026-11-01']??0).toBe(0);expect(budget.reservations[id].unknown).toBe(false);
 const original=structuredClone(f.store.jobs.get(id));f.clock.now+=5001;
 await run('second');expect(generate).toHaveBeenCalledTimes(2);expect(f.store.jobs.get(id)!.id).toBe(original!.id);expect(f.store.jobs.get(id)!.expiresAt).toBe(original!.expiresAt);
 budget=JSON.parse(f.store.ledger.get('budget')!.value);expect(budget.spent['2026-11-01']).toBe(10000);
});
it('bounds animation retries and releases the queue after repeated unsent TLS failures',async()=>{
 const f=await taskFixture(20,true);f.saved(0,STAGE_NAMES.filter(s=>s!=='idle'));const id=f.jobs[0].id;
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const generate=vi.fn(async()=>{throw failure();});
 const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})}});
 for(let n=0;n<14&&f.store.jobs.get(id)!.status!=='failed';n++){await run('owner-'+n);f.clock.now+=5001;}
 expect(generate).toHaveBeenCalledTimes(4);expect(f.store.jobs.get(id)!.error).toBe('provider_not_sent');
 const state=JSON.parse(f.store.ledger.get('scheduler')!.value);expect(state.pauseReason).toBeUndefined();expect(state.providerSlots).toEqual([]);
 expect(JSON.parse(f.store.ledger.get('budget')!.value).spent['2026-11-01']??0).toBe(0);
});
it('retains an unknown slot and prevents replay after an unproven TLS failure',async()=>{
 const f=await taskFixture(20);const id=f.jobs[0].id;
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const generate=vi.fn(async()=>{throw new GenerationError('outcome_unknown',undefined,undefined,undefined,{boundary:'provider_cli',reason:'process_exit'},{kind:'tls_error',errno:8});});
 const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})}});
 await run('first');await run('second');expect(generate).toHaveBeenCalledTimes(1);
 const state=JSON.parse(f.store.ledger.get('scheduler')!.value);expect(state.pauseReason).toBe('outcome_unknown');expect(state.providerSlots.some((s:{unknown?:boolean})=>s.unknown)).toBe(true);
});

it.each(['ordinary','base-repair','legacy','certificate'] as const)('finishes %s failures within the saved retry bound and lets the next job run',async mode=>{
 const f=await taskFixture(20);const id=f.jobs[0].id;
 const job=f.store.jobs.get(id)!;
 if(mode==='base-repair')Object.assign(job,{reviewBase:true,baseRetrySourceId:'f'.repeat(64),baseRepair:{policy:1,maxAttempts:3,phase:'active',attempts:[]}});
 const row=f.store.ledger.get('scheduler')!;
 row.value=JSON.stringify(mode==='legacy'?{revision:0,queue:[id],active:null}:{...JSON.parse(row.value),queue:[id]});
 const generate=vi.fn(async()=>{throw mode==='certificate'?new GenerationError('provider_not_sent',undefined,undefined,undefined,{boundary:'provider_cli',reason:'process_exit'},{...cause,errno:1}):failure();});
 const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,wait:async ms=>{f.clock.now+=ms;},renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})}});
 for(let n=0;n<12&&f.store.jobs.get(id)!.status!=='failed';n++){await run('owner-'+n);f.clock.now+=5001;}
 expect(generate).toHaveBeenCalledTimes(mode==='base-repair'?3:mode==='certificate'?1:2);
 expect(f.store.jobs.get(id)!.error).toBe('provider_not_sent');
 const state=JSON.parse(f.store.ledger.get('scheduler')!.value);expect(state.pauseReason).toBeUndefined();expect(state.providerSlots??[]).toEqual([]);
 expect(JSON.parse(f.store.ledger.get('budget')!.value).reservations[id]).toBeUndefined();
 const next=f.jobs[1].id;f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[next]});
 expect((await f.service.claim('next-owner'))?.id).toBe(next);
});

it.each(['rollback','lost-ack'] as const)('journals zero-cost failure through %s without repeating a provider call',async mode=>{
 const f=await taskFixture(20,true);f.saved(0,STAGE_NAMES.filter(s=>s!=='idle'));const id=f.jobs[0].id;
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const directory=await mkdtemp(path.join(tmpdir(),'tls-journal-'));
 try{
  const journal=await FileResultJournal.open(directory);
  const service=attachResultJournal(f.service,f.store,{journal,now:()=>f.clock.now,retry:{wait:async()=>{},random:()=>0}});
  const transaction=f.store.transaction.bind(f.store);let injected=false;
  vi.spyOn(f.store,'transaction').mockImplementation(async operation=>{
   let target=false;
   const result=await transaction(tx=>operation({...tx,putJob:async value=>{
    if(!injected&&value.animationRepair?.attempts.some(a=>a.failure?.code==='provider_not_sent')){
     injected=true;target=true;if(mode==='rollback')throw Error('synthetic rollback');
    }
    return tx.putJob(value);
   }}));
   if(target&&mode==='lost-ack')throw Error('synthetic lost acknowledgement');
   return result;
  });
  const generate=vi.fn(async()=>{throw failure();});
  const run=createSpriteGenerationWorker({service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})}});
  await run('first');expect(injected).toBe(true);expect(generate).toHaveBeenCalledTimes(1);
  expect(await journal.list()).toEqual([]);
  const job=f.store.jobs.get(id)!;expect(job.animationRepair!.attempts[0]).toMatchObject({ordinal:1,status:'failed',failure:{code:'provider_not_sent',cliCause:cause}});
  const ledger=JSON.parse(f.store.ledger.get('budget')!.value);expect(ledger.spent['2026-11-01']).toBe(0);expect(ledger.reservations[id].unknown).toBe(false);
  expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBeUndefined();
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('recovers a retained unsent failure with zero cost after all checkpoint writes fail',async()=>{
 const f=await taskFixture(20,true);f.saved(0,STAGE_NAMES.filter(s=>s!=='idle'));const id=f.jobs[0].id;
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const directory=await mkdtemp(path.join(tmpdir(),'tls-recovery-'));
 try{
  const journal=await FileResultJournal.open(directory);
  const service=attachResultJournal({...f.service,failAnimationAttempt:async()=>{throw Error('unavailable checkpoint');}},f.store,{journal,now:()=>f.clock.now,retry:{attempts:2,wait:async()=>{},random:()=>0}});
  const generate=vi.fn(async()=>{throw failure();});
  const run=createSpriteGenerationWorker({service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})}});
  await run('first');await run('finalizer');
  expect(generate).toHaveBeenCalledTimes(1);
  const keys=await journal.list();expect(keys).toHaveLength(1);
  const record=(await journal.read(keys[0],f.clock.now))!;
  expect(record).toMatchObject({outcomeKind:'failure',costUsd:0,outcome:{code:'provider_not_sent',costUsd:0,cliCause:cause}});
  const state=JSON.parse(f.store.ledger.get('scheduler')!.value);
  const options={expectedRevision:state.revision,expectedJobHash:checkpointJobHash(f.store.jobs.get(id)),now:()=>f.clock.now};
  await expect(recoverResult(f.store,{...record,outcome:{kind:'failure',code:'provider_not_sent',cliCause:{kind:'tls_error',errno:8},costUsd:0}},options)).rejects.toMatchObject({code:'stage_conflict'});
  expect(await recoverResult(f.store,record,{...options,apply:true})).toMatchObject({mode:'failure',applied:true});
  expect(f.store.jobs.get(id)!.animationRepair!.attempts[0]).toMatchObject({ordinal:1,status:'failed',failure:{code:'provider_not_sent',cliCause:cause}});
  const budget=JSON.parse(f.store.ledger.get('budget')!.value);expect(budget.spent['2026-11-01']).toBe(0);
  const recovered=JSON.parse(f.store.ledger.get('scheduler')!.value);expect(recovered.pauseReason).toBe('outcome_unknown');expect(recovered.providerSlots).toEqual([]);
  expect(await recoverResult(f.store,record,{...options,apply:true})).toMatchObject({mode:'noop'});expect(generate).toHaveBeenCalledTimes(1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

it.each([false,true])('retains prior uncertain costs when TLS and HTTP520 are mixed (TLS first=%s)',async tlsFirst=>{
 const f=await taskFixture(20);const id=f.jobs[0].id;
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 let calls=0;
 const generate=vi.fn(async()=>{
  const tls=(calls++===0)===tlsFirst;
  throw tls?failure():new GenerationError('outcome_unknown',undefined,undefined,undefined,{boundary:'provider_cli',reason:'process_exit'},{kind:'http_error',httpStatus:520});
 });
 const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})}});
 for(let n=0;n<8&&f.store.jobs.get(id)!.status!=='failed';n++){await run('owner-'+n);f.clock.now+=5001;}
 expect(generate).toHaveBeenCalledTimes(2);
 const state=JSON.parse(f.store.ledger.get('scheduler')!.value);expect(state.pauseReason).toBeUndefined();expect(state.providerSlots).toEqual([]);
 const budget=JSON.parse(f.store.ledger.get('budget')!.value);expect(budget.reservations[id].unknown).toBe(true);expect(budget.spent['2026-11-01']??0).toBe(0);
});

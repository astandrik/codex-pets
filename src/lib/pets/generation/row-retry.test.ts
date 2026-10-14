import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {MemoryStore} from './test-store';
import {createGenerationService} from './service';
import {createSpriteGenerationWorker} from './sprite-worker';
import {GenerationError,LEASE_MS,STAGE_NAMES} from './model';
const usage={textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.04};
function disconnected(){return new GenerationError('outcome_unknown',undefined,undefined,undefined,{boundary:'provider_cli',reason:'process_exit',exitCode:1},{kind:'remote_disconnected'});}
async function fixture(){
 const store=new MemoryStore(),clock={now:Date.parse('2026-10-13T18:00:00Z'),enabled:true};
 const service=createGenerationService(store,{now:()=>clock.now,enabled:()=>clock.enabled,secret:()=> 'row-retry-fixture-secret-at-least32'});
 const accepted=await service.generate({requestId:randomUUID(),prompt:'Synthetic character'},'203.0.113.1');
 const calls:string[]=[],waits:number[]=[];
 const generate=vi.fn(async(name:string)=>{calls.push(name);return{bytes:Buffer.from(name),generationMs:1,usage};});
 const wait=vi.fn(async(ms:number)=>{waits.push(ms);clock.now+=ms;});
 const worker=createSpriteGenerationWorker({service,store,now:()=>clock.now,wait,renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})},build:async()=>({'pet.zip':Buffer.from('zip')})});
 return{store,clock,service,accepted,calls,waits,generate,wait,worker};
}
describe('one durable delayed row retry',()=>{
 it('retries only the disconnected row after five seconds, preserving every successful sibling',async()=>{
  const f=await fixture();let failed=false;
  f.generate.mockImplementation(async name=>{f.calls.push(name);if(name==='running-left'&&!failed){failed=true;throw disconnected();}return{bytes:Buffer.from(name),generationMs:1,usage};});
  expect(await f.worker('owner')).toBe('completed');expect(f.waits).toEqual([5000]);
  expect(f.calls.filter(n=>n==='running-left')).toHaveLength(2);for(const name of STAGE_NAMES.filter(n=>n!=='running-left'))expect(f.calls.filter(n=>n===name)).toHaveLength(1);
  const job=await f.store.readJob(f.accepted.generationId);expect(job).toHaveProperty('rowRetries',[expect.objectContaining({stage:'running-left',state:'completed'})]);
  expect(job).toHaveProperty('rowAttemptLogs',[expect.objectContaining({stage:'running-left',attempt:1,cliCause:{kind:'remote_disconnected'}})]);
  expect(JSON.parse(f.store.ledger.get('budget')!.value).reservations[f.accepted.generationId]).toEqual({remainingMicroUsd:0,unknown:true});
  expect(JSON.stringify(await f.service.get(f.accepted.generationId))).not.toMatch(/rowRetries|rowAttemptLogs|remote_disconnected/);
 });
 it('stops after a second failure and never repeats that terminal job',async()=>{
  const f=await fixture();f.generate.mockImplementation(async name=>{f.calls.push(name);if(name==='idle')throw disconnected();return{bytes:Buffer.from(name),generationMs:1,usage};});
  expect(await f.worker('owner')).toBe('failed');expect(await f.worker('other')).toBe('idle');expect(f.calls.filter(n=>n==='idle')).toHaveLength(2);expect(f.waits).toEqual([5000]);
  const job=await f.store.readJob(f.accepted.generationId);expect(job).toHaveProperty('rowAttemptLogs',[expect.objectContaining({stage:'idle',attempt:1}),expect.objectContaining({stage:'idle',attempt:2})]);
  expect(job?.stages.filter(s=>s.status==='completed')).toHaveLength(11);
 });
 it('does not retry moderation, unknown errors or checkpoint failures',async()=>{
  for(const error of [new GenerationError('provider_rejected'),new GenerationError('outcome_unknown')]){
   const f=await fixture();f.generate.mockRejectedValueOnce(error);expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(1);expect(f.wait).not.toHaveBeenCalled();
  }
  const f=await fixture();vi.spyOn(f.service,'saveStage').mockRejectedValueOnce(Error('checkpoint unavailable'));expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(1);expect(f.wait).not.toHaveBeenCalled();
 });
 it('rechecks disabling after the wait and before the retry',async()=>{
  const f=await fixture();f.generate.mockRejectedValueOnce(disconnected());f.wait.mockImplementation(async ms=>{f.clock.now+=ms;f.clock.enabled=false;});
  expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(1);
 });
 it('does not send retry after an uncertain retry-intent acknowledgement or restart',async()=>{
  const f=await fixture();f.generate.mockRejectedValueOnce(disconnected());
  const original=f.service.beginRowRetry;vi.spyOn(f.service,'beginRowRetry').mockImplementationOnce(async(...args)=>{await original(...args);throw Error('lost retry intent ACK');});
  expect(await f.worker('owner')).toBe('failed');f.clock.now+=LEASE_MS+1;expect(await f.worker('replacement')).toBe('idle');expect(f.generate).toHaveBeenCalledTimes(1);
 });
});
it('does not send a retry after its start acknowledgement is lost',async()=>{
 const f=await fixture();f.generate.mockRejectedValueOnce(disconnected());const original=f.service.authorizeRowRetry;
 vi.spyOn(f.service,'authorizeRowRetry').mockImplementationOnce(async(...args)=>{await original(...args);throw Error('lost retry authorization ACK');});
 expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(1);
 expect((await f.store.readJob(f.accepted.generationId))?.rowRetries?.[0].state).toBe('started');
 expect(await f.worker('replacement')).toBe('idle');
});
it('does not send an early retry or authorize the same token twice',async()=>{
 const f=await fixture(),job=(await f.service.claim('owner'))!;await f.service.beginStage(job,'base');await f.service.recordRowAttemptFailure(job,'base',1,disconnected());
 const retry=await f.service.beginRowRetry(job,'base');
 await expect(f.service.authorizeRowRetry(job,'base',retry.token)).rejects.toMatchObject({code:'invalid_stage'});
 f.clock.now+=5000;await f.service.authorizeRowRetry(job,'base',retry.token);
 await expect(f.service.authorizeRowRetry(job,'base',retry.token)).rejects.toMatchObject({code:'invalid_stage'});
 await expect(f.service.beginRowRetry(job,'base')).rejects.toMatchObject({code:'invalid_stage'});
 f.clock.now+=LEASE_MS+1;expect(await f.service.claim('replacement')).toBeNull();expect(f.generate).not.toHaveBeenCalled();
});
it('serializes persistence for eleven simultaneous disconnects without repeating successful work',async()=>{
 const f=await fixture(),seen=new Set<string>();
 f.generate.mockImplementation(async name=>{f.calls.push(name);if(name!=='base'&&!seen.has(name)){seen.add(name);throw disconnected();}return{bytes:Buffer.from(name),generationMs:1,usage};});
 const transaction=f.store.transaction.bind(f.store);let active=0,max=0;
 f.store.transaction=async operation=>{active++;max=Math.max(max,active);try{return await transaction(operation);}finally{active--;}};
 expect(await f.worker('owner')).toBe('completed');expect(f.calls).toHaveLength(23);expect(f.calls.filter(n=>n==='base')).toHaveLength(1);
 const job=await f.store.readJob(f.accepted.generationId);expect(job?.rowRetries).toHaveLength(11);expect(job?.rowRetries?.every(x=>x.state==='completed')).toBe(true);expect(job?.rowAttemptLogs).toHaveLength(11);
 expect(job?.stages.filter(s=>s.status==='completed')).toHaveLength(12);expect(max).toBeLessThanOrEqual(11);
});

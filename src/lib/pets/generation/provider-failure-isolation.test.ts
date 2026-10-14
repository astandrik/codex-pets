import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {MemoryStore} from './test-store';
import {createGenerationService} from './service';
import {createSpriteGenerationWorker} from './sprite-worker';
import {GenerationError,HEARTBEAT_MS,LEASE_MS,STAGE_NAMES} from './model';
import type {CliCause} from './cli-cause';
const usage={textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.04};
const causes:CliCause[]=[{kind:'remote_disconnected'},{kind:'incomplete_response'},{kind:'http_error',httpStatus:520},{kind:'http_error',httpStatus:500}];
function failure(cause:CliCause){return new GenerationError('outcome_unknown',undefined,undefined,undefined,{boundary:'provider_cli',reason:'process_exit',exitCode:1},cause);}
async function fixture(){
 const store=new MemoryStore(),clock={now:Date.parse('2026-10-14T07:00:00Z')};
 const service=createGenerationService(store,{now:()=>clock.now,enabled:()=>true,secret:()=> 'provider-isolation-fixture-secret32'});
 const input=()=>({requestId:randomUUID(),prompt:'Synthetic test'});
 const first=await service.generate(input(),'203.0.113.10'),next=await service.generate(input(),'203.0.113.11');
 const calls:string[]=[],waits:number[]=[];
 const generate=vi.fn(async(name:string)=>{calls.push(name);return{bytes:Buffer.from(name),usage,generationMs:1};});
 const worker=createSpriteGenerationWorker({service,store,now:()=>clock.now,wait:async ms=>{waits.push(ms);clock.now+=ms;},renderer:{open:async()=>({generate,prepare:async()=>{},compose:async()=>Buffer.from('atlas'),cleanup:async()=>{}})},build:async()=>({'pet.zip':Buffer.from('zip')})});
 return{store,clock,service,first,next,calls,waits,generate,worker};
}
describe('bounded provider failures',()=>{
 it.each(causes)('retries only the failed row once with delay for $kind $httpStatus',async cause=>{
  const f=await fixture();let failed=false;
  f.generate.mockImplementation(async name=>{f.calls.push(name);if(name==='waving'&&!failed){failed=true;throw failure(cause);}return{bytes:Buffer.from(name),usage,generationMs:1};});
  expect(await f.worker('owner')).toBe('completed');expect(f.waits).toEqual([5000]);
  for(const name of STAGE_NAMES)expect(f.calls.filter(x=>x===name)).toHaveLength(name==='waving'?2:1);
  expect((await f.store.readJob(f.first.generationId))?.rowRetries).toEqual([expect.objectContaining({stage:'waving',state:'completed'})]);
  expect(JSON.parse(f.store.ledger.get('budget')!.value).reservations[f.first.generationId]).toEqual({remainingMicroUsd:0,unknown:true});
 });
 it.each(causes)('lets the next pet run after two captured $kind failures, retaining the failed pet and unknown spending',async cause=>{
  const f=await fixture();f.generate.mockImplementation(async name=>{f.calls.push(name);if(name==='waving')throw failure(cause);return{bytes:Buffer.from(name),usage,generationMs:1};});
  expect(await f.worker('owner')).toBe('failed');expect(f.calls.filter(x=>x==='waving')).toHaveLength(2);expect(f.waits).toEqual([5000]);
  const failed=structuredClone(await f.store.readJob(f.first.generationId));expect(failed?.stages.filter(x=>x.status==='completed')).toHaveLength(11);
  expect(JSON.parse(f.store.ledger.get('scheduler')!.value)).toMatchObject({active:null,queue:[f.next.generationId]});
  expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBeUndefined();
  f.generate.mockImplementation(async name=>({bytes:Buffer.from(name),usage,generationMs:1}));
  expect(await f.worker('next-owner')).toBe('completed');expect(await f.store.readJob(f.first.generationId)).toEqual(failed);
  expect((await f.store.readJob(f.next.generationId))?.status).toBe('completed');
  expect(JSON.parse(f.store.ledger.get('budget')!.value).reservations[f.first.generationId]).toEqual({remainingMicroUsd:0,unknown:true});
 });
 it('handles the observed two520 plus one incomplete response while every successful row stays saved',async()=>{
  const f=await fixture();const broken=new Map<string,CliCause>([['waving',{kind:'http_error',httpStatus:520}],['failed',{kind:'http_error',httpStatus:520}],['look-0-157',{kind:'incomplete_response'}]]);
  f.generate.mockImplementation(async name=>{f.calls.push(name);const cause=broken.get(name);if(cause)throw failure(cause);return{bytes:Buffer.from(name),usage,generationMs:1};});
  expect(await f.worker('owner')).toBe('failed');
  for(const name of STAGE_NAMES)expect(f.calls.filter(x=>x===name)).toHaveLength(broken.has(name)?2:1);
  const job=await f.store.readJob(f.first.generationId);expect(job?.rowAttemptLogs).toHaveLength(6);expect(job?.rowRetries).toHaveLength(3);expect(job?.stages.filter(s=>s.status==='completed')).toHaveLength(9);
  for(const name of STAGE_NAMES.filter(n=>!broken.has(n)))expect(await f.store.readArtifact(f.first.generationId,'stage-'+name+'.png',f.clock.now)).toEqual(Buffer.from(name));
  expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBeUndefined();expect((await f.service.claim('next-owner'))?.id).toBe(f.next.generationId);
 });
 it.each([500,520])('keeps the pause for HTTP $0 mixed with an unconfirmed checkpoint',async status=>{
  const f=await fixture(),save=f.service.saveStage;
  f.generate.mockImplementation(async name=>{if(name==='waving')throw failure({kind:'http_error',httpStatus:status});return{bytes:Buffer.from(name),usage,generationMs:1};});
  vi.spyOn(f.service,'saveStage').mockImplementation(async(...args)=>{if(args[1]==='running')throw Error('checkpoint failed');return save(...args);});
  expect(await f.worker('owner')).toBe('failed');expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');expect(await f.worker('next')).toBe('idle');
 });
 it('rolls back failed-job finalization when the scheduler write fails and does not advance the queue',async()=>{
  const f=await fixture();f.generate.mockRejectedValue(failure(causes[2]));const tx=f.store.transaction.bind(f.store),fail=f.service.fail;
  vi.spyOn(f.service,'fail').mockImplementation(async(...args)=>{
   f.store.transaction=operation=>tx(t=>operation({...t,putLedger:async(key,value,expires)=>{if(key==='scheduler')throw Error('scheduler write failed');await t.putLedger(key,value,expires);}}));
   try{return await fail(...args);}finally{f.store.transaction=tx;}
  });
  await expect(f.worker('owner')).rejects.toThrow('scheduler write failed');expect((await f.store.readJob(f.first.generationId))?.status).toBe('generating');
  expect(await f.worker('other')).toBe('idle');expect(f.generate).toHaveBeenCalledTimes(2);
 });
 it('requires a persisted terminal attempt matching each unresolved row, not only a supplied cause',async()=>{
  const f=await fixture(),j=(await f.service.claim('owner'))!;await f.service.beginStage(j,'base');
  const error=failure(causes[2]);await f.service.fail(j,error.code,undefined,error.diagnostic,[],[{stage:'base',cause:causes[2]}]);
  expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');
 });
 it('keeps the pause when persisted and supplied HTTP statuses differ',async()=>{
  const f=await fixture(),job=(await f.service.claim('owner'))!;await f.service.beginStage(job,'base');
  await f.service.recordRowAttemptFailure(job,'base',1,failure({kind:'http_error',httpStatus:500}));
  const error=failure({kind:'http_error',httpStatus:520});
  await f.service.fail(job,error.code,undefined,error.diagnostic,[],[{stage:'base',cause:{kind:'http_error',httpStatus:520}}]);
  expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');
  expect(await f.worker('next')).toBe('idle');
 });
 it('keeps the pause for lost retry acknowledgement even when the first provider failure is durable',async()=>{
  const f=await fixture();f.generate.mockRejectedValue(failure(causes[2]));const begin=f.service.beginRowRetry;
  vi.spyOn(f.service,'beginRowRetry').mockImplementationOnce(async(...args)=>{await begin(...args);throw Error('lost retry ACK');});
  expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(1);expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');expect(await f.worker('next')).toBe('idle');
 });
 it.each<CliCause>([{kind:'unclassified'},{kind:'timeout'},{kind:'http_error',httpStatus:400},{kind:'http_error',httpStatus:429},{kind:'http_error',httpStatus:502}])('does not widen retries or unpause other cases: $kind $httpStatus',async cause=>{
  const f=await fixture();f.generate.mockRejectedValue(failure(cause));expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(1);expect(f.waits).toEqual([]);expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');
 });
 it('keeps the pause when a worker disappears with a paid intent',async()=>{
  const f=await fixture(),j=(await f.service.claim('owner'))!;await f.service.beginStage(j,'base');f.clock.now+=LEASE_MS+1;
  expect(await f.worker('replacement')).toBe('idle');expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');expect(f.generate).not.toHaveBeenCalled();
 });
 it('keeps the pause when heartbeat fails during the last provider attempt',async()=>{
  vi.useFakeTimers();
  try{
   const f=await fixture();let attempts=0;vi.spyOn(f.service,'heartbeat').mockRejectedValue(Error('heartbeat unavailable'));
   f.generate.mockImplementation(async()=>{if(++attempts===2)await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);throw failure(causes[0]);});
   expect(await f.worker('owner')).toBe('failed');expect(attempts).toBe(2);
   expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');expect(await f.worker('replacement')).toBe('idle');
  }finally{vi.useRealTimers();}
 });
});

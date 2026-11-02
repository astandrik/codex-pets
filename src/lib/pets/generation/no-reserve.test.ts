import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {createGenerationService} from './service';
import {createSpriteGenerationWorker} from './sprite-worker';
import {MemoryStore} from './test-store';
import {STAGE_NAMES} from './model';

function fixture(spent=0){
 const store=new MemoryStore(),now=Date.parse('2026-10-13T10:00:00Z');
 store.ledger.set('budget',{value:JSON.stringify({spent:{'2026-10-13':spent},reservations:{}}),expiresAt:Date.UTC(2099,0)});
 const service=createGenerationService(store,{now:()=>now,enabled:()=>true,budgetUsd:()=>50,secret:()=> 'no-reserve-test-secret-at-least-32-characters'});
 const input=()=>({requestId:randomUUID(),prompt:'Synthetic pet'});
 return{store,service,input,now};
}
const billing=(store:MemoryStore)=>JSON.parse(store.ledger.get('budget')!.value);
describe('recorded-spend budget without monetary reservations',()=>{
 it('admits below the threshold without reserving funds and refuses exactly at it',async()=>{
  const f=fixture(49_999_999);await f.service.generate(f.input(),'203.0.113.1');
  expect(Object.values(billing(f.store).reservations)).toEqual([{remainingMicroUsd:0,unknown:false}]);
  const stopped=fixture(50_000_000);await expect(stopped.service.generate(stopped.input(),'203.0.113.2')).rejects.toMatchObject({code:'budget_exhausted'});expect(stopped.store.jobs.size).toBe(0);
 });
 it('authorizes eleven parallel rows without holds, records overshoot and blocks the next task',async()=>{
  const f=fixture(49_950_000);await f.service.generate(f.input(),'203.0.113.3');
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let rows=0;const calls:string[]=[];
  const worker=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.now,renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from('atlas'),generate:async name=>{
   calls.push(name);expect(Object.values(billing(f.store).reservations)).toEqual([{remainingMicroUsd:0,unknown:false}]);
   if(name!=='base'){rows++;if(rows===11)release();await barrier;}
   return{bytes:Buffer.from(name),generationMs:1,usage:{textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.04}};
  }})},build:async()=>({'pet.zip':Buffer.from('zip')})});
  expect(await worker('owner')).toBe('completed');expect(calls).toEqual([...STAGE_NAMES]);expect(rows).toBe(11);
  expect(billing(f.store)).toEqual({spent:{'2026-10-13':50_430_000},reservations:{}});
  await expect(f.service.generate(f.input(),'203.0.113.4')).rejects.toMatchObject({code:'budget_exhausted'});
 });
 it('keeps unknown accounting history with a zero balance and never repeats the failed stage',async()=>{
  const f=fixture();const accepted=await f.service.generate(f.input(),'203.0.113.5');const job=(await f.service.claim('old'))!;
  await f.service.beginStage(job,'base');await f.service.fail(job,'outcome_unknown');
  expect(billing(f.store).reservations[accepted.generationId]).toEqual({remainingMicroUsd:0,unknown:true});
  expect(await f.service.claim('new')).toBeNull();expect((await f.store.readJob(job.id))?.status).toBe('failed');
 });
});

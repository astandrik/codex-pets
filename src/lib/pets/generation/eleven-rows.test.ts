import {randomUUID} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {LEASE_MS,STAGE_NAMES,type StageName} from "./model";
import {MemoryStore} from "./test-store";
const usage={textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.04};
async function fixture(limit=50){
 const store=new MemoryStore(),clock={now:Date.parse('2026-10-12T11:00:00Z')};
 const service=createGenerationService(store,{secret:()=> 'eleven-rows-test-secret-at-least-32-characters',enabled:()=>true,now:()=>clock.now,budgetUsd:()=>limit});
 await service.generate({prompt:'Synthetic eleven-row fixture',requestId:randomUUID()},'203.0.113.81');
 const generate=vi.fn(async(name:StageName)=>({bytes:Buffer.from(name),usage,generationMs:1}));
 const worker=createSpriteGenerationWorker({service,store,now:()=>clock.now,renderer:{open:async()=>({prepare:async()=>undefined,generate,compose:async()=>Buffer.from('atlas'),cleanup:async()=>undefined})},build:async()=>({'pet.zip':Buffer.from('zip')})});
 return{store,clock,service,generate,worker};
}
const budget=(store:MemoryStore)=>JSON.parse(store.ledger.get('budget')!.value);
const six=STAGE_NAMES.slice(1,7);
const eleven=STAGE_NAMES.slice(1);
async function base(f:Awaited<ReturnType<typeof fixture>>){const job=(await f.service.claim('owner'))!;await f.service.beginStage(job,'base');await f.service.saveStage(job,'base',Buffer.from('base'),{usage,generationMs:1});return job;}
describe('eleven-row generation boundary',()=>{
 it('uses exactly a base plus one batch of eleven rows',async()=>{
  const f=await fixture(),begin=f.service.beginStages,groups:string[][]=[];
  vi.spyOn(f.service,'beginStages').mockImplementation((job,names)=>{groups.push([...names]);return begin(job,names);});
  expect(await f.worker('owner')).toBe('completed');expect(groups.map(x=>x.length)).toEqual([11]);
  expect(f.generate.mock.calls.map(x=>x[0])).toEqual([...STAGE_NAMES]);expect(budget(f.store).spent['2026-10-12']).toBe(480000);
 });
 it.each([{limit:13,attempts:[11]},{limit:10,attempts:[11]},{limit:6,attempts:[11]},{limit:3,attempts:[11]}])('keeps eleven rows below recorded-spend threshold $limit',async({limit,attempts})=>{
  const f=await fixture(limit),begin=f.service.beginStages,sizes:number[]=[];
  vi.spyOn(f.service,'beginStages').mockImplementation((job,names)=>{sizes.push(names.length);return begin(job,names);});
  expect(await f.worker('owner')).toBe('completed');expect(sizes.slice(0,attempts.length)).toEqual(attempts);
  expect(f.generate).toHaveBeenCalledTimes(12);expect(new Set(f.generate.mock.calls.map(x=>x[0])).size).toBe(12);
 });
 it('preserves ten unknown outcomes without holding funds after one of eleven finishes and across midnight',async()=>{
  const f=await fixture(),job=await base(f);await f.service.beginStages(job,eleven);
  expect(budget(f.store).reservations[job.id]).toEqual({unknown:false,remainingMicroUsd:0});
  await f.service.saveStage(job,six[5],Buffer.from(six[5]),{usage,generationMs:1});f.clock.now+=LEASE_MS+1;
  expect(await f.service.claim('replacement')).toBeNull();f.clock.now+=86400000;await f.store.cleanup(f.clock.now);
  expect(budget(f.store).reservations[job.id]).toEqual({unknown:true,remainingMicroUsd:0});
 });
 it('resumes six completed rows without repaying them',async()=>{
  const f=await fixture(),job=await base(f);await f.service.beginStages(job,six);
  await Promise.all([...six].reverse().map(name=>f.service.saveStage(job,name,Buffer.from(name),{usage,generationMs:1})));
  f.clock.now+=LEASE_MS+1;expect(await f.worker('replacement')).toBe('completed');expect(f.generate.mock.calls.map(x=>x[0])).toEqual(STAGE_NAMES.slice(7));
 });
 it('packages eleven saved rows after a restart without another provider call',async()=>{
  const f=await fixture(),job=await base(f);await f.service.beginStages(job,eleven);
  for(const name of [...eleven].reverse())await f.service.saveStage(job,name,Buffer.from(name),{usage,generationMs:1});
  f.clock.now+=LEASE_MS+1;expect(await f.worker('replacement')).toBe('completed');expect(f.generate).not.toHaveBeenCalled();
  expect((await f.store.readJob(job.id))?.stages.filter(s=>s.status==='completed')).toHaveLength(12);
 });
 it('does not repeat or shrink eleven persisted intents after a lost acknowledgement',async()=>{
  const f=await fixture(),begin=f.service.beginStages,sizes:number[]=[];let count=0;
  vi.spyOn(f.service,'beginStages').mockImplementation(async(job,names)=>{sizes.push(names.length);const saved=await begin(job,names);if(count++===0){throw Error('synthetic lost ACK');}return saved;});
  expect(await f.worker('owner')).toBe('completed');expect(sizes).toEqual([11]);expect(f.generate).toHaveBeenCalledTimes(12);expect(new Set(f.generate.mock.calls.map(x=>x[0])).size).toBe(12);
 });
});

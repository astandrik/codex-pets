import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGenerationService } from "./service";
import { createSpriteGenerationWorker } from "./sprite-worker";
import { GenerationError, LEASE_MS, STAGE_NAMES, type StageName } from "./model";
import { MemoryStore } from "./test-store";
const usage={textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:0.04};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
async function fixture(){
 const store=new MemoryStore(),config={now:Date.parse('2026-10-12T08:00:00Z'),enabled:true};
 const service=createGenerationService(store,{secret:()=> 'parallel-worker-test-secret-at-least-32',enabled:()=>config.enabled,now:()=>config.now});
 const accepted=await service.generate({prompt:'Synthetic pet',requestId:randomUUID()},'203.0.113.12');
 const generate=vi.fn(async(name:StageName)=>({bytes:Buffer.from(name),usage,generationMs:1}));
 const prepare=vi.fn(async()=>{expect((await store.readJob(accepted.generationId))?.stages[0]).toMatchObject({name:'base',status:'completed'});});
 const compose=vi.fn(async()=>Buffer.from('atlas')),cleanup=vi.fn(async()=>undefined);
 const worker=createSpriteGenerationWorker({service,store,renderer:{open:async()=>({generate,prepare,compose,cleanup})},build:async()=>({'pet.zip':Buffer.from('zip')}),now:()=>config.now});
 return{store,config,service,accepted,generate,prepare,compose,cleanup,worker};
}

describe('eleven-row worker boundary',()=>{
 it('waits for base, overlaps exactly eleven rows, saves reverse completions and joins before composing',async()=>{
  const f=await fixture(),base=deferred(),idle=deferred(),running=deferred(),left=deferred(),right=deferred(),waving=deferred(),jumping=deferred(),others=new Map(STAGE_NAMES.slice(7).map(name=>[name,deferred()]));let active=0,max=0;
  f.generate.mockImplementation(async name=>{
   const row=(await f.store.readJob(f.accepted.generationId))?.stages.find(s=>s.name===name);
   expect(row?.status).toBe('inflight');active++;max=Math.max(max,active);
   if(name==='base')await base.promise;if(name==='idle')await idle.promise;if(name==='running')await running.promise;if(name==='running-left')await left.promise;if(name==='running-right')await right.promise;if(name==='waving')await waving.promise;if(name==='jumping')await jumping.promise;if(others.has(name))await others.get(name)!.promise;
   active--;return{bytes:Buffer.from(name),usage,generationMs:1};
  });
  const result=f.worker('owner');
  try{
   await vi.waitFor(()=>expect(f.generate).toHaveBeenCalledTimes(1));expect(f.prepare).not.toHaveBeenCalled();
   base.resolve();await vi.waitFor(()=>expect(f.generate.mock.calls.map(x=>x[0])).toContain('look-180-337'));
   expect(max).toBe(11);expect(await f.worker('other')).toBe('idle');
   running.resolve();await vi.waitFor(async()=>expect((await f.store.readJob(f.accepted.generationId))?.stages.find(s=>s.name==='running')?.status).toBe('completed'));
   expect(f.generate).toHaveBeenCalledTimes(12);expect(f.cleanup).not.toHaveBeenCalled();
   expect(JSON.parse(f.store.ledger.get('scheduler')!.value).active.inflight).toBe(true);
  }finally{base.resolve();idle.resolve();running.resolve();left.resolve();right.resolve();waving.resolve();jumping.resolve();for(const peer of others.values())peer.resolve();await result;}
  expect(await result).toBe('completed');expect(max).toBe(11);expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.generate).toHaveBeenCalledTimes(12);expect(new Set(f.generate.mock.calls.map(x=>x[0])).size).toBe(12);
 });
 it('waits for successful siblings before failing a known refusal and never retries',async()=>{
  const f=await fixture(),peer=deferred();let done=false;
  f.generate.mockImplementation(async name=>{if(name==='idle')throw new GenerationError('provider_rejected');if(name==='running')await peer.promise;return{bytes:Buffer.from(name),usage,generationMs:1};});
  const result=f.worker('owner').finally(()=>{done=true;});
  try{await vi.waitFor(()=>expect(f.generate.mock.calls.map(x=>x[0])).toContain('running'));expect(done).toBe(false);expect(f.cleanup).not.toHaveBeenCalled();}
  finally{peer.resolve();await result;}
  expect(await result).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(12);
  expect(await f.store.readArtifact(f.accepted.generationId,'stage-running.png',f.config.now)).toEqual(Buffer.from('running'));
  expect(await f.service.get(f.accepted.generationId)).toMatchObject({error:{code:'provider_rejected'}});
  const budget=JSON.parse(f.store.ledger.get('budget')!.value);expect(budget.spent['2026-10-12']).toBe(440000);expect(budget.reservations).toEqual({});
 });
 it('prefers an unknown sibling outcome over a known failure and retains the unknown accounting marker',async()=>{
  const f=await fixture();
  f.generate.mockImplementation(async name=>{if(name==='idle')throw new GenerationError('provider_rejected');if(name==='running')throw Error('transport timeout');return{bytes:Buffer.from(name),usage,generationMs:1};});
  expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(12);
  expect(await f.service.get(f.accepted.generationId)).toMatchObject({error:{code:'outcome_unknown'}});
  expect(await f.worker('replacement')).toBe('idle');
  const reserve=JSON.parse(f.store.ledger.get('budget')!.value).reservations[f.accepted.generationId];expect(reserve.unknown).toBe(true);expect(reserve.remainingMicroUsd).toBe(0);
 });
 it('recovers lost pair-intent and sibling-result acknowledgements without another paid call',async()=>{
  const f=await fixture(),begin=f.service.beginStages,save=f.service.saveStage;let pairAckLost=false;
  vi.spyOn(f.service,'beginStages').mockImplementationOnce(async(...args)=>{await begin(...args);pairAckLost=true;throw Error('lost pair ACK');});
  vi.spyOn(f.service,'saveStage').mockImplementation(async(...args)=>{const value=await save(...args);if(args[1]==='running')throw Error('lost result ACK');return value;});
  expect(await f.worker('owner')).toBe('completed');expect(f.generate).toHaveBeenCalledTimes(12);
  expect(pairAckLost).toBe(true);expect(JSON.parse(f.store.ledger.get('budget')!.value).spent['2026-10-12']).toBe(480000);
 });
 it('rechecks disabling after intents and before either paid row call',async()=>{
  const f=await fixture(),begin=f.service.beginStages;
  vi.spyOn(f.service,'beginStages').mockImplementationOnce(async(...args)=>{const result=await begin(...args);f.config.enabled=false;return result;});
  expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(1);
  expect(await f.service.get(f.accepted.generationId)).toMatchObject({error:{code:'generation_disabled'}});
 });
 it('records all already-authorized rows even when their actual cost exceeds the threshold',async()=>{
  const store=new MemoryStore();const config={now:Date.parse('2026-10-12T08:00:00Z')};
  const service=createGenerationService(store,{secret:()=> 'parallel-worker-budget-secret-at-least32',enabled:()=>true,now:()=>config.now,budgetUsd:()=>2});
  await service.generate({prompt:'Synthetic budget',requestId:randomUUID()},'203.0.113.12');
  const calls:StageName[]=[];const worker=createSpriteGenerationWorker({service,store,renderer:{open:async()=>({prepare:async()=>undefined,generate:async name=>{calls.push(name);return{bytes:Buffer.from(name),usage:{...usage,costUsd:name==='base'?1.96:0.04},generationMs:1};},compose:async()=>Buffer.from('atlas'),cleanup:async()=>undefined})},build:async()=>({'pet.zip':Buffer.from('zip')}),now:()=>config.now});
  expect(await worker('owner')).toBe('completed');expect(calls).toEqual([...STAGE_NAMES]);
  expect(JSON.parse(store.ledger.get('budget')!.value).spent['2026-10-12']).toBe(2400000);
 });
 it('does not adopt a replacement owner from a checkpoint read after lease expiry',async()=>{
  const f=await fixture(),save=f.service.saveStage;
  vi.spyOn(f.service,'saveStage').mockImplementationOnce(async(...args)=>{
    const result=await save(...args);f.config.now+=LEASE_MS+1;
    expect((await f.service.claim('replacement'))?.worker).toBe('replacement');
    return result;
  });
  await expect(f.worker('old')).rejects.toMatchObject({code:'stale_worker'});
  expect(f.generate.mock.calls.map(x=>x[0])).toEqual(['base']);
  expect((await f.store.readJob(f.accepted.generationId))?.worker).toBe('replacement');
  expect((await f.store.readJob(f.accepted.generationId))?.stages).toHaveLength(1);
 });
 it('does not adopt another owner while reconciling a lost atlas acknowledgement',async()=>{
  const f=await fixture(),save=f.service.saveSource;
  vi.spyOn(f.service,'saveSource').mockImplementationOnce(async(...args)=>{
    await save(...args);f.config.now+=LEASE_MS+1;
    expect((await f.service.claim('replacement'))?.worker).toBe('replacement');
    throw Error('lost atlas ACK');
  });
  await expect(f.worker('old')).rejects.toMatchObject({code:'stale_worker'});
  expect((await f.store.readJob(f.accepted.generationId))?.status).toBe('processing');
  expect((await f.store.readJob(f.accepted.generationId))?.worker).toBe('replacement');
 });
 it('resumes a fully saved pair without repeating the base or rows',async()=>{
  const f=await fixture(),job=(await f.service.claim('old'))!;
  await f.service.beginStage(job,'base');await f.service.saveStage(job,'base',Buffer.from('base'),{usage,generationMs:1});
  await f.service.beginStages(job,['idle','running']);
  await Promise.all(['idle','running'].map(name=>f.service.saveStage(job,name as StageName,Buffer.from(name),{usage,generationMs:1})));
  f.config.now+=LEASE_MS+1;expect(await f.worker('new')).toBe('completed');
  expect(f.generate).toHaveBeenCalledTimes(9);expect(f.generate.mock.calls.map(x=>x[0])).not.toContain('base');expect(f.generate.mock.calls.map(x=>x[0])).not.toContain('idle');expect(f.generate.mock.calls.map(x=>x[0])).not.toContain('running');
 });
});

it('saves successful sibling images even when an earlier checkpoint cannot be confirmed',async()=>{
 const f=await fixture(),save=f.service.saveStage;
 vi.spyOn(f.service,'saveStage').mockImplementation(async(...args)=>{if(args[1]==='idle')throw Error('synthetic unavailable checkpoint');return save(...args);});
 expect(await f.worker('owner')).toBe('failed');expect(f.generate).toHaveBeenCalledTimes(12);
 for(const name of STAGE_NAMES.slice(2))expect(await f.store.readArtifact(f.accepted.generationId,'stage-'+name+'.png',f.config.now)).toEqual(Buffer.from(name));
 expect(await f.service.get(f.accepted.generationId)).toMatchObject({error:{code:'outcome_unknown'}});
 expect(JSON.parse(f.store.ledger.get('scheduler')!.value).pauseReason).toBe('outcome_unknown');
 expect(JSON.parse(f.store.ledger.get('budget')!.value).reservations[f.accepted.generationId]).toMatchObject({unknown:true});
});

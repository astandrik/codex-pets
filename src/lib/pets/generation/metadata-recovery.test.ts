import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {MemoryStore} from './test-store';
import {createGenerationService} from './service';
import {createSpriteGenerationWorker} from './sprite-worker';
import {moscowDay} from './model';
afterEach(()=>vi.unstubAllEnvs());
it('advances 17 saved bases and 7 untouched jobs without replaying saved provider work',async()=>{
  vi.stubEnv('PET_GENERATION_PROVIDER_CALLS','20');vi.stubEnv('PET_GENERATION_QUEUE_LIMIT','30');
  const now=Date.now(),store=new MemoryStore();
  const unknowns=Array.from({length:3},(_,i)=>({jobId:String(i+1).repeat(64),owner:'old',leaseId:randomUUID(),key:'old-operation',startedAt:now-86400000,unknown:true,dispatched:true}));
  store.ledger.set('scheduler',{expiresAt:now+86400000,value:JSON.stringify({version:3,revision:0,activeLimit:1,providerLimit:20,queue:[],active:[],resumes:{},providerSlots:unknowns,providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null})});
  const service=createGenerationService(store,{enabled:()=>true,secret:()=> 'synthetic-secret',now:()=>now});
  const inputs=Array.from({length:25},()=>({requestId:randomUUID(),prompt:'Synthetic'}));
  const receipts=[];
  for(let i=0;i<25;i++)receipts.push(await service.generate(inputs[i],`203.0.113.${i+1}`,{reviewBase:true}));
  const bytes=Buffer.from('saved base'),sha256=createHash('sha256').update(bytes).digest('hex');
  const ids=receipts.map(row=>row.generationId);
  for(const id of ids.slice(0,17)){
    const job=store.jobs.get(id)!;
    store.jobs.set(id,{...job,status:'generating',stages:[{name:'base',status:'completed',sha256,startedAt:now,generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:0.04}}]});
    store.artifacts.set(id+':stage-base.png',{bytes,expiresAt:job.expiresAt});
  }
  store.jobs.set(ids[17],{...store.jobs.get(ids[17])!,status:'generating',stages:[{name:'base',status:'inflight',startedAt:now}],rowAttemptLogs:[{stage:'base',attempt:1,at:now,code:'provider_rejected'}]});
  const pending=JSON.parse(store.ledger.get('scheduler')!.value);
  pending.tasks=[{key:ids[17]+':fail',jobId:ids[17],kind:'fail',status:'ready',notBefore:0,attempt:'failure',error:{code:'provider_rejected',providerFailure:{httpStatus:400}}}];
  store.ledger.get('scheduler')!.value=JSON.stringify(pending);
  const budget=JSON.parse(store.ledger.get('budget')!.value);budget.spent[moscowDay(now)]=1016767;
  for(const old of unknowns)budget.reservations[old.jobId]={remainingMicroUsd:0,unknown:true};
  store.ledger.get('budget')!.value=JSON.stringify(budget);
  const quota=[...store.ledger].filter(([key])=>key.startsWith('day:')||key.startsWith('ip:'));
  const calls:string[]=[];
  const worker=createSpriteGenerationWorker({service,store,now:()=>now,renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>bytes,generate:async()=>{calls.push(job.id);return {bytes,generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:0.01}};}})}});
  for(let i=0;i<60;i++)if(await worker('worker-'+i)==='idle')break;
  expect(calls).toHaveLength(7);expect(new Set(calls)).toEqual(new Set(ids.slice(18)));
  for(let i=0;i<25;i++){
    expect(store.jobs.get(ids[i])!.expiresAt).toBe(Date.parse(receipts[i].expiresAt));
    expect((await service.generate(inputs[i],`203.0.113.${i+1}`,{reviewBase:true})).generationId).toBe(ids[i]);
  }
  for(const id of [...ids.slice(0,17),...ids.slice(18)])expect(store.jobs.get(id)!.status).toBe('awaiting_confirmation');
  expect(store.jobs.get(ids[17])!).toMatchObject({status:'failed',error:'provider_rejected'});
  for(const id of ids.slice(0,17))expect(store.artifacts.get(id+':stage-base.png')!.bytes.equals(bytes)).toBe(true);
  expect([...store.ledger].filter(([key])=>key.startsWith('day:')||key.startsWith('ip:'))).toEqual(quota);
  expect(JSON.parse(store.ledger.get('scheduler')!.value).providerSlots).toEqual(unknowns);
  const finalBudget=JSON.parse(store.ledger.get('budget')!.value);
  expect(finalBudget.spent[moscowDay(now)]).toBe(1086767);
  for(const old of unknowns)expect(finalBudget.reservations[old.jobId]).toEqual(budget.reservations[old.jobId]);
});

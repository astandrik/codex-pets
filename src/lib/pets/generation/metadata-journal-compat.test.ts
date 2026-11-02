import {afterEach,expect,it,vi} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {buildCardMetadataRequest} from './card-provider';
import {MemoryStore} from './test-store';import {createGenerationService} from './service';import {FileResultJournal} from './result-journal';import {attachResultJournal} from './checkpoint-journal';import {prepareGeneratedCard} from './card-worker';
const roots:string[]=[];afterEach(async()=>{vi.unstubAllEnvs();for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
it.each([{version:1,reason:'budget_exhausted'},{version:1,reason:'generation_disabled'},{version:2,reason:'budget_exhausted'},{version:2,reason:'generation_disabled'}])('releases metadata reservation v$version for proven pre-dispatch $reason',async({version,reason})=>{
 const now=Date.parse('2026-11-02T10:00:00Z'),store=new MemoryStore();let enabled=true;
 const service=createGenerationService(store,{enabled:()=>enabled,secret:()=>"synthetic-review-secret",now:()=>now,automaticCardMetadata:()=>true,budgetUsd:()=>1});
 const accepted=await service.generate({requestId:randomUUID(),prompt:'Synthetic test'},'203.0.113.1');
 if(version===2){vi.stubEnv('PET_GENERATION_ACTIVE_JOBS','1');vi.stubEnv('PET_GENERATION_PROVIDER_CALLS','11');store.ledger.get('scheduler')!.value=JSON.stringify({version:2,revision:1,activeLimit:1,providerLimit:11,active:[],queue:[accepted.generationId],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null});}
 const claimed=(await service.claim('owner'))!,job={...claimed,status:'processing' as const};store.jobs.set(job.id,job);
 const root=await mkdtemp(path.join(tmpdir(),'metadata-compat-'));roots.push(root);const journal=await FileResultJournal.open(root),reserve=journal.reserve.bind(journal);
 journal.reserve=async identity=>{const key=await reserve(identity);if(reason==='generation_disabled')enabled=false;else await store.transaction(async tx=>{const budget=JSON.parse((await tx.getLedger('budget',now))!);budget.spent['2026-11-02']=1e6;await tx.putLedger('budget',JSON.stringify(budget),Date.UTC(2099,0,1));});return key;};
 attachResultJournal(service,store,{journal,now:()=>now});let calls=0;
 const result=await prepareGeneratedCard(job,Buffer.from('source'),service,store,{prepare:async()=>buildCardMetadataRequest(job,Array(4).fill('data:image/png;base64,YQ==')),generate:async()=>{calls++;throw Error('No provider call');}},()=>{},()=>now);
 expect(result.cardMetadata!.error).toBe(reason);expect(calls).toBe(0);expect(await journal.list()).toEqual([]);
});

import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';import {taskFixture} from './task-pool.test-utils';
import {FileResultJournal} from './result-journal';import {attachResultJournal} from './checkpoint-journal';
import {STAGE_NAMES} from './model';import {createSpriteGenerationWorker} from './sprite-worker';
import {recoverResult,checkpointJobHash} from './result-checkpoint-recovery';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function fixture(){
 const f=await taskFixture(20,true);f.saved(0,STAGE_NAMES.filter(n=>n!=='idle'));const row=f.store.ledger.get('scheduler')!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[f.jobs[0].id]});
 const root=await mkdtemp(path.join(tmpdir(),'recover-result-'));roots.push(root);const journal=await FileResultJournal.open(root);
 const service=attachResultJournal(f.service,f.store,{journal,now:()=>f.clock.now,retry:{attempts:1,wait:async()=>{}}});
 const original=f.store.transaction.bind(f.store);const spy=vi.spyOn(f.store,'transaction').mockImplementation(fn=>original(tx=>fn({...tx,putArtifact:async(id,kind,bytes,expires)=>{if(kind==='stage-idle.png')throw Error('db down');return tx.putArtifact(id,kind,bytes,expires);}})));
 vi.spyOn(console,'warn').mockImplementation(()=>{});let calls=0;
 const run=createSpriteGenerationWorker({service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from('atlas'),generate:async()=>{calls++;return {bytes:Buffer.from('received'),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}};}})}});
 expect(await run('provider-owner')).toBe('failed');expect(await run('finalizer')).toBe('failed');spy.mockRestore();
 const [key]=await journal.list(),record=(await journal.read(key,f.clock.now))!;
 const expectation=()=>({expectedRevision:JSON.parse(f.store.ledger.get('scheduler')!.value).revision,expectedJobHash:checkpointJobHash(f.store.jobs.get(f.jobs[0].id)!),now:()=>f.clock.now});
 return {...f,journal,record,expectation,calls:()=>calls};
}
it('dry-run performs zero writes; apply saves exact bytes/cost but never resumes the failed parent',async()=>{
 const f=await fixture();const before=structuredClone(f.store.jobs),budget=f.store.ledger.get('budget')!.value;
 expect((await recoverResult(f.store,f.record,f.expectation())).mode).toBe('image');
 expect(f.store.jobs).toEqual(before);expect(f.store.ledger.get('budget')!.value).toBe(budget);
 const expected=f.expectation();await recoverResult(f.store,f.record,{...expected,apply:true});
 expect(f.store.jobs.get(f.jobs[0].id)!.status).toBe('failed');expect(f.store.jobs.get(f.jobs[0].id)!.stages.find(s=>s.name==='idle')!.status).toBe('completed');
 expect(await f.store.readArtifact(f.jobs[0].id,'stage-idle.png',f.clock.now)).toEqual(Buffer.from('received'));
 expect(JSON.parse(f.store.ledger.get('scheduler')!.value)).toMatchObject({pauseReason:'outcome_unknown',providerSlots:[]});
 expect(JSON.parse(f.store.ledger.get('budget')!.value).spent['2026-11-01']).toBe(40000);
 expect((await recoverResult(f.store,f.record,{...expected,apply:true})).mode).toBe('noop');expect(f.calls()).toBe(1);
});
it('rejects a changed job and rejects any replay at or beyond original receipt expiry',async()=>{
 const f=await fixture();const expected=f.expectation();f.store.jobs.get(f.jobs[0].id)!.displayName='changed';
 await expect(recoverResult(f.store,f.record,{...expected,apply:true})).rejects.toThrow();
 f.clock.now=f.record.identity.createdAt+7*86400000;
 await expect(recoverResult(f.store,f.record,{...f.expectation(),apply:true})).rejects.toThrow();expect(f.calls()).toBe(1);
});
it('accounts a missing expired parent only with explicit absence and never recreates it',async()=>{
 const f=await fixture();f.clock.now=f.jobs[0].expiresAt+1;f.store.jobs.delete(f.jobs[0].id);
 const expected={...f.expectation(),expectedJobHash:null};
 await recoverResult(f.store,f.record,{...expected,apply:true});expect(f.store.jobs.has(f.jobs[0].id)).toBe(false);
 expect(JSON.parse(f.store.ledger.get('budget')!.value).spent).toBeDefined();expect(f.calls()).toBe(1);
});
it('two concurrent restores cannot charge the same outcome twice',async()=>{
 const f=await fixture(),expected=f.expectation();
 const results=await Promise.all([recoverResult(f.store,f.record,{...expected,apply:true}),recoverResult(f.store,f.record,{...expected,apply:true})]);
 expect(results.map(r=>r.mode)).toContain('noop');
 expect(JSON.parse(f.store.ledger.get('budget')!.value).spent['2026-11-01']).toBe(40000);
});
it('rejects a currently active owner without changing accounting or journal identity',async()=>{
 const f=await fixture();const row=f.store.ledger.get('scheduler')!,s=JSON.parse(row.value);
 s.tasks.push({jobId:f.jobs[0].id,key:'active',kind:'image',stage:'idle',status:'running',notBefore:0,attempt:'same',lease:{id:f.jobs[0].id,owner:'new-owner',leaseId:'11111111-1111-4111-8111-111111111111',until:f.clock.now+1000}});row.value=JSON.stringify(s);
 const budget=f.store.ledger.get('budget')!.value;
 await expect(recoverResult(f.store,f.record,{...f.expectation(),apply:true})).rejects.toThrow();
 expect(f.store.ledger.get('budget')!.value).toBe(budget);
});
it('accounts retained metadata after fallback without overwriting completed or manually edited fields',async()=>{
 const f=await taskFixture();const id=f.jobs[0].id;const row=f.store.ledger.get('scheduler')!;row.value=JSON.stringify({...JSON.parse(row.value),queue:[id]});
 const originalJob=f.store.jobs.get(id)!;f.store.jobs.set(id,{...originalJob,status:'processing',cardMetadata:{policy:1,state:'pending',revision:0,edited:false}});
 const root=await mkdtemp(path.join(tmpdir(),'metadata-recovery-'));roots.push(root);const journal=await FileResultJournal.open(root);
 const service=attachResultJournal(f.service,f.store,{journal,now:()=>f.clock.now,retry:{attempts:1}});
 let job=(await service.claim('metadata-owner'))!;job=await service.beginCardMetadata(job,'f'.repeat(64));await service.authorizeCardMetadata(job);
 const transaction=f.store.transaction.bind(f.store);const spy=vi.spyOn(f.store,'transaction').mockImplementation(fn=>transaction(tx=>fn({...tx,putJob:async saved=>{if(saved.cardMetadata?.state==='completed')throw Error('metadata write failed');return tx.putJob(saved);}})));
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 await expect(service.saveCardMetadata(job,{fields:{description:'generated description',tags:[]},responseHash:'e'.repeat(64),inputTokens:2,outputTokens:3,costUsd:.02})).rejects.toThrow();
 spy.mockRestore();await service.failCardMetadata(job,'outcome_unknown');await service.completeTask(job);
 const saved=f.store.jobs.get(id)!;f.store.jobs.set(id,{...saved,status:'completed',cardMetadata:{...saved.cardMetadata!,revision:1,edited:true,fields:{description:'manual description',tags:['manual']}}});
 const before=structuredClone(f.store.jobs.get(id)!);const [key]=await journal.list();const record=(await journal.read(key,f.clock.now))!;
 const result=await recoverResult(f.store,record,{apply:true,now:()=>f.clock.now,expectedRevision:JSON.parse(f.store.ledger.get('scheduler')!.value).revision,expectedJobHash:checkpointJobHash(before)});
 expect(result.mode).toBe('accounting-only');expect(f.store.jobs.get(id)).toEqual(before);
 expect(JSON.parse(f.store.ledger.get('budget')!.value).spent['2026-11-01']).toBe(20000);
});
it('rolls back if the receipt deadline is crossed while writing the budget',async()=>{
 const f=await fixture();f.clock.now=f.record.identity.createdAt+7*86400000-1;f.store.jobs.delete(f.jobs[0].id);
 const before=f.store.ledger.get('budget')!.value,transaction=f.store.transaction.bind(f.store);
 vi.spyOn(f.store,'transaction').mockImplementation(fn=>transaction(tx=>fn({...tx,putLedger:async(key,value,expiry)=>{await tx.putLedger(key,value,expiry);if(key==='budget')f.clock.now+=2;}})));
 await expect(recoverResult(f.store,f.record,{...f.expectation(),expectedJobHash:null,apply:true})).rejects.toThrow();
 expect(f.store.ledger.get('budget')!.value).toBe(before);
});
it('rejects a changed source even with a fresh operator job hash',async()=>{
 const f=await fixture();const current=f.store.jobs.get(f.jobs[0].id)!;current.promptRevision='different-revision';current.prompt='changed input';
 await expect(recoverResult(f.store,f.record,{...f.expectation(),apply:true})).rejects.toThrow();
});
it('retains an unresolved failure permit after image TTL',async()=>{
 const f=await fixture(),root=await mkdtemp(path.join(tmpdir(),'expired-failure-'));roots.push(root);const journal=await FileResultJournal.open(root);
 const key=await journal.reserve(f.record.identity);await journal.publish(key,{kind:'failure',code:'outcome_unknown'},`failed-${f.record.identity.operationKey}`);
 f.clock.now=f.record.identity.expiresAt+1;const record=(await journal.read(key,f.clock.now))!;
 await recoverResult(f.store,record,{...f.expectation(),apply:true});
 expect(JSON.parse(f.store.ledger.get('scheduler')!.value).providerSlots).toHaveLength(1);
});
it('clears a confirmed metadata rejection from the journal instead of leaking its reservation',async()=>{
 const f=await taskFixture(),id=f.jobs[0].id,root=await mkdtemp(path.join(tmpdir(),'metadata-failure-'));roots.push(root);
 const journal=await FileResultJournal.open(root),service=attachResultJournal(f.service,f.store,{journal,now:()=>f.clock.now});
 f.store.jobs.set(id,{...f.store.jobs.get(id)!,status:'processing',cardMetadata:{policy:1,state:'pending',revision:0,edited:false}});
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 let job=(await service.claim('metadata'))!;job=await service.beginCardMetadata(job,'f'.repeat(64));await service.authorizeCardMetadata(job);
 await service.failCardMetadata(job,'provider_rejected');
 expect(await journal.list()).toEqual([]);
});
it.each(['prompt','base','reference','animationPrompt'])('rejects changed %s provenance with a fresh operator hash',async field=>{
 const f=await fixture(),job=f.store.jobs.get(f.jobs[0].id)!;
 if(field==='prompt')job.prompt='new prompt';
 if(field==='base')job.stages.find(s=>s.name==='base')!.sha256='b'.repeat(64);
 if(field==='reference')job.reference={sha256:'c'.repeat(64),sourceSha256:'c'.repeat(64),width:1,height:1,sizeBytes:1,normalizationVersion:1};
 if(field==='animationPrompt')job.animationPrompt='different motion';
 await expect(recoverResult(f.store,f.record,{...f.expectation(),apply:true})).rejects.toThrow();
});
it.each([false,true])('restores a first base to explicit confirmation without queuing or repeating generation; baseRetry=%s',async baseRetry=>{
 const f=await taskFixture(),id=f.jobs[0].id;f.store.jobs.set(id,{...f.store.jobs.get(id)!,reviewBase:true,...(baseRetry?{baseRetrySourceId:'b'.repeat(64),baseRepair:{policy:1 as const,maxAttempts:4,phase:'active' as const,attempts:[]}}:{})});
 f.store.ledger.get('scheduler')!.value=JSON.stringify({...JSON.parse(f.store.ledger.get('scheduler')!.value),queue:[id]});
 const root=await mkdtemp(path.join(tmpdir(),'base-restore-'));roots.push(root);const journal=await FileResultJournal.open(root);
 const service=attachResultJournal(f.service,f.store,{journal,now:()=>f.clock.now,retry:{attempts:1}}),transaction=f.store.transaction.bind(f.store);let block=true,calls=0;
 const spy=vi.spyOn(f.store,'transaction').mockImplementation(fn=>transaction(tx=>fn({...tx,putArtifact:async(id,kind,bytes,expires)=>{if(block&&kind==='stage-base.png')throw Error('DB failed');return tx.putArtifact(id,kind,bytes,expires);}})));
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const run=createSpriteGenerationWorker({service,store:f.store,now:()=>f.clock.now,renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from('atlas'),generate:async()=>{calls++;return {bytes:Buffer.from('base'),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}};}})}});
 expect(await run('owner')).toBe('failed');expect(await run('finalizer')).toBe('failed');block=false;spy.mockRestore();
 const [key]=await journal.list(),record=(await journal.read(key,f.clock.now))!,before=f.store.jobs.get(id)!;
 const expectation={expectedRevision:JSON.parse(f.store.ledger.get('scheduler')!.value).revision,expectedJobHash:checkpointJobHash(before),now:()=>f.clock.now,apply:true};
 await recoverResult(f.store,record,expectation);
 expect(f.store.jobs.get(id)).toMatchObject({id,status:'awaiting_confirmation',expiresAt:before.expiresAt});
 const state=JSON.parse(f.store.ledger.get('scheduler')!.value);expect(state.queue).not.toContain(id);expect(state.pauseReason).toBe('outcome_unknown');expect(calls).toBe(1);
 await expect(service.confirm(id)).rejects.toMatchObject({code:'generation_paused'});
 // Simulate a separately authorized administrator release only inside this in-memory fixture.
 delete state.pauseReason;f.store.ledger.get('scheduler')!.value=JSON.stringify(state);
 expect((await service.confirm(id)).newlyQueued).toBe(true);expect(calls).toBe(1);
 expect((await recoverResult(f.store,record,expectation)).mode).toBe('noop');
 expect(JSON.parse(f.store.ledger.get('budget')!.value).spent['2026-11-01']).toBe(40000);
});

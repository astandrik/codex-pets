import {expect,it,vi} from 'vitest';
import {baseRetryFixture} from './base-retry-fixture.test-utils';
import {jobSchema} from './model';

it('does not admit when source expires during last target read',async()=>{
 const f=await baseRetryFixture(), input=await f.input(), expires=f.store.jobs.get(f.id)!.expiresAt;
 f.config.now=expires-1000;
 const original=f.store.transaction.bind(f.store);
 vi.spyOn(f.store,'transaction').mockImplementation(op=>original(tx=>op({...tx,getJob:async id=>{
   const value=await tx.getJob(id);if(id!==f.id&&value?.baseRetrySourceId===f.id)f.config.now=expires;return value;
 }})));
 await expect(f.service.retryBaseGeneration(f.id,input,'203.0.113.8')).rejects.toMatchObject({code:'generation_expired'});
 expect(f.store.jobs.size).toBe(1);
});

it('does not admit a provider failure with missing base checkpoint',async()=>{
 const f=await baseRetryFixture();f.store.jobs.get(f.id)!.stages=[];
 await expect(f.service.getBaseRetryOptions(f.id)).rejects.toMatchObject({code:'base_retry_unavailable'});
});

it('does not admit a provider failure with contradictory later-stage checkpoint',async()=>{
 const f=await baseRetryFixture();f.store.jobs.get(f.id)!.stages.push({name:'idle',status:'inflight',startedAt:f.config.now});
 await expect(f.service.getBaseRetryOptions(f.id)).rejects.toMatchObject({code:'base_retry_unavailable'});
});

it('does not admit when the last current base attempt is unknown despite a rejected terminal label',async()=>{
 const f=await baseRetryFixture();const job=f.store.jobs.get(f.id)!;
 job.rowAttemptLogs=[{stage:'base',attempt:1,at:f.config.now,code:'outcome_unknown'}];
 jobSchema.parse(job);
 await expect(f.service.getBaseRetryOptions(f.id)).rejects.toMatchObject({code:'base_retry_unavailable'});
});

it('retains support for legacy records with a consistent base checkpoint and no attempt log',async()=>{
 const f=await baseRetryFixture(true);expect(f.store.jobs.get(f.id)!.rowAttemptLogs).toBeUndefined();
 const options=await f.service.getBaseRetryOptions(f.id);expect(options).toHaveProperty('inputState','legacy');
});

it('charges the new Moscow day when midnight crosses on the final read',async()=>{
 const f=await baseRetryFixture(),input=await f.input();
 f.config.now=Date.parse('2026-11-01T20:59:59.999Z');
 const original=f.store.transaction.bind(f.store);let crossed=false;
 vi.spyOn(f.store,'transaction').mockImplementation(op=>original(tx=>op({...tx,getJob:async id=>{
  const job=await tx.getJob(id);if(!crossed&&id!==f.id&&job?.baseRetrySourceId===f.id){crossed=true;f.config.now+=2;}return job;
 }})));
 await f.service.retryBaseGeneration(f.id,input,'203.0.113.8');
 expect(f.store.ledger.get('day:2026-11-02')?.value).toBe('1');
});
it('requires current attempt evidence when a new input snapshot exists',async()=>{
 const f=await baseRetryFixture();f.store.jobs.get(f.id)!.rowAttemptLogs=[];
 await expect(f.service.getBaseRetryOptions(f.id)).rejects.toMatchObject({code:'base_retry_unavailable'});
});
it('rejects a conflicting HTTP status in the current attempt journal',async()=>{
 const f=await baseRetryFixture();f.store.jobs.get(f.id)!.rowAttemptLogs![0].cliCause={kind:'http_error',httpStatus:500};
 await expect(f.service.getBaseRetryOptions(f.id)).rejects.toMatchObject({code:'base_retry_unavailable'});
});
it('rejects a still-waiting retry even if a terminal log is present',async()=>{
 const f=await baseRetryFixture(),job=f.store.jobs.get(f.id)!;
 job.rowAttemptLogs![0].attempt=2;
 job.rowRetries=[{stage:'base',state:'waiting',notBefore:f.config.now+5000,token:'12345678-1234-4234-8234-123456789abc'}];
 await expect(f.service.getBaseRetryOptions(f.id)).rejects.toMatchObject({code:'base_retry_unavailable'});
});

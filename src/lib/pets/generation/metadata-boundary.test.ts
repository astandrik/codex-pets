import {randomUUID,createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createGenerationService} from './service';
import {MemoryStore} from './test-store';

it('stores only stage metadata when given the complete renderer result',async()=>{
  const store=new MemoryStore();
  const service=createGenerationService(store,{enabled:()=>true,secret:()=> 'synthetic-secret'});
  const input={requestId:randomUUID(),prompt:'Synthetic'};
  const receipt=await service.generate(input,'203.0.113.1');
  const job=(await service.claim('worker'))!;
  await service.beginStage(job,'base');
  const bytes=Buffer.alloc(1024*1024,7);
  const image={bytes,generationMs:12,usage:{textInputTokens:1,imageInputTokens:2,outputTokens:3,costUsd:0.04},extra:'must not persist'};
  const result=await service.saveStage(job,'base',bytes,image);
  expect(result!.stages[0]).not.toHaveProperty('bytes');
  const saved=store.jobs.get(job.id)!;
  expect(saved.stages[0]).not.toHaveProperty('bytes');
  expect(saved.stages[0]).not.toHaveProperty('extra');
  expect(saved.stages[0]).toMatchObject({status:'completed',sha256:createHash('sha256').update(bytes).digest('hex'),usage:image.usage,generationMs:12});
  expect(store.artifacts.get(job.id+':stage-base.png')!.bytes.equals(bytes)).toBe(true);
  const ledger=structuredClone([...store.ledger]);
  await service.saveStage(job,'base',bytes,image);
  expect([...store.ledger]).toEqual(ledger);
  expect((await service.generate(input,'203.0.113.1')).generationId).toBe(receipt.generationId);
});

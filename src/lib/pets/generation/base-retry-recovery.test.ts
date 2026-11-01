import {expect,it,vi} from "vitest";
import {baseRetryFixture} from "./base-retry-fixture.test-utils";
import {randomUUID} from "node:crypto";
it("reconciles a committed admission after the response is lost",async()=>{
 const f=await baseRetryFixture(),input=await f.input(),original=f.store.transaction.bind(f.store);let lost=false;
 vi.spyOn(f.store,"transaction").mockImplementation(async op=>{const value=await original(op);if(!lost&&f.store.jobs.size===2){lost=true;throw Error("lost ACK");}return value;});
 const r=await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");
 expect(lost).toBe(true);expect((await f.service.findBaseRetry(f.id,input.requestId)).generation.generationId).toBe(r.generation.generationId);expect(f.store.jobs.size).toBe(2);
});
it("does not create a new job behind a corrupt source pointer",async()=>{
 const f=await baseRetryFixture(),input=await f.input();await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");
 f.store.ledger.get("base-retry:source:"+f.id)!.value="{";
 await expect(f.service.retryBaseGeneration(f.id,{...input,requestId:randomUUID()},"203.0.113.8")).rejects.toMatchObject({code:"base_retry_unavailable"});
 expect(f.store.jobs.size).toBe(2);
});
it("rolls back a deadline crossed during the final receipt write",async()=>{
 const f=await baseRetryFixture(),input=await f.input(),original=f.store.transaction.bind(f.store),expires=f.store.jobs.get(f.id)!.expiresAt;
 const before=structuredClone([...f.store.ledger]);
 vi.spyOn(f.store,"transaction").mockImplementation(op=>original(tx=>op({...tx,putLedger:async(...args)=>{
  await tx.putLedger(...args);if(args[0].startsWith("base-retry:"))f.config.now=expires;
 }})));
 await expect(f.service.retryBaseGeneration(f.id,input,"203.0.113.8")).rejects.toMatchObject({code:"generation_expired"});
 expect(f.store.jobs.size).toBe(1);expect([...f.store.ledger]).toEqual(before);
});
it("rejects expiry during artifact IO without keeping a partial admission",async()=>{
 const f=await baseRetryFixture(),input=await f.input(),expiry=f.store.jobs.get(f.id)!.expiresAt;
 const original=f.store.transaction.bind(f.store);f.config.now=expiry-1;
 vi.spyOn(f.store,"transaction").mockImplementation(op=>original(tx=>op({...tx,getArtifact:async(...args)=>{const bytes=await tx.getArtifact(...args);f.config.now=expiry;return bytes;}})));
 await expect(f.service.retryBaseGeneration(f.id,input,"203.0.113.8")).rejects.toMatchObject({code:"generation_expired"});expect(f.store.jobs.size).toBe(1);
});
it("retries midnight transaction with the same candidate id and only the new-day quota",async()=>{
 const f=await baseRetryFixture(),input=await f.input(),original=f.store.transaction.bind(f.store);let crossed=false;
 f.config.now=Date.parse("2026-11-01T20:59:59.999Z");
 vi.spyOn(f.store,"transaction").mockImplementation(op=>original(tx=>op({...tx,putJob:async job=>{await tx.putJob(job);if(job.id!==f.id&&!crossed){crossed=true;f.config.now+=2;}}})));
 const r=await f.service.retryBaseGeneration(f.id,input,"203.0.113.8");expect(f.store.jobs.size).toBe(2);
 expect(f.store.ledger.get("day:2026-11-01")!.value).toBe("1");expect(f.store.ledger.get("day:2026-11-02")!.value).toBe("1");
 expect((await f.store.readJob(r.generation.generationId))!.createdAt).toBe(f.config.now);
});

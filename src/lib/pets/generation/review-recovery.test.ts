import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {taskFixture} from "./task-pool.test-utils";
import {parallelFixture} from "./parallel-fixture.test-utils";
import {createSpriteGenerationWorker, type SpriteSession} from "./sprite-worker";
import {buildCardMetadataRequest} from "./card-provider";
import {CARD_METADATA_FALLBACK} from "./card-metadata";
import {GenerationError, LEASE_MS, STAGE_NAMES, jobSchema} from "./model";
import type {MemoryStore} from "./test-store";

const usage = {textInputTokens:1, imageInputTokens:0, outputTokens:1, costUsd:0.01};
const transport = () => new GenerationError("outcome_unknown", undefined, undefined, undefined,
  {boundary:"provider_cli", reason:"process_exit"}, {kind:"http_error", httpStatus:520});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});
function isolate(store: MemoryStore, id: string) {
  const state = JSON.parse(store.ledger.get("scheduler")!.value);
  state.queue = [id]; store.ledger.get("scheduler")!.value = JSON.stringify(state);
}
function baseJob(f: Awaited<ReturnType<typeof taskFixture>>, maxAttempts = 1) {
  const job = f.store.jobs.get(f.jobs[0].id)!;
  job.reviewBase = true; job.baseRetrySourceId = "f".repeat(64);
  job.baseRepair = {policy:1, maxAttempts, phase:"active", attempts:[]};
  isolate(f.store, job.id); return job;
}
function runner(f: {store: MemoryStore; service: Awaited<ReturnType<typeof taskFixture>>["service"]; clock: {now: number}}, generate: SpriteSession["generate"]) {
  return createSpriteGenerationWorker({service:f.service, store:f.store, now:()=>f.clock.now,
    renderer:{open:async()=>({prepare:async()=>{}, cleanup:async()=>{}, compose:async()=>Buffer.from("atlas"), generate})},
    build:async()=>({"pet.zip":Buffer.from("zip")})});
}

it.each([2, 3].flatMap(version => ["inflight", "failed"].map(cardState => ({version, cardState}))))(
  "packages lost metadata after lease expiry in v$version with $cardState checkpoint", async ({version, cardState}) => {
    const f = version === 3 ? await taskFixture(1) : await parallelFixture();
    const id = "jobs" in f ? f.jobs[0].id : f.a.generationId;
    const job = f.store.jobs.get(id)!;
    job.status = "processing"; job.cardMetadata = {policy:1, state:"pending", revision:0, edited:false};
    const original = {id, createdAt:job.createdAt, expiresAt:job.expiresAt};
    const source = Buffer.from("saved atlas");
    f.store.artifacts.set(`${id}:source.png`, {bytes:source, expiresAt:job.expiresAt});
    isolate(f.store, id);
    if (version === 2) {
      const state = JSON.parse(f.store.ledger.get("scheduler")!.value); state.resumes[id] = 0;
      f.store.ledger.get("scheduler")!.value = JSON.stringify(state);
    }
    const requestLedger = [...f.store.ledger].filter(([key])=>key.startsWith("request:") || key.startsWith("day:") || key.startsWith("ip:"));
    let lost = (await f.service.claim("same-owner"))!;
    const request = buildCardMetadataRequest(lost, Array(4).fill("data:image/png;base64,YQ=="));
    lost = await f.service.beginCardMetadata(lost, request.requestHash);
    await f.service.authorizeCardMetadata(lost);
    if (cardState === "failed") await f.service.failCardMetadata(lost, "outcome_unknown");
    f.clock.now += LEASE_MS + 1;
    let packages = 0, calls = 0;
    const run = createSpriteGenerationWorker({service:f.service, store:f.store, now:()=>f.clock.now,
      renderer:{open:async()=>{throw Error("No image work expected");}},
      cardProvider:{prepare:async()=>request, generate:async()=>{calls++;throw Error("No metadata resend");}},
      build:async(current, bytes)=>{expect(bytes).toEqual(source);expect(current.cardMetadata?.fields).toEqual({description:CARD_METADATA_FALLBACK,tags:[]});packages++;return {"pet.zip":Buffer.from("zip")};}});
    await Promise.all([run("same-owner"), run("peer-owner")]);
    const saved = f.store.jobs.get(id)!;
    expect(saved).toMatchObject({...original, status:"completed", cardMetadata:{state:"failed", error:"outcome_unknown"}});
    expect(packages).toBe(1);expect(calls).toBe(0);
    const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
    expect(state.providerSlots).toHaveLength(1);
    expect(state.providerSlots[0]).toMatchObject({unknown:true, leaseId:lost.workerLeaseId});
    expect(state.pauseReason).toBe("outcome_unknown");
    expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[id].unknown).toBe(true);
    expect([...f.store.ledger].filter(([key])=>key.startsWith("request:") || key.startsWith("day:") || key.startsWith("ip:"))).toEqual(requestLedger);
    await expect(f.service.saveCardMetadata(lost, {fields:{description:"Late response",tags:[]},responseHash:"a".repeat(64),costUsd:.01,inputTokens:1,outputTokens:1})).rejects.toMatchObject({code:"stale_worker"});
  });

it.each([1, 4])("isolates a recorded base failure after %i attempts and lets a peer proceed", async maxAttempts => {
  const f = await taskFixture(1); const job = baseJob(f, maxAttempts); let calls = 0;
  const run = runner(f, async()=>{calls++;throw transport();});
  for (let i=0; i<20 && f.store.jobs.get(job.id)?.status!=="failed"; i++) {await run(`worker-${i}`);f.clock.now+=5000;}
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(calls).toBe(maxAttempts);expect(f.store.jobs.get(job.id)).toMatchObject({status:"failed",error:"outcome_unknown"});
  expect(state.providerSlots).toEqual([]);expect(state.pauseReason).toBeUndefined();
  expect(f.store.jobs.get(job.id)?.baseRepair?.attempts).toHaveLength(maxAttempts);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[job.id].unknown).toBe(true);
  state.queue.push(f.jobs[1].id);f.store.ledger.get("scheduler")!.value=JSON.stringify(state);
  expect((await f.service.claim("peer"))?.id).toBe(f.jobs[1].id);
});

it("keeps an unclassified base outcome paused", async()=>{
  const f=await taskFixture(1);const job=baseJob(f);let calls=0;
  const run=runner(f,async()=>{calls++;throw new GenerationError("outcome_unknown");});
  for(let i=0;i<6&&f.store.jobs.get(job.id)?.status!=="failed";i++)await run(`worker-${i}`);
  expect(calls).toBe(1);expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
});

it("restores a v2 transport retry from the failure journal without replacing the request", async()=>{
  const f=await parallelFixture(), old=(await f.service.claim("same-owner"))!;
  await f.service.beginStage(old,"base");await f.service.authorizeStage(old,"base");
  await f.service.recordRowAttemptFailure(old,"base",1,transport());
  const requestLedger=[...f.store.ledger].filter(([key])=>key.startsWith("request:")||key.startsWith("day:")||key.startsWith("ip:"));
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);state.queue=[];f.store.ledger.get("scheduler")!.value=JSON.stringify(state);
  f.clock.now+=LEASE_MS+1;let calls=0;
  const run=runner(f,async name=>{calls++;return {bytes:Buffer.from(name),generationMs:1,usage};});
  expect(await run("same-owner")).toBe("yielded");
  const saved=f.store.jobs.get(old.id)!;const retry=saved.rowRetries?.[0];
  expect(saved).toMatchObject({status:"generating",createdAt:old.createdAt,expiresAt:old.expiresAt});
  expect(retry).toMatchObject({stage:"base",state:"waiting"});expect(calls).toBe(0);
  f.clock.now=retry!.notBefore;
  expect(await run("new-owner")).toBe("yielded");expect(calls).toBe(1);
  expect(f.store.jobs.get(old.id)?.rowRetries?.[0]).toMatchObject({token:retry!.token,state:"completed"});
  await expect(f.service.heartbeat(old)).rejects.toMatchObject({code:"stale_worker"});
  expect([...f.store.ledger].filter(([key])=>key.startsWith("request:")||key.startsWith("day:")||key.startsWith("ip:"))).toEqual(requestLedger);
});

it.each([false,true])("includes failed base attempts in totals with unknown usage=%s",async unknown=>{
  const f=await taskFixture(1);f.saved(0,STAGE_NAMES);const job=baseJob(f);job.baseConfirmedAt=f.clock.now;
  for(const stage of job.stages){stage.usage=usage;stage.generationMs=stage.name==="base"?300:1;}
  const begin=f.clock.now-6000;
  job.baseRepair={policy:1,maxAttempts:2,phase:"complete",attempts:[
    {ordinal:1,token:randomUUID(),reason:"initial",status:"failed",reservedAt:begin,notBefore:begin,startedAt:begin,finishedAt:begin+200,generationMs:200,
      ...(unknown?{}:{usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:0}}),
      failure:unknown?{code:"outcome_unknown",diagnostic:{boundary:"provider_cli",reason:"process_exit"},cliCause:{kind:"http_error",httpStatus:520}}:{code:"provider_rate_limited",providerFailure:{httpStatus:429},cliCause:{kind:"http_error",httpStatus:429}}},
    {ordinal:2,token:randomUUID(),reason:unknown?"transport":"rate_limit",status:"saved",reservedAt:begin+1000,notBefore:begin+1000,startedAt:begin+1000,finishedAt:begin+1300,generationMs:300,usage,resultSha256:job.stages[0].sha256},
  ]};
  jobSchema.parse(job);
  const budget=f.store.ledger.get("budget")!.value;
  expect(await runner(f,async()=>{throw Error("No provider calls");})("compose")).toBe("yielded");
  const saved=f.store.jobs.get(job.id)!;
  expect(saved.generationMs).toBe(511);
  if(unknown)expect(saved.usage).toBeUndefined();else expect(saved.usage?.costUsd).toBeCloseTo(.12);
  expect(f.store.ledger.get("budget")!.value).toBe(budget);
});

it("recovers a committed v2 retry reservation after its acknowledgement is lost", async()=>{
  const f=await parallelFixture(), old=(await f.service.claim("lost"))!;
  await f.service.beginStage(old,"base");await f.service.authorizeStage(old,"base");await f.service.recordRowAttemptFailure(old,"base",1,transport());
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);state.queue=[];f.store.ledger.get("scheduler")!.value=JSON.stringify(state);
  f.clock.now+=LEASE_MS+1;let calls=0;
  const begin=f.service.beginRowRetry;
  vi.spyOn(f.service,"beginRowRetry").mockImplementationOnce(async(...args)=>{await begin(...args);throw Error("lost acknowledgement");});
  const run=runner(f,async name=>{calls++;return{bytes:Buffer.from(name),usage,generationMs:1};});
  expect(await run("recover-reservation")).toBe("yielded");
  const retry=f.store.jobs.get(old.id)!.rowRetries![0];
  f.clock.now+=LEASE_MS+1;
  expect(await run("resume-reservation")).toBe("yielded");expect(calls).toBe(1);
  expect(f.store.jobs.get(old.id)!.rowRetries).toEqual([{...retry,state:"completed"}]);
});

it("does not repeat a durable second v2 transport failure", async()=>{
  const f=await parallelFixture(), old=(await f.service.claim("old"))!;
  await f.service.beginStage(old,"base");await f.service.authorizeStage(old,"base");await f.service.recordRowAttemptFailure(old,"base",1,transport());
  const retry=await f.service.beginRowRetry(old,"base");f.clock.now=retry.notBefore;
  await f.service.authorizeRowRetry(old,"base",retry.token);await f.service.recordRowAttemptFailure(old,"base",2,transport());
  const state=JSON.parse(f.store.ledger.get("scheduler")!.value);state.queue=[];f.store.ledger.get("scheduler")!.value=JSON.stringify(state);
  f.clock.now+=LEASE_MS+1;let calls=0;
  expect(await runner(f,async()=>{calls++;throw Error("Must not call again");})("new")).toBe("failed");
  expect(calls).toBe(0);expect(f.store.jobs.get(old.id)?.error).toBe("outcome_unknown");
  expect(f.store.jobs.get(old.id)?.rowRetries?.[0].token).toBe(retry.token);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});

it("resumes undispatched metadata without creating an unknown-cost marker",async()=>{
  const f=await taskFixture(1),job=f.store.jobs.get(f.jobs[0].id)!;
  job.status="processing";job.cardMetadata={policy:1,state:"pending",revision:0,edited:false};isolate(f.store,job.id);
  f.store.artifacts.set(`${job.id}:source.png`,{bytes:Buffer.from("atlas"),expiresAt:job.expiresAt});
  const lost=(await f.service.claim("old"))!;
  const request=buildCardMetadataRequest(lost,Array(4).fill("data:image/png;base64,YQ=="));
  await f.service.beginCardMetadata(lost,request.requestHash);f.clock.now+=LEASE_MS+1;let calls=0;
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:{open:async()=>{throw Error("No image calls");}},
    cardProvider:{prepare:async()=>request,generate:async()=>{calls++;return {fields:{description:"Metadata",tags:[]},responseHash:"a".repeat(64),inputTokens:1,outputTokens:1,costUsd:.002};}},
    build:async()=>({"pet.zip":Buffer.from("zip")})});
  await run("new");await run("pack");
  expect(calls).toBe(1);expect(f.store.jobs.get(job.id)?.status).toBe("completed");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({providerSlots:[]});
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[job.id]).toBeUndefined();
});

it("does not restore metadata if the job expires during the recovery read",async()=>{
  const f=await taskFixture(1),job=f.store.jobs.get(f.jobs[0].id)!;
  job.status="processing";job.cardMetadata={policy:1,state:"pending",revision:0,edited:false};isolate(f.store,job.id);
  f.clock.now=job.expiresAt-LEASE_MS-5;
  let lost=(await f.service.claim("old"))!;
  const request=buildCardMetadataRequest(lost,Array(4).fill("data:image/png;base64,YQ=="));
  lost=await f.service.beginCardMetadata(lost,request.requestHash);await f.service.authorizeCardMetadata(lost);
  f.clock.now+=LEASE_MS+1;
  const transaction=f.store.transaction.bind(f.store);let writes=0;
  vi.spyOn(f.store,"transaction").mockImplementationOnce(run=>transaction(tx=>run({...tx,
    getJob:async id=>{const current=await tx.getJob(id);if(id===job.id)f.clock.now+=10;return current;},
    putJob:async current=>{writes++;await tx.putJob(current);},
  })));
  expect(await f.service.claim("recovery")).toBeNull();
  expect(writes).toBe(0);expect(f.store.jobs.get(job.id)?.cardMetadata?.state).toBe("inflight");
});

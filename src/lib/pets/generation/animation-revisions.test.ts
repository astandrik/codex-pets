import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import * as model from "./model";
import {revisionFixture} from "./animation-revision-fixture.test-utils";

const quota = (store: Awaited<ReturnType<typeof revisionFixture>>["store"]) => [...store.ledger].filter(([key]) => key.startsWith("day:") || key.startsWith("ip:"));
afterEach(() => vi.unstubAllEnvs());
describe("animation revisions", () => {
  it("canonicalizes only the nine ordinary states and normalizes optional corrections", () => {
    const input = {requestId: randomUUID(), states: ["waving", "idle"], prompt: "  Tilt\r\nslowly  ", sourceMetadataRevision: 0};
    expect(model.animationRevisionInputSchema.parse(input)).toMatchObject({states: ["idle", "waving"], prompt: "Tilt\nslowly"});
    for (const states of [[], ["base"], ["look-0-157"], ["idle", "idle"], ["unknown"]]) expect(model.animationRevisionInputSchema.safeParse({...input, states}).success).toBe(false);
    for (const prompt of [false, "x".repeat(2001)]) expect(model.animationRevisionInputSchema.safeParse({...input, prompt}).success).toBe(false);
    expect(model.animationRevisionInputSchema.safeParse({...input, pipelineVersion: 3}).success).toBe(false);
  });
  it("snapshots a separate version atomically, charges once and preserves source metadata without AI", async () => {
    vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
    const f = await revisionFixture(); f.config.now += 3_600_000;
    const original = structuredClone(await f.store.readJob(f.source.id));
    const child = await f.service.reviseAnimations(f.source.id, f.input(), "203.0.113.9");
    const job = (await f.store.readJob(child.generationId))!;
    expect(job).toMatchObject({pipelineVersion: 3, stages: [], animationAnatomyPolicy: 1, baseConfirmedAt: f.config.now, animationPrompt: "Move gently", cardMetadata: {state: "completed", revision: 0, edited: true, fields: {description: "Floating character"}}, animationRevision: {sourceGenerationId: f.source.id, selectedStates: ["idle", "waving"], corrections: {idle: ["Tilt without adding arms"], waving: ["Tilt without adding arms"]}}});
    expect(job.reference).toBeUndefined(); expect(job.usage).toBeUndefined(); expect(job.submission).toBeUndefined();
    expect(job.expiresAt).toBe(f.config.now + model.DAY);
    expect(await f.service.getBase(job.id)).toEqual(f.base);
    expect(await f.service.getAnimationRevisionSource(job.id)).toEqual(f.files["spritesheet.webp"]);
    expect(await f.store.readJob(f.source.id)).toEqual(original);
    expect(quota(f.store).map(([, row]) => row.value)).toEqual(["1", "1"]);
    expect(model.requiredStageNames(job)).toEqual(["idle", "waving"]);
  });
  it("deduplicates concurrent requests and recovers after parent expiry and flag-off", async () => {
    vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
    const f = await revisionFixture(); f.config.now += 3600000; const input = f.input();
    const results = await Promise.all(Array.from({length: 5}, () => f.service.reviseAnimations(f.source.id, input, "203.0.113.9")));
    expect(new Set(results.map(r => r.generationId)).size).toBe(1);
    await expect(f.service.reviseAnimations(f.source.id, {...input, prompt: "different"}, "203.0.113.9")).rejects.toMatchObject({code: "request_id_conflict"});
    f.config.now = f.source.expiresAt + 1; await f.store.cleanup(f.config.now);
    vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "false");
    expect((await f.service.reviseAnimations(f.source.id, input, null)).generationId).toBe(results[0].generationId);
    expect((await f.service.findAnimationRevision(f.source.id, input.requestId)).generationId).toBe(results[0].generationId);
    expect(quota(f.store).map(([, row]) => row.value)).toEqual(["1", "1"]);
  });
  it.each(["expired", "metadata", "corrupt", "disabled", "queue", "write"])("does not charge or save a partial candidate on %s refusal", async cause => {
    vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
    const f = await revisionFixture(); const input = f.input();
    if (cause === "expired") f.config.now = f.source.expiresAt;
    if (cause === "metadata") input.sourceMetadataRevision = 1;
    if (cause === "corrupt") f.store.artifacts.get(f.source.id + ":stage-base.png")!.bytes = Buffer.from("broken");
    if (cause === "disabled") vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "false");
    if (cause === "queue") { for (let i=0;i<5;i++) await f.service.generate({prompt:"pet",requestId:randomUUID()},`203.0.113.${i}`); }
    const before = {jobs: structuredClone([...f.store.jobs]), ledger: structuredClone([...f.store.ledger]), artifacts: [...f.store.artifacts]};
    if (cause === "write") { const transaction = f.store.transaction.bind(f.store); vi.spyOn(f.store,"transaction").mockImplementation(op => transaction(tx => op({...tx, putJob: async () => {throw Error("write failure");}}))); }
    await expect(f.service.reviseAnimations(f.source.id, input, "203.0.113.9")).rejects.toBeDefined();
    expect([...f.store.jobs]).toEqual(before.jobs); expect([...f.store.ledger]).toEqual(before.ledger); expect([...f.store.artifacts]).toEqual(before.artifacts);
  });
  it("recovers a lost admission acknowledgement without another attempt", async () => {
    vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
    const f = await revisionFixture(); const transaction = f.store.transaction.bind(f.store); let lost = false;
    vi.spyOn(f.store,"transaction").mockImplementation(async op => {const result = await transaction(op); if (!lost && f.store.jobs.size === 2) {lost=true; throw Error("lost ACK");} return result;});
    const child = await f.service.reviseAnimations(f.source.id, f.input(), "203.0.113.9");
    expect(child.status).toBe("queued"); expect(f.store.jobs.size).toBe(2); expect(quota(f.store).map(([,r])=>r.value)).toEqual(["1","1"]);
  });
});

it("retains old policy, validates revision payloads and bounds accumulated corrections before admission",async()=>{
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED","true");
  const f=await revisionFixture();
  expect(model.jobSchema.parse(f.source).animationAnatomyPolicy).toBeUndefined();
  expect(model.jobSchema.safeParse({...f.source,pipelineVersion:3}).success).toBe(false);
  const child=await f.service.reviseAnimations(f.source.id,f.input(),"203.0.113.9");
  const job=f.store.jobs.get(child.generationId)!;job.status="completed";
  for(const [kind,bytes] of Object.entries(f.files)) f.store.artifacts.set(job.id+":"+kind,{bytes,expiresAt:job.expiresAt});
  await expect(f.service.reviseAnimations(job.id,{...f.input(),sourceMetadataRevision:0},"203.0.113.9")).rejects.toMatchObject({code:"animation_revision_not_accepted"});
  await f.service.acceptAnimationRevision(job.id);
  const next=await f.service.reviseAnimations(job.id,{...f.input(),states:["waving"],prompt:"",sourceMetadataRevision:0},"203.0.113.9");
  expect(f.store.jobs.get(next.generationId)?.animationRevision?.corrections).toEqual({idle:["Tilt without adding arms"],waving:["Tilt without adding arms"]});
  f.store.jobs.get(job.id)!.animationRevision!.corrections.waving=["a".repeat(2000),"b".repeat(2000),"c".repeat(2000),"d".repeat(1994)];
  const before=structuredClone([...f.store.ledger]);
  await expect(f.service.reviseAnimations(job.id,{...f.input(),states:["waving"],prompt:"one more",sourceMetadataRevision:0},"203.0.113.9")).rejects.toMatchObject({code:"animation_corrections_limit"});
  expect([...f.store.ledger]).toEqual(before);
});
it("rejects queue expiry and cannot revive a failed candidate by acceptance",async()=>{
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED","true");
  const f=await revisionFixture();const child=await f.service.reviseAnimations(f.source.id,f.input(),"203.0.113.9");
  f.config.now+=model.WAIT_MS;expect(await f.service.claim("late")).toBeNull();
  expect((await f.service.get(child.generationId)).error?.code).toBe("queue_timeout");
  await expect(f.service.acceptAnimationRevision(child.generationId)).rejects.toMatchObject({code:"generation_not_completed"});
});
it("accepts once after a lost commit ACK without changing expiry or ledger",async()=>{
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED","true");
  const f=await revisionFixture();const child=await f.service.reviseAnimations(f.source.id,f.input(),"203.0.113.9");
  f.store.jobs.get(child.generationId)!.status="completed";
  const before=structuredClone([...f.store.ledger]);const tx=f.store.transaction.bind(f.store);
  vi.spyOn(f.store,"transaction").mockImplementationOnce(async op=>{await tx(op);throw Error("lost accept ACK");});
  const accepted=await f.service.acceptAnimationRevision(child.generationId);
  expect(accepted.animationRevision?.acceptedAt).toBe(f.config.now);expect(accepted.expiresAt).toBe(child.expiresAt);expect([...f.store.ledger]).toEqual(before);
});
it("rolls back across midnight and charges the current day on retry, retaining unknown costs",async()=>{
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED","true");
  const f=await revisionFixture();f.config.now=Date.parse("2026-10-21T20:59:59.999Z");
  await f.store.transaction(async tx=>{await tx.putLedger("budget",JSON.stringify({spent:{"2026-10-21":123},reservations:{legacy:{remainingMicroUsd:0,unknown:true}}}),f.config.now+model.DAY*10);});
  const transaction=f.store.transaction.bind(f.store);let crossed=false;
  vi.spyOn(f.store,"transaction").mockImplementation(op=>transaction(tx=>op({...tx,putLedger:async(key,value,expires)=>{
    await tx.putLedger(key,value,expires);if(key.startsWith("day:")&&!crossed){crossed=true;f.config.now+=2;}
  }})));
  await f.service.reviseAnimations(f.source.id,f.input(),"203.0.113.9");
  expect(f.store.ledger.has("day:2026-10-21")).toBe(false);
  expect(f.store.ledger.get("day:2026-10-22")?.value).toBe("1");
  expect(JSON.parse(f.store.ledger.get("budget")!.value)).toMatchObject({spent:{"2026-10-21":123},reservations:{legacy:{unknown:true}}});
});

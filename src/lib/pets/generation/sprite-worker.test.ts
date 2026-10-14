import { randomUUID, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGenerationService } from "./service";
import { createSpriteGenerationWorker } from "./sprite-worker";
import { STAGE_NAMES, LEASE_MS, GenerationError, jobSchema, type StageName } from "./model";
import {parseSpritegenReply} from "./sprite-renderer";
import { MemoryStore } from "./test-store";

function fixture() {
  const store = new MemoryStore(); const config = { now: Date.parse("2026-10-10T10:00:00Z"), enabled: true };
  const service = createGenerationService(store, { now: () => config.now, enabled: () => config.enabled, secret: () => "test-secret-at-least-32-characters-long" });
  const generate = vi.fn(async (name: StageName) => ({ bytes: Buffer.from(name), usage: { textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: 0.04 }, generationMs: 1 }));
  const compose = vi.fn(async () => Buffer.from("atlas")); const cleanup = vi.fn(async () => undefined);
  const renderer = { open: vi.fn(async () => ({ generate, prepare: async () => undefined, compose, cleanup })) };
  const build = vi.fn(async () => ({ "pet.zip": Buffer.from("zip") }));
  const worker = createSpriteGenerationWorker({ service, store, renderer, build, now: () => config.now });
  const input = { requestId: randomUUID(), prompt: "Synthetic pet", displayName: "Pet" };
  return { store, config, service, worker, renderer, generate, compose, cleanup, build, input };
}
describe("row worker side-effect boundaries", () => {
  it("saves both failed row diagnostics privately while retaining unknown accounting and successful peers",async()=>{
    const f=fixture();const accepted=await f.service.generate(f.input,"203.0.113.1");
    f.generate.mockImplementation(async(name)=>{
      if(name==='running-left')throw new GenerationError('outcome_unknown',undefined,undefined,undefined,{boundary:'provider_image',reason:'unexpected_dimensions',width:1024,height:1024,message:'private response'});
      if(name==='running-right')throw new GenerationError('outcome_unknown',undefined,undefined,undefined,{boundary:'provider_cli',reason:'process_timeout',elapsedMs:220000});
      return {bytes:Buffer.from(name),usage:{textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.04},generationMs:1};
    });
    expect(await f.worker('owner')).toBe('failed');expect(await f.worker('replacement')).toBe('idle');expect(f.generate).toHaveBeenCalledTimes(12);
    const job=jobSchema.parse(await f.store.readJob(accepted.generationId));
    expect(job.stageFailureDiagnostics).toEqual([
      {stage:'running-left',diagnostic:{boundary:'provider_image',reason:'unexpected_dimensions',width:1024,height:1024}},
      {stage:'running-right',diagnostic:{boundary:'provider_cli',reason:'process_timeout',elapsedMs:220000}},
    ]);
    expect(job.stages.filter(s=>s.status==='completed')).toHaveLength(10);
    expect(JSON.parse(f.store.ledger.get('budget')!.value).reservations[accepted.generationId]).toMatchObject({unknown:true,remainingMicroUsd:0});
    const publicResult=JSON.stringify(await f.service.get(accepted.generationId));expect(publicResult).not.toMatch(/Diagnostic|unexpected_dimensions|width|private response/);expect(JSON.stringify(job)).not.toContain('private response');
  });
  it("persists sanitized refusal diagnostics but keeps them out of public results", async () => {
    const f = fixture(); const accepted = await f.service.generate(f.input, "203.0.113.1");
    f.generate.mockRejectedValueOnce(new GenerationError("provider_rejected", undefined, {
      httpStatus: 400, code: "moderation_blocked", moderationStage: "input", message: "private prompt", key: "secret",
    }));
    expect(await f.worker("a")).toBe("failed");
    expect(await f.worker("b")).toBe("idle");
    expect(f.generate).toHaveBeenCalledTimes(1);
    const saved = jobSchema.parse(await f.store.readJob(accepted.generationId));
    expect(saved.providerFailure).toEqual({ httpStatus: 400, code: "moderation_blocked", moderationStage: "input" });
    expect(saved.prompt).toBe("");
    expect(JSON.stringify(saved)).not.toMatch(/private prompt|secret/);
    expect(await f.service.get(accepted.generationId)).toMatchObject({ error: { code: "provider_rejected" } });
    expect(await f.service.get(accepted.generationId)).toMatchObject({ error: {
      message: "OpenAI blocked the generation request during safety checks.", automaticRetry: false,
    } });
    expect(await f.service.get(accepted.generationId)).not.toHaveProperty("providerFailure");
    expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations).toEqual({});
  });
  it("calls each stage once, packages the result and exposes metadata-only progress", async () => {
    const f = fixture(); const job = await f.service.generate(f.input, "203.0.113.1");
    expect(await f.worker("a")).toBe("completed");
    expect(f.generate.mock.calls.map(call => call[0])).toEqual([...STAGE_NAMES]);
    expect(f.compose).toHaveBeenCalledTimes(1); expect(f.cleanup).toHaveBeenCalledTimes(1);
    expect(await f.service.get(job.generationId)).toMatchObject({ status: "completed", progress: { completedSteps: 12, totalSteps: 12 } });
    expect((await f.store.readJob(job.generationId))?.prompt).toBe("");
  });
  it("continues at the next unpaid stage after a restart", async () => {
    const f = fixture(); await f.service.generate(f.input, "203.0.113.1");
    const job = (await f.service.claim("crashed"))!;
    await f.service.beginStage(job, "base");
    await f.service.saveStage(job, "base", Buffer.from("base"), { usage: { textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: 0.04 }, generationMs: 1 });
    f.config.now += LEASE_MS + 1;
    expect(await f.worker("new")).toBe("completed");
    expect(f.generate.mock.calls.map(call => call[0])).toEqual(STAGE_NAMES.slice(1));
  });
  it("reconciles a lost row commit acknowledgement without another paid call", async () => {
    const f = fixture(); await f.service.generate(f.input, "203.0.113.1");
    const original = f.service.saveStage;
    vi.spyOn(f.service, "saveStage").mockImplementationOnce(async (...args) => { await original(...args); throw new Error("lost acknowledgement"); });
    expect(await f.worker("a")).toBe("completed");
    expect(f.generate).toHaveBeenCalledTimes(12);
  });
  it("pauses after an unknown request outcome and never calls the next row", async () => {
    const f = fixture(); const job = await f.service.generate(f.input, "203.0.113.1");
    f.generate.mockRejectedValueOnce(new Error("timeout"));
    expect(await f.worker("a")).toBe("failed"); expect(await f.worker("b")).toBe("idle");
    expect(f.generate).toHaveBeenCalledTimes(1); expect(f.compose).not.toHaveBeenCalled();
    expect(await f.service.get(job.generationId)).toMatchObject({ error: { code: "outcome_unknown" } });
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });
  it("does not run a provider after an unconfirmed intent write", async () => {
    const f = fixture(); await f.service.generate(f.input, "203.0.113.1");
    vi.spyOn(f.service, "beginStage").mockRejectedValueOnce(new Error("db offline"));
    vi.spyOn(f.store, "readJob").mockRejectedValueOnce(new Error("db offline"));
    await expect(f.worker("a")).rejects.toThrow("db offline"); expect(f.generate).not.toHaveBeenCalled();
  });
  it("verifies saved image hashes before any subsequent provider call", async () => {
    const f = fixture(); await f.service.generate(f.input, "203.0.113.1");
    const job = (await f.service.claim("old"))!;
    await f.service.beginStage(job, "base"); await f.service.saveStage(job, "base", Buffer.from("base"), { generationMs: 1 });
    expect((await f.store.readJob(job.id))?.stages[0].sha256).toBe(createHash("sha256").update("base").digest("hex"));
    f.store.artifacts.set(job.id + ":stage-base.png", { bytes: Buffer.from("corrupt"), expiresAt: job.expiresAt });
    f.config.now += LEASE_MS + 1;
    expect(await f.worker("new")).toBe("failed"); expect(f.generate).not.toHaveBeenCalled();
  });
});

it("reconciles a lost atlas and completed-result acknowledgement without another paid call", async () => {
  const f=fixture();const accepted=await f.service.generate(f.input,"203.0.113.1");
  const save=f.service.saveSource;vi.spyOn(f.service,"saveSource").mockImplementationOnce(async(...args)=>{await save(...args);throw new Error("lost atlas ACK");});
  const finish=f.service.finish;vi.spyOn(f.service,"finish").mockImplementationOnce(async(...args)=>{await finish(...args);throw new Error("lost finish ACK");});
  expect(await f.worker("a")).toBe("completed");expect(f.generate).toHaveBeenCalledTimes(12);
  expect(await f.service.get(accepted.generationId)).toMatchObject({status:"completed"});
});
it("resumes a local packaging crash using the saved atlas without new paid calls",async()=>{
  const f=fixture();await f.service.generate(f.input,"203.0.113.1");
  f.build.mockRejectedValueOnce(new Error("local process crash"));
  await expect(f.worker("a")).rejects.toThrow("local process crash");
  f.config.now+=LEASE_MS+1;
  expect(await f.worker("b")).toBe("completed");expect(f.generate).toHaveBeenCalledTimes(12);
});
it("preserves an unresolved paid intent after job/image TTL cleanup",async()=>{
  const f=fixture();await f.service.generate(f.input,"203.0.113.1");
  const job=(await f.service.claim("crashed"))!;await f.service.beginStage(job,"base");
  f.config.now+=86400001;expect(await f.worker("new")).toBe("idle");
  await expect(f.service.generate({...f.input,requestId:randomUUID()},"203.0.113.2")).rejects.toMatchObject({code:"generation_paused"});
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[job.id].unknown).toBe(true);
});

it("records expired in-flight lease privately without replaying the stage",async()=>{
  const f=fixture();const accepted=await f.service.generate(f.input,"203.0.113.1");
  const job=(await f.service.claim("crashed"))!;await f.service.beginStage(job,"base");
  f.config.now+=LEASE_MS+1;expect(await f.worker("replacement")).toBe("idle");
  expect(f.generate).not.toHaveBeenCalled();
  const saved=await f.store.readJob(accepted.generationId);
  expect(saved).toMatchObject({status:"failed",error:"outcome_unknown",failureDiagnostic:{boundary:"lease",reason:"expired_lease"},stageFailureDiagnostics:[{stage:"base",diagnostic:{boundary:"lease",reason:"expired_lease"}}]});
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[job.id]).toMatchObject({unknown:true,remainingMicroUsd:0});
});

it("persists CLI causes per failed row without exposing them or breaking old job readers",async()=>{
 const f=fixture();const accepted=await f.service.generate(f.input,"203.0.113.6");
 f.generate.mockImplementation(async name=>{
  if(name==='running-left')parseSpritegenReply(JSON.stringify({error:'outcome_unknown',failureDiagnostic:{boundary:'provider_cli',reason:'process_exit',exitCode:1},cliCause:{kind:'connection_reset',errno:104,message:'secret private response'}}));
  if(name==='running-right')parseSpritegenReply(JSON.stringify({error:'outcome_unknown',cliCause:{kind:'invalid_json',document:'secret'}}));
  return{bytes:Buffer.from(name),usage:{textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.04},generationMs:1};
 });
 expect(await f.worker('owner')).toBe('failed');expect(await f.worker('replacement')).toBe('idle');expect(f.generate).toHaveBeenCalledTimes(12);
 const saved=await f.store.readJob(accepted.generationId);
 expect(saved).toHaveProperty('cliFailureCauses',[
  {stage:'running-left',cause:{kind:'connection_reset',errno:104}},
  {stage:'running-right',cause:{kind:'invalid_json'}},
 ]);
 expect(JSON.stringify(saved)).not.toContain('secret');
 expect(JSON.stringify(await f.service.get(accepted.generationId))).not.toMatch(/cliFailure|connection_reset|errno/);
 expect(JSON.parse(f.store.ledger.get('budget')!.value).reservations[accepted.generationId]).toEqual({remainingMicroUsd:0,unknown:true});
});

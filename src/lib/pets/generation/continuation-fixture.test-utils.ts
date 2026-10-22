import {createHash,randomUUID} from "node:crypto";
import sharp from "sharp";
import {createGenerationService} from "./service";
import {DAY,STAGE_NAMES,type GenerationJob} from "./model";
import {MemoryStore} from "./test-store";

export async function continuationFixture(missing: string[] = []) {
  const config = {now: Date.parse("2026-10-22T12:00:00Z"), enabled: true};
  const store = new MemoryStore();
  const service = createGenerationService(store, {now: () => config.now, enabled: () => config.enabled, secret: () => "continuation-test-secret"});
  const image = await sharp({create: {width: 32, height: 32, channels: 4, background: "#ad79ce"}}).png().toBuffer();
  const job: GenerationJob = {id: "a".repeat(64), prompt: "", displayName: "Orb", status: "failed", error: "invalid_sprite_extraction", createdAt: config.now, expiresAt: config.now + DAY, worker: "", promptRevision: "test", pipelineVersion: 2, reviewBase: true, baseConfirmedAt: config.now, animationPrompt: "Move gently", stages: STAGE_NAMES.filter(n => !missing.includes(n)).map(name => ({name, status: "completed", startedAt: config.now, sha256: createHash("sha256").update(image).digest("hex"), usage: {textInputTokens: 1, imageInputTokens: 1, outputTokens: 1, costUsd: .01}})), cardMetadata: {policy: 1, state: "pending", revision: 0, edited: false}};
  await store.transaction(async tx => {await tx.putJob(job);for (const s of job.stages) await tx.putArtifact(job.id, `stage-${s.name}.png`, image, job.expiresAt);});
  const input = async (mode: "rebuild" | "regenerate", states?: string[]) => ({requestId: randomUUID(), mode, sourceRevision: (await service.getContinuationOptions(job.id)).sourceRevision, ...(states ? {states} : {})});
  return {config, store, service, job, image, input};
}


export async function failedAnimationRevisionFixture() {
  const f=await continuationFixture();
  const {PET_STATES,PET_LOOK_DIRECTIONS}=await import("@/lib/pets/types");
  const cells=[...PET_STATES.flatMap(s=>Array.from({length:s.frames},(_,column)=>({row:s.row,column}))),...PET_LOOK_DIRECTIONS];
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="2288">'+cells.map(c=>`<circle cx="${c.column*192+96}" cy="${c.row*208+104}" r="40" fill="#ad79ce"/>`).join('')+'</svg>';
  const atlas=await sharp(Buffer.from(svg)).png().toBuffer();
  const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  const job:GenerationJob={...f.job,pipelineVersion:3,animationAnatomyPolicy:1,stages:f.job.stages.filter(s=>s.name==='idle'),animationRevision:{policy:1,sourceGenerationId:'b'.repeat(64),sourceMetadataRevision:2,selectedStates:['idle','waving'],baseSha256:hash(f.image),sourceAtlasSha256:hash(atlas),corrections:{idle:['Keep the tilt'],waving:['Use a small gesture']}},cardMetadata:{policy:1,state:'completed',revision:2,edited:true,fields:{description:'Hand edited character',tags:['test']}}};
  await f.store.transaction(async tx=>{await tx.putJob(job);await tx.putArtifact(job.id,'revision-source.webp',atlas,job.expiresAt);});
  return {...f,job,atlas};
}

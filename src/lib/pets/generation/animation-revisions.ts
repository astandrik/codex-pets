import {initialAnimationRepair} from "@/lib/pets/generation/animation-repair";
import {createHash} from "node:crypto";
import {z} from "zod";
import {animationRevisionInputSchema, animationCorrectionsSchema} from "@/lib/pets/generation/animation-revision-input";
import {DAY, GENERATION_ID, GenerationError, dedupSchema, generationAnimationRevisionsEnabled, generationDigest, isUnacceptedAnimationRevision, nextMoscowDay, moscowDay, type GenerationJob} from "@/lib/pets/generation/model";
import type {GenerationStore, GenerationTransaction} from "@/lib/pets/generation/store";
import {readSavedGenerationBase} from "@/lib/pets/generation/base-review";
import {normalizeSavedGenerationBase} from "@/lib/pets/generation/reference-image";
import {validateGeneratedSheet} from "@/lib/pets/generation/package";
import {validatePetJson} from "@/lib/pets/validation";
import {publicJob} from "@/lib/pets/generation/public-job";
import {scheduler, expireQueue, requireQueueCapacity, saveScheduler} from "@/lib/pets/generation/scheduler";
import {readDailyQuota, consumeDailyQuota} from "@/lib/pets/generation/quota-grants";
import {startBudgetTracking} from "@/lib/pets/generation/budget";

class AdmissionDayChanged extends Error {}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function requireAcceptedAnimationRevision(job: GenerationJob) {
  if (isUnacceptedAnimationRevision(job)) throw new GenerationError("animation_revision_not_accepted");
}
export async function readRevisionAtlas(job: GenerationJob, read: GenerationTransaction["getArtifact"], now: number) {
  const bytes = await read(job.id, "revision-source.webp", now);
  if (!job.animationRevision || !bytes || sha(bytes) !== job.animationRevision.sourceAtlasSha256) throw new GenerationError("saved_stage_unavailable");
  return bytes;
}

export function createAnimationRevisionService(store: GenerationStore, options: {
  now: () => number; enabled: () => boolean; secret: () => string; createId: () => string; budgetUsd: () => number; automaticAnimationRepair?: () => boolean;
}) {
  const live = (job: GenerationJob | null) => {
    if (!job) throw new GenerationError("not_found");
    if (job.expiresAt <= options.now()) throw new GenerationError("generation_expired");
    return job;
  };
  const sourceJob = (job: GenerationJob | null, revision: number) => {
    const source = live(job);
    if (source.status !== "completed") throw new GenerationError("generation_not_completed");
    requireAcceptedAnimationRevision(source);
    if ((source.cardMetadata?.revision ?? 0) !== revision) throw new GenerationError("metadata_conflict");
    return source;
  };
  async function receipt(tx: GenerationTransaction, key: string, sourceId: string, hash?: string) {
    const raw = await tx.getLedger(key, options.now());
    if (!raw) return null;
    const record = dedupSchema.parse(JSON.parse(raw));
    if (hash !== undefined && record.hash !== hash) throw new GenerationError("request_id_conflict");
    const job = live(await tx.getJob(record.id));
    if (job.animationRevision?.sourceGenerationId !== sourceId) throw new GenerationError("request_id_conflict");
    return publicJob(job, options.now());
  }
  return {
    async findAnimationRevision(sourceId: string, requestId: string) {
      if (!GENERATION_ID.test(sourceId) || !z.uuid().safeParse(requestId).success) throw new GenerationError("invalid_argument");
      const key = "request:" + generationDigest(options.secret(), "request", requestId);
      const found = await store.transaction(tx => receipt(tx, key, sourceId));
      if (!found) throw new GenerationError("not_found");
      return found;
    },
    async reviseAnimations(sourceId: string, input: unknown, clientIp: string | null) {
      const parsed = animationRevisionInputSchema.safeParse(input);
      if (!GENERATION_ID.test(sourceId) || !parsed.success) throw new GenerationError("invalid_argument");
      const body = parsed.data, secret = options.secret();
      const key = "request:" + generationDigest(secret, "request", body.requestId);
      const hash = generationDigest(secret, "body", JSON.stringify({kind: "animation_revision", sourceId, states: body.states, prompt: body.prompt || "", revision: body.sourceMetadataRevision}));
      const previous = await store.transaction(tx => receipt(tx, key, sourceId, hash));
      if (previous) return previous;
      if (!generationAnimationRevisionsEnabled()) throw new GenerationError("animation_revisions_disabled");
      if (!options.enabled()) throw new GenerationError("generation_disabled");
      if (!clientIp) throw new GenerationError("client_ip_unavailable");
      const source = sourceJob(await store.readJob(sourceId), body.sourceMetadataRevision);
      const base = await readSavedGenerationBase(source, (id, kind, now) => store.readArtifact(id, kind, now), options.now());
      await normalizeSavedGenerationBase(base); // Fully decode, but retain the exact approved bytes.
      const atlas = await store.readArtifact(sourceId, "spritesheet.webp", options.now());
      const json = await store.readArtifact(sourceId, "pet.json", options.now());
      if (!atlas || !json) throw new GenerationError("invalid_generated_package");
      await validateGeneratedSheet(atlas);
      let metadata;
      try {metadata = validatePetJson(JSON.parse(json.toString("utf8")));} catch {throw new GenerationError("invalid_generated_package");}
      if (!metadata.ok || metadata.value.spriteVersionNumber !== 2) throw new GenerationError("invalid_generated_package");
      const corrections = animationCorrectionsSchema.parse(structuredClone(source.continuation?.corrections ?? source.animationRevision?.corrections ?? {}));
      if (body.prompt) for (const state of body.states) corrections[state] = [...(corrections[state] ?? []), body.prompt];
      if (!animationCorrectionsSchema.safeParse(corrections).success) throw new GenerationError("animation_corrections_limit");
      const baseSha256 = sha(base), sourceAtlasSha256 = sha(atlas), id = options.createId();
      const fields = source.cardMetadata?.fields ?? {description: metadata.value.description, tags: []};
      for (let retry = 0; ; retry++) {
        try {
          return await store.transaction(async tx => {
            const replay = await receipt(tx, key, sourceId, hash);
            if (replay) return replay;
            if (!generationAnimationRevisionsEnabled()) throw new GenerationError("animation_revisions_disabled");
            if (!options.enabled()) throw new GenerationError("generation_disabled");
            const current = sourceJob(await tx.getJob(sourceId), body.sourceMetadataRevision);
            const currentBase = await readSavedGenerationBase(current, tx.getArtifact, options.now());
            const currentAtlas = await tx.getArtifact(sourceId, "spritesheet.webp", options.now());
            if (sha(currentBase) !== baseSha256 || !currentAtlas || sha(currentAtlas) !== sourceAtlasSha256) throw new GenerationError("saved_stage_unavailable");
            const now = options.now();
            const state = await scheduler(tx, now); await expireQueue(tx, state, now);
            if (state.pauseReason) throw new GenerationError("generation_paused");
            requireQueueCapacity(state);
            // Read the clock after potentially slow database reads for current-day accounting.
            const admittedAt = options.now();
            const quota = await readDailyQuota(tx, secret, clientIp, admittedAt);
            if (!quota.globalRemaining) throw new GenerationError("rate_limited", nextMoscowDay(admittedAt), undefined, "global");
            if (!quota.ipRemaining) throw new GenerationError("rate_limited", nextMoscowDay(admittedAt), undefined, "ip");
            await startBudgetTracking(tx, id, admittedAt, options.budgetUsd());
            const job: GenerationJob = {
              ...(options.automaticAnimationRepair?.() ? {animationRepair: initialAnimationRepair()} : {}),
              id, prompt: "", displayName: source.displayName, nameSource: source.nameSource,
              status: "queued", createdAt: admittedAt, queuedAt: admittedAt, expiresAt: admittedAt + DAY, worker: "",
              reviewBase: true, baseConfirmedAt: admittedAt, pipelineVersion: 3, stages: [],
              promptRevision: "pet-animation-revision-20261021-1", animationAnatomyPolicy: 1,
              ...(source.animationPrompt ? {animationPrompt: source.animationPrompt} : {}),
              cardMetadata: {policy: 1, state: "completed", revision: 0, edited: source.cardMetadata?.edited ?? false, fields},
              animationRevision: {policy: 1, sourceGenerationId: sourceId, sourceMetadataRevision: body.sourceMetadataRevision, selectedStates: body.states, baseSha256, sourceAtlasSha256, corrections},
            };
            await tx.putArtifact(id, "stage-base.png", base, job.expiresAt);
            await tx.putArtifact(id, "revision-source.webp", atlas, job.expiresAt);
            await tx.putJob(job);
            await tx.putLedger(key, JSON.stringify({hash, id, expiresAt: admittedAt + 7 * DAY}), admittedAt + 7 * DAY);
            await consumeDailyQuota(tx, secret, clientIp, admittedAt, quota);
            state.queue.push(id); await saveScheduler(tx, state);
            live(current);
            if (moscowDay(options.now()) !== moscowDay(admittedAt)) throw new AdmissionDayChanged();
            return publicJob(job, options.now());
          });
        } catch (error) {
          if (error instanceof AdmissionDayChanged) {
            if (retry < 2) continue;
            throw new GenerationError("generation_unavailable");
          }
          if (!(error instanceof GenerationError)) {
            const saved = await store.transaction(tx => receipt(tx, key, sourceId, hash));
            if (saved) return saved;
          }
          throw error;
        }
      }
    },
    async getAnimationRevisionSource(id: string) {
      if (!GENERATION_ID.test(id)) throw new GenerationError("invalid_argument");
      const job = live(await store.readJob(id));
      const bytes = await readRevisionAtlas(job, (jobId, kind, now) => store.readArtifact(jobId, kind, now), options.now());
      live(job); return bytes;
    },
    async acceptAnimationRevision(id: string) {
      if (!GENERATION_ID.test(id)) throw new GenerationError("invalid_argument");
      try {
        return await store.transaction(async tx => {
          const job = live(await tx.getJob(id));
          if (!job.animationRevision) throw new GenerationError("invalid_argument");
          if (job.status !== "completed") throw new GenerationError("generation_not_completed");
          if (job.animationRevision.acceptedAt !== undefined) return publicJob(job, options.now());
          const accepted = {...job, animationRevision: {...job.animationRevision, acceptedAt: options.now()}};
          await tx.putJob(accepted); live(accepted);
          return publicJob(accepted, options.now());
        });
      } catch (error) {
        if (!(error instanceof GenerationError)) {
          const job = await store.readJob(id);
          if (job && job.expiresAt > options.now() && job.animationRevision?.acceptedAt !== undefined) return publicJob(job, options.now());
        }
        throw error;
      }
    },
  };
}

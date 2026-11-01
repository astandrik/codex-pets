import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {GenerationError, type GenerationJob, type ImageUsage, type StageName} from "@/lib/pets/generation/model";
import type {ContinuationState} from "@/lib/pets/generation/continuation-model";
import {latestAnimationAttempt, animationFailureRetryReason} from "@/lib/pets/generation/animation-repair";
import type {createGenerationService} from "@/lib/pets/generation/service";
import type {GenerationStore} from "@/lib/pets/generation/store";
import type {SpriteSession, StageImage} from "@/lib/pets/generation/sprite-worker";

type Context = {
  service: ReturnType<typeof createGenerationService>;
  store: GenerationStore;
  now: () => number;
  wait: (ms: number) => Promise<void>;
  checkLease: () => void;
  mutate: <T>(run: () => Promise<T>) => Promise<T>;
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const uncertain = (boundary: "intent" | "checkpoint") => new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary, reason: "unconfirmed_write"});
async function currentJob(context: Context, original: GenerationJob) {
  const current = await context.store.readJob(original.id);
  if (!current || current.worker !== original.worker) throw new GenerationError("stale_worker");
  if (current.expiresAt <= context.now()) throw new GenerationError("generation_expired");
  return current;
}
async function reserveKnownAttempt(context: Context, job: GenerationJob, name: ContinuationState, reason: "quality" | "transport" | "moderation") {
  const previous = latestAnimationAttempt(await currentJob(context, job), name);
  try { await context.mutate(() => context.service.reserveAnimationAttempt(job, name, reason)); }
  catch (error) {
    if (error instanceof GenerationError) throw error;
    const saved = latestAnimationAttempt(await currentJob(context, job), name);
    if (!saved || saved.status !== "reserved" || saved.reason !== reason || saved.ordinal !== (previous?.ordinal ?? 0) + 1) throw uncertain("intent");
  }
}

export async function generateRepairAnimation(context: Context, job: GenerationJob, name: ContinuationState, session: SpriteSession): Promise<StageImage> {
  while (true) {
    const current = await currentJob(context, job);
    const attempt = latestAnimationAttempt(current, name);
    const maxAttempts = current.animationRepair?.maxAttempts;
    if (maxAttempts === undefined) throw uncertain("intent");
    if (attempt?.status === "failed" && attempt.failure) {
      const failure = new GenerationError(attempt.failure.code, undefined, attempt.failure.providerFailure, undefined, attempt.failure.diagnostic, attempt.failure.cliCause);
      const reason = animationFailureRetryReason(failure);
      if (!reason || attempt.ordinal >= maxAttempts) throw failure;
      await reserveKnownAttempt(context, job, name, reason);
      continue;
    }
    if (!attempt || attempt.status !== "reserved") throw uncertain("intent");
    const delay = Math.max(0, attempt.notBefore - context.now());
    if (delay) await context.wait(delay);
    context.checkLease();
    try { await context.mutate(() => context.service.startAnimationAttempt(job, name, attempt.token)); }
    catch (error) { if (error instanceof GenerationError) throw error; throw uncertain("intent"); }
    context.checkLease();
    let image: StageImage;
    try { image = await session.generate(name, {attempt: attempt.ordinal}); }
    catch (error) {
      const failure = error instanceof GenerationError ? error : new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "renderer_process", reason: "unclassified"});
      try { await context.mutate(() => context.service.failAnimationAttempt(job, name, attempt.token, failure)); }
      catch {
        const recorded = await currentJob(context, job).then(current => latestAnimationAttempt(current, name)).catch(() => undefined);
        if (recorded?.token !== attempt.token || recorded.ordinal !== attempt.ordinal || recorded.status !== "failed" ||
          recorded.failure?.code !== failure.code || !isDeepStrictEqual(recorded.failure.diagnostic, failure.diagnostic) ||
          !isDeepStrictEqual(recorded.failure.cliCause, failure.cliCause) ||
          !isDeepStrictEqual(recorded.failure.providerFailure, failure.providerFailure)) throw uncertain("checkpoint");
      }
      const reason = animationFailureRetryReason(failure);
      if (!reason || attempt.ordinal >= maxAttempts) throw failure;
      await reserveKnownAttempt(context, job, name, reason);
      continue;
    }
    try { await context.mutate(() => context.service.saveAnimationAttempt(job, name, attempt.token, image.bytes, image)); }
    catch {
      const readback = await currentJob(context, job);
      const saved = latestAnimationAttempt(readback, name);
      const bytes = await context.store.readArtifact(job.id, `stage-${name}.png`, context.now());
      if (saved?.token !== attempt.token || saved.status !== "saved" || saved.resultSha256 !== hash(image.bytes) || !bytes || hash(bytes) !== saved.resultSha256) throw uncertain("checkpoint");
    }
    return image;
  }
}

export async function composeWithAnimationRepairs(context: Context, job: GenerationJob, initial: SpriteSession,
  saved: Map<StageName, Buffer>, reopen: (job: GenerationJob) => Promise<SpriteSession>, onFailure: (name: ContinuationState, error: unknown) => void,
): Promise<{job: GenerationJob; atlas: Buffer}> {
  let session = initial;
  const repairRound = async (states: readonly ContinuationState[]) => {
    const results = await Promise.allSettled(states.map(async name => {
      try {
        const last = latestAnimationAttempt(await currentJob(context, job), name);
        if (last?.status !== "reserved" && last?.status !== "failed") await reserveKnownAttempt(context, job, name, "quality");
        const image = await generateRepairAnimation(context, job, name, session);
        saved.set(name, image.bytes);
      } catch (failure) { onFailure(name, failure); throw failure; }
    }));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length) {
      const failure = failures.find(r => r.reason instanceof GenerationError && r.reason.code === "outcome_unknown")?.reason ?? failures[0].reason;
      if (failure instanceof GenerationError) throw new GenerationError(failure.code, failure.retryAt, failure.providerFailure, failure.limitScope, failure.diagnostic, failure.cliCause, failure.details, job.animationRepair?.issues);
      throw uncertain("checkpoint");
    }
    job = await context.mutate(() => context.service.verifyAnimationRepair(job));
  };
  if (job.animationRepair?.phase === "repairing" && job.animationRepair.pending.length) await repairRound(job.animationRepair.pending);
  while (true) {
    context.checkLease();
    let atlas: Buffer;
    try { atlas = await session.compose(); }
    catch (error) {
      if (!(error instanceof GenerationError) || !["invalid_sprite_extraction", "missing_animation_frame"].includes(error.code) ||
        error.diagnostic?.boundary !== "renderer_process" || !["invalid_image", "process_exit"].includes(error.diagnostic.reason) || !error.assemblyIssues?.length) throw error;
      let plan: Awaited<ReturnType<Context["service"]["planAnimationRepair"]>>;
      try { plan = await context.mutate(() => context.service.planAnimationRepair(job, error.assemblyIssues!)); }
      catch (failure) { if (failure instanceof GenerationError) throw failure; throw uncertain("checkpoint"); }
      if (!plan.states?.length) throw error;
      job = plan.job;
      session = await reopen(plan.job);
      await session.prepare();
      await repairRound(plan.states);
      continue;
    }
    const completed = await context.mutate(() => context.service.completeAnimationRepair(job));
    return {job: completed, atlas};
  }
}

export function repairGenerationTotals(job: GenerationJob): {generationMs: number; usage?: ImageUsage} {
  const base = job.stages.find(s => s.name === "base");
  const attempts = job.animationRepair?.attempts ?? [];
  const rows = [...(job.baseRepair?.attempts ?? (base ? [base] : [])), ...(job.animationRepair ? attempts : job.stages.filter(s=>s.name!=="base"))];
  const generationMs = rows.reduce((sum, row) => sum + (row.generationMs ?? 0), 0);
  if (rows.some(row => !row.usage)) return {generationMs};
  const usage = rows.reduce((sum, row) => ({textInputTokens: sum.textInputTokens + row.usage!.textInputTokens,
    imageInputTokens: sum.imageInputTokens + row.usage!.imageInputTokens, outputTokens: sum.outputTokens + row.usage!.outputTokens,
    costUsd: sum.costUsd + row.usage!.costUsd}), {textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: 0});
  return {generationMs, usage};
}

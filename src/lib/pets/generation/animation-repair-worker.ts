import {currentWorkerContext,setWorkerPhase} from "@/lib/pets/generation/worker-diagnostics";
import {readActiveWorkerJob, WorkerYield} from "@/lib/pets/generation/scheduler";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {GenerationError, type GenerationJob, type ImageUsage, type StageName} from "@/lib/pets/generation/model";
import type {ContinuationState} from "@/lib/pets/generation/continuation-model";
import {latestAnimationAttempt, animationFailureRetryReason} from "@/lib/pets/generation/animation-repair";
import {recoverProviderIntent} from "@/lib/pets/generation/provider-intent-recovery";
import {recoverRetryReservation} from "@/lib/pets/generation/retry-reservation-recovery";
import type {createGenerationService} from "@/lib/pets/generation/service";
import type {GenerationStore} from "@/lib/pets/generation/store";
import type {SpriteSession, StageImage} from "@/lib/pets/generation/sprite-worker";

type Context = {
  service: ReturnType<typeof createGenerationService>;
  store: GenerationStore;
  now: () => number;
  wait: (ms: number) => Promise<void>;
  checkLease: () => void;
  beforeCall?: () => void;
  heavy?: <T>(operation: () => Promise<T>) => Promise<T>;
  mutate: <T>(run: () => Promise<T>) => Promise<T>;
  onTerminalFailure?: (name: ContinuationState) => void;
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const uncertain = (boundary: "intent" | "checkpoint") => new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary, reason: "unconfirmed_write"});
async function currentJob(context: Context, original: GenerationJob) {
  return readActiveWorkerJob(context.store, original, context.now());
}
export async function reserveAnimationRetry(context: Context, job: GenerationJob, name: ContinuationState, reason: "quality" | "transport" | "moderation") {
  const before = await currentJob(context, job);
  try {
    const result = await context.mutate(() => context.service.reserveAnimationAttempt(job, name, reason));
    return {notBefore: result.attempt.notBefore};
  } catch (error) {
    if (error instanceof GenerationError || error instanceof WorkerYield) throw error;
    return recoverRetryReservation(context.store, before, {kind: "animation", stage: name, reason}, error, context.now);
  }
}

function pendingRetryFailure(job: GenerationJob, name: ContinuationState): GenerationError | undefined {
  let failed = latestAnimationAttempt(job, name);
  if (failed?.status === "reserved" && failed.reason === "transport") {
    const ordinal = failed.ordinal - 1;
    failed = job.animationRepair?.attempts.find(attempt => attempt.state === name && attempt.ordinal === ordinal);
  }
  const maxAttempts = job.animationRepair?.maxAttempts;
  if (failed?.status !== "failed" || failed.failure?.code !== "outcome_unknown" || maxAttempts === undefined) return;
  const failure = failed.failure;
  if (failed.ordinal >= maxAttempts && animationFailureRetryReason(failure) === "transport" && failure.diagnostic?.boundary === "provider_cli") return;
  return new GenerationError(failure.code, undefined, failure.providerFailure, undefined, failure.diagnostic, failure.cliCause);
}

async function beforeProviderCall<T>(context: Context, job: GenerationJob, retryFailure: GenerationError | undefined, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (retryFailure && job.expiresAt <= context.now() && error instanceof GenerationError &&
      (error.code === "generation_expired" || error.code === "stale_worker")) throw retryFailure;
    throw error;
  }
}

export async function generateRepairAnimation(context: Context, job: GenerationJob, name: ContinuationState, session: SpriteSession): Promise<StageImage> {
  let retryFailure = pendingRetryFailure(job, name);
  while (true) {
    const current = await beforeProviderCall(context, job, retryFailure, () => currentJob(context, job));
    retryFailure = pendingRetryFailure(current, name);
    const attempt = latestAnimationAttempt(current, name);
    const maxAttempts = current.animationRepair?.maxAttempts;
    if (maxAttempts === undefined) throw uncertain("intent");
    if (attempt?.status === "failed" && attempt.failure) {
      const failure = new GenerationError(attempt.failure.code, undefined, attempt.failure.providerFailure, undefined, attempt.failure.diagnostic, attempt.failure.cliCause);
      const reason = animationFailureRetryReason(failure);
      if (!reason || attempt.ordinal >= maxAttempts) {
        if (reason === "transport" && failure.diagnostic?.boundary === "provider_cli") context.onTerminalFailure?.(name);
        throw failure;
      }
      await beforeProviderCall(context, job, retryFailure, () => reserveAnimationRetry(context, job, name, reason));
      if (job.workerLeaseId) throw new WorkerYield(context.now() + 5000);
      continue;
    }
    if (!attempt || attempt.status !== "reserved") throw uncertain("intent");
    await beforeProviderCall(context, job, retryFailure, async () => {
    const delay = Math.max(0, attempt.notBefore - context.now());
    if (delay && job.workerLeaseId) throw new WorkerYield(attempt.notBefore);
    if (delay) await context.wait(delay);
    context.checkLease();
    context.beforeCall?.();
    setWorkerPhase(currentWorkerContext(), "intent", job, attempt.ordinal);
    try { await context.mutate(() => {
      context.beforeCall?.();
      return context.service.startAnimationAttempt(job, name, attempt.token);
    }); }
    catch (error) {
      if (error instanceof GenerationError || error instanceof WorkerYield) throw error;
      await recoverProviderIntent(context.store, job, name, attempt.token, error, context.now);
    }
    context.checkLease();
    try { context.beforeCall?.(); }
    catch (error) {
      if (error instanceof WorkerYield) await context.mutate(() => context.service.deferUnsentAnimationAttempt(job, name, attempt.token));
      throw error;
    }
    });
    retryFailure = undefined;
    let image: StageImage;
    try { setWorkerPhase(currentWorkerContext(),"provider",job,attempt.ordinal); image = await session.generate(name, {attempt: attempt.ordinal}); }
    catch (error) {
      const failure = error instanceof GenerationError ? error : new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "renderer_process", reason: "unclassified"});
      const reason = animationFailureRetryReason(failure);
      const terminal = attempt.ordinal >= maxAttempts && reason === "transport" && failure.diagnostic?.boundary === "provider_cli";
      try { await context.mutate(() => context.service.failAnimationAttempt(job, name, attempt.token, failure)); }
      catch (error) {
        if (error instanceof GenerationError && job.expiresAt <= context.now()) {
          // persistResult rethrows this exact failure only after committing its
          // expired-result receipt. Other errors do not prove that checkpoint.
          if (error === failure && terminal) context.onTerminalFailure?.(name);
          throw error;
        }
        const recorded = await currentJob(context, job).then(current => latestAnimationAttempt(current, name)).catch(() => undefined);
        if (recorded?.token !== attempt.token || recorded.ordinal !== attempt.ordinal || recorded.status !== "failed" ||
          recorded.failure?.code !== failure.code || !isDeepStrictEqual(recorded.failure.diagnostic, failure.diagnostic) ||
          !isDeepStrictEqual(recorded.failure.cliCause, failure.cliCause) ||
          !isDeepStrictEqual(recorded.failure.providerFailure, failure.providerFailure)) throw uncertain("checkpoint");
      }
      if (terminal) context.onTerminalFailure?.(name);
      if (!reason || attempt.ordinal >= maxAttempts) throw failure;
      retryFailure = failure.code === "outcome_unknown" ? failure : undefined;
      await beforeProviderCall(context, job, retryFailure, () => reserveAnimationRetry(context, job, name, reason));
      if (job.workerLeaseId) throw new WorkerYield(context.now() + 5000);
      continue;
    }
    try { await context.mutate(() => context.service.saveAnimationAttempt(job, name, attempt.token, image.bytes, image)); }
    catch (error) {
      if (error instanceof GenerationError && error.code === "generation_expired") throw error;
      if (job.expiresAt <= context.now()) {
        if (error instanceof GenerationError && error.code === "stale_worker") throw error;
        throw uncertain("checkpoint");
      }
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
        await beforeProviderCall(context, job, pendingRetryFailure(job, name), async () => {
          const last = latestAnimationAttempt(await currentJob(context, job), name);
          if (last?.status !== "reserved" && last?.status !== "failed") await reserveAnimationRetry(context, job, name, "quality");
        });
        const image = await generateRepairAnimation(context, job, name, session);
        saved.set(name, image.bytes);
      } catch (failure) { onFailure(name, failure); throw failure; }
    }));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length) {
      const failure = failures.find(r => r.reason instanceof GenerationError && r.reason.code === "outcome_unknown")?.reason ?? failures[0].reason;
      if (failure instanceof WorkerYield) throw failure;
      if (failure instanceof GenerationError) throw new GenerationError(failure.code, failure.retryAt, failure.providerFailure, failure.limitScope, failure.diagnostic, failure.cliCause, failure.details, job.animationRepair?.issues);
      throw uncertain("checkpoint");
    }
    job = await context.mutate(() => context.service.verifyAnimationRepair(job));
  };
  if (job.animationRepair?.phase === "repairing" && job.animationRepair.pending.length) await repairRound(job.animationRepair.pending);
  while (true) {
    context.checkLease();
    let atlas: Buffer;
    try { atlas = await (context.heavy ? context.heavy(() => session.compose()) : session.compose()); }
    catch (error) {
      if (!(error instanceof GenerationError) || !["invalid_sprite_extraction", "missing_animation_frame"].includes(error.code) ||
        error.diagnostic?.boundary !== "renderer_process" || !["invalid_image", "process_exit"].includes(error.diagnostic.reason) || !error.assemblyIssues?.length) throw error;
      let plan: Awaited<ReturnType<Context["service"]["planAnimationRepair"]>>;
      try { plan = await context.mutate(() => context.service.planAnimationRepair(job, error.assemblyIssues!)); }
      catch (failure) { if (failure instanceof GenerationError) throw failure; throw uncertain("checkpoint"); }
      if (!plan.states?.length) throw error;
      job = plan.job;
      if (job.workerLeaseId) throw new WorkerYield();
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

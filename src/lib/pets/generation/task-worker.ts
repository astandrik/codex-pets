import {setWorkerPhase, type WorkerContext} from "@/lib/pets/generation/worker-diagnostics";
import {createHash} from "node:crypto";
import {GenerationError, HEARTBEAT_MS, type GenerationJob, type StageName} from "@/lib/pets/generation/model";
import {WorkerYield, readActiveWorkerJob, scheduler, isTaskScheduler} from "@/lib/pets/generation/scheduler";
import {generateRepairAnimation, repairGenerationTotals} from "@/lib/pets/generation/animation-repair-worker";
import {isAnimationState, latestAnimationAttempt, getRepairScope} from "@/lib/pets/generation/animation-repair";
import {generateRepairBase} from "@/lib/pets/generation/base-repair-worker";
import {readSavedGenerationBase} from "@/lib/pets/generation/base-review";
import {readRevisionAtlas} from "@/lib/pets/generation/animation-revisions";
import {isRetryableImageCause} from "@/lib/pets/generation/cli-cause";
import {errorFromTask} from "@/lib/pets/generation/task-scheduler";
import {prepareGeneratedCard} from "@/lib/pets/generation/card-worker";
import {buildGeneratedPackage} from "@/lib/pets/generation/package";
import type {SpriteSession, createSpriteGenerationWorker} from "@/lib/pets/generation/sprite-worker";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type Options = Parameters<typeof createSpriteGenerationWorker>[0];
export async function runGenerationTask(initial: GenerationJob, options: Options, diagnostic?: WorkerContext): Promise<string> {
  let job = initial;
  const task = job.workerTask!;
  const now = options.now ?? Date.now;
  let session: SpriteSession | undefined;
  let leaseError: unknown;
  let recordedTerminalFailure = false;
  let primaryError: unknown;
  let heartbeat = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(() => options.service.heartbeat(initial)).then(() => undefined).catch(error => {leaseError = error;});
  }, HEARTBEAT_MS);
  const checkLease = () => {
    if (leaseError) throw new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary:"lease",reason:"heartbeat_failed"});
    if (initial.expiresAt <= now()) throw new GenerationError("generation_expired");
  };
  const beforeCall = () => {checkLease();if (options.stopping?.()) throw new WorkerYield();};
  const context = {service: options.service, store: options.store, now, wait: options.wait ?? (async () => {throw new WorkerYield();}),
    checkLease, beforeCall, onTerminalFailure: () => {recordedTerminalFailure = true;}, mutate: <T>(run: () => Promise<T>) => run()};
  async function refresh() {job = await readActiveWorkerJob(options.store, initial, now());return job;}
  async function open(composing = false) {
    const saved = new Map<StageName, Buffer>();
    for (const stage of job.stages) {
      if (stage.status !== "completed" || (!composing && stage.name !== "base" && !job.continuation && !job.animationRevision)) continue;
      const bytes = await options.store.readArtifact(job.id, `stage-${stage.name}.png`, now());
      if (!bytes || hash(bytes) !== stage.sha256) throw new GenerationError("saved_stage_unavailable");
      if (composing || stage.name === "base") saved.set(stage.name, bytes);
    }
    let reference: Buffer | undefined, atlas: Buffer | undefined;
    if (job.continuation || job.animationRevision) {
      saved.set("base", await readSavedGenerationBase(job, options.store.readArtifact.bind(options.store), now()));
      if (job.animationRevision) atlas = await readRevisionAtlas(job, options.store.readArtifact.bind(options.store), now());
      else if (job.continuation?.atlas) {
        atlas = await options.store.readArtifact(job.id, job.continuation.atlas.kind, now()) ?? undefined;
        if (!atlas || hash(atlas) !== job.continuation.atlas.sha256) throw new GenerationError("saved_stage_unavailable");
      }
    } else if (task.stage === "base" && job.reference) {
      reference = await options.store.readArtifact(job.id,"reference.png",now()) ?? undefined;
      if (!reference || hash(reference) !== job.reference.sha256) throw new GenerationError("saved_stage_unavailable");
    }
    setWorkerPhase(diagnostic, "prepare", job);
    session = await options.renderer.open(job, saved, reference, atlas, {diagnosticOnly:composing});
    return session;
  }
  async function ordinaryImage(name: StageName, active: SpriteSession) {
    const retry = job.rowRetries?.find(r => r.stage === name && r.state !== "completed");
    beforeCall();
    const recorded = job.rowAttemptLogs?.filter(log => log.stage === name).at(-1);
    if (recorded) {
      const retryable = recorded.attempt === 1 && recorded.code === "outcome_unknown" && isRetryableImageCause(recorded.cliCause);
      if (!retryable) throw new GenerationError(recorded.code, undefined, undefined, undefined, recorded.diagnostic, recorded.cliCause, recorded.details);
      if (!retry) {
        const recovered = await options.service.beginRowRetry(job, name);
        throw new WorkerYield(recovered.notBefore);
      }
    }
    if (retry) {
      if (retry.notBefore > now()) throw new WorkerYield(retry.notBefore);
      await options.service.authorizeRowRetry(job, name, retry.token);
    } else await options.service.authorizeStage(job, name);
    if (options.stopping?.()) {await options.service.deferUnsentStage(job,name);throw new WorkerYield();}
    let image;
    try {checkLease(); setWorkerPhase(diagnostic, "provider", job, retry ? 2 : 1); image = await active.generate(name);}
    catch (error) {
      const failure = error instanceof GenerationError ? error : new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"renderer_process",reason:"unclassified"});
      await options.service.recordRowAttemptFailure(job,name,retry?2:1,failure);
      if (retry && failure.code === "outcome_unknown" && isRetryableImageCause(failure.cliCause) && failure.diagnostic?.boundary === "provider_cli") recordedTerminalFailure = true;
      if (initial.expiresAt <= now()) throw failure;
      if (!retry && failure.code === "outcome_unknown" && isRetryableImageCause(failure.cliCause)) {
        const next = await options.service.beginRowRetry(job,name);throw new WorkerYield(next.notBefore);
      }
      throw failure;
    }
    try {setWorkerPhase(diagnostic, "checkpoint", job); await options.service.saveStage(job,name,image.bytes,image);}
    catch (error) {
      if (initial.expiresAt <= now()) throw error;
      const saved = await refresh();if (saved.stages.find(s=>s.name===name)?.sha256 !== hash(image.bytes)) throw error;
    }
  }
  try {
    beforeCall();
    if (task.kind === "image") {
      const name = task.stage!;
      if (!job.stages.some(s=>s.name===name)) {await options.service.beginStage(job,name);await refresh();}
      if (isAnimationState(name) && job.animationRepair?.pending.includes(name) && latestAnimationAttempt(job,name)?.status === "saved") {
        const retry = await options.service.reserveAnimationAttempt(job,name,"quality");throw new WorkerYield(retry.attempt.notBefore);
      }
      const active = await open();
      if (name !== "base") await active.prepare(operation=>options.service.withHeavy(job,operation));
      setWorkerPhase(diagnostic, "provider", job);
      if (name === "base" && job.baseRepair) await generateRepairBase(context,job,active);
      else if (isAnimationState(name) && job.animationRepair) await generateRepairAnimation(context,job,name,active);
      else await ordinaryImage(name,active);
    } else if (task.kind === "review") {
      await options.service.awaitConfirmation(job);
    } else if (task.kind === "compose") {
      const active = await open(true);
      let atlas: Buffer;
      try {atlas=await options.service.withHeavy(job,()=>active.compose());}
      catch(error) {
        if (!(error instanceof GenerationError) || !["invalid_sprite_extraction","missing_animation_frame"].includes(error.code) ||
          error.diagnostic?.boundary !== "renderer_process" || !["invalid_image","process_exit"].includes(error.diagnostic.reason) || !error.assemblyIssues?.length || !getRepairScope(job).length || !job.animationRepair) throw error;
        const repair=await options.service.planAnimationRepair(job,error.assemblyIssues);
        if (!repair.states?.length) throw error;
        throw new WorkerYield();
      }
      if (job.animationRepair && getRepairScope(job).length) {await options.service.completeAnimationRepair(job);await refresh();}
      await options.service.saveSource(job,atlas,(job.animationRepair || job.baseRepair)?repairGenerationTotals(job):{generationMs:job.stages.reduce((sum,s)=>sum+(s.generationMs??0),0)});
    } else if (task.kind === "metadata") {
      const source=await options.store.readArtifact(job.id,"source.png",now());
      if (!source) throw new GenerationError("source_unavailable");
      await prepareGeneratedCard(job,source,options.service,options.store,options.cardProvider,checkLease,now,()=>Boolean(options.stopping?.()));
    } else if (task.kind === "package") {
      const source=await options.store.readArtifact(job.id,"source.png",now());
      if (!source) throw new GenerationError("source_unavailable");
      const files=await options.service.withHeavy(job,()=>(options.build??buildGeneratedPackage)(job,source));
      await options.service.finish(job,files);
    } else {
      const failure=await options.store.transaction(async tx=>{
        const state=await scheduler(tx,now());
        if (!isTaskScheduler(state))throw new GenerationError("invalid_stage");
        const current=state.tasks.find(t=>t.key===task.key);
        if (!current)throw new GenerationError("stale_worker");
        return {error:errorFromTask(current),diagnostics:current.diagnostics??[],causes:current.causes??[]};
      });
      await options.service.fail(job,failure.error.code,failure.error.providerFailure,failure.error.diagnostic,failure.diagnostics,failure.causes,failure.error.assemblyIssues);
    }
    setWorkerPhase(diagnostic, "finalize", job);
    await options.service.completeTask(initial);
    return task.kind === "package" ? "completed" : task.kind === "review" ? "awaiting_confirmation" : task.kind === "fail" ? "failed" : "yielded";
  } catch (error) {
    primaryError = error instanceof WorkerYield ? undefined : error;
    const phase = diagnostic?.phase;
    try {
    if (initial.expiresAt <= now()) {
      const uncertain = Boolean(leaseError) || !(error instanceof GenerationError) ||
        (["outcome_unknown", "stage_conflict", "invalid_provider_result"].includes(error.code) && !recordedTerminalFailure);
      await options.service.finishExpiredGeneration(initial, uncertain);
      return "failed";
    }
    if (error instanceof WorkerYield) {await options.service.completeTask(initial,{eligibleAt:error.eligibleAt});return "yielded";}
    if (!(error instanceof GenerationError)) {
      const safeToRetry = !["image", "metadata"].includes(task.kind) || await options.store.transaction(async tx => {
        const state = await scheduler(tx, now());
        return isTaskScheduler(state) && state.providerSlots.some(slot => slot.leaseId === initial.workerLeaseId && slot.dispatched === false);
      });
      if (safeToRetry) {await options.service.completeTask(initial,{eligibleAt:now()+5000});return "yielded";}
    }
    const failure=error instanceof GenerationError?error:new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"checkpoint",reason:"unconfirmed_write"});
    await options.service.completeTask(initial,{error:failure});
    return "failed";
    } catch (secondary) {
      if(error instanceof WorkerYield){setWorkerPhase(diagnostic,"finalize",job);throw secondary;}
      if(!diagnostic?.primaryReported)diagnostic?.report(error);
      setWorkerPhase(diagnostic,"finalize",job);
      diagnostic?.report(secondary, true);
      if (diagnostic && phase) diagnostic.phase = phase;
      throw secondary;
    }
  } finally {
    clearInterval(timer); await heartbeat;
    try {await session?.cleanup();} catch (error) {
      if (primaryError) {if(!diagnostic?.primaryReported)diagnostic?.report(primaryError);const phase=diagnostic?.phase;setWorkerPhase(diagnostic,"workspace_cleanup");diagnostic?.report(error,true);if(diagnostic&&phase)diagnostic.phase=phase;}
      else {setWorkerPhase(diagnostic, "workspace_cleanup"); throw error;}
    }
  }
}

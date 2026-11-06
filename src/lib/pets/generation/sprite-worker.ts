import type {FileResultJournal} from "@/lib/pets/generation/result-journal";
import {setWorkerPhase, type WorkerContext} from "@/lib/pets/generation/worker-diagnostics";
import {runGenerationTask} from "@/lib/pets/generation/task-worker";
import {generateRepairBase} from "@/lib/pets/generation/base-repair-worker";
import {WorkerYield} from "@/lib/pets/generation/scheduler";
import {readSavedGenerationBase} from "@/lib/pets/generation/base-review";
import {readRevisionAtlas} from "@/lib/pets/generation/animation-revisions";
import { createHash } from "node:crypto";
import {isRetryableImageCause,isRetryableImageFailure} from "@/lib/pets/generation/cli-cause";
import {isAnimationState, getRepairScope} from "@/lib/pets/generation/animation-repair";
import {generateRepairAnimation, composeWithAnimationRepairs, repairGenerationTotals} from "@/lib/pets/generation/animation-repair-worker";
import {prepareGeneratedCard} from "@/lib/pets/generation/card-worker";
import type {GenerationCardProvider} from "@/lib/pets/generation/card-provider";
import { buildGeneratedPackage } from "@/lib/pets/generation/package";
import { GenerationError, generationStageNames, requiredStageNames, usesStageCheckpoints, HEARTBEAT_MS, MAX_PARALLEL_IMAGE_ROWS, STAGE_NAMES, type GenerationJob, type ImageUsage, type StageName, type StageFailureDiagnostic, type StageCliCause } from "@/lib/pets/generation/model";
import type { createGenerationService } from "@/lib/pets/generation/service";
import type { GenerationStore } from "@/lib/pets/generation/store";

export type StageImage = { bytes: Buffer; usage?: ImageUsage; generationMs: number };
export type SpriteSession = {
  prepare(withHeavy?: (operation: () => Promise<void>) => Promise<void>): Promise<void>;
  generate(name: StageName, context?: {attempt: number}): Promise<StageImage>;
  compose(): Promise<Buffer>;
  cleanup(): Promise<void>;
};
export type SpriteRenderer = { open(job: GenerationJob, saved: Map<StageName, Buffer>, reference?: Buffer, revisionAtlas?: Buffer, options?: {diagnosticOnly?: boolean}): Promise<SpriteSession>; cleanupExpired?(now: number): Promise<void> };
type Service = ReturnType<typeof createGenerationService>;

export function createSpriteGenerationWorker(options: {
  service: Service; store: GenerationStore; renderer: SpriteRenderer;
  cardProvider?:GenerationCardProvider;
  build?: (job: GenerationJob, source: Buffer) => Promise<Record<string, Buffer>>;
  now?: () => number;
  wait?: (ms:number)=>Promise<void>;
  stopping?: () => boolean;
  resultJournal?: FileResultJournal;
}) {
  let lastCleanup = -Infinity;
  return async function runOnce(owner: string, context?: WorkerContext) {
    setWorkerPhase(context, "cleanup");
    const now = options.now ?? Date.now;
    if (options.stopping?.()) return "idle";
    if (now() - lastCleanup >= 60_000) { lastCleanup = now(); await options.resultJournal?.expire(now()); await options.renderer.cleanupExpired?.(now()); await options.store.cleanup(now()); }
    setWorkerPhase(context, "claim");
    let job = await options.service.claim(owner);
    if (!job) return "idle";
    setWorkerPhase(context, "prepare", job);
    if (job.workerTask) return runGenerationTask(job, options, context);
    const initial = job;
    let session: SpriteSession | undefined;
    let primaryError: unknown;
    let yieldAt: number | undefined;
    let leaseError: unknown;
    const stageDiagnostics:StageFailureDiagnostic[]=[];
    const cliCauses:StageCliCause[]=[];
    const recordedTerminalFailures = new Set<StageName>();
    const stageFailures: {name:StageName;error:GenerationError}[] = [];
    const uncertain = (error: GenerationError) => ["outcome_unknown", "stage_conflict", "invalid_provider_result"].includes(error.code);
    let heartbeat = Promise.resolve();
    let checkpointQueue: Promise<void> = Promise.resolve();
    const mutate = <T,>(operation: () => Promise<T>) => {
      const result = checkpointQueue.then(operation);
      checkpointQueue = result.then(() => undefined, () => undefined);
      return result;
    };
    const repairContext = {service: options.service, store: options.store, now,
      onTerminalFailure: (name:StageName) => {recordedTerminalFailures.add(name);},
      heavy: job.workerLeaseId ? <T,>(run: () => Promise<T>) => options.service.withHeavy(job!, run) : undefined,
      beforeCall: () => {if (job?.workerLeaseId && options.stopping?.()) throw new WorkerYield();},
      wait: options.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms))), mutate,
      checkLease: () => {
        if (leaseError) throw new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "lease", reason: "heartbeat_failed"});
        if (initial.expiresAt <= now()) throw new GenerationError("generation_expired");
      }};
    const timer = setInterval(() => {
      heartbeat = heartbeat.then(async () => { await options.service.heartbeat(initial); }).catch(error => { leaseError = error; });
    }, HEARTBEAT_MS);
    async function awaitReview(current: GenerationJob) {
      clearInterval(timer);
      await heartbeat;
      if (leaseError) throw new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "lease", reason: "heartbeat_failed"});
      try { await options.service.awaitConfirmation(current); }
      catch (error) {
        const saved = await options.store.readJob(current.id);
        if (!saved || !saved.reviewBase || (saved.status !== "awaiting_confirmation" && saved.baseConfirmedAt === undefined) ||
            saved.stages[0]?.sha256 !== current.stages[0]?.sha256) throw error;
      }
      return "awaiting_confirmation" as const;
    }
    try {
      if (job.status === "generating") {
        if (!usesStageCheckpoints(job)) throw new GenerationError("outcome_unknown");
        const saved = new Map<StageName, Buffer>();
        for (const stage of job.stages.filter(s => !initial.continuation || requiredStageNames(initial).includes(s.name))) {
          const bytes = await options.store.readArtifact(job.id, "stage-" + stage.name + ".png", now());
          if (stage.status === "inflight" && (job.workerLeaseId || (job.baseRepair && stage.name === "base") || (job.animationRepair && isAnimationState(stage.name)))) continue;
          if (stage.status !== "completed" || !bytes || createHash("sha256").update(bytes).digest("hex") !== stage.sha256) throw new GenerationError("saved_stage_unavailable");
          saved.set(stage.name, bytes);
        }
        if (job.reviewBase && job.baseConfirmedAt === undefined && saved.has("base")) return await awaitReview(job);
        let reference: Buffer | undefined;
        if (!job.continuation && job.reference && !saved.has("base")) {
          const bytes = await options.store.readArtifact(job.id, "reference.png", now());
          if (!bytes || createHash("sha256").update(bytes).digest("hex") !== job.reference.sha256) throw new GenerationError("saved_stage_unavailable");
          reference = bytes;
        }
        let revisionAtlas: Buffer | undefined;
        if (job.continuation) {
          saved.set("base", await readSavedGenerationBase(job, (id,kind,time)=>options.store.readArtifact(id,kind,time), now()));
          if (job.continuation.atlas) {
            revisionAtlas=await options.store.readArtifact(job.id,job.continuation.atlas.kind,now())??undefined;
            if(!revisionAtlas||createHash("sha256").update(revisionAtlas).digest("hex")!==job.continuation.atlas.sha256)throw new GenerationError("saved_stage_unavailable");
          }
        } else if (job.animationRevision) {
          const read = (id: string, kind: string, time: number) => options.store.readArtifact(id, kind, time);
          saved.set("base", await readSavedGenerationBase(job, read, now()));
          revisionAtlas = await readRevisionAtlas(job, read, now());
        }
        const activeSession = await options.renderer.open(job, saved, reference, revisionAtlas);
        session = activeSession;
        let prepared = false;
        const prepareRows = async () => {
          if (!prepared) { await (job!.workerLeaseId ? options.service.withHeavy(job!, () => activeSession.prepare()) : activeSession.prepare()); prepared = true; }
        };
        const remaining = generationStageNames(job).filter(name => !saved.has(name));
        while (remaining.length) {
          const names = remaining.splice(0, remaining[0] === "base" ? 1 : MAX_PARALLEL_IMAGE_ROWS);
          if (names[0] !== "base") await prepareRows();
          if (leaseError) throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"lease",reason:"heartbeat_failed"});
          try {
            if (names[0] === "base") {
              if(!job.stages.some(stage=>stage.name==="base"))job = await options.service.beginStage(job, "base");
            }
            else if (!batchAlreadyReserved(job, names)) {
              job = await options.service.beginStages(job, names);
            }
          } catch (error) {
            if (error instanceof GenerationError) throw error;
            // This process has not called the provider for these intents yet.
            const readback = await options.store.readJob(job.id);
            if (!readback || readback.worker !== owner || readback.workerLeaseId !== initial.workerLeaseId || names.some(name => readback.stages.find(stage => stage.name === name)?.status !== "inflight")) throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"intent",reason:"unconfirmed_write"});
            job = readback;
          }
          const batchJob = job;
          const results = await Promise.allSettled(names.map(async name => {
            if (leaseError) throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"lease",reason:"heartbeat_failed"});
            if (batchJob.baseRepair && name==="base") {
              const image=await generateRepairBase(repairContext,batchJob,activeSession);
              saved.set(name,image.bytes);return;
            }
            if (batchJob.animationRepair && isAnimationState(name)) {
              const image = await generateRepairAnimation(repairContext, batchJob, name, activeSession);
              saved.set(name, image.bytes);
              return;
            }
            if (batchJob.workerLeaseId && options.stopping?.()) throw new WorkerYield();
            const existingRetry = batchJob.workerLeaseId ? batchJob.rowRetries?.find(r => r.stage === name) : undefined;
            const recorded = batchJob.workerLeaseId ? batchJob.rowAttemptLogs?.filter(log => log.stage === name).at(-1) : undefined;
            if (recorded) {
              if (recorded.attempt !== 1 || !isRetryableImageFailure(recorded)) {
                throw new GenerationError(recorded.code, undefined, undefined, undefined, recorded.diagnostic, recorded.cliCause, recorded.details);
              }
              if (!existingRetry) {
                let retry: NonNullable<GenerationJob["rowRetries"]>[number];
                try { retry = await mutate(() => options.service.beginRowRetry(batchJob, name)); }
                catch (error) {
                  if (error instanceof GenerationError || error instanceof WorkerYield) throw error;
                  const saved = await options.service.readWorkerJob(batchJob);
                  const recovered = saved.rowRetries?.find(item => item.stage === name);
                  if (!recovered || recovered.state !== "waiting") throw new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary:"checkpoint", reason:"unconfirmed_write"});
                  retry = recovered;
                }
                throw new WorkerYield(retry.notBefore);
              }
            }
            let image: StageImage;
            const call=async(attempt:1|2)=>{
              if (batchJob.expiresAt <= now()) throw new GenerationError("generation_expired");
              try{return await activeSession.generate(name);}
              catch(error){
                const failure=error instanceof GenerationError?error:new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"renderer_process",reason:"unclassified"});
                try{await mutate(()=>options.service.recordRowAttemptFailure(batchJob,name,attempt,failure));}
                catch{throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"checkpoint",reason:"unconfirmed_write"});}
                // Only an exhausted, durably recorded provider failure is local
                // to this task. Missing checkpoints and abandoned retries are not.
                if(attempt===2&&failure.diagnostic?.boundary==="provider_cli"&&isRetryableImageCause(failure.cliCause))recordedTerminalFailures.add(name);
                throw failure;
              }
            };
            try{
              if(existingRetry){
                if(existingRetry.notBefore>now())throw new WorkerYield(existingRetry.notBefore);
                await mutate(()=>{
                  if (options.stopping?.()) throw new WorkerYield();
                  return options.service.authorizeRowRetry(batchJob,name,existingRetry.token);
                });
              } else {
                await mutate(() => {
                  if (batchJob.workerLeaseId && options.stopping?.()) throw new WorkerYield();
                  return options.service.authorizeStage(batchJob, name);
                });
              }
              if (batchJob.workerLeaseId && options.stopping?.()) {
                await mutate(() => options.service.deferUnsentStage(batchJob, name));
                throw new WorkerYield();
              }
              image=await call(existingRetry?2:1);
            }
            catch(error){
              if(existingRetry || !(error instanceof GenerationError)||!isRetryableImageFailure(error))throw error;
              if(batchJob.expiresAt<=now())throw error;
              try{
                const retry=await mutate(()=>options.service.beginRowRetry(batchJob,name));
                if(batchJob.workerLeaseId)throw new WorkerYield(retry.notBefore);
                await (options.wait??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(Math.max(0,retry.notBefore-now()));
                if(leaseError)throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"lease",reason:"heartbeat_failed"});
                await mutate(()=>options.service.authorizeRowRetry(batchJob,name,retry.token));
                image=await call(2);
              }catch(retryError){
                if(batchJob.expiresAt<=now()&&retryError instanceof GenerationError&&["stale_worker","generation_expired"].includes(retryError.code))throw error;
                if(retryError instanceof GenerationError||retryError instanceof WorkerYield)throw retryError;
                throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"intent",reason:"unconfirmed_write"});
              }
            }
            // Each checkpoint updates the same job/budget/scheduler. Serial
            // saves avoid exhausting transaction retries when all rows finish together.
            const checkpoint = mutate(async () => {
              try { await options.service.saveStage(batchJob, name, image.bytes, image); }
              catch (error) {
                if (error instanceof GenerationError && error.code === "generation_expired") throw error;
                const readback = await options.store.readJob(batchJob.id);
                const stage = readback?.stages.find(item => item.name === name);
                if (readback && (readback.worker !== owner || readback.workerLeaseId !== initial.workerLeaseId)) throw new GenerationError("stale_worker");
                if (!readback || stage?.status !== "completed" || stage.sha256 !== createHash("sha256").update(image.bytes).digest("hex")) throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"checkpoint",reason:"unconfirmed_write"});
              }
              saved.set(name, image.bytes);
            });
            // A failed checkpoint must not prevent saving successful siblings.
            await checkpoint;
          }).map((promise,index)=>promise.catch(error=>{
            stageFailures.push({name:names[index],error:error instanceof GenerationError?error:new GenerationError("outcome_unknown")});
            if(error instanceof GenerationError&&error.diagnostic)stageDiagnostics.push({stage:names[index],diagnostic:error.diagnostic});
            if(error instanceof GenerationError&&error.cliCause)cliCauses.push({stage:names[index],cause:error.cliCause});
            throw error;
          })));
          // Do not finalize, release the reserve or delete shared files while a
          // sibling is still running. Unknown spending dominates a known refusal.
          const failures = results.flatMap((result,index) => result.status === "rejected"
            ? [{name:names[index],error:result.reason instanceof GenerationError || result.reason instanceof WorkerYield ? result.reason : new GenerationError("outcome_unknown")}]
            : []);
          if (failures.length) {
            if (initial.expiresAt <= now()) {
              const unresolved = failures.find(({name,error}) => error instanceof GenerationError && uncertain(error) && !recordedTerminalFailures.has(name));
              if (unresolved) throw unresolved.error;
            }
            throw (failures.find(({error}) => error instanceof GenerationError && error.code === "outcome_unknown") ?? failures.find(({error}) => error instanceof GenerationError) ?? failures[0]).error;
          }
          const refreshed = await options.store.readJob(job.id);
          if (!refreshed) throw new Error("Saved generation checkpoint unavailable");
          if (refreshed.worker !== owner || refreshed.workerLeaseId !== initial.workerLeaseId) throw new GenerationError("stale_worker");
          job = refreshed;
          if (job.reviewBase && job.baseConfirmedAt === undefined && saved.has("base")) return await awaitReview(job);
          if (job.workerLeaseId && remaining.length) throw new WorkerYield();
        }
        await prepareRows();
        let atlas: Buffer;
        if (job.animationRepair && getRepairScope(job).length) {
          const result = await composeWithAnimationRepairs(repairContext, job, session, saved, async current => {
            await session?.cleanup();
            session = await options.renderer.open(current, saved, reference, revisionAtlas);
            return session;
          }, (name, error) => {
            stageFailures.push({name,error:error instanceof GenerationError?error:new GenerationError("outcome_unknown")});
            if (error instanceof GenerationError && error.diagnostic) stageDiagnostics.push({stage: name, diagnostic: error.diagnostic});
            if (error instanceof GenerationError && error.cliCause) cliCauses.push({stage: name, cause: error.cliCause});
          });
          atlas = result.atlas; job = result.job;
        } else atlas = await (job.workerLeaseId ? options.service.withHeavy(job, () => session!.compose()) : session.compose());
        try {
          job = await options.service.saveSource(job, atlas, (job.animationRepair || job.baseRepair) ? repairGenerationTotals(job) : { generationMs: job.stages.reduce((sum, stage) => sum + (stage.generationMs ?? 0), 0) });
        } catch (error) {
          if (error instanceof GenerationError && error.code === "generation_expired") throw error;
          const readback = await options.store.readJob(job.id);
          const persisted = await options.store.readArtifact(job.id, "source.png", now());
          if (readback && (readback.worker !== owner || readback.workerLeaseId !== initial.workerLeaseId)) throw new GenerationError("stale_worker");
          if (!readback || readback.status !== "processing" || !persisted || !persisted.equals(atlas)) throw error;
          job = readback;
        }
      }
      const source = await options.store.readArtifact(job.id, "source.png", now());
      if (!source) throw new GenerationError("source_unavailable");
      job=await prepareGeneratedCard(job,source,options.service,options.store,options.cardProvider,repairContext.checkLease,now, () => Boolean(job?.workerLeaseId && options.stopping?.()));
      const files = await (job.workerLeaseId ? options.service.withHeavy(job, () => (options.build ?? buildGeneratedPackage)(job!, source)) : (options.build ?? buildGeneratedPackage)(job, source));
      try { await options.service.finish(job, files); }
      catch (error) {
        const readback = await options.store.readJob(job.id);
        if (readback?.status !== "completed") throw error;
      }
      return "completed";
    } catch (error) {
      primaryError = error instanceof WorkerYield ? undefined : error;
      try {
      // Paid/provider ambiguity is classified at its boundary. A local processing
      // crash preserves the checkpoint for lease-based recovery without repayment.
      if (error instanceof WorkerYield) { yieldAt = error.eligibleAt; return "yielded"; }
      if (!(error instanceof GenerationError)) throw error;
      if (initial.expiresAt <= now()) {
        const isolatedExpiredFailure = (error.diagnostic?.boundary === "provider_cli" || (initial.baseRepair && !error.diagnostic)) && stageFailures.length > 0
          && stageFailures.some(({name}) => recordedTerminalFailures.has(name))
          && stageFailures.every(({name,error}) => !uncertain(error) || recordedTerminalFailures.has(name));
        await options.service.finishExpiredGeneration(initial, Boolean(leaseError) || (uncertain(error) && !isolatedExpiredFailure));
        return "failed";
      }
      stageDiagnostics.sort((a,b)=>STAGE_NAMES.indexOf(a.stage)-STAGE_NAMES.indexOf(b.stage));
      const failure=leaseError?new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"lease",reason:"heartbeat_failed"}):error;
      await options.service.fail(initial, failure.code, failure.providerFailure,failure.diagnostic,stageDiagnostics,cliCauses.sort((a,b)=>STAGE_NAMES.indexOf(a.stage)-STAGE_NAMES.indexOf(b.stage)),failure.assemblyIssues);
      return "failed";
      }catch(secondary){if(!context?.primaryReported)context?.report(error);context?.report(secondary,true);throw secondary;}
    } finally {
      clearInterval(timer);
      await heartbeat;
      try { await session?.cleanup(); } catch (error) {
        if (primaryError) {if(!context?.primaryReported)context?.report(primaryError);const phase=context?.phase;setWorkerPhase(context,"workspace_cleanup");context?.report(error,true);if(context&&phase)context.phase=phase;}
        else {setWorkerPhase(context, "workspace_cleanup"); throw error;}
      }
      if (yieldAt !== undefined) await options.service.yield(initial, yieldAt);
    }
  };
}

function batchAlreadyReserved(job: GenerationJob, names: StageName[]) {
  return Boolean((job.animationRepair || job.workerLeaseId) && names.every(name => job.stages.some(stage => stage.name === name && stage.status === "inflight")));
}

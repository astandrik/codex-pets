import {taskResourcesAvailable} from "@/lib/pets/generation/task-readiness";
import {createHash, randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {checkStageBudget, settleBudget, type GenerationBudgetLimit} from "@/lib/pets/generation/budget";
import {latestAnimationAttempt, isAnimationState} from "@/lib/pets/generation/animation-repair";
import {latestBaseAttempt} from "@/lib/pets/generation/base-repair";
import {recoverUnconfirmedCardMetadata} from "@/lib/pets/generation/card-metadata";
import {configuredProviderCalls} from "@/lib/pets/generation/execution-limits";
import {stageOperation} from "@/lib/pets/generation/execution-slots";
import {isRetryableImageCause,isRetryableImageFailure,isUnsentImageFailure} from "@/lib/pets/generation/cli-cause";
import {GenerationError, LEASE_MS, generationStageNames, usesStageCheckpoints, type GenerationJob, type GenerationTask, type TaskScheduler} from "@/lib/pets/generation/model";
import {isTaskScheduler, requireJobWithActiveWorkerLease, saveScheduler, scheduler} from "@/lib/pets/generation/scheduler";
import type {GenerationStore, GenerationTransaction} from "@/lib/pets/generation/store";

const providerTask = (task: GenerationTask) => task.kind === "image" || task.kind === "metadata";
const heavyTask = (task: GenerationTask) => task.kind === "compose" || task.kind === "package";
const key = (id: string, kind: GenerationTask["kind"], stage?: string) => `${id}:${kind}${stage ? `:${stage}` : ""}`;
function hasUnknownProviderOperation(task: GenerationTask, job: GenerationJob, state: TaskScheduler) {
  let operation: string | undefined;
  if (task.kind === "metadata" && job.cardMetadata?.requestHash) operation = `card:${job.cardMetadata.requestHash}`;
  else if (task.kind === "image" && task.stage) {
    const baseAttempt = task.stage === "base" ? latestBaseAttempt(job) : undefined;
    const animationAttempt = isAnimationState(task.stage) ? latestAnimationAttempt(job, task.stage) : undefined;
    const attempt = baseAttempt ?? animationAttempt;
    operation = attempt ? `${task.stage === "base" ? "base-attempt" : "attempt"}:${attempt.token}` : stageOperation(job, task.stage);
  }
  return operation !== undefined && state.providerSlots.some(slot => slot.jobId === job.id && slot.unknown && slot.key === operation);
}
function recordedProviderFailure(task: GenerationTask, job: GenerationJob): "transport" | "rejection" | "not_sent" | undefined {
  const error = task.error;
  if (task.kind !== "image" || !task.stage || error?.diagnostic?.boundary !== "provider_cli") return;
  let recorded: GenerationTask["error"];
  let exhausted = false, attemptJournal = false;
  const base = task.stage === "base" ? latestBaseAttempt(job) : undefined;
  const animation = isAnimationState(task.stage) ? latestAnimationAttempt(job, task.stage) : undefined;
  if (base) {
    if (base.status !== "failed") return;
    recorded = base.failure; exhausted = base.ordinal === job.baseRepair?.maxAttempts; attemptJournal = true;
  } else if (animation) {
    if (animation.status !== "failed") return;
    recorded = animation.failure; exhausted = animation.ordinal === job.animationRepair?.maxAttempts; attemptJournal = true;
  } else {
    const row = job.rowAttemptLogs?.filter(log => log.stage === task.stage).at(-1);
    recorded = row; exhausted = row?.attempt === 2;
  }
  if (!recorded || recorded.code !== error.code || !isDeepStrictEqual(recorded.diagnostic, error.diagnostic) ||
      !isDeepStrictEqual(recorded.cliCause, error.cliCause) || (attemptJournal && !isDeepStrictEqual(recorded.providerFailure, error.providerFailure))) return;
  if (isUnsentImageFailure(error) && (exhausted || !isRetryableImageFailure(error))) return "not_sent";
  if (error.code === "outcome_unknown" && exhausted && isRetryableImageCause(error.cliCause)) return "transport";
  if ((error.code === "provider_rejected" || error.code === "provider_rate_limited") && error.cliCause?.kind === "http_error" &&
      error.providerFailure?.httpStatus === error.cliCause.httpStatus && error.cliCause.httpStatus !== undefined) return "rejection";
}
function desiredTasks(job: GenerationJob): GenerationTask[] {
  const make = (kind: GenerationTask["kind"], attempt = "initial", stage?: GenerationTask["stage"], notBefore = 0): GenerationTask =>
    ({key: key(job.id, kind, stage), jobId: job.id, kind, ...(stage ? {stage} : {}), status: "ready", notBefore, attempt});
  if (job.status === "processing") {
    return [job.cardMetadata && !["completed", "failed"].includes(job.cardMetadata.state)
      ? make("metadata", `metadata:${job.cardMetadata.revision}`) : make("package", "package")];
  }
  if (!["queued", "generating"].includes(job.status)) return [];
  const base = job.stages.find(s => s.name === "base");
  if (job.reviewBase && job.baseConfirmedAt === undefined && base?.status === "completed") return [make("review")];
  const names = generationStageNames(job);
  const stages = names.includes("base") && base?.status !== "completed" ? ["base" as const] : names.filter(n => n !== "base");
  const pending = stages.filter(name => job.stages.find(s => s.name === name)?.status !== "completed" || (isAnimationState(name) && job.animationRepair?.pending.includes(name)));
  if (pending.length) return pending.map(name => {
    const attempt = name === "base" ? latestBaseAttempt(job) : isAnimationState(name) ? latestAnimationAttempt(job, name) : undefined;
    const retry = job.rowRetries?.find(r => r.stage === name && r.state !== "completed");
    return make("image", attempt?.token ?? retry?.token ?? "initial", name, attempt?.status === "reserved" ? attempt.notBefore : retry?.notBefore ?? 0);
  });
  const snapshot = createHash("sha256").update(JSON.stringify(job.stages.map(s => [s.name, s.sha256]))).digest("hex");
  return [make("compose", snapshot)];
}

async function reconcile(tx: GenerationTransaction, state: TaskScheduler, now: number) {
  const jobs = await tx.getJobs(state.queue);
  for (const id of state.queue) {
    const job = jobs.get(id);
    if (!job || job.expiresAt <= now || !["queued", "generating", "processing"].includes(job.status)) continue;
    if (!usesStageCheckpoints(job)) throw new GenerationError("generation_not_configured");
    const existing = state.tasks.filter(t => t.jobId === id);
    // A queued finalizer owns the terminal decision even when another parent runs first.
    if (existing.some(t => t.kind === "fail" && (t.status === "ready" || t.status === "running"))) continue;
    const desired = desiredTasks(job);
    const next = desired.map(want => {
      const old = existing.find(t => t.key === want.key);
      // beginStage can reserve an attempt after claim. Its new token must not
      // erase a terminal failure; eligible retries explicitly yield ready work.
      if (old?.status === "running" || old?.status === "failed") return old;
      return {...want, notBefore:Math.max(want.notBefore, old?.status === "ready" ? old.notBefore : 0)};
    });
    for (const task of existing) if ((task.status === "running" || task.status === "failed") && !next.some(t => t.key === task.key)) next.push(task);
    if (next.some(t => t.status === "failed")) {
      // Finish already scheduled siblings before surfacing the parent's terminal error.
      const imageWork = next.some(t => t.kind === "image" && (t.status === "running" || (!state.pauseReason && t.status === "ready")));
      if (!imageWork && !next.some(t => t.status === "running")) {
        const failures = next.filter(t => t.status === "failed");
        const recorded = failures.map(task => ({task, kind: recordedProviderFailure(task, job)}));
        const failed = failures.find(t => t.error?.code === "outcome_unknown" && hasUnknownProviderOperation(t, job, state)) ??
          recorded.find(f => f.task.error?.code === "outcome_unknown" && f.kind !== "transport")?.task ??
          recorded.find(f => f.kind === "rejection" || f.kind === "not_sent")?.task ??
          failures.find(t => t.error?.code === "outcome_unknown") ??
          failures.find(t => t.error?.code !== "generation_paused") ?? failures[0];
        state.tasks = state.tasks.filter(t => t.jobId !== id);
        state.tasks.push({key: key(id, "fail"), jobId: id, kind: "fail", status: "ready", notBefore: 0, attempt: "failure", error: failed.error,
          diagnostics: next.flatMap(t=>t.stage&&t.error?.diagnostic?[{stage:t.stage,diagnostic:t.error.diagnostic}]:[]),
          causes: next.flatMap(t=>t.stage&&t.error?.cliCause?[{stage:t.stage,cause:t.error.cliCause}]:[])});
        continue;
      }
    }
    state.tasks = [...state.tasks.filter(t => t.jobId !== id), ...next.filter(t => t.kind !== "compose" || !next.some(s => s.status === "failed"))];
  }
}

export async function claimGenerationTask(tx: GenerationTransaction, state: TaskScheduler, owner: string, clock: () => number, budgetUsd: GenerationBudgetLimit, beforeCleanup = JSON.stringify(state)) {
  let now = clock();
  const saveChanges = async () => {
    if (JSON.stringify(state) !== beforeCleanup) await saveScheduler(tx, state);
  };
  for (const task of state.tasks.filter(t => t.status === "running" && t.lease!.until <= now)) {
    const slot = state.providerSlots.find(s => s.leaseId === task.lease!.leaseId);
    if (slot && slot.dispatched !== false) {
      slot.unknown = true; state.pauseReason = "outcome_unknown";
      await settleBudget(tx, task.jobId, now, true);
      const job = task.kind === "metadata" ? await tx.getJob(task.jobId) : null;
      if (job && job.expiresAt > clock() && job.status === "processing" && job.cardMetadata &&
          ["inflight", "completed", "failed"].includes(job.cardMetadata.state) && slot.key === `card:${job.cardMetadata.requestHash}`) {
        await tx.putJob({...job, cardMetadata:recoverUnconfirmedCardMetadata(job.cardMetadata)});
        // Keep the uncertain provider permit; only local packaging can follow.
        task.status = "done"; delete task.error; delete task.lease; continue;
      }
      task.status = "failed"; task.error = {code:"outcome_unknown",diagnostic:{boundary:"lease",reason:"heartbeat_failed"}}; delete task.lease; continue;
    }
    if (state.heavy?.leaseId === task.lease!.leaseId) continue;
    state.providerSlots = state.providerSlots.filter(s => s.leaseId !== task.lease!.leaseId);
    task.status = "ready"; delete task.lease;
  }
  if (process.env.PET_GENERATION_DRAIN === "true") {await saveChanges(); return null;}
  try {if (configuredProviderCalls() !== state.providerLimit) throw Error("mismatch");}
  catch {throw new GenerationError("generation_not_configured");}
  await reconcile(tx, state, now);
  const pivot = state.taskTurn ? state.queue.indexOf(state.taskTurn) + 1 : 0;
  const order = [...state.queue.slice(pivot), ...state.queue.slice(0, pivot)];
  for (const id of order) {
    const task = state.tasks.find(t => t.jobId === id && t.status === "ready" && t.notBefore <= now && taskResourcesAvailable(t, state));
    if (!task) continue;
    const job = await tx.getJob(id);
    now = clock();
    if (!job || job.expiresAt <= now) continue;
    // Metadata is optional: its existing service records a fallback if budget is exhausted.
    if (task.kind === "image") {
      try {await checkStageBudget(tx, id, now, budgetUsd);}
      catch (error) {
        if (!(error instanceof GenerationError)) throw error;
        task.status = "failed"; task.error = {code: error.code}; continue;
      }
    }
    now = clock();
    if (job.expiresAt <= now) continue;
    const leaseId = randomUUID();
    task.status = "running"; task.lease = {id, owner, leaseId, until: now + LEASE_MS, inflight: false};
    if (providerTask(task)) state.providerSlots.push({jobId: id, owner, leaseId, key: task.key, startedAt: now, dispatched: false});
    if (heavyTask(task)) state.heavy = {jobId: id, owner, leaseId};
    state.taskTurn = id; state.resumes[id] = 0;
    const current = {...job, status: job.status === "queued" ? "generating" as const : job.status, executionVersion: 3 as const};
    await tx.putJob(current); await saveScheduler(tx, state);
    return {...current, worker: owner, workerLeaseId: leaseId, leaseUntil: now + LEASE_MS,
      workerTask: {key: task.key, kind: task.kind, ...(task.stage ? {stage: task.stage} : {})}};
  }
  await saveChanges(); return null;
}

export function taskFailure(error: GenerationError): NonNullable<GenerationTask["error"]> {
  return {code: error.code, ...(error.retryAt ? {retryAt: error.retryAt} : {}), ...(error.providerFailure ? {providerFailure: error.providerFailure} : {}),
    ...(error.diagnostic ? {diagnostic: error.diagnostic} : {}), ...(error.cliCause ? {cliCause: error.cliCause} : {}),
    ...(error.details ? {details: error.details} : {}), ...(error.assemblyIssues ? {assemblyIssues: error.assemblyIssues} : {})};
}
export function errorFromTask(task: GenerationTask) {
  const e = task.error;
  return new GenerationError(e?.code ?? "outcome_unknown", e?.retryAt, e?.providerFailure, undefined, e?.diagnostic, e?.cliCause, e?.details, e?.assemblyIssues);
}
export async function completeGenerationTask(store: GenerationStore, job: GenerationJob, clock: () => number, result: {error?: GenerationError; eligibleAt?: number} = {}) {
  return store.transaction(async tx => {
    const now = clock();
    const state = await scheduler(tx, now);
    if (!isTaskScheduler(state)) throw new GenerationError("invalid_stage");
    const task = state.tasks.find(t => t.key === job.workerTask?.key);
    // Parent completion may already have removed its tasks in the same fenced flow.
    if (!task) {
      const current = await tx.getJob(job.id);
      if (current && ["completed", "failed", "awaiting_confirmation"].includes(current.status)) return;
      throw new GenerationError("stale_worker");
    }
    const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
    if (!task) throw new GenerationError("stale_worker");
    const slot = state.providerSlots.find(s => s.leaseId === job.workerLeaseId);
    if (slot && slot.dispatched !== false) {
      const metadataFallback = !result.error && task.kind === "metadata" && slot.unknown &&
        current.cardMetadata?.state === "failed" && current.cardMetadata.error === "outcome_unknown";
      if (metadataFallback) { /* Keep the unknown permit while allowing local packaging. */ }
      else if (result.error?.code === "outcome_unknown") {slot.unknown = true; state.pauseReason = "outcome_unknown"; await settleBudget(tx, job.id, now, true);}
      else throw new GenerationError("outcome_unknown");
    } else state.providerSlots = state.providerSlots.filter(s => s.leaseId !== job.workerLeaseId);
    if (state.heavy?.leaseId === job.workerLeaseId) state.heavy = null;
    task.status = result.error ? "failed" : result.eligibleAt !== undefined ? "ready" : "done";
    if (result.error) task.error = taskFailure(result.error);
    if (result.eligibleAt !== undefined) task.notBefore = result.eligibleAt;
    delete task.lease;
    await saveScheduler(tx, state);
  });
}

export function assertTaskStage(job: GenerationJob, stage: string) {
  if (job.workerTask && (job.workerTask.kind !== "image" || job.workerTask.stage !== stage)) throw new GenerationError("invalid_stage");
}

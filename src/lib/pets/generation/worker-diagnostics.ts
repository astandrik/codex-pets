import {AsyncLocalStorage} from "node:async_hooks";
import {createHash} from "node:crypto";
import {YdbError} from "@/lib/ydb/client";
import {GenerationError, STAGE_NAMES} from "@/lib/pets/generation/model";

export type WorkerPhase = "cleanup" | "claim" | "prepare" | "provider" | "checkpoint" | "finalize" | "workspace_cleanup";
export type WorkerContext = {
  primaryReported?: boolean; phase: WorkerPhase; startedAt: number; iterationHash: string;
  targetHash?: string; task?: string; stage?: string; attempt?: number; checkpointPass?: number;
  report: (error: unknown, secondary?: boolean) => void;
};
export type WorkerErrorHandler = (error: unknown, context: WorkerContext, secondary: boolean) => void;
const codes = new Set(["generation_paused", "generation_disabled", "generation_expired", "generation_not_configured", "invalid_stage", "stage_conflict", "stale_worker", "outcome_unknown", "provider_rejected", "provider_rate_limited", "budget_exhausted", "saved_stage_unavailable", "source_unavailable", "metadata_unavailable", "provider_not_configured", "invalid_provider_result"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function createWorkerContext(owner: string, onError?: WorkerErrorHandler, now = Date.now): WorkerContext {
  const context: WorkerContext = {phase:"cleanup", startedAt:now(), iterationHash:hash(owner), report(error, secondary = false) {
    try {if(!secondary)context.primaryReported=true;onError?.(error, {...context}, secondary);} catch { /* A diagnostic sink never owns the task outcome. */ }
  }};
  return context;
}
export function setWorkerPhase(context: WorkerContext | undefined, phase: WorkerPhase, job?: {id:string; workerTask?:{kind:string;stage?:string;key?:string}}, attempt?: number) {
  if (!context) return;
  context.phase = phase;
  if (job) {
    context.targetHash = hash(job.id);
    context.task = job.workerTask?.kind;
    context.stage = job.workerTask?.stage;
  }
  if (attempt !== undefined) context.attempt = attempt;
}
export function logWorkerFailure(error: unknown, context: WorkerContext, secondary = false, write = console.warn, now = Date.now) {
  try {
    const databaseStatus = error instanceof YdbError ? Reflect.get(error.constructor, "status") : undefined;
    const elapsed = now() - context.startedAt;
    write(JSON.stringify({operation:"pet-generation-worker-error", phase:context.phase, secondary,
      iterationHash:context.iterationHash, ...(context.targetHash ? {targetHash:context.targetHash} : {}),
      ...(["image","metadata","compose","package","review","fail"].includes(context.task ?? "") ? {task:context.task} : {}),
      ...(STAGE_NAMES.some(name => name === context.stage) ? {stage:context.stage} : {}),
      ...(Number.isSafeInteger(context.attempt) && context.attempt! > 0 && context.attempt! <= 51 ? {attempt:context.attempt} : {}),
      ...(Number.isSafeInteger(context.checkpointPass) ? {checkpointPass:context.checkpointPass} : {}),
      errorClass:error instanceof YdbError ? "YdbError" : error instanceof GenerationError ? "GenerationError" : "Error",
      ...(error instanceof GenerationError && codes.has(error.code) ? {code:error.code} : {}),
      ...(Number.isSafeInteger(databaseStatus) ? {databaseStatus} : {}),
      elapsedMs:Number.isFinite(elapsed) ? Math.max(0, Math.min(86400000, Math.round(elapsed))) : 0}));
  } catch { /* Diagnostics must not interrupt a saved result or its recovery. */ }
}

const diagnosticContext = new AsyncLocalStorage<WorkerContext>();
export const withWorkerContext = <T>(context:WorkerContext,run:()=>Promise<T>) => diagnosticContext.run(context,run);
export const currentWorkerContext = () => diagnosticContext.getStore();

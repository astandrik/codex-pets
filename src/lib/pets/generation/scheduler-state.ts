import {usesStageCheckpoints, legacySchedulerSchema, type Scheduler} from "@/lib/pets/generation/model";
import {isParallelScheduler, isTaskScheduler, saveScheduler, scheduler} from "@/lib/pets/generation/scheduler";
import type {GenerationStore} from "@/lib/pets/generation/store";
import {DEFAULT_PROVIDER_CALLS, MAX_PROVIDER_CALLS} from "@/lib/pets/generation/execution-limits";

export type SchedulerChange = {action: "activate" | "activate-tasks" | "downgrade" | "limit"; expectedRevision: number; activeLimit?: 1 | 2; providerLimit?: number; now: number; apply?: boolean};

export function transitionScheduler(state: Scheduler, change: SchedulerChange): Scheduler {
  if (state.revision !== change.expectedRevision) throw new Error("scheduler_conflict");
  if (state.pauseReason) throw new Error("scheduler_paused");
  if (change.providerLimit !== undefined && (!Number.isSafeInteger(change.providerLimit) || change.providerLimit < 1 || change.providerLimit > MAX_PROVIDER_CALLS)) throw new Error("scheduler_invalid_change");
  if (change.action === "limit") {
    if (!isParallelScheduler(state) || (change.activeLimit === undefined && change.providerLimit === undefined)) throw new Error("scheduler_invalid_change");
    if (isTaskScheduler(state) && change.activeLimit !== undefined) throw new Error("scheduler_invalid_change");
    return {...state, activeLimit: change.activeLimit ?? state.activeLimit, providerLimit: change.providerLimit ?? state.providerLimit};
  }
  if (change.action === "activate-tasks") {
    if (isTaskScheduler(state)) return state;
    if (isParallelScheduler(state) ? state.active.length || state.providerSlots.length || state.providerWaiters.length || state.heavy : state.active) throw new Error("scheduler_not_drained");
    return {revision:state.revision,queue:state.queue,version:3,activeLimit:isParallelScheduler(state)?state.activeLimit:1,
      providerLimit:change.providerLimit??DEFAULT_PROVIDER_CALLS,active:[],resumes:isParallelScheduler(state)?state.resumes:{},
      providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null};
  }
  if (isTaskScheduler(state) && state.tasks.length) throw new Error("scheduler_not_drained");
  if (isParallelScheduler(state)) {
    if (state.active.length || state.providerSlots.length || state.providerWaiters.length || state.heavy || Object.keys(state.resumes).length) throw new Error("scheduler_not_drained");
  } else if (state.active) throw new Error("scheduler_not_drained");
  if (change.action === "activate") {
    if (isParallelScheduler(state)) return state;
    return {...state, version: 2, activeLimit: change.activeLimit ?? 1, providerLimit: change.providerLimit ?? 11, active: [], resumes: {}, providerSlots: [], providerWaiters: [], providerTurn: null, heavy: null};
  }
  return legacySchedulerSchema.parse({revision: state.revision, queue: state.queue, active: null});
}

export async function changeSchedulerState(store: GenerationStore, change: SchedulerChange) {
  return store.transaction(async tx => {
    const current = await scheduler(tx, change.now);
    if (change.action === "activate-tasks") for (const id of current.queue) {
      const job=await tx.getJob(id);
      if(job && !usesStageCheckpoints(job) && ["queued","generating","processing"].includes(job.status)) throw new Error("scheduler_legacy_job_not_drained");
    }
    const next = transitionScheduler(current, change);
    if (change.apply) {
      if (process.env.PET_GENERATION_DRAIN !== "true") throw new Error("scheduler_drain_required");
      await tx.putLedger(`scheduler-backup:${current.revision}`, JSON.stringify(current), change.now + 7 * 86400000);
      await saveScheduler(tx, next);
    }
    return next;
  });
}

export function schedulerSummary(state: Scheduler) {
  return {version: isTaskScheduler(state) ? 3 : isParallelScheduler(state) ? 2 : 1, revision: state.revision,
    activeLimit: isParallelScheduler(state) ? state.activeLimit : 1,
    providerLimit: isParallelScheduler(state) ? state.providerLimit : 11,
    activeJobs: isTaskScheduler(state) ? new Set(state.tasks.filter(t=>t.status==="running").map(t=>t.jobId)).size : isParallelScheduler(state) ? state.active.length : Number(Boolean(state.active)),
    ...(isTaskScheduler(state)?{activeTasks:state.tasks.filter(t=>t.status==="running").length,readyTasks:state.tasks.filter(t=>t.status==="ready").length}:{}),
    waiting: state.queue.length, paused: Boolean(state.pauseReason),
    providerCalls: isParallelScheduler(state) ? state.providerSlots.length : Number(Boolean(state.active?.inflight)),
    resumed: isParallelScheduler(state) ? Object.keys(state.resumes).length : 0,
    heavy: isParallelScheduler(state) ? Number(Boolean(state.heavy)) : null};
}

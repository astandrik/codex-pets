import {createHash, randomUUID} from "node:crypto";
import {animationRepairSchema, ANIMATION_ATTEMPT_FAILURE_CODES, GenerationError, moscowDay, type AnimationAttempt, type GenerationJob, type Scheduler, type ImageUsage} from "@/lib/pets/generation/model";
import {assemblyIssuesSchema, type AssemblyIssue, type ContinuationState} from "@/lib/pets/generation/continuation-model";
import {getRepairScope, hasUnsettledAnimationAttempt, latestAnimationAttempt, selectRepairStates, animationFailureRetryReason} from "@/lib/pets/generation/animation-repair";
import {checkStageBudget, recordStageCost} from "@/lib/pets/generation/budget";
import {requireJobWithActiveWorkerLease, scheduler, saveScheduler} from "@/lib/pets/generation/scheduler";
import type {GenerationStore, GenerationTransaction} from "@/lib/pets/generation/store";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type Options = {now: () => number; enabled: () => boolean; automaticAnimationRepair: () => boolean; budgetUsd: () => number};

export function createAnimationRepairService(store: GenerationStore, options: Options) {
  async function withJob<T>(job: GenerationJob, run: (tx: GenerationTransaction, current: GenerationJob, state: Scheduler, now: number) => Promise<T>) {
    return store.transaction(async tx => {
      const state = await scheduler(tx, options.now());
      const now = options.now();
      const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
      if (current.status !== "generating" || !current.animationRepair) throw new GenerationError("invalid_stage");
      animationRepairSchema.parse(current.animationRepair);
      return run(tx, current, state, now);
    });
  }
  function requireAttempt(current: GenerationJob, name: ContinuationState, token: string) {
    const attempt = latestAnimationAttempt(current, name);
    if (!getRepairScope(current).includes(name) || !attempt || attempt.token !== token) throw new GenerationError("invalid_stage");
    return attempt;
  }
  function replace(current: GenerationJob, attempt: AnimationAttempt): GenerationJob {
    if (!current.animationRepair) throw new GenerationError("invalid_stage");
    return {...current, animationRepair: {...current.animationRepair, attempts: current.animationRepair.attempts.map(a => a.token === attempt.token ? attempt : a)}};
  }
  async function save(tx: GenerationTransaction, job: GenerationJob, state: Scheduler) {
    animationRepairSchema.parse(job.animationRepair);
    await tx.putJob(job);
    if (state.active) state.active.inflight = hasUnsettledAnimationAttempt(job) || job.stages.some(s => s.name === "base" && s.status === "inflight");
    await saveScheduler(tx, state);
    return job;
  }
  async function authorize(tx: GenerationTransaction, current: GenerationJob, ordinal: number, now: number) {
    if (!options.enabled() || (ordinal > 1 && !options.automaticAnimationRepair())) throw new GenerationError("generation_disabled");
    if (current.animationRepair?.phase === "stopped") throw new GenerationError("invalid_stage");
    if (current.reviewBase && current.baseConfirmedAt === undefined) throw new GenerationError("base_not_ready");
    await checkStageBudget(tx, current.id, now, options.budgetUsd());
  }
  return {
    async reserveAnimationAttempt(job: GenerationJob, name: ContinuationState, reason: "initial" | "transport" | "quality" | "moderation", sourceSha256?: string) {
      const token = randomUUID();
      return withJob(job, async (tx, current, state, now) => {
        if (state.pauseReason) throw new GenerationError("generation_paused");
        if (!getRepairScope(current).includes(name)) throw new GenerationError("invalid_stage");
        const repair = current.animationRepair!;
        const last = latestAnimationAttempt(current, name);
        if (last?.status === "reserved") {
          if (last.reason !== reason || (sourceSha256 !== undefined && last.sourceSha256 !== sourceSha256)) throw new GenerationError("invalid_stage");
          return {job: current, attempt: last};
        }
        if (reason === "initial" || !last || last.ordinal >= 4) throw new GenerationError("invalid_stage");
        if ((reason === "transport" || reason === "moderation") && (last.status !== "failed" || !last.failure || animationFailureRetryReason(last.failure) !== reason)) throw new GenerationError("invalid_stage");
        if (reason === "quality" && (repair.phase !== "repairing" || !repair.pending.includes(name) || last.status !== "saved" || !last.usage || !last.resultSha256)) throw new GenerationError("invalid_stage");
        const priorHash = reason === "quality" ? last.resultSha256 : last.sourceSha256;
        if (sourceSha256 !== undefined && sourceSha256 !== priorHash) throw new GenerationError("stage_conflict");
        await authorize(tx, current, last.ordinal + 1, now);
        const attempt: AnimationAttempt = {state: name, ordinal: last.ordinal + 1, token, reason, status: "reserved", reservedAt: now, notBefore: now + 5000, ...(priorHash ? {sourceSha256: priorHash} : {})};
        const updated = await save(tx, {...current, animationRepair: {...repair, attempts: [...repair.attempts, attempt]}}, state);
        return {job: updated, attempt};
      });
    },
    async startAnimationAttempt(job: GenerationJob, name: ContinuationState, token: string) {
      return withJob(job, async (tx, current, state, now) => {
        const attempt = requireAttempt(current, name, token);
        if (state.pauseReason) throw new GenerationError("generation_paused");
        if (attempt.status !== "reserved" || attempt.notBefore > now) throw new GenerationError("invalid_stage");
        const stage = current.stages.find(stage => stage.name === name);
        if (!stage || (attempt.sourceSha256
          ? stage.status !== "completed" || stage.sha256 !== attempt.sourceSha256 || !current.animationRepair!.pending.includes(name)
          : stage.status !== "inflight")) throw new GenerationError("invalid_stage");
        await authorize(tx, current, attempt.ordinal, now);
        if (attempt.sourceSha256) {
          const bytes = await tx.getArtifact(current.id, `stage-${name}.png`, now);
          if (!bytes || hash(bytes) !== attempt.sourceSha256) throw new GenerationError("saved_stage_unavailable");
        }
        const decisionTime = options.now();
        await requireJobWithActiveWorkerLease(tx, state, job, decisionTime);
        if (!options.enabled() || (attempt.ordinal > 1 && !options.automaticAnimationRepair())) throw new GenerationError("generation_disabled");
        if (moscowDay(decisionTime) !== moscowDay(now)) await checkStageBudget(tx, current.id, decisionTime, options.budgetUsd());
        return save(tx, replace(current, {...attempt, status: "started", startedAt: decisionTime}), state);
      });
    },
    async saveAnimationAttempt(job: GenerationJob, name: ContinuationState, token: string, bytes: Buffer, metadata: {usage?: ImageUsage; generationMs: number}) {
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new GenerationError("invalid_provider_result");
      const sha256 = hash(bytes);
      return withJob(job, async (tx, current, state, now) => {
        const attempt = requireAttempt(current, name, token);
        if (attempt.status === "saved") {
          if (attempt.resultSha256 !== sha256) throw new GenerationError("stage_conflict");
          return current;
        }
        if (attempt.status !== "started") throw new GenerationError("invalid_stage");
        const index = current.stages.findIndex(s => s.name === name);
        if (index < 0 || (attempt.sourceSha256 && current.stages[index].sha256 !== attempt.sourceSha256)) throw new GenerationError("stage_conflict");
        await tx.putArtifact(current.id, `stage-${name}.png`, bytes, current.expiresAt);
        await recordStageCost(tx, current.id, now, metadata.usage, name);
        const result = {usage: metadata.usage, generationMs: metadata.generationMs};
        const updated = replace(current, {...attempt, status: "saved", finishedAt: now, resultSha256: sha256, ...result});
        updated.animationRepair!.pending = updated.animationRepair!.pending.filter(state => state !== name);
        const stages = [...current.stages];
        stages[index] = {...stages[index], ...result, status: "completed", sha256};
        return save(tx, {...updated, stages}, state);
      });
    },
    async failAnimationAttempt(job: GenerationJob, name: ContinuationState, token: string, error: GenerationError) {
      return withJob(job, async (tx, current, state, now) => {
        const attempt = requireAttempt(current, name, token);
        if (["failed", "unknown"].includes(attempt.status)) return current;
        if (attempt.status !== "started") throw new GenerationError("invalid_stage");
        const code = ANIMATION_ATTEMPT_FAILURE_CODES.find(code => code === error.code) ?? "outcome_unknown";
        const retryReason = animationFailureRetryReason(error);
        const unknown = code === "outcome_unknown" && retryReason !== "transport";
        // A filtered output may have consumed provider work without returning usage.
        await recordStageCost(tx, current.id, now, code === "outcome_unknown" || retryReason === "moderation" ? undefined : {costUsd: 0}, name);
        const failure = {code, ...(error.diagnostic ? {diagnostic: error.diagnostic} : {}), ...(error.cliCause ? {cliCause: error.cliCause} : {}), ...(error.providerFailure ? {providerFailure: error.providerFailure} : {})};
        return save(tx, replace(current, {...attempt, status: unknown ? "unknown" : "failed", finishedAt: now, failure}), state);
      });
    },
    async planAnimationRepair(job: GenerationJob, input: readonly AssemblyIssue[]) {
      const issues = assemblyIssuesSchema.parse(input);
      return withJob(job, async (tx, current, state, now) => {
        let states = selectRepairStates(current, issues);
        if (hasUnsettledAnimationAttempt(current)) states = null;
        if (states) for (const name of states) {
          const bytes = await tx.getArtifact(current.id, `stage-${name}.png`, now);
          if (!bytes || hash(bytes) !== current.stages.find(s => s.name === name)?.sha256) throw new GenerationError("saved_stage_unavailable");
        }
        const updated = {...current, assemblyIssues: issues, animationRepair: {...current.animationRepair!, phase: states ? "repairing" as const : "stopped" as const, pending: states ?? [], issues}};
        return {job: await save(tx, updated, state), states};
      });
    },
    async completeAnimationRepair(job: GenerationJob) {
      return withJob(job, async (tx, current, state) => {
        if (hasUnsettledAnimationAttempt(current) || getRepairScope(current).some(name =>
          latestAnimationAttempt(current, name)?.status !== "saved" || current.stages.find(s => s.name === name)?.status !== "completed")) throw new GenerationError("invalid_stage");
        return save(tx, {...current, assemblyIssues: undefined, animationRepair: {...current.animationRepair!, phase: "complete", pending: [], issues: []}}, state);
      });
    },
    async verifyAnimationRepair(job: GenerationJob) {
      return withJob(job, async (tx, current, state) => {
        if (hasUnsettledAnimationAttempt(current) || current.animationRepair!.attempts.some(a => a.status === "reserved")) throw new GenerationError("invalid_stage");
        return save(tx, {...current, animationRepair: {...current.animationRepair!, phase: "verifying"}}, state);
      });
    },
  };
}

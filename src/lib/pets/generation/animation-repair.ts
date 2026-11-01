import {CONTINUATION_STATES, type AssemblyIssue, type ContinuationState} from "@/lib/pets/generation/continuation-model";
import {generationStageNames, type AnimationRepairState, type AnimationAttempt, type GenerationJob} from "@/lib/pets/generation/model";
import type {AnimationRepairProgress} from "@/lib/pets/generation/animation-repair-progress";
import {isRetryableImageCause, type CliCause} from "@/lib/pets/generation/cli-cause";
import {isOutputModerationFailure, type ProviderFailure} from "@/lib/pets/generation/provider-failure";

export function animationFailureRetryReason(failure: {code: string; cliCause?: CliCause; providerFailure?: ProviderFailure}): "transport" | "moderation" | undefined {
  if (failure.code === "outcome_unknown" && isRetryableImageCause(failure.cliCause)) return "transport";
  if (failure.code === "provider_rejected" && isOutputModerationFailure(failure.providerFailure)) return "moderation";
  return undefined;
}

export function reserveInitialAnimationAttempts(job: GenerationJob, names: readonly string[], now: number, token: () => string): GenerationJob {
  if (!job.animationRepair) return job;
  const attempts = names.filter(isAnimationState).map(state => ({state, ordinal: 1, token: token(), reason: "initial" as const,
    status: "reserved" as const, reservedAt: now, notBefore: now}));
  return {...job, animationRepair: {...job.animationRepair, attempts: [...job.animationRepair.attempts, ...attempts]}};
}

export const initialAnimationRepair = (maxAttempts?: number): AnimationRepairState => ({policy: maxAttempts === undefined ? 1 : 2, maxAttempts: maxAttempts ?? 4, phase: "initial", pending: [], issues: [], attempts: []});
export function isAnimationState(name: string): name is ContinuationState {
  return CONTINUATION_STATES.some(state => state === name);
}
export function getRepairScope(job: GenerationJob): readonly ContinuationState[] {
  if (job.continuation?.mode === "rebuild") return [];
  return generationStageNames(job).filter(isAnimationState);
}
export function latestAnimationAttempt(job: GenerationJob, state: ContinuationState): AnimationAttempt | undefined {
  return job.animationRepair?.attempts.filter(a => a.state === state).at(-1);
}
export function hasUnsettledAnimationAttempt(job: GenerationJob): boolean {
  return job.animationRepair?.attempts.some(a => a.status === "started" || a.status === "unknown") ?? false;
}
export function canResumeAnimationRepair(job: GenerationJob): boolean {
  return Boolean(job.animationRepair && job.animationRepair.phase !== "stopped" && !hasUnsettledAnimationAttempt(job) &&
    job.stages.filter(s => s.status === "inflight").every(s => isAnimationState(s.name) &&
      ["reserved", "failed"].includes(latestAnimationAttempt(job, s.name)?.status ?? "")));
}
export function selectRepairStates(job: GenerationJob, issues: readonly AssemblyIssue[]): ContinuationState[] | null {
  if (!job.animationRepair || !issues.length) return null;
  const scope = getRepairScope(job);
  if (issues.some(issue => !scope.includes(issue.state))) return null;
  const states = CONTINUATION_STATES.filter(state => issues.some(issue => issue.state === state));
  for (const state of states) {
    const last = latestAnimationAttempt(job, state);
    const stage = job.stages.find(s => s.name === state);
    if (!last || last.status !== "saved" || !last.usage || last.ordinal >= job.animationRepair.maxAttempts || !stage || stage.status !== "completed" || stage.sha256 !== last.resultSha256) return null;
  }
  return states;
}
export function getAnimationRepairSummary(job: GenerationJob, now: number): AnimationRepairProgress | undefined {
  const repair = job.animationRepair;
  if (!repair || job.continuation?.mode === "rebuild") return undefined;
  const waiting = repair.attempts.filter(a => a.ordinal > 1 && a.status === "reserved" && a.notBefore > now);
  return {maxAttempts: repair.maxAttempts, phase: job.status === "failed" && repair.phase !== "complete" ? "stopped" : repair.phase,
    rows: getRepairScope(job).map(state => {
      const last = latestAnimationAttempt(job, state);
      return {state, attempts: last?.ordinal ?? 0, retrying: Boolean(job.status === "generating" && repair.phase !== "stopped" && last && last.ordinal > 1 && ["reserved", "started"].includes(last.status))};
    }), ...(waiting.length ? {retryAt: new Date(Math.min(...waiting.map(a => a.notBefore))).toISOString()} : {})};
}

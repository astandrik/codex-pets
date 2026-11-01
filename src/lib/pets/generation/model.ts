import {validBaseRepairSequence} from "@/lib/pets/generation/base-repair";
import {continuationPlanSchema, assemblyIssuesSchema, rebuildHistorySchema, CONTINUATION_STATES, REGENERATION_RETRIES, type AssemblyIssue} from "@/lib/pets/generation/continuation-model";
import {animationStatesSchema, animationCorrectionsSchema} from "@/lib/pets/generation/animation-revision-input";
export {animationRevisionInputSchema} from "@/lib/pets/generation/animation-revision-input";
import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {cardMetadataRecordSchema} from "@/lib/pets/generation/card-metadata";
import { providerFailureSchema, readProviderFailure, type ProviderFailure } from "@/lib/pets/generation/provider-failure";
import {cliCauseSchema,readCliCause,type CliCause,errorDetailsSchema,readErrorDetails,type ErrorDetails} from "@/lib/pets/generation/cli-cause";
import { failureDiagnosticSchema, readFailureDiagnostic, type FailureDiagnostic } from "@/lib/pets/generation/failure-diagnostic";
import {retryInputMetadataSchema} from "@/lib/pets/generation/base-retry-model";

export const DAY = 86_400_000;
export const WAIT_MS = 30 * 60_000;
export const LEASE_MS = 10 * 60_000;
export const GENERATION_MODEL = "gpt-image-2.5-sunburst";
export const PROMPT_REVISION = "pet-v2-rows-20261010-1";
export const STAGE_NAMES = ["base", "idle", "running", "running-left", "running-right", "waving", "jumping", "waiting", "failed", "review", "look-0-157", "look-180-337"] as const;
export type StageName = typeof STAGE_NAMES[number];
export const MAX_PARALLEL_IMAGE_ROWS = 11;
export const HEARTBEAT_MS = 30_000;
export const GENERATION_ID = /^[a-f0-9]{64}$/;
export const generationInputSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  displayName: z.string().trim().min(1).max(80).optional(),
  requestId: z.uuid(),
}).strict();
export function normalizeGenerationText(value: string) {
  return value.replace(/\r\n?/g, "\n");
}
export const generationConfirmationSchema = z.object({
  animationPrompt: z.string().transform(value => normalizeGenerationText(value).trim()).pipe(z.string().max(2000)).optional(),
}).strict();
export const browserGenerationInputSchema = generationInputSchema.extend({prompt: z.string().trim().max(2000).default("")});
export const referenceImageSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().min(1).max(1024),
  height: z.number().int().min(1).max(1024),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
  normalizationVersion: z.literal(1),
}).strict();
export type GenerationReference = {metadata: z.infer<typeof referenceImageSchema>; bytes: Buffer};
export type GenerationInput = z.infer<typeof generationInputSchema>;

export const usageSchema = z.object({
  textInputTokens: z.number().int().nonnegative(),
  imageInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type ImageUsage = z.infer<typeof usageSchema>;
export const ANIMATION_ATTEMPT_FAILURE_CODES = ["outcome_unknown", "provider_rejected", "provider_rate_limited", "invalid_sprite_extraction", "invalid_stage", "missing_animation_frame"] as const;
export const animationAttemptSchema = z.object({
  state: z.enum(CONTINUATION_STATES), ordinal: z.number().int().min(1).max(REGENERATION_RETRIES.max + 1), token: z.uuid(),
  reason: z.enum(["initial", "transport", "quality", "moderation"]),
  status: z.enum(["reserved", "started", "saved", "failed", "unknown"]),
  reservedAt: z.number().finite(), notBefore: z.number().finite(),
  startedAt: z.number().finite().optional(), finishedAt: z.number().finite().optional(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  resultSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  usage: usageSchema.optional(), generationMs: z.number().finite().nonnegative().optional(),
  failure: z.object({code: z.enum(ANIMATION_ATTEMPT_FAILURE_CODES), diagnostic: failureDiagnosticSchema.optional(), cliCause: cliCauseSchema.optional(), providerFailure: providerFailureSchema.optional()}).strict().optional(),
}).strict().refine(a => a.notBefore >= a.reservedAt &&
  (a.ordinal === 1 ? a.reason === "initial" : a.reason !== "initial") &&
  (a.reason !== "quality" || a.sourceSha256 !== undefined) &&
  (a.status === "reserved" ? a.startedAt === undefined && a.finishedAt === undefined : a.startedAt !== undefined) &&
  (a.startedAt === undefined || a.startedAt >= a.notBefore) &&
  (a.status !== "saved" || (a.finishedAt !== undefined && a.resultSha256 !== undefined && a.generationMs !== undefined)) &&
  (!["failed", "unknown"].includes(a.status) || (a.finishedAt !== undefined && a.failure !== undefined)) &&
  (a.finishedAt === undefined || (a.startedAt !== undefined && a.finishedAt >= a.startedAt)), "Invalid attempt transition");
export type AnimationAttempt = z.infer<typeof animationAttemptSchema>;
export const animationRepairSchema = z.object({
  policy: z.union([z.literal(1), z.literal(2)]), maxAttempts: z.number().int().min(1).max(REGENERATION_RETRIES.max + 1),
  phase: z.enum(["initial", "repairing", "verifying", "complete", "stopped"]),
  pending: z.array(z.enum(CONTINUATION_STATES)).max(11), issues: assemblyIssuesSchema,
  attempts: z.array(animationAttemptSchema).max(CONTINUATION_STATES.length * (REGENERATION_RETRIES.max + 1)),
}).strict().refine(repair => {
  if (repair.policy === 1 && repair.maxAttempts !== 4) return false;
  if (new Set(repair.pending).size !== repair.pending.length || new Set(repair.attempts.map(a => a.token)).size !== repair.attempts.length) return false;
  if (repair.phase === "complete" && repair.pending.length) return false;
  return CONTINUATION_STATES.every(state => {
    const attempts = repair.attempts.filter(a => a.state === state);
    return attempts.length <= repair.maxAttempts && (repair.phase !== "complete" || !attempts.length || attempts.at(-1)?.status === "saved") && attempts.every((a, index) => a.ordinal === index + 1 && (index === attempts.length - 1 || ["saved", "failed"].includes(a.status)));
  });
}, "Invalid attempt sequence");
export type AnimationRepairState = z.infer<typeof animationRepairSchema>;
export const baseAttemptSchema = z.object({
  ordinal: z.number().int().min(1).max(51), token: z.uuid(),
  reason: z.enum(["initial", "transport", "moderation", "rate_limit"]),
  status: z.enum(["reserved", "started", "saved", "failed", "unknown"]),
  reservedAt: z.number().finite(), notBefore: z.number().finite(),
  startedAt: z.number().finite().optional(), finishedAt: z.number().finite().optional(),
  resultSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  usage: usageSchema.optional(), generationMs: z.number().finite().nonnegative().optional(),
  failure: z.object({code:z.enum(ANIMATION_ATTEMPT_FAILURE_CODES),retryAt:z.iso.datetime().optional(),diagnostic:failureDiagnosticSchema.optional(),cliCause:cliCauseSchema.optional(),providerFailure:providerFailureSchema.optional()}).strict().optional(),
}).strict().refine(a => a.notBefore >= a.reservedAt &&
  (a.ordinal === 1 ? a.reason === "initial" : a.reason !== "initial") &&
  (a.status === "reserved" ? a.startedAt === undefined && a.finishedAt === undefined : a.startedAt !== undefined) &&
  (a.startedAt === undefined || a.startedAt >= a.notBefore) &&
  (a.status !== "saved" || (a.finishedAt !== undefined && a.resultSha256 !== undefined && a.generationMs !== undefined)) &&
  (!["failed", "unknown"].includes(a.status) || (a.finishedAt !== undefined && a.failure !== undefined)) &&
  (a.finishedAt === undefined || (a.startedAt !== undefined && a.finishedAt >= a.startedAt)) &&
  (a.status === "saved" || a.resultSha256 === undefined) &&
  (a.usage === undefined || a.status === "saved" || (a.status === "failed" && a.failure?.code === "provider_rate_limited" && a.failure.providerFailure?.httpStatus === 429 && Object.values(a.usage).every(value=>value===0))) &&
  (["failed","unknown"].includes(a.status) || a.failure === undefined), "Invalid base attempt transition");
export type BaseAttempt = z.infer<typeof baseAttemptSchema>;
export const baseRepairSchema = z.object({
  policy:z.literal(1), maxAttempts:z.number().int().min(1).max(51), phase:z.enum(["active","complete","stopped"]),
  attempts:z.array(baseAttemptSchema).max(51),
}).strict().refine(validBaseRepairSequence, "Invalid base attempt sequence");
export type BaseRepairState = {policy:1;maxAttempts:number;phase:"active"|"complete"|"stopped";attempts:BaseAttempt[]};
export const stageSchema = z.object({
  name: z.enum(STAGE_NAMES), status: z.enum(["inflight", "completed"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), usage: usageSchema.optional(),
  generationMs: z.number().nonnegative().optional(), startedAt: z.number(),
});
export const submissionSchema = z.object({ petId: z.string(), slug: z.string(), submittedAt: z.iso.datetime() });
export const stageFailureDiagnosticSchema = z.object({stage:z.enum(STAGE_NAMES),diagnostic:failureDiagnosticSchema}).strict();
export const stageCliCauseSchema=z.object({stage:z.enum(STAGE_NAMES),cause:cliCauseSchema}).strict();
export const rowAttemptLogSchema=z.object({stage:z.enum(STAGE_NAMES),attempt:z.union([z.literal(1),z.literal(2)]),at:z.number(),code:z.enum(["outcome_unknown","provider_rejected","provider_rate_limited","invalid_sprite_extraction","invalid_stage","missing_animation_frame"]),diagnostic:failureDiagnosticSchema.optional(),cliCause:cliCauseSchema.optional(),details:errorDetailsSchema.optional()}).strict();
export type RowAttemptLog=z.infer<typeof rowAttemptLogSchema>;
export const rowRetrySchema=z.object({stage:z.enum(STAGE_NAMES),token:z.uuid(),notBefore:z.number(),state:z.enum(["waiting","started","completed"])}).strict();
export const ROW_RETRY_DELAY_MS=5000;
export type StageCliCause=z.infer<typeof stageCliCauseSchema>;
export type StageFailureDiagnostic=z.infer<typeof stageFailureDiagnosticSchema>;
export type GenerationSubmission = z.infer<typeof submissionSchema>;
export const animationRevisionSchema = z.object({
  policy: z.literal(1), sourceGenerationId: z.string().regex(GENERATION_ID),
  sourceMetadataRevision: z.number().int().nonnegative(), selectedStates: animationStatesSchema,
  baseSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceAtlasSha256: z.string().regex(/^[a-f0-9]{64}$/),
  corrections: animationCorrectionsSchema, acceptedAt: z.number().optional(),
}).strict();
export const jobSchema = z.object({
  id: z.string().regex(GENERATION_ID),
  prompt: z.string(),
  displayName: z.string(),
  nameSource: z.enum(["user", "automatic"]).optional(),
  status: z.enum(["queued", "generating", "awaiting_confirmation", "processing", "completed", "failed"]),
  reviewBase: z.boolean().optional(),
  baseConfirmedAt: z.number().optional(),
  queuedAt: z.number().optional(),
  reference: referenceImageSchema.optional(),
  retryInput: retryInputMetadataSchema.optional(),
  baseRetrySourceId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
  worker: z.string().default(""),
  leaseUntil: z.number().optional(),
  error: z.string().optional(),
  providerFailure: providerFailureSchema.optional(),
  failureDiagnostic: failureDiagnosticSchema.optional(),
  stageFailureDiagnostics: z.array(stageFailureDiagnosticSchema).max(12).optional(),
  rowAttemptLogs:z.array(rowAttemptLogSchema).max(24).optional(),
  rowRetries:z.array(rowRetrySchema).max(12).optional(),
  animationRepair: animationRepairSchema.optional(),
  baseRepair: baseRepairSchema.optional(),
  cliFailureCauses:z.array(stageCliCauseSchema).max(12).optional(),
  usage: usageSchema.optional(),
  providerRequestId: z.string().optional(),
  generationMs: z.number().optional(),
  animationPrompt: z.string().min(1).max(2000).optional(),
  animationAnatomyPolicy: z.literal(1).optional(),
  animationRevision: animationRevisionSchema.optional(),
  continuation: continuationPlanSchema.optional(),
  assemblyIssues: assemblyIssuesSchema.optional(),
  rebuildHistory: rebuildHistorySchema.optional(),
  promptRevision: z.string(),
  pipelineVersion: z.number().int().default(1),
  stages: z.array(stageSchema).default([]),
  submission: submissionSchema.optional(),
  cardMetadata: cardMetadataRecordSchema.optional(),
}).refine(job => job.pipelineVersion === 4
  ? Boolean(job.continuation && job.reviewBase && job.baseConfirmedAt !== undefined && !job.reference && !job.animationRevision)
  : job.pipelineVersion === 3
  ? Boolean(job.animationRevision && job.animationAnatomyPolicy === 1 && job.reviewBase && job.baseConfirmedAt !== undefined && !job.reference)
  : job.animationRevision === undefined, "Invalid animation revision policy")
  // Free rebuilds retain the completed audit; no active base policy crosses into a continuation.
  .refine(job => !job.baseRepair || (job.pipelineVersion === 2 && job.reviewBase === true && Boolean(job.baseRetrySourceId) && !job.animationRevision && (!job.continuation || (job.continuation.mode==="rebuild" && job.baseRepair.phase==="complete")) && !job.rowAttemptLogs?.some(log=>log.stage==="base") && !job.rowRetries?.some(retry=>retry.stage==="base")), "Invalid base repair scope")
  .refine(job => !job.baseRepair || (!job.baseRepair.attempts.length ? job.stages.length===0 : job.baseRepair.attempts.at(-1)?.status==="saved"
    ? job.stages[0]?.name==="base" && job.stages[0].status==="completed" && job.stages[0].sha256===job.baseRepair.attempts.at(-1)?.resultSha256
    : job.stages.length===1 && job.stages[0].name==="base" && job.stages[0].status==="inflight"), "Invalid base repair checkpoint")
  .refine(job => !job.animationRepair || (job.pipelineVersion >= 2 && job.pipelineVersion <= 4 &&
    [...job.animationRepair.pending, ...job.animationRepair.attempts.map(a => a.state)].every(state =>
      (job.continuation?.mode === "rebuild" ? CONTINUATION_STATES : job.continuation?.generationStages ?? job.animationRevision?.selectedStates ?? CONTINUATION_STATES).includes(state))), "Invalid animation repair scope");
export type GenerationJob = z.infer<typeof jobSchema>;
// Read-only timeout projection; expireQueue persists the transition in a transaction.
export function withQueueTimeout(job: GenerationJob, now: number): GenerationJob {
  return job.status === "queued" && (job.queuedAt ?? job.createdAt) + WAIT_MS <= now
    ? {...job, status: "failed", error: "queue_timeout", prompt: ""}
    : job;
}
export function requiredStageNames(job: GenerationJob): readonly StageName[] {
  if (job.continuation) return continuationPlanSchema.parse(job.continuation).compositionStages;
  if (job.pipelineVersion === 3) {
    if (!job.animationRevision) throw new GenerationError("invalid_stage");
    return job.animationRevision.selectedStates;
  }
  return STAGE_NAMES;
}
export function usesStageCheckpoints(job: GenerationJob) {
  return job.pipelineVersion === 2 || job.pipelineVersion === 3 || job.pipelineVersion === 4;
}
export function generationStageNames(job: GenerationJob): readonly StageName[] {
  return job.continuation ? continuationPlanSchema.parse(job.continuation).generationStages : requiredStageNames(job);
}
export function isUnacceptedAnimationRevision(job: GenerationJob) {
  return Boolean(job.animationRevision && job.animationRevision.acceptedAt === undefined);
}
export function generationAnimationRevisionsEnabled() {
  return process.env.PET_GENERATION_ANIMATION_REVISIONS_ENABLED === "true";
}
export function generationAnimationAutoRepairEnabled() {
  return process.env.PET_GENERATION_ANIMATION_AUTO_REPAIR_ENABLED === "true";
}
export function generationBaseRetryEnabled() {
  return process.env.PET_GENERATION_BASE_RETRY_ENABLED === "true";
}
export const schedulerSchema = z.object({
  revision: z.number().int(),
  queue: z.array(z.string()),
  pauseReason: z.string().optional(),
  active: z.object({ id: z.string(), owner: z.string(), until: z.number(), inflight: z.boolean().optional() }).nullable(),
});
export type Scheduler = z.infer<typeof schedulerSchema>;
export const dedupSchema = z.object({ hash: z.string(), id: z.string(), expiresAt: z.number(), nameProvided: z.boolean().optional() });

export class GenerationError extends Error {
  readonly providerFailure?: ProviderFailure;
  readonly diagnostic?: FailureDiagnostic;
  readonly cliCause?:CliCause;
  readonly details?:ErrorDetails;
  readonly assemblyIssues?: AssemblyIssue[];
  constructor(public readonly code: string, public readonly retryAt?: string, providerFailure?: unknown, public readonly limitScope?: "ip" | "global", diagnostic?:unknown,cliCause?:unknown,details?:unknown,assemblyIssues?:unknown) {
    super(code);
    const issues=assemblyIssuesSchema.safeParse(assemblyIssues);
    this.assemblyIssues=issues.success?issues.data:undefined;
    this.name = "GenerationError";
    this.providerFailure = readProviderFailure(providerFailure);
    this.diagnostic = readFailureDiagnostic(diagnostic);
    this.cliCause = readCliCause(cliCause);
    this.details=readErrorDetails(details);
  }
}

export function generationEnabled() {
  const file = process.env.PET_GENERATION_ENABLE_FILE?.trim();
  if (file) { try { return readFileSync(file, "utf8").trim() === "true"; } catch { return false; } }
  return process.env.PET_GENERATION_ENABLED === "true";
}

export function generationAnimationHintsEnabled() {
  return process.env.PET_GENERATION_ANIMATION_HINTS_ENABLED === "true";
}

export function generationReviewFlowEnabled() {
  return process.env.PET_GENERATION_REVIEW_FLOW_ENABLED === "true";
}

export function readGenerationSecret() {
  const file = process.env.PET_GENERATION_SECRET_FILE?.trim();
  const value = file ? readFileSync(file, "utf8").trim() : process.env.PET_GENERATION_SECRET?.trim();
  if (!value || value.length < 32) throw new GenerationError("generation_not_configured");
  return value;
}

export function readGenerationClientIp(headers: Pick<Headers, "get">): string | null {
  // Only origin nginx may set this header; application ports stay on loopback.
  const ip = headers.get("x-pets-client-ip")?.trim();
  return ip && isIP(ip) ? ip : null;
}

export function generationDigest(secret: string, domain: string, value: string) {
  return createHmac("sha256", secret).update(domain + "\0" + value).digest("hex");
}

export function moscowDay(now: number) {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function nextMoscowDay(now: number) {
  return new Date(Date.parse(moscowDay(now) + "T00:00:00+03:00") + DAY).toISOString();
}

export function newGenerationId() {
  return randomBytes(32).toString("hex");
}

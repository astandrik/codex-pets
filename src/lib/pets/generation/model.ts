import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {cardMetadataRecordSchema} from "@/lib/pets/generation/card-metadata";
import { providerFailureSchema, readProviderFailure, type ProviderFailure } from "@/lib/pets/generation/provider-failure";
import {cliCauseSchema,readCliCause,type CliCause,errorDetailsSchema,readErrorDetails,type ErrorDetails} from "@/lib/pets/generation/cli-cause";
import { failureDiagnosticSchema, readFailureDiagnostic, type FailureDiagnostic } from "@/lib/pets/generation/failure-diagnostic";

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
  cliFailureCauses:z.array(stageCliCauseSchema).max(12).optional(),
  usage: usageSchema.optional(),
  providerRequestId: z.string().optional(),
  generationMs: z.number().optional(),
  animationPrompt: z.string().min(1).max(2000).optional(),
  promptRevision: z.string(),
  pipelineVersion: z.number().int().default(1),
  stages: z.array(stageSchema).default([]),
  submission: submissionSchema.optional(),
  cardMetadata: cardMetadataRecordSchema.optional(),
});
export type GenerationJob = z.infer<typeof jobSchema>;
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
  constructor(public readonly code: string, public readonly retryAt?: string, providerFailure?: unknown, public readonly limitScope?: "ip" | "global", diagnostic?:unknown,cliCause?:unknown,details?:unknown) {
    super(code);
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

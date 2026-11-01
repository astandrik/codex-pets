import {z} from "zod";
import type {GenerationJob} from "@/lib/pets/generation/model";

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const retryInputMetadataSchema = z.object({policy:z.literal(1),sha256:digestSchema}).strict();
export const storedGenerationInputSchema = z.object({
  version:z.literal(1), prompt:z.string().max(2000), displayName:z.string().min(1).max(80).optional(),
  reference:z.object({sha256:digestSchema,sourceSha256:digestSchema}).strict().optional(),
}).strict().refine(input => Boolean(input.prompt.trim() || input.reference), "Missing generation input");
export type StoredGenerationInput = z.infer<typeof storedGenerationInputSchema>;

const request = {requestId:z.uuid(),sourceRevision:digestSchema};
export const baseRetryInputSchema = z.discriminatedUnion("mode",[
  z.object({...request,mode:z.literal("saved")}).strict(),
  z.object({...request,mode:z.literal("legacy-image-only")}).strict(),
  z.object({...request,mode:z.literal("legacy-text"),prompt:z.string().transform(v=>v.replace(/\r\n?/g,"\n").trim()).pipe(z.string().min(1).max(2000))}).strict(),
]);
export type BaseRetryInput = z.infer<typeof baseRetryInputSchema>;
export type BaseRetryMode = BaseRetryInput["mode"];
export const retryGenerationSchema = z.object({generationId:digestSchema,status:z.enum(["queued","generating","awaiting_confirmation","processing","completed","failed"]),expiresAt:z.iso.datetime(),previewUrl:z.string()});
export const baseRetryReplySchema = z.object({requestId:z.uuid(),sourceGenerationId:digestSchema,reused:z.boolean(),generation:retryGenerationSchema});
export type BaseRetryReply = z.infer<typeof baseRetryReplySchema>;
export const baseRetryOptionsSchema = z.union([
  z.object({existingGeneration:retryGenerationSchema}),
  z.object({sourceRevision:digestSchema,sourceExpiresAt:z.iso.datetime(),inputState:z.enum(["saved","legacy"]),prompt:z.string().max(2000).optional(),displayName:z.string().max(80).optional(),referenceUrl:z.string().optional(),availableModes:z.array(z.enum(["saved","legacy-image-only","legacy-text"])),blockedReason:z.string().optional()}),
]);
export type BaseRetryOptions = z.infer<typeof baseRetryOptionsSchema>;

export function baseRetryEligibility(job: GenerationJob): boolean {
  if (job.status!=="failed" || job.pipelineVersion!==2 || !job.reviewBase || job.baseConfirmedAt!==undefined || job.continuation || job.animationRevision || job.stages.some(s=>s.name==="base"&&s.status==="completed")) return false;
  if (job.error==="queue_timeout") return job.stages.length===0 && !job.rowAttemptLogs?.length && !job.rowRetries?.length;
  if(job.stages.length!==1 || job.stages[0].name!=="base" || job.stages[0].status!=="inflight" || job.animationRepair?.attempts.length || job.animationRepair?.pending.length)return false;
  const logs=job.rowAttemptLogs??[];
  if(logs.some(log=>log.stage!=="base") || new Set(logs.map(log=>log.attempt)).size!==logs.length || (job.retryInput && !logs.length))return false;
  const last=logs.find(log=>log.attempt===2)??logs.find(log=>log.attempt===1);
  if(last && (last.code!==job.error || (last.diagnostic && last.diagnostic.boundary!=="provider_cli")))return false;
  if(job.rowRetries?.some(retry=>retry.stage!=="base" || retry.state!=="started" || last?.attempt!==2))return false;
  const failure=job.providerFailure;
  if(last?.cliCause && (last.cliCause.kind!=="http_error" || last.cliCause.httpStatus!==failure?.httpStatus))return false;
  if(job.cliFailureCauses?.some(entry=>entry.stage!=="base" || entry.cause.kind!=="http_error" || entry.cause.httpStatus!==failure?.httpStatus))return false;
  return (job.error==="provider_rejected" && failure?.httpStatus===400 && failure.code==="moderation_blocked" && failure.moderationStage==="output") ||
    (job.error==="provider_rate_limited" && failure?.httpStatus===429);
}

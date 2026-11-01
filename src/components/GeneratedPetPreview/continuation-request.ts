import { z } from "zod";
import { continuationInputSchema, continuationMaxRetriesSchema, assemblyIssuesSchema, CONTINUATION_STATES, REGENERATION_RETRIES, type ContinuationInput } from "@/lib/pets/generation/continuation-model";
const id = z.string().regex(/^[a-f0-9]{64}$/);
export const CONTINUATION_PENDING = "pets-continuation-v1:";
export const CONTINUATION_PAYLOAD = "pets-continuation-payload-v1:";
export function parseMaxRetriesInput(value: string, max: number = REGENERATION_RETRIES.max): number | null {
    if (!value.trim()) return null;
    const parsed = continuationMaxRetriesSchema.safeParse(Number(value));
    return parsed.success && parsed.data <= max ? parsed.data : null;
}
const savedInputSchema = z.object({requestId: z.uuid(), input: continuationInputSchema}).strict()
    .refine(value => value.requestId === value.input.requestId);
const payloadKey = (sourceId: string, requestId: string) => CONTINUATION_PAYLOAD + sourceId + ":" + requestId;
function parseSavedInput(raw: string | null, requestId: string): ContinuationInput | null {
    try {
        if (!raw || new TextEncoder().encode(raw).length > 4096) return null;
        const parsed = savedInputSchema.safeParse(JSON.parse(raw));
        return parsed.success && parsed.data.requestId === requestId ? parsed.data.input : null;
    } catch { return null; }
}
export function readContinuationInput(storage: Pick<Storage, "getItem">, sourceId: string, requestId: string): ContinuationInput | null {
    try {
        const raw = storage.getItem(payloadKey(sourceId, requestId)) ?? storage.getItem(CONTINUATION_PAYLOAD + sourceId);
        return parseSavedInput(raw, requestId);
    } catch { return null; }
}
export function rememberContinuationInput(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, sourceId: string, input: ContinuationInput) {
    const saved = savedInputSchema.parse({requestId: input.requestId, input});
    const raw = JSON.stringify(saved);
    if (new TextEncoder().encode(raw).length > 4096) throw Error("Continuation input is too large");
    const key = payloadKey(sourceId, input.requestId), previous = storage.getItem(key);
    storage.setItem(key, raw);
    try {
        rememberContinuation(storage, sourceId, input.requestId);
    } catch (error) {
        try {
            if (previous !== raw && storage.getItem(key) === raw) {
                if (previous === null) storage.removeItem(key);
                else storage.setItem(key, previous);
            }
        } catch { /* A failed rollback must still prevent sending the request. */ }
        throw error;
    }
}
export function readContinuationId(storage: Pick<Storage, "getItem">, sourceId: string): string | null {
    try {
        const raw = storage.getItem(CONTINUATION_PENDING + sourceId);
        if (!raw || raw.length > 100)
            return null;
        const p = z.object({ requestId: z.uuid() }).strict().safeParse(JSON.parse(raw));
        return p.success ? p.data.requestId : null;
    }
    catch {
        return null;
    }
}
export function rememberContinuation(storage: Pick<Storage, "setItem">, sourceId: string, requestId: string) { storage.setItem(CONTINUATION_PENDING + sourceId, JSON.stringify({ requestId })); }
export function clearContinuation(storage: Pick<Storage, "getItem" | "removeItem">, sourceId: string, requestId: string) {
    storage.removeItem(payloadKey(sourceId, requestId));
    if (parseSavedInput(storage.getItem(CONTINUATION_PAYLOAD + sourceId), requestId)) storage.removeItem(CONTINUATION_PAYLOAD + sourceId);
    if (readContinuationId(storage, sourceId) === requestId) storage.removeItem(CONTINUATION_PENDING + sourceId);
}
export const continuationReplySchema = z.object({ operation: z.object({ id: z.uuid(), mode: z.enum(["rebuild", "regenerate"]), state: z.enum(["preparing", "accepted", "rejected"]), generationId: id.optional(), retryAt: z.number().optional() }), input: continuationInputSchema.optional(), generation: z.object({ generationId: id, expiresAt: z.iso.datetime(), status: z.enum(["queued", "generating", "processing", "completed", "failed", "awaiting_confirmation"]) }).optional() });
const previewSchema=z.discriminatedUnion("kind",[z.object({kind:z.literal("source-image"),url:z.string()}),z.object({kind:z.literal("atlas-row"),url:z.string(),row:z.number().int().min(0).max(10),frames:z.number().int().min(1).max(8)})]);
const retryLimitsSchema = z.object({min: z.literal(0), default: z.number().int().min(0).max(REGENERATION_RETRIES.max), max: z.number().int().min(0).max(REGENERATION_RETRIES.max)}).refine(value => value.default <= value.max);
export const continuationOptionsSchema = z.object({ regenerationRetries: retryLimitsSchema.optional(), sourceRevision: id, character:z.object({displayName:z.string().optional(),description:z.string().optional(),baseUrl:z.string(),expiresAt:z.iso.datetime()}).optional(), canRebuild: z.boolean(), canRegenerate: z.boolean(), requiredStates: z.array(z.enum(CONTINUATION_STATES)), strips: z.array(z.object({ state: z.enum(CONTINUATION_STATES), status: z.enum(["saved", "missing", "invalid"]), uncertain: z.boolean(), preview:previewSchema.optional() })), rebuildsRemaining: z.number(), retryAt: z.number().optional(), activeGenerationId: id.optional(), activeRequestId: z.uuid().optional(), issues: assemblyIssuesSchema });

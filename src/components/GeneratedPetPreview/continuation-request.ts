import { z } from "zod";
import { continuationInputSchema, assemblyIssuesSchema, CONTINUATION_STATES } from "@/lib/pets/generation/continuation-model";
const id = z.string().regex(/^[a-f0-9]{64}$/);
export const CONTINUATION_PENDING = "pets-continuation-v1:";
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
export function clearContinuation(storage: Pick<Storage, "getItem" | "removeItem">, sourceId: string, requestId: string) { if (readContinuationId(storage, sourceId) === requestId)
    storage.removeItem(CONTINUATION_PENDING + sourceId); }
export const continuationReplySchema = z.object({ operation: z.object({ id: z.uuid(), mode: z.enum(["rebuild", "regenerate"]), state: z.enum(["preparing", "accepted", "rejected"]), generationId: id.optional(), retryAt: z.number().optional() }), input: continuationInputSchema.optional(), generation: z.object({ generationId: id, expiresAt: z.iso.datetime(), status: z.enum(["queued", "generating", "processing", "completed", "failed", "awaiting_confirmation"]) }).optional() });
export const continuationOptionsSchema = z.object({ sourceRevision: id, canRebuild: z.boolean(), canRegenerate: z.boolean(), requiredStates: z.array(z.enum(CONTINUATION_STATES)), strips: z.array(z.object({ state: z.enum(CONTINUATION_STATES), status: z.enum(["saved", "missing", "invalid"]), uncertain: z.boolean() })), rebuildsRemaining: z.number(), retryAt: z.number().optional(), activeGenerationId: id.optional(), activeRequestId: z.uuid().optional(), issues: assemblyIssuesSchema });

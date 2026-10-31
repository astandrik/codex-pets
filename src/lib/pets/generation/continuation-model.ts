import { z } from "zod";
export const CONTINUATION_STATES = ["idle", "running", "running-left", "running-right", "waving", "jumping", "waiting", "failed", "review", "look-0-157", "look-180-337"] as const;
export type ContinuationState = typeof CONTINUATION_STATES[number];
export const continuationLockKey = (id:string) => 'continuation-lock:' + id;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const continuationStatesSchema = z.array(z.enum(CONTINUATION_STATES)).max(11)
    .refine(v => new Set(v).size === v.length)
    .transform(v => CONTINUATION_STATES.filter(s => v.includes(s)));
export const continuationInputSchema = z.object({ requestId: z.uuid(), mode: z.enum(["rebuild", "regenerate"]), sourceRevision: hash, states: continuationStatesSchema.optional() }).strict()
    .refine(v => v.mode === "rebuild" ? v.states === undefined : Boolean(v.states?.length));
export type ContinuationInput = z.infer<typeof continuationInputSchema>;
export const assemblyIssueSchema = z.object({ state: z.enum(CONTINUATION_STATES), kind: z.enum(["sparse", "components", "chroma", "edge", "invalid"]), frame: z.number().int().min(0).max(7).optional(), actual: z.number().int().nonnegative().max(25000000).optional(), expected: z.number().int().nonnegative().max(25000000).optional() }).strict();
export const assemblyIssuesSchema = z.array(assemblyIssueSchema).max(100);
export type AssemblyIssue = z.infer<typeof assemblyIssueSchema>;
export const continuationPlanSchema = z.object({ policy: z.literal(1), mode: z.enum(["rebuild", "regenerate"]), sourceGenerationId: hash, generationStages: continuationStatesSchema, compositionStages: continuationStatesSchema, baseSha256: hash, atlas: z.object({ kind: z.string().regex(/^[a-z0-9.-]+$/), sha256: hash }).strict().optional(), corrections: z.partialRecord(z.enum(CONTINUATION_STATES), z.array(z.string().max(2000)).max(4000)).optional() }).strict()
    .refine(p => p.generationStages.every(s => p.compositionStages.includes(s)) && (p.mode !== "rebuild" || !p.generationStages.length));
export type ContinuationPlan = z.infer<typeof continuationPlanSchema>;
export const rebuildHistorySchema = z.array(z.object({ operationId: z.uuid(), at: z.number(), error: z.string().max(80), issues: assemblyIssuesSchema.optional() })).max(3);
export type ContinuationPreview = {kind: "source-image"; url: string} | {kind: "atlas-row"; url: string; row: number; frames: number};
export type ContinuationOptions = {
    character?: {displayName?: string; description?: string; baseUrl: string; expiresAt: string};
    sourceRevision: string;
    canRebuild: boolean;
    canRegenerate: boolean;
    reason?: string;
    requiredStates: ContinuationState[];
    strips: {
        state: ContinuationState;
        status: "saved" | "missing" | "invalid";
        uncertain: boolean;
        preview?: ContinuationPreview;
    }[];
    rebuildsRemaining: number;
    retryAt?: number;
    activeGenerationId?: string;
    activeRequestId?: string;
    issues: AssemblyIssue[];
};
export type ContinuationOperation = {
    id: string;
    mode: "rebuild" | "regenerate";
    state: "preparing" | "accepted" | "rejected";
    generationId?: string;
    retryAt?: number;
};
export const continuationEnabled = () => process.env.PET_GENERATION_CONTINUATION_ENABLED === "true";

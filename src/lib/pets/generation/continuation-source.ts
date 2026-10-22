import { createHash } from "node:crypto";
import sharp from "sharp";
import { CONTINUATION_STATES, type ContinuationOptions, type ContinuationState } from "@/lib/pets/generation/continuation-model";
import { GenerationError, type GenerationJob } from "@/lib/pets/generation/model";
import type { GenerationStore } from "@/lib/pets/generation/store";
import { readSavedGenerationBase } from "@/lib/pets/generation/base-review";
import { normalizeSavedGenerationBase } from "@/lib/pets/generation/reference-image";
import { validateGeneratedSheet } from "@/lib/pets/generation/package";
export const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export const jobRevision = (job: GenerationJob) => sha(JSON.stringify(job));
export type SourceSnapshot = {
    job: GenerationJob;
    base: Buffer;
    atlas?: Buffer;
    atlasKind?: string;
    raws: Map<ContinuationState, Buffer>;
    targets: ContinuationState[];
    options: ContinuationOptions;
    jobRevision: string;
};
export function requireContinuationSource(job: GenerationJob | null, now: number) {
    if (!job)
        throw new GenerationError("not_found");
    if (job.expiresAt <= now)
        throw new GenerationError("generation_expired");
    if (job.status !== "failed")
        throw new GenerationError("continuation_busy");
    if (!job.reviewBase || job.baseConfirmedAt === undefined || ![2, 3, 4].includes(job.pipelineVersion))
        throw new GenerationError("base_not_ready");
    return job;
}
export async function inspectContinuationSource(store: GenerationStore, id: string, now: number): Promise<SourceSnapshot> {
    const job = requireContinuationSource(await store.readJob(id), now);
    const base = await readSavedGenerationBase(job, (i, k, t) => store.readArtifact(i, k, t), now);
    await normalizeSavedGenerationBase(base);
    let atlas: Buffer | undefined, atlasKind: string | undefined;
    for (const kind of ["source.png", ...(job.continuation?.atlas ? [job.continuation.atlas.kind] : []), ...(job.animationRevision ? ["revision-source.webp"] : [])]) {
        const bytes = await store.readArtifact(id, kind, now);
        if (!bytes)
            continue;
        const expected = kind === job.continuation?.atlas?.kind ? job.continuation.atlas.sha256 : kind === "revision-source.webp" ? job.animationRevision?.sourceAtlasSha256 : undefined;
        if (expected && sha(bytes) !== expected)
            continue;
        try {
            await validateGeneratedSheet(bytes);
            atlas = bytes;
            atlasKind = kind;
            break;
        }
        catch { /* A missing atlas makes its unavailable rows mandatory below. */ }
    }
    const targets: ContinuationState[] = !atlas ? [...CONTINUATION_STATES] : atlasKind === "source.png" ? [] : job.continuation?.compositionStages ?? job.animationRevision?.selectedStates ?? [...CONTINUATION_STATES];
    const raws = new Map<ContinuationState, Buffer>();
    for (const name of targets) {
        const stage = job.stages.find(s => s.name === name && s.status === "completed");
        if (!stage?.sha256)
            continue;
        const bytes = await store.readArtifact(id, `stage-${name}.png`, now);
        if (!bytes || bytes.length > 8 * 1024 * 1024 || sha(bytes) !== stage.sha256)
            continue;
        try {
            await sharp(bytes, { limitInputPixels: 25000000, animated: false }).ensureAlpha().raw().toBuffer();
            raws.set(name, bytes);
        }
        catch { /* Invalid saved rows are explicit mandatory replacements. */ }
    }
    const issues = job.assemblyIssues ?? [];
    const strips = CONTINUATION_STATES.map(state => ({ state, status: targets.includes(state) && !raws.has(state) ? "missing" as const : issues.some(i => i.state === state) && atlasKind !== "source.png" ? "invalid" as const : "saved" as const, uncertain: job.stages.some(s => s.name === state && s.status === "inflight") }));
    const requiredStates = strips.filter(s => s.status !== "saved").map(s => s.state);
    const sourceRevision = sha(JSON.stringify({ job: jobRevision(job), base: sha(base), atlas: atlas ? sha(atlas) : null, rows: [...raws].map(([name, bytes]) => [name, sha(bytes)]) }));
    const last = job.rebuildHistory?.at(-1)?.at;
    return { job, base, atlas, atlasKind, raws, targets, jobRevision: jobRevision(job), options: { sourceRevision, canRebuild: targets.every(n => raws.has(n)), canRegenerate: true, requiredStates, strips, rebuildsRemaining: 3 - (job.rebuildHistory?.length ?? 0), ...(last ? { retryAt: last + 30000 } : {}), issues } };
}

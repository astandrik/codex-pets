import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CONTINUATION_STATES, continuationEnabled, continuationInputSchema, type ContinuationOperation, type ContinuationPlan, type ContinuationState } from "@/lib/pets/generation/continuation-model";
import { inspectContinuationSource, jobRevision, requireContinuationSource, sha, type SourceSnapshot } from "@/lib/pets/generation/continuation-source";
import { DAY, GENERATION_ID, GenerationError, generationDigest, moscowDay, nextMoscowDay, type GenerationJob } from "@/lib/pets/generation/model";
import { publicJob } from "@/lib/pets/generation/public-job";
import type { GenerationStore, GenerationTransaction } from "@/lib/pets/generation/store";
import { scheduler, expireQueue, saveScheduler } from "@/lib/pets/generation/scheduler";
import { restoreBudgetTracking, startBudgetTracking } from "@/lib/pets/generation/budget";
import { consumeDailyQuota, readDailyQuota } from "@/lib/pets/generation/quota-grants";
const LEASE = 5 * 60000;
const receiptSchema = z.object({ id: z.uuid(), sourceId: z.string(), targetId: z.string(), hash: z.string(), mode: z.enum(["rebuild", "regenerate"]), state: z.enum(["preparing", "accepted", "rejected"]), owner: z.string(), until: z.number(), createdAt: z.number(), input: continuationInputSchema, copied: z.array(z.string()).default([]) });
type Receipt = z.infer<typeof receiptSchema>;
class DayChanged extends Error {
}
export function createContinuationService(store: GenerationStore, options: {
    now: () => number;
    enabled: () => boolean;
    secret: () => string;
    createId: () => string;
    budgetUsd: () => number;
}) {
    const key = (requestId: string) => "continuation:" + generationDigest(options.secret(), "request", requestId);
    const lockKey = (id: string) => "continuation-lock:" + id;
    const read = async (tx: GenerationTransaction, k: string) => { const raw = await tx.getLedger(k, options.now()); return raw ? receiptSchema.parse(JSON.parse(raw)) : null; };
    const save = async (tx: GenerationTransaction, r: Receipt, updateLock = true) => { await tx.putLedger(key(r.id), JSON.stringify(r), r.createdAt + 7 * DAY); if (updateLock)
        await tx.putLedger(lockKey(r.sourceId), JSON.stringify(r), r.createdAt + 7 * DAY); };
    async function reply(r: Receipt) {
        const operation: ContinuationOperation = { id: r.id, mode: r.mode, state: r.state, ...(r.state === "accepted" ? { generationId: r.targetId } : { retryAt: r.until }) };
        if (r.state !== "accepted")
            return { operation, input: r.input };
        const job = await store.readJob(r.targetId);
        if (!job || job.expiresAt <= options.now())
            throw new GenerationError("generation_expired");
        return { operation, generation: publicJob(job, options.now()) };
    }
    async function active(tx: GenerationTransaction, id: string) {
        const r = await read(tx, lockKey(id));
        if (!r)
            return null;
        if (r.state === "preparing" && r.until > options.now())
            return r;
        if (r.state === "accepted") {
            const j = await tx.getJob(r.targetId);
            if (j && j.expiresAt > options.now() && ["queued", "generating", "processing", "awaiting_confirmation"].includes(j.status))
                return r;
        }
        return null;
    }
    function guard() { if (!continuationEnabled())
        throw new GenerationError("continuation_disabled"); if (!options.enabled())
        throw new GenerationError("generation_disabled"); }
    async function queue(tx: GenerationTransaction) { const state = await scheduler(tx, options.now()); await expireQueue(tx, state, options.now()); if (state.pauseReason)
        throw new GenerationError("generation_paused"); if (state.queue.length >= 5)
        throw new GenerationError("queue_full"); return state; }
    function plan(snapshot: SourceSnapshot, mode: Receipt["mode"], selected: ContinuationState[]): ContinuationPlan {
        return { policy: 1, mode, sourceGenerationId: snapshot.job.id, baseSha256: sha(snapshot.base), generationStages: selected, compositionStages: snapshot.atlas ? CONTINUATION_STATES.filter(n => snapshot.targets.includes(n) || selected.includes(n)) : [...CONTINUATION_STATES], ...(snapshot.atlas ? { atlas: { kind: mode === "rebuild" ? snapshot.atlasKind! : "continuation-source.webp", sha256: sha(snapshot.atlas) } } : {}), ...(snapshot.job.continuation?.corrections ?? snapshot.job.animationRevision?.corrections ? { corrections: snapshot.job.continuation?.corrections ?? snapshot.job.animationRevision?.corrections } : {}) };
    }
    return {
        async getContinuationOptions(id: string) {
            if (!GENERATION_ID.test(id))
                throw new GenerationError("invalid_argument");
            if (!continuationEnabled())
                throw new GenerationError("continuation_disabled");
            const snapshot = await inspectContinuationSource(store, id, options.now());
            const busy = await store.transaction(tx => active(tx, id));
            return { ...snapshot.options, canRebuild: continuationEnabled() && snapshot.options.canRebuild && snapshot.options.rebuildsRemaining > 0, canRegenerate: continuationEnabled(), ...(busy ? { activeRequestId: busy.id, ...(busy.state === "accepted" ? { activeGenerationId: busy.targetId } : {}) } : {}), ...(!continuationEnabled() ? { reason: "continuation_disabled" } : {}) };
        },
        async findContinuation(id: string, requestId: string) {
            if (!GENERATION_ID.test(id) || !z.uuid().safeParse(requestId).success)
                throw new GenerationError("invalid_argument");
            const r = await store.transaction(tx => read(tx, key(requestId)));
            if (!r || r.sourceId !== id)
                throw new GenerationError("not_found");
            return reply(r);
        },
        async continueGeneration(id: string, input: unknown, clientIp: string | null) {
            const parsed = continuationInputSchema.safeParse(input);
            if (!GENERATION_ID.test(id) || !parsed.success)
                throw new GenerationError("invalid_argument");
            const body = parsed.data, hash = generationDigest(options.secret(), "body", JSON.stringify({ source: id, ...body }));
            const previous = await store.transaction(tx => read(tx, key(body.requestId)));
            if (previous && (previous.hash !== hash || previous.sourceId !== id))
                throw new GenerationError("request_id_conflict");
            if (previous && previous.state !== "preparing")
                return reply(previous);
            if (previous && previous.until > options.now())
                return reply(previous);
            guard();
            const snapshot = await inspectContinuationSource(store, id, options.now());
            if (snapshot.options.sourceRevision !== body.sourceRevision)
                throw new GenerationError("continuation_source_conflict");
            const selected = body.states ?? [];
            if (body.mode === "rebuild" && !snapshot.options.canRebuild)
                throw new GenerationError("continuation_selection_conflict");
            if (body.mode === "regenerate" && !snapshot.options.requiredStates.every(s => selected.includes(s)))
                throw new GenerationError("continuation_selection_conflict");
            if (body.mode === "rebuild") {
                try {
                    const r = await store.transaction(async (tx) => {
                        const existing = await read(tx, key(body.requestId));
                        if (existing) {
                            if (existing.hash !== hash)
                                throw new GenerationError("request_id_conflict");
                            return existing;
                        }
                        guard();
                        if (await active(tx, id))
                            throw new GenerationError("continuation_busy");
                        const job = requireContinuationSource(await tx.getJob(id), options.now());
                        if (jobRevision(job) !== snapshot.jobRevision)
                            throw new GenerationError("continuation_source_conflict");
                        const history = job.rebuildHistory ?? [];
                        if (history.length >= 3)
                            throw new GenerationError("continuation_limit");
                        const retryAt = (history.at(-1)?.at ?? -Infinity) + 30000;
                        if (retryAt > options.now())
                            throw new GenerationError("continuation_cooldown", new Date(retryAt).toISOString());
                        const state = await queue(tx), now = options.now();
                        if (job.expiresAt <= now)
                            throw new GenerationError("generation_expired");
                        await restoreBudgetTracking(tx, id, now);
                        const updated: GenerationJob = { ...job, status: "queued", queuedAt: now, worker: "", leaseUntil: undefined, error: undefined, providerFailure: undefined, failureDiagnostic: undefined, continuation: plan(snapshot, "rebuild", []), rebuildHistory: [...history, { operationId: body.requestId, at: now, error: job.error ?? "generation_unavailable", ...(job.assemblyIssues ? { issues: job.assemblyIssues } : {}) }] };
                        await tx.putJob(updated);
                        state.queue.push(id);
                        await saveScheduler(tx, state);
                        const r: Receipt = { id: body.requestId, sourceId: id, targetId: id, hash, mode: "rebuild", state: "accepted", owner: "", until: now, createdAt: now, input: body, copied: [] };
                        await save(tx, r);
                        requireContinuationSource(job, options.now());
                        return r;
                    });
                    return reply(r);
                }
                catch (error) {
                    const saved = await store.transaction(tx => read(tx, key(body.requestId)));
                    if (saved?.state === "accepted" && saved.hash === hash)
                        return reply(saved);
                    throw error;
                }
            }
            if (!clientIp)
                throw new GenerationError("client_ip_unavailable");
            const owner = randomUUID();
            const draft = await store.transaction(async (tx) => {
                const existing = await read(tx, key(body.requestId));
                if (existing && existing.hash !== hash)
                    throw new GenerationError("request_id_conflict");
                if (existing?.state === "accepted" || existing?.state === "rejected")
                    return existing;
                if (existing && existing.until > options.now())
                    return existing;
                guard();
                const busy = await active(tx, id);
                if (busy && busy.id !== body.requestId)
                    throw new GenerationError("continuation_busy");
                const current = requireContinuationSource(await tx.getJob(id), options.now());
                if (jobRevision(current) !== snapshot.jobRevision)
                    throw new GenerationError("continuation_source_conflict");
                await queue(tx);
                const quota = await readDailyQuota(tx, options.secret(), clientIp, options.now());
                if (!quota.globalRemaining || !quota.ipRemaining)
                    throw new GenerationError("rate_limited", nextMoscowDay(options.now()));
                const now = options.now(), r: Receipt = { id: body.requestId, sourceId: id, targetId: existing?.targetId ?? options.createId(), hash, mode: "regenerate", state: "preparing", owner, until: now + LEASE, createdAt: existing?.createdAt ?? now, input: body, copied: existing?.copied ?? [] };
                await save(tx, r);
                return r;
            });
            if (draft.state !== "preparing" || draft.owner !== owner)
                return reply(draft);
            const execution = plan(snapshot, "regenerate", selected);
            const copies = new Map<string, Buffer>([["stage-base.png", snapshot.base]]);
            if (snapshot.atlas)
                copies.set("continuation-source.webp", snapshot.atlas);
            for (const name of execution.compositionStages)
                if (!selected.includes(name)) {
                    const bytes = snapshot.raws.get(name);
                    if (!bytes)
                        throw new GenerationError("saved_stage_unavailable");
                    copies.set(`stage-${name}.png`, bytes);
                }
            try {
                for (const [kind, bytes] of copies)
                    try {
                        await store.transaction(async (tx) => {
                            const r = await read(tx, key(draft.id));
                            if (!r || r.owner !== owner || r.state !== "preparing" || r.until <= options.now())
                                throw new GenerationError("continuation_busy");
                            if (r.copied.includes(kind)) {
                                const existing = await tx.getArtifact(r.targetId, kind, options.now());
                                if (existing && sha(existing) === sha(bytes)) {
                                    await tx.setArtifactExpiry(r.targetId, [kind], r.until);
                                    return;
                                }
                            }
                            await tx.putArtifact(r.targetId, kind, bytes, r.until);
                            await save(tx, { ...r, copied: [...new Set([...r.copied, kind])] });
                        });
                    }
                    catch (error) {
                        const checkpoint = await store.transaction(tx => read(tx, key(draft.id)));
                        const saved = await store.readArtifact(draft.targetId, kind, options.now());
                        if (checkpoint?.owner !== owner || checkpoint.state !== "preparing" || !checkpoint.copied.includes(kind) || !saved || sha(saved) !== sha(bytes))
                            throw error;
                    }
                for (let attempt = 0;; attempt++)
                    try {
                        const done = await store.transaction(async (tx) => {
                            const r = await read(tx, key(draft.id));
                            if (r?.state === "accepted")
                                return r;
                            if (!r || r.owner !== owner || r.until <= options.now())
                                throw new GenerationError("continuation_busy");
                            guard();
                            const current = requireContinuationSource(await tx.getJob(id), options.now());
                            if (jobRevision(current) !== snapshot.jobRevision)
                                throw new GenerationError("continuation_source_conflict");
                            if (![...copies.keys()].every(k => r.copied.includes(k)))
                                throw new GenerationError("saved_stage_unavailable");
                            const state = await queue(tx), now = options.now(), quota = await readDailyQuota(tx, options.secret(), clientIp, now);
                            if (!quota.globalRemaining)
                                throw new GenerationError("rate_limited", nextMoscowDay(now), undefined, "global");
                            if (!quota.ipRemaining)
                                throw new GenerationError("rate_limited", nextMoscowDay(now), undefined, "ip");
                            if (r.until <= now)
                                throw new GenerationError("continuation_busy");
                            for (const kind of copies.keys())
                                if (!await tx.hasArtifact(r.targetId, kind, now))
                                    throw new GenerationError("saved_stage_unavailable");
                            await startBudgetTracking(tx, r.targetId, now, options.budgetUsd());
                            const stages = execution.compositionStages.filter(n => !selected.includes(n)).map(name => ({ name, status: "completed" as const, sha256: sha(copies.get(`stage-${name}.png`)!), startedAt: now }));
                            const job: GenerationJob = { id: r.targetId, prompt: "", displayName: current.displayName, nameSource: current.nameSource, status: "queued", createdAt: now, queuedAt: now, expiresAt: now + DAY, worker: "", reviewBase: true, baseConfirmedAt: now, pipelineVersion: 4, promptRevision: current.promptRevision, stages, continuation: execution, animationAnatomyPolicy: current.animationAnatomyPolicy, ...(current.animationPrompt ? { animationPrompt: current.animationPrompt } : {}), ...(current.cardMetadata ? { cardMetadata: { ...structuredClone(current.cardMetadata), usage: undefined, ...(current.cardMetadata.state === "inflight" ? { state: "failed" as const, error: "outcome_unknown" as const } : {}) } } : {}) };
                            await tx.setArtifactExpiry(job.id, [...copies.keys()], job.expiresAt);
                            await tx.putJob(job);
                            await consumeDailyQuota(tx, options.secret(), clientIp, now, quota);
                            state.queue.push(job.id);
                            await saveScheduler(tx, state);
                            const receipt = { ...r, state: "accepted" as const, until: now };
                            await save(tx, receipt);
                            requireContinuationSource(current, options.now());
                            if (options.now() >= r.until)
                                throw new GenerationError("continuation_busy");
                            if (moscowDay(options.now()) !== moscowDay(now))
                                throw new DayChanged();
                            return receipt;
                        });
                        return reply(done);
                    }
                    catch (error) {
                        if (error instanceof DayChanged && attempt < 2)
                            continue;
                        throw error;
                    }
            }
            catch (error) {
                const r = await store.transaction(tx => read(tx, key(draft.id)));
                if (r?.state === "accepted")
                    return reply(r);
                await store.transaction(async (tx) => { const current = await read(tx, key(draft.id)); if (current?.state === "preparing" && current.owner === owner) {
                    await tx.deleteArtifacts(current.targetId);
                    await save(tx, { ...current, state: "rejected", until: options.now() }, (await read(tx, lockKey(id)))?.id === current.id);
                } });
                throw error;
            }
        },
    };
}

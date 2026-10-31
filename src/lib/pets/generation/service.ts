import {createBaseRepairService} from "@/lib/pets/generation/base-repair-service";
import {reserveInitialBaseAttempt,canResumeBaseRepair,latestBaseAttempt,baseFailureRetryReason} from "@/lib/pets/generation/base-repair";
import {reserveInitialAnimationAttempts, canResumeAnimationRepair, hasUnsettledAnimationAttempt, latestAnimationAttempt, isAnimationState, getRepairScope, animationFailureRetryReason} from "@/lib/pets/generation/animation-repair";
import {admitGeneration} from "@/lib/pets/generation/admission";
import {createBaseRetryService} from "@/lib/pets/generation/base-retries";
import {createAnimationRepairService} from "@/lib/pets/generation/animation-repair-service";
import {createContinuationService} from "@/lib/pets/generation/continuations";
import {createAnimationRevisionService, requireAcceptedAnimationRevision} from "@/lib/pets/generation/animation-revisions";
import {isRetryableImageCause} from "@/lib/pets/generation/cli-cause";
import { parsePublicPetSlug } from "@/lib/pets/public-slug";
import { findAvailablePublicPetSlug, PublicPetSlugUnavailableError } from "@/lib/pets/public-slug-allocation";
import { createHash, randomUUID } from "node:crypto";
import type { AppPrincipal } from "@/lib/auth/session";
import { assetUrl } from "@/lib/pets/asset-urls";
import { validateUploadedPackage } from "@/lib/pets/package";
import { replaceGeneratedDetails, validateGeneratedSheet } from "@/lib/pets/generation/package";
import { slugify } from "@/lib/pets/validation";
import {
  generationAnimationAutoRepairEnabled, generationBaseRetryEnabled, generationReviewFlowEnabled, generationStageNames, requiredStageNames, usesStageCheckpoints, isUnacceptedAnimationRevision, DAY, LEASE_MS, WAIT_MS, GENERATION_ID, MAX_PARALLEL_IMAGE_ROWS, GenerationError,
  generationInputSchema, generationDigest, generationEnabled, readGenerationSecret,
  newGenerationId, dedupSchema,
  rowAttemptLogSchema, ROW_RETRY_DELAY_MS, type RowAttemptLog, stageFailureDiagnosticSchema, type StageFailureDiagnostic, stageCliCauseSchema, type StageCliCause,
  type StageName, type GenerationJob, type ImageUsage, type GenerationReference, browserGenerationInputSchema, normalizeGenerationText, type GenerationInput,
} from "@/lib/pets/generation/model";
import { generationStore, type GenerationStore, type GenerationTransaction } from "@/lib/pets/generation/store";

import { checkStageBudget, recordStageCost, settleBudget } from "@/lib/pets/generation/budget";
import { readProviderFailure } from "@/lib/pets/generation/provider-failure";
import { readFailureDiagnostic } from "@/lib/pets/generation/failure-diagnostic";
import {CARD_METADATA_FALLBACK, normalizeCardMetadata, cardMetadataEditSchema, type CardMetadataFields, type CardMetadataRecord, type PublicCardMetadata} from "@/lib/pets/generation/card-metadata";
import type {CardMetadataResult} from "@/lib/pets/generation/card-provider";
import {publicJob} from "@/lib/pets/generation/public-job";
import {scheduler, saveScheduler, expireQueue, requireQueueCapacity, requireJobWithActiveWorkerLease} from "@/lib/pets/generation/scheduler";
import {createBaseReviewService, readSavedGenerationBase} from "@/lib/pets/generation/base-review";
import {normalizeSavedGenerationBase} from "@/lib/pets/generation/reference-image";

export function createGenerationService(store: GenerationStore, options: {
  enabled: () => boolean;
  secret: () => string;
  now?: () => number;
  createId?: () => string;
  budgetUsd?: () => number;
  automaticCardMetadata?: () => boolean;
  automaticAnimationRepair?: () => boolean;
  baseRetries?: () => boolean;
  reviewFlow?: () => boolean;
}) {
  const clock = options.now ?? Date.now;
  const createId = options.createId ?? newGenerationId;
  const budgetUsd = options.budgetUsd ?? (() => 50);
  async function beginStages(job: GenerationJob, names: StageName[]) {
    const now = clock();
    return store.transaction(async tx => {
      const state = await scheduler(tx, now);
      const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
      if (!options.enabled()) throw new GenerationError("generation_disabled");
      if (state.pauseReason) throw new GenerationError("generation_paused");
      if (current.reviewBase && current.baseConfirmedAt === undefined && names.some(name => name !== "base")) throw new GenerationError("base_not_ready");
      if (names.some(name => current.stages.some(stage => stage.name === name && stage.status === "completed"))) throw new GenerationError("stage_already_completed");
      const plan = requiredStageNames(current);
      const next = plan.slice(current.stages.length, current.stages.length + names.length);
      if (current.continuation) {
        const pending = generationStageNames(current).filter(name => !current.stages.some(s => s.name === name));
        if (current.status !== "generating" || current.stages.some(s => s.status !== "completed") || !names.length || names.length > MAX_PARALLEL_IMAGE_ROWS || names.some((name,index)=>name!==pending[index])) throw new GenerationError("invalid_stage");
      } else if (!usesStageCheckpoints(current) || current.status !== "generating" || names.length < 1 || names.length > MAX_PARALLEL_IMAGE_ROWS
        || (current.pipelineVersion === 2 && current.stages.length === 0 && names.length !== 1)
        || current.stages.some((stage, index) => stage.status !== "completed" || stage.name !== requiredStageNames(current)[index])
        || names.some((name, index) => name !== next[index])) throw new GenerationError("invalid_stage");
      await checkStageBudget(tx, job.id, now, budgetUsd());
      let updated = reserveInitialAnimationAttempts({ ...current, stages: [...current.stages, ...names.map(name => ({ name, status: "inflight" as const, startedAt: now }))] }, names, now, randomUUID);
      if(names.length===1&&names[0]==="base")updated=reserveInitialBaseAttempt(updated,now,randomUUID);
      await tx.putJob(updated);
      if (state.active) state.active.inflight = !(names.length===1&&names[0]==="base"&&updated.baseRepair);
      await saveScheduler(tx, state);
      return updated;
    });
  }
  return {
    ...createBaseRepairService(store,{now:clock,enabled:options.enabled,budgetUsd}),
    ...createBaseRetryService(store,{now:clock,enabled:options.enabled,secret:options.secret,createId,budgetUsd,baseRetries:options.baseRetries??(()=>false),reviewFlow:options.reviewFlow??generationReviewFlowEnabled,automaticAnimationRepair:options.automaticAnimationRepair,automaticCardMetadata:options.automaticCardMetadata}),
    ...createAnimationRepairService(store, {now: clock, enabled: options.enabled, automaticAnimationRepair: options.automaticAnimationRepair ?? (() => false), budgetUsd}),
    ...createContinuationService(store, {now: clock, enabled: options.enabled, secret: options.secret, createId, budgetUsd, automaticAnimationRepair: options.automaticAnimationRepair}),
    ...createAnimationRevisionService(store, {now: clock, enabled: options.enabled, secret: options.secret, createId, budgetUsd, automaticAnimationRepair: options.automaticAnimationRepair}),
    ...createBaseReviewService(store, {now: clock, enabled: options.enabled, budgetUsd}),
    async generate(input: unknown, clientIp: string | null, admission: {reviewBase?: boolean; reference?: GenerationReference; allowNew?: boolean; legacyMultipartInput?: GenerationInput; sourceBaseId?: string} = {}) {
      if (admission.sourceBaseId !== undefined && (!GENERATION_ID.test(admission.sourceBaseId) || !admission.reviewBase || admission.reference || admission.legacyMultipartInput)) throw new GenerationError("invalid_argument");
      const parsed = (admission.reviewBase && admission.sourceBaseId === undefined ? browserGenerationInputSchema : generationInputSchema).safeParse(input);
      if (!parsed.success || (!parsed.data.prompt && !admission.reference) || (admission.reference && !admission.reviewBase)) throw new GenerationError("invalid_argument");
      const body = parsed.data;
      const requestTime = clock();
      const secret = options.secret();
      const requestKey = "request:" + generationDigest(secret, "request", body.requestId);
      const fingerprint = (value: GenerationInput) => generationDigest(secret, "body", JSON.stringify({ prompt: value.prompt, displayName: value.displayName ?? "Generated pet", ...(admission.reference ? {referenceSha256: admission.reference.metadata.sourceSha256} : {}), ...(admission.sourceBaseId ? {sourceBaseId: admission.sourceBaseId} : {}) }));
      const hash = fingerprint(body);
      let legacyHash: string | undefined;
      if (admission.legacyMultipartInput !== undefined) {
        const legacy = browserGenerationInputSchema.safeParse(admission.legacyMultipartInput);
        if (!admission.reviewBase || !legacy.success || legacy.data.requestId !== body.requestId ||
            normalizeGenerationText(legacy.data.prompt) !== body.prompt ||
            (legacy.data.displayName === undefined ? undefined : normalizeGenerationText(legacy.data.displayName)) !== body.displayName) throw new GenerationError("invalid_argument");
        legacyHash = fingerprint(legacy.data);
      }
      const id = createId();
      return store.transaction(async (tx) => {
        let now = admission.sourceBaseId ? clock() : requestTime;
        const previous = await tx.getLedger(requestKey, now);
        if (previous) {
          const record = dedupSchema.parse(JSON.parse(previous));
          if ((record.hash !== hash && record.hash !== legacyHash) || (record.nameProvided!==undefined && record.nameProvided!==(body.displayName!==undefined))) throw new GenerationError("request_id_conflict");
          const job = await tx.getJob(record.id);
          if (!job || job.expiresAt <= now) throw new GenerationError("generation_expired");
          return publicJob(job, now);
        }
        if (admission.allowNew === false) throw new GenerationError("generation_review_disabled");
        if (!options.enabled()) throw new GenerationError("generation_disabled");
        if (!clientIp) throw new GenerationError("client_ip_unavailable");
        let reference = admission.reference;
        let displayName = body.displayName;
        let sourceExpiresAt: number | undefined;
        if (admission.sourceBaseId) {
          const source = await tx.getJob(admission.sourceBaseId);
          if (!source) throw new GenerationError("not_found");
          if (source.expiresAt <= now) throw new GenerationError("generation_expired");
          if (!source.reviewBase || source.status !== "awaiting_confirmation" || source.baseConfirmedAt !== undefined) throw new GenerationError("base_not_ready");
          const bytes = await readSavedGenerationBase(source, tx.getArtifact, now);
          reference = await normalizeSavedGenerationBase(bytes);
          sourceExpiresAt = source.expiresAt;
          now = clock();
          if (source.expiresAt <= now) throw new GenerationError("generation_expired");
          if (displayName === undefined && source.nameSource === "user") displayName = source.displayName;
        }
        const job = await admitGeneration(tx,{id,input:{...body,displayName},reviewBase:admission.reviewBase,reference,acceptedAt:now,sourceDeadline:sourceExpiresAt},clientIp,
          {now:clock,enabled:options.enabled,secret:()=>secret,budgetUsd,automaticAnimationRepair:options.automaticAnimationRepair,automaticCardMetadata:options.automaticCardMetadata,baseRetries:options.baseRetries??(()=>false)});
        await tx.putLedger(requestKey, JSON.stringify({ hash, id, expiresAt: now + 7 * DAY, nameProvided:body.displayName!==undefined }), now + 7 * DAY);
        // Roll back admission if the source expired while the database work was in flight.
        if (sourceExpiresAt !== undefined && sourceExpiresAt <= clock()) throw new GenerationError("generation_expired");
        return publicJob(job, now);
      });
    },
    async get(id: string) {
      if (!GENERATION_ID.test(id)) throw new GenerationError("invalid_argument");
      const job = await store.readJob(id);
      if (!job) throw new GenerationError("not_found");
      if (job.expiresAt <= clock()) throw new GenerationError("generation_expired");
      let metadata:PublicCardMetadata|undefined;
      if(job.cardMetadata){metadata=publicCard(job,job.cardMetadata.fields??{description:CARD_METADATA_FALLBACK,tags:[]});}
      else if(job.status==="completed"){
        const bytes=await store.readArtifact(id,"pet.json",clock());
        if(bytes){try{const value=JSON.parse(bytes.toString("utf8"));if(typeof value.description==="string")metadata=publicCard(job,{description:value.description,tags:[]});}catch{/* Preserve compatibility with legacy records lacking readable metadata. */}}
      }
      return publicJob(job, clock(), metadata);
    },
    async editMetadata(id:string,input:unknown){
      if(!GENERATION_ID.test(id))throw new GenerationError("invalid_argument");
      const parsed=cardMetadataEditSchema.safeParse(input);if(!parsed.success)throw new GenerationError("invalid_argument");
      let desired:CardMetadataFields;
      try{desired=normalizeCardMetadata({...(parsed.data.displayName===undefined?{}:{displayName:parsed.data.displayName}),description:parsed.data.description,tags:parsed.data.tags});}catch{throw new GenerationError("invalid_argument");}
      const same=(fields:CardMetadataFields,displayName:string)=>fields.description===desired.description&&JSON.stringify(fields.tags)===JSON.stringify(desired.tags)&&(desired.displayName===undefined||desired.displayName===displayName);
      const editable=(job:GenerationJob|null)=>{
        if(!job)throw new GenerationError("not_found");
        if(job.expiresAt<=clock())throw new GenerationError("generation_expired");
        if(job.status!=="completed")throw new GenerationError("generation_not_completed");
        requireAcceptedAnimationRevision(job);
        if(job.submission)throw new GenerationError("metadata_locked");return job;
      };
      const snapshot=await store.transaction(async tx=>{
        const job=editable(await tx.getJob(id)),now=clock();
        const petJsonBuffer=await tx.getArtifact(id,"pet.json",now),spritesheetBuffer=await tx.getArtifact(id,"spritesheet.webp",now),zipBuffer=await tx.getArtifact(id,"pet.zip",now);
        if(!petJsonBuffer||!spritesheetBuffer||!zipBuffer)throw new GenerationError("invalid_generated_package");
        const fields=job.cardMetadata?.fields??{description:JSON.parse(petJsonBuffer.toString("utf8")).description,tags:[]};
        if((job.cardMetadata?.revision??0)!==parsed.data.revision&&!same(fields,job.displayName))throw new GenerationError("metadata_conflict");
        return {job,fields,petJsonBuffer,spritesheetBuffer,zipBuffer};
      });
      const changed=await replaceGeneratedDetails(snapshot,{description:desired.description,displayName:desired.displayName??snapshot.job.displayName});
      try{return await store.transaction(async tx=>{
        const current=editable(await tx.getJob(id));
        const fields=current.cardMetadata?.fields??snapshot.fields;
        if(same(fields,current.displayName))return publicCard(current,fields);
        if((current.cardMetadata?.revision??0)!==parsed.data.revision)throw new GenerationError("metadata_conflict");
        const card=current.cardMetadata??{policy:1 as const,state:"completed" as const,revision:0,edited:false};
        const displayName=desired.displayName??current.displayName;
        const updated={...current,displayName,cardMetadata:{...card,fields:{...desired,displayName},revision:card.revision+1,edited:true}};
        await tx.putArtifact(id,"pet.json",changed.petJsonBuffer,current.expiresAt);await tx.putArtifact(id,"pet.zip",changed.zipBuffer,current.expiresAt);await tx.putJob(updated);
        return publicCard(updated,desired);
      });}catch(error){
        if(error instanceof GenerationError)throw error;
        const saved=await store.readJob(id);
        if(saved&&saved.expiresAt>clock()&&saved.cardMetadata?.fields&&same(saved.cardMetadata.fields,saved.displayName))return publicCard(saved,saved.cardMetadata.fields);
        throw error;
      }
    },
    async checkSubmissionSlug(id: string, requestedSlug: unknown) {
      if (!GENERATION_ID.test(id)) throw new GenerationError("invalid_argument");
      return store.transaction(async tx => {
        const job = await tx.getJob(id);
        if (!job) throw new GenerationError("not_found");
        if (job.expiresAt <= clock()) throw new GenerationError("generation_expired");
        if (job.status !== "completed") throw new GenerationError("generation_not_completed");
        requireAcceptedAnimationRevision(job);
        if (job.submission) return { available: true, suggestedSlug: job.submission.slug, submission: job.submission };
        const slug = parsePublicPetSlug(requestedSlug);
        if (!slug) throw new GenerationError("invalid_public_slug");
        return findSubmissionSlug(slug, tx);
      });
    },
    async submit(id: string, principal: Pick<AppPrincipal, "userId" | "email" | "name"> | null, requestedSlug?: unknown, expectedMetadataRevision?:number) {
      if (!GENERATION_ID.test(id)) throw new GenerationError("invalid_argument");
      const suffix = randomUUID().replace(/-/g, "").slice(0, 22);
      const assetId = "asset_" + suffix;
      try {
        return await store.transaction(async tx => {
          const now = clock();
          const job = await tx.getJob(id);
          if (!job) throw new GenerationError("not_found");
          if (job.expiresAt <= now) throw new GenerationError("generation_expired");
          if (job.status !== "completed") throw new GenerationError("generation_not_completed");
        requireAcceptedAnimationRevision(job);
          if (job.submission) return job.submission;
          if(expectedMetadataRevision!==undefined&&expectedMetadataRevision!==(job.cardMetadata?.revision??0))throw new GenerationError("metadata_conflict");
          const publicSlug = requestedSlug === undefined ? undefined : parsePublicPetSlug(requestedSlug);
          if (publicSlug === null) throw new GenerationError("invalid_public_slug");
          const petJsonBuffer = await tx.getArtifact(id, "pet.json", now);
          const spritesheetBuffer = await tx.getArtifact(id, "spritesheet.webp", now);
          const zipBuffer = await tx.getArtifact(id, "pet.zip", now);
          if (!petJsonBuffer || !spritesheetBuffer || !zipBuffer) throw new GenerationError("invalid_generated_package");
          try { await validateGeneratedSheet(spritesheetBuffer); } catch { throw new GenerationError("invalid_generated_package"); }
          const assets = { assetId, petJsonBuffer, spritesheetBuffer, zipBuffer, spritesheetExt: "webp" as const };
          const validation = await validateUploadedPackage(assets);
          if (!validation.ok || validation.value.petJson.spriteVersionNumber !== 2) throw new GenerationError("invalid_generated_package");
          const base = publicSlug ?? (slugify(validation.value.petJson.id) || "generated-pet") + "-" + suffix;
          const { suggestedSlug: slug } = await findSubmissionSlug(base, tx);
          const submission = { petId: "pet_" + suffix, slug, submittedAt: new Date(now).toISOString() };
          await tx.saveSubmission({ assets, identity: { id: submission.petId, slug: submission.slug, createdAt: submission.submittedAt }, pet: {
            petJson: validation.value.petJson, ownerId: principal?.userId ?? "", ownerEmail: principal?.email ?? null, ownerName: principal?.name ?? null, contactEmail: principal?.email ?? null,
            publicEmailRequested: false, kind: "creature", tags: job.cardMetadata?.fields?.tags??[], spritesheetExt: "webp",
            petJsonUrl: assetUrl(assetId, "pet.json"), spritesheetUrl: assetUrl(assetId, "spritesheet.webp"), zipUrl: assetUrl(assetId, "pet.zip"),
          } });
          await tx.putJob({ ...job, submission });
          return submission;
        });
      } catch (error) {
        // An unknown commit result must be resolved by readback, never a blind copy.
        if (!(error instanceof GenerationError)) {
          const job = await store.readJob(id);
          if (job && job.expiresAt > clock() && job.submission) return job.submission;
        }
        throw error;
      }
    },
    async claim(owner: string) {
      if (!options.enabled()) return null;
      return store.transaction(async (tx) => {
        const state = await scheduler(tx, clock());
        let now = clock();
        const hadPendingWork = Boolean(state.active || state.queue.length);
        const queuedBeforeCleanup = state.queue.length;
        await expireQueue(tx, state, now);
        const saveQueueCleanup = async () => {
          if (state.queue.length !== queuedBeforeCleanup) await saveScheduler(tx, state);
        };
        now = clock();
        if(state.pauseReason){
          const pending=state.active&&state.active.until<=now?await tx.getJob(state.active.id):null;
          now = clock();
          if(!pending||pending.status!=="processing"||pending.cardMetadata?.state!=="failed") {
            await saveQueueCleanup(); return null;
          }
        }
        if (state.active) {
          if (state.active.until > now) { await saveQueueCleanup(); return null; }
          const abandoned = await tx.getJob(state.active.id);
          now = clock();
          if(abandoned&&abandoned.expiresAt>now&&abandoned.status==="processing"&&abandoned.cardMetadata?.state==="inflight"){
            state.active={id:abandoned.id,owner,until:now+LEASE_MS,inflight:true};
            const recovered={...abandoned,worker:owner,leaseUntil:now+LEASE_MS};await tx.putJob(recovered);await saveScheduler(tx,state);return recovered;
          }
          if (abandoned && abandoned.expiresAt > now && (state.active.inflight !== true || (canResumeAnimationRepair(abandoned) || canResumeBaseRepair(abandoned))) && (abandoned.status === "processing" || (usesStageCheckpoints(abandoned) && abandoned.status === "generating" && (!abandoned.stages.some(stage => stage.status === "inflight") || (canResumeAnimationRepair(abandoned) || canResumeBaseRepair(abandoned)))))) {
            state.active = { id: abandoned.id, owner, until: now + LEASE_MS, inflight: false };
            const recovered = { ...abandoned, worker: owner, leaseUntil: now + LEASE_MS };
            await tx.putJob(recovered);
            await saveScheduler(tx, state);
            return recovered;
          }
          if (!abandoned || abandoned.expiresAt <= now) {
            const uncertain = state.active.inflight !== false;
            await settleBudget(tx, state.active.id, now, uncertain);
            if (uncertain) state.pauseReason = "outcome_unknown";
          }
          if (abandoned && abandoned.expiresAt > now && abandoned.status === "generating") {
            await tx.putJob({ ...abandoned, status: "failed", error: "outcome_unknown", prompt: "",
              failureDiagnostic:{boundary:"lease",reason:"expired_lease"},
              stageFailureDiagnostics:abandoned.stages.filter(stage=>stage.status==="inflight").map(stage=>({stage:stage.name,diagnostic:{boundary:"lease",reason:"expired_lease"}})),
            });
            await settleBudget(tx, abandoned.id, now, true);
            state.pauseReason = "outcome_unknown";
          }
          state.active = null;
          if (state.pauseReason) { await saveScheduler(tx, state); return null; }
        }
        while (state.queue.length) {
          const id = state.queue.shift()!;
          const job = await tx.getJob(id);
          // Reads and transaction retries can cross either deadline after expireQueue.
          const decisionTime = clock();
          if (!job || job.expiresAt <= decisionTime) {
            await settleBudget(tx, id, decisionTime);
            continue;
          }
          if (job.status !== "queued") continue;
          if ((job.queuedAt ?? job.createdAt) + WAIT_MS <= decisionTime) {
            await tx.putJob({...job, status: "failed", error: "queue_timeout", prompt: ""});
            await settleBudget(tx, id, decisionTime);
            continue;
          }
          const claimed: GenerationJob = {...job, status: "generating", worker: owner, leaseUntil: decisionTime + LEASE_MS};
          state.active = {id, owner, until: decisionTime + LEASE_MS, inflight: !usesStageCheckpoints(job)};
          await tx.putJob(claimed);
          await saveScheduler(tx, state);
          return claimed;
        }
        if (hadPendingWork) await saveScheduler(tx, state);
        return null;
      });
    },
    async heartbeat(job: GenerationJob) {
      const now = clock();
      return store.transaction(async tx => {
        const state = await scheduler(tx, now);
        const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
        const updated = { ...current, leaseUntil: now + LEASE_MS };
        await tx.putJob(updated);
        state.active = { ...state.active, id: job.id, owner: job.worker, until: now + LEASE_MS };
        await saveScheduler(tx, state);
        return updated;
      });
    },
    beginStages,
    beginStage(job: GenerationJob, name: StageName) {
      return beginStages(job, [name]);
    },
    async authorizeStage(job: GenerationJob, name: StageName) {
      const now = clock();
      await store.transaction(async tx => {
        const state = await scheduler(tx, now);
        const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
        if (!options.enabled()) throw new GenerationError("generation_disabled");
        if (state.pauseReason) throw new GenerationError("generation_paused");
        if (name !== "base" && current.reviewBase && current.baseConfirmedAt === undefined) throw new GenerationError("base_not_ready");
        if (!generationStageNames(current).includes(name) || current.status !== "generating" || current.stages.find(stage => stage.name === name)?.status !== "inflight") throw new GenerationError("invalid_stage");
        await checkStageBudget(tx, job.id, now, budgetUsd());
      });
    },
    async recordRowAttemptFailure(job:GenerationJob,name:StageName,attempt:1|2,error:GenerationError){
      const now=clock();return store.transaction(async tx=>{
        const state=await scheduler(tx,now),current=await requireJobWithActiveWorkerLease(tx,state,job,now);
        if(!requiredStageNames(current).includes(name)||current.status!=="generating"||current.stages.find(stage=>stage.name===name)?.status!=="inflight")throw new GenerationError("invalid_stage");
        const entry:RowAttemptLog=rowAttemptLogSchema.parse({stage:name,attempt,at:now,code:error.code,diagnostic:error.diagnostic,cliCause:error.cliCause,details:error.details});
        const logs=current.rowAttemptLogs??[];
        if(logs.some(item=>item.stage===name&&item.attempt===attempt))return;
        await tx.putJob({...current,rowAttemptLogs:[...logs,entry]});
        if(error.code==="outcome_unknown")await recordStageCost(tx,job.id,now,undefined,name);
      });
    },
    async beginRowRetry(job:GenerationJob,name:StageName){
      const now=clock(),token=randomUUID();return store.transaction(async tx=>{
        const state=await scheduler(tx,now),current=await requireJobWithActiveWorkerLease(tx,state,job,now);
        if(!options.enabled())throw new GenerationError("generation_disabled");
        if(state.pauseReason)throw new GenerationError("generation_paused");
        const first=current.rowAttemptLogs?.find(log=>log.stage===name&&log.attempt===1);
        if(!requiredStageNames(current).includes(name)||current.status!=="generating"||current.stages.find(stage=>stage.name===name)?.status!=="inflight"||first?.code!=="outcome_unknown"||!isRetryableImageCause(first.cliCause)||current.rowRetries?.some(retry=>retry.stage===name))throw new GenerationError("invalid_stage");
        await checkStageBudget(tx,job.id,now,budgetUsd());
        const retry={stage:name,token,notBefore:now+ROW_RETRY_DELAY_MS,state:"waiting" as const};
        await tx.putJob({...current,rowRetries:[...(current.rowRetries??[]),retry]});return retry;
      });
    },
    async authorizeRowRetry(job:GenerationJob,name:StageName,token:string){
      const now=clock();return store.transaction(async tx=>{
        const state=await scheduler(tx,now),current=await requireJobWithActiveWorkerLease(tx,state,job,now);
        if(!options.enabled())throw new GenerationError("generation_disabled");
        if(state.pauseReason)throw new GenerationError("generation_paused");
        const retry=current.rowRetries?.find(item=>item.stage===name);
        if(!requiredStageNames(current).includes(name)||current.status!=="generating"||current.stages.find(stage=>stage.name===name)?.status!=="inflight"||!retry||retry.token!==token||retry.state!=="waiting"||retry.notBefore>now)throw new GenerationError("invalid_stage");
        await checkStageBudget(tx,job.id,now,budgetUsd());
        await tx.putJob({...current,rowRetries:current.rowRetries!.map(item=>item.stage===name?{...item,state:"started" as const}:item)});
      });
    },
    async saveStage(job: GenerationJob, name: StageName, bytes: Buffer, metadata: { usage?: ImageUsage; generationMs: number }) {
      const now = clock();
      if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new GenerationError("invalid_provider_result");
      const hash = createHash("sha256").update(bytes).digest("hex");
      return store.transaction(async tx => {
        const state = await scheduler(tx, now);
        const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
        const index = current.stages.findIndex(stage => stage.name === name);
        if (!generationStageNames(current).includes(name) || index < 0) throw new GenerationError("invalid_stage");
        if (current.stages[index].status === "completed") {
          if (current.stages[index].sha256 !== hash) throw new GenerationError("stage_conflict");
          return current;
        }
        const stages = [...current.stages];
        stages[index] = { ...stages[index], ...metadata, status: "completed", sha256: hash };
        await tx.putArtifact(job.id, "stage-" + name + ".png", bytes, current.expiresAt);
        await recordStageCost(tx, job.id, now, metadata.usage, name);
        const updated = { ...current, stages, ...(current.rowRetries?{rowRetries:current.rowRetries.map(item=>item.stage===name?{...item,state:"completed" as const}:item)}:{}) };
        await tx.putJob(updated);
        if (state.active) state.active.inflight = stages.some(stage => stage.status === "inflight") || hasUnsettledAnimationAttempt(updated);
        await saveScheduler(tx, state);
        return updated;
      });
    },
    async beginCardMetadata(job:GenerationJob,requestHash:string){
      const now=clock();return store.transaction(async tx=>{
        const state=await scheduler(tx,now),current=await requireJobWithActiveWorkerLease(tx,state,job,now);
        if(!options.enabled())throw new GenerationError("generation_disabled");
        if(state.pauseReason)throw new GenerationError("generation_paused");
        if(current.status!=="processing"||current.cardMetadata?.state!=="pending"||!/^[a-f0-9]{64}$/.test(requestHash))throw new GenerationError("metadata_already_started");
        await checkStageBudget(tx,job.id,now,budgetUsd());
        const updated={...current,cardMetadata:{...current.cardMetadata,state:"inflight" as const,requestHash,startedAt:now}};
        await tx.putJob(updated);if(state.active)state.active.inflight=true;await saveScheduler(tx,state);return updated;
      });
    },
    async authorizeCardMetadata(job:GenerationJob){
      const now=clock();return store.transaction(async tx=>{
        const state=await scheduler(tx,now),current=await requireJobWithActiveWorkerLease(tx,state,job,now);
        if(!options.enabled())throw new GenerationError("generation_disabled");
        if(state.pauseReason)throw new GenerationError("generation_paused");
        if(current.status!=="processing"||current.cardMetadata?.state!=="inflight"||current.cardMetadata.requestHash!==job.cardMetadata?.requestHash)throw new GenerationError("metadata_already_started");
        await checkStageBudget(tx,job.id,now,budgetUsd());
      });
    },
    async saveCardMetadata(job:GenerationJob,result:CardMetadataResult){
      const fields=normalizeCardMetadata(result.fields),now=clock();
      if(!/^[a-f0-9]{64}$/.test(result.responseHash)||![result.costUsd,result.inputTokens,result.outputTokens].every(n=>Number.isFinite(n)&&n>=0))throw new GenerationError("metadata_unavailable");
      return store.transaction(async tx=>{
        const state=await scheduler(tx,now),current=await requireJobWithActiveWorkerLease(tx,state,job,now),card=current.cardMetadata;
        if(card?.state==="completed"&&card.responseHash===result.responseHash)return current;
        if(current.status!=="processing"||card?.state!=="inflight"||card.requestHash!==job.cardMetadata?.requestHash)throw new GenerationError("metadata_already_started");
        await recordStageCost(tx,job.id,now,{costUsd:result.costUsd},"card");
        const displayName=current.nameSource==="automatic"?(fields.displayName??current.displayName):current.displayName;
        const updated={...current,displayName,cardMetadata:{...card,state:"completed" as const,fields:{...fields,displayName},responseHash:result.responseHash,usage:{inputTokens:result.inputTokens,outputTokens:result.outputTokens,costUsd:result.costUsd}}};
        await tx.putJob(updated);if(state.active)state.active.inflight=false;await saveScheduler(tx,state);return updated;
      });
    },
    async failCardMetadata(job:GenerationJob,code:string){
      const error:NonNullable<CardMetadataRecord["error"]>=code==="provider_rejected"||code==="outcome_unknown"||code==="budget_exhausted"||code==="generation_disabled"?code:"metadata_unavailable";
      const now=clock();return store.transaction(async tx=>{
        const state=await scheduler(tx,now),current=await requireJobWithActiveWorkerLease(tx,state,job,now),card=current.cardMetadata;
        if(!card||current.status!=="processing")throw new GenerationError("metadata_already_started");
        if(card.state==="completed"||card.state==="failed")return current;
        await recordStageCost(tx,job.id,now,error==="outcome_unknown"?undefined:{costUsd:0},"card");
        if(error==="outcome_unknown")state.pauseReason="outcome_unknown";
        const updated={...current,cardMetadata:{...card,state:"failed" as const,error,fields:{description:CARD_METADATA_FALLBACK,tags:[]}}};
        await tx.putJob(updated);if(state.active)state.active.inflight=false;await saveScheduler(tx,state);return updated;
      });
    },
    async saveSource(job: GenerationJob, bytes: Buffer, metadata: { usage?: ImageUsage; providerRequestId?: string; generationMs: number }) {
      const now = clock();
      return store.transaction(async (tx) => {
        const state = await scheduler(tx, now);
        const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
        if (current.status === "processing") return current;
        if (current.status !== "generating") throw new GenerationError("stale_worker");
        if (current.continuation) {
          if (requiredStageNames(current).some(name => !current.stages.some(s => s.name === name && s.status === "completed"))) throw new GenerationError("invalid_stage");
        } else if (usesStageCheckpoints(current) && (current.stages.length !== requiredStageNames(current).length || current.stages.some((stage, index) => stage.status !== "completed" || stage.name !== requiredStageNames(current)[index]))) throw new GenerationError("invalid_stage");
        const processing: GenerationJob = { ...current, ...metadata, status: "processing", leaseUntil: now + LEASE_MS };
        await tx.putArtifact(job.id, "source.png", bytes, job.expiresAt);
        await tx.putJob(processing);
        state.active = { id: job.id, owner: job.worker, until: now + LEASE_MS, inflight: false };
        await saveScheduler(tx, state);
        return processing;
      });
    },
    async finish(job: GenerationJob, files: Record<string, Buffer>) {
      const now = clock();
      await store.transaction(async (tx) => {
        const state = await scheduler(tx, now);
        const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
        if (current.status !== "processing") throw new GenerationError("stale_worker");
        if(current.cardMetadata&&["pending","inflight"].includes(current.cardMetadata.state))throw new GenerationError("metadata_not_prepared");
        for (const [kind, bytes] of Object.entries(files)) await tx.putArtifact(job.id, kind, bytes, job.expiresAt);
        await tx.putJob({ ...current, ...(current.continuation && current.animationRevision ? {animationRevision:{...current.animationRevision,acceptedAt:current.animationRevision.acceptedAt??now}}:{}), status: "completed", prompt: "" });
        await settleBudget(tx, job.id, now);
        state.active = null;
        await saveScheduler(tx, state);
      });
    },
    async fail(job: GenerationJob, code: string, providerFailure?: unknown, failureDiagnostic?:unknown, stageDiagnostics:StageFailureDiagnostic[] = [], cliCauses:StageCliCause[] = [], assemblyIssues:import("./continuation-model").AssemblyIssue[] = []) {
      const now = clock();
      await store.transaction(async (tx) => {
        const state = await scheduler(tx, now);
        const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
        const diagnostic = readProviderFailure(providerFailure);
        const failure = readFailureDiagnostic(failureDiagnostic);
        const stages = stageDiagnostics.slice(0,12).flatMap(entry=>{
          const parsed=stageFailureDiagnosticSchema.safeParse({stage:entry.stage,diagnostic:readFailureDiagnostic(entry.diagnostic)});
          return parsed.success?[parsed.data]:[];
        });
        const causes=cliCauses.slice(0,12).flatMap(entry=>{const parsed=stageCliCauseSchema.safeParse(entry);return parsed.success?[parsed.data]:[];});
        await tx.putJob({ ...current, status: "failed", error: code, prompt: "",
          ...(current.baseRepair && current.baseRepair.phase!=="complete"?{baseRepair:{...current.baseRepair,phase:"stopped" as const}}:{}),
          ...(current.animationRepair && current.animationRepair.phase !== "complete" ? {animationRepair: {...current.animationRepair, phase: "stopped" as const}} : {}),
          ...(diagnostic ? { providerFailure: diagnostic } : {}),
          ...(failure ? {failureDiagnostic:failure}:{}),
          ...(stages.length ? {stageFailureDiagnostics:stages}:{}),
          ...(causes.length ? {cliFailureCauses:causes}:{}), ...(assemblyIssues.length?{assemblyIssues}:{}) });
        await settleBudget(tx, job.id, now, code === "outcome_unknown");
        const repairScope = new Set<StageName>(current.animationRepair ? getRepairScope(current) : []);
        // Quality retries keep the old completed image; the journal owns the new call.
        const unresolved=current.stages.filter(stage=>stage.status==="inflight" ||
          (repairScope.has(stage.name) && isAnimationState(stage.name) && latestAnimationAttempt(current,stage.name)?.status!=="saved"));
        // Only fully recorded provider failures are local to this terminal job.
        // Missing checkpoints, retry acknowledgements and leases still stop the queue.
        const terminalProviderFailure=code==="outcome_unknown"&&usesStageCheckpoints(current)
          &&current.status==="generating"&&(failure?.boundary==="provider_cli" || (current.baseRepair && !failure))
          &&unresolved.length>0&&causes.length===unresolved.length
          &&unresolved.every(stage=>{
            const matches=causes.filter(entry=>entry.stage===stage.name);
            const attempts=(current.rowAttemptLogs??[]).filter(log=>log.stage===stage.name);
            const repairLast=repairScope.has(stage.name)&&isAnimationState(stage.name)?latestAnimationAttempt(current,stage.name):undefined;
            const last=stage.name==="base"&&current.baseRepair
              ? (latestBaseAttempt(current)?.status==="failed"?latestBaseAttempt(current)?.failure:undefined)
              : repairScope.has(stage.name)
              ? (repairLast?.status==="failed"?repairLast.failure:undefined)
              : (attempts.find(log=>log.attempt===2)??attempts.find(log=>log.attempt===1));
            if(matches.length!==1||!last||(last.diagnostic?.boundary!=="provider_cli" && !(stage.name==="base"&&current.baseRepair&&!last.diagnostic)))return false;
            const cause=matches[0].cause;
            const reason=stage.name==="base"&&current.baseRepair?baseFailureRetryReason(last):animationFailureRetryReason(last);
            return (reason==="transport"||(reason==="moderation"&&cause.kind==="http_error"&&cause.httpStatus===400))
              &&last.cliCause?.kind===cause.kind&&last.cliCause?.httpStatus===cause.httpStatus;
          });
        if (code === "outcome_unknown"&&!terminalProviderFailure) state.pauseReason = code;
        state.active = null;
        await saveScheduler(tx, state);
      });
    },
  };
}

export const petGeneration = createGenerationService(generationStore, {
  enabled: generationEnabled, secret: readGenerationSecret,
  automaticCardMetadata:()=>true,
  automaticAnimationRepair: generationAnimationAutoRepairEnabled,
  baseRetries:generationBaseRetryEnabled,
  budgetUsd: () => {
    const limit = Number(process.env.PET_GENERATION_BUDGET_USD || "50");
    if (!Number.isFinite(limit) || limit <= 0 || limit > 50) throw new GenerationError("generation_not_configured");
    return limit;
  },
});
export type PublicGeneration = Awaited<ReturnType<typeof petGeneration.get>>;


async function findSubmissionSlug(base: string, tx: GenerationTransaction) {
  try { return await findAvailablePublicPetSlug(base, slugs => tx.listTakenSlugs(slugs)); }
  catch (error) {
    if (error instanceof PublicPetSlugUnavailableError) throw new GenerationError("public_slug_unavailable");
    throw error;
  }
}

function publicCard(job:GenerationJob,fields:CardMetadataFields):PublicCardMetadata{
  return {...fields,displayName:job.displayName,revision:job.cardMetadata?.revision??0,edited:job.cardMetadata?.edited??false,automaticState:job.cardMetadata?.state??"legacy",editable:job.status==="completed"&&!job.submission&&!isUnacceptedAnimationRevision(job)};
}

import { createHash } from "node:crypto";

import { normalizeGenerationReference } from "../../src/lib/pets/generation/input-runtime.mjs";
import { providerFailureDecision } from "../../src/lib/pets/generation/retry-policy-runtime.mjs";
import { generatePetBase, hatchV2Pet } from "./pet-generation-pipeline.mjs";

export class GenerationWorkerError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "GenerationWorkerError";
    this.code = code;
    this.ambiguous = options.ambiguous ?? false;
    this.busy = options.busy ?? false;
    this.cancelled = options.cancelled ?? false;
  }
}

export function createGenerationWorkerRuntime({ repository, provider, config, workerId, sleep = defaultSleep, log = logEvent }) {
  const expiresAt = () => new Date(Date.now() + config.artifactRetentionDays * 86_400_000).toISOString();

  async function processNextRun() {
    const candidate = await repository.findRunnableRun();
    if (!candidate) return false;
    const claimed = await repository.claimRun(candidate, workerId);
    if (!claimed) return false;
    const started = Date.now();
    const lockHeartbeat = heartbeat(repository, claimed.lease, config.leaseSeconds);
    let activeStage = claimed.lease.stage;
    try {
      const request = await repository.loadRequest(claimed.run.requestId);
      if (!request) throw new GenerationWorkerError("request_not_found", "Generation request was not found.");
      const version = `${claimed.run.baseRevision}:${claimed.run.targetedRetryCount}`;
      const ledgerProvider = {
        moderate: (input) => providerCall({
          stage: activeStage,
          operation: "moderation",
          model: "omni-moderation-latest",
          payload: fingerprintModeration(input),
          dispatch: () => provider.moderate(input),
          cache: (result) => ({ flagged: result.flagged }),
          version,
        }),
      };
      const invokeImage = async (stage, input) => {
        activeStage = stage;
        const { key } = resolveImageArtifactKeys(stage, claimed.run);
        const requestHash = providerRequestHash("image", fingerprintImage(input), version);
        const stored = await repository.readArtifact(claimed.run.id, key);
        if (stored) {
          await repository.reconcileProviderSuccess?.({ runId: claimed.run.id, stage, requestHash });
          return { image: stored.buffer, requestId: null, usage: { resumed: true } };
        }
        return providerCall({
          stage,
          operation: "image",
          model: config.model,
          payload: fingerprintImage(input),
          reserveImage: true,
          dispatch: () => provider.generateImage(input),
          beforeComplete: (result) => repository.putArtifact({
            runId: claimed.run.id, key, stage, fileName: `${key}.png`, contentType: "image/png",
            buffer: result.image, expiresAt: expiresAt(),
          }),
          cache: (result) => ({ byteSize: result.image.length }),
          version,
          requestHash,
        });
      };
      const onImageValidated = async (stage, image) => {
        const { alias } = resolveImageArtifactKeys(stage, claimed.run);
        await repository.putArtifact({
          runId: claimed.run.id, key: alias, stage, fileName: `${alias}.png`, contentType: "image/png",
          buffer: image, expiresAt: expiresAt(),
        });
      };
      const invokeReview = async (input) => {
        activeStage = "vision-review";
        return providerCall({
          stage: "vision-review",
          operation: "review",
          model: config.reviewModel,
          payload: { contact: digest(input.contactSheet), directions: digest(input.directionSheet) },
          dispatch: () => provider.review(input),
          cache: (result) => ({ review: result.review }),
          version,
        });
      };

      if (["queued_base", "generating_base"].includes(candidate.status)) {
        const referenceImage = request.referenceImage
          ? (await normalizeGenerationReference({
            buffer: request.referenceImage,
            declaredContentType: request.referenceContentType,
          })).buffer
          : undefined;
        await generatePetBase({
          prompt: request.prompt, referenceImage, provider: ledgerProvider, invokeImage, onImageValidated,
        });
        await requireRunUpdate(repository, claimed.run.id, {
          status: "awaiting_base_review", lastStage: "base", expectedStatuses: ["generating_base"],
        });
      } else {
        const base = await repository.readArtifact(claimed.run.id, "base");
        if (!base) throw new GenerationWorkerError("base_artifact_missing", "The approved base artifact is missing.");
        const result = await hatchV2Pet({
          prompt: request.prompt,
          baseImage: base.buffer,
          provider: ledgerProvider,
          invokeImage,
          invokeReview,
          onImageValidated,
        });
        await requireRunUpdate(repository, claimed.run.id, {
          status: "validating", lastStage: "assembly", expectedStatuses: ["generating"],
        });
        for (const artifact of result.artifacts) {
          await repository.putArtifact({
            runId: claimed.run.id,
            key: artifact.key,
            stage: artifact.stage,
            fileName: artifact.fileName,
            contentType: artifact.contentType,
            buffer: artifact.buffer,
            expiresAt: expiresAt(),
          });
        }
        if (!result.qa.pass) {
          activeStage = failedQaStage(result.qa.issues);
          throw new GenerationWorkerError("mechanical_qa_failed", "Deterministic sprite validation found blocking issues.");
        }
        await requireRunUpdate(repository, claimed.run.id, {
          status: "awaiting_final_review",
          lastStage: "vision-review",
          review: result.review,
          expectedStatuses: ["validating"],
        });
      }
      await repository.finishAttempt(claimed.lease, { status: "succeeded" });
      log({ event: "run_processed", runId: claimed.run.id, stage: activeStage, latencyMs: Date.now() - started });
      return true;
    } catch (error) {
      const normalized = normalizeFailure(error);
      if (!normalized.busy && !normalized.cancelled) {
        await repository.updateRun(claimed.run.id, {
          status: "failed", lastStage: activeStage,
          failureCode: normalized.code, failureMessage: normalized.message,
          expectedStatuses: ["generating_base", "generating", "validating"],
        });
      }
      await repository.finishAttempt(claimed.lease, {
        status: normalized.ambiguous ? "ambiguous" : "failed",
        errorCode: normalized.code,
        errorMessage: normalized.message,
        ambiguous: normalized.ambiguous,
      });
      log({ event: normalized.cancelled ? "run_cancelled" : "run_failed", runId: claimed.run.id, stage: activeStage,
        latencyMs: Date.now() - started, errorCode: normalized.code, ambiguous: normalized.ambiguous });
      return true;
    } finally {
      clearInterval(lockHeartbeat);
    }

    async function providerCall({ stage, operation, model, payload, reserveImage = false, dispatch, beforeComplete, cache, version, requestHash = providerRequestHash(operation, payload, version) }) {
      for (let retryNumber = 0; ; retryNumber += 1) {
        const begin = await repository.beginProviderAttempt({
          runId: claimed.run.id, stage, requestHash, model, owner: workerId, reserveImage,
        });
        if (begin.kind === "cached") {
          if (operation === "image") {
            throw new GenerationWorkerError("artifact_missing_after_success", "A completed image call has no artifact.");
          }
          const stored = parseUsage(begin.attempt.usageJson)?.result;
          if (!stored) throw new GenerationWorkerError("cached_result_missing", "A completed provider call has no cached result.");
          return stored;
        }
        if (begin.kind === "busy") throw new GenerationWorkerError("stage_busy", "Another worker owns this stage.", { busy: true });
        if (begin.kind === "ambiguous") throw new GenerationWorkerError(
          "ambiguous_provider_dispatch", "A prior provider call has an unknown outcome.", { ambiguous: true },
        );
        if (begin.kind === "budget") throw new GenerationWorkerError("image_call_budget_exhausted", "Image-generation call budget exhausted.");
        if (begin.kind === "cancelled") throw new GenerationWorkerError("run_cancelled", "Generation run was cancelled.", { cancelled: true });
        if (begin.kind !== "acquired") throw new GenerationWorkerError("run_not_found", "Generation run disappeared.");
        const callStarted = Date.now();
        const callHeartbeat = heartbeat(repository, begin.attempt, config.leaseSeconds);
        try {
          const result = await dispatch();
          if (beforeComplete) await beforeComplete(result);
          await repository.finishAttempt(begin.attempt, {
            status: "succeeded",
            providerRequestId: result.requestId,
            usage: { provider: result.usage ?? {}, result: cache(result) },
          });
          log({ event: "provider_call", runId: claimed.run.id, stage, operation,
            latencyMs: Date.now() - callStarted, byteSize: result.image?.length,
            usage: result.usage ?? {} });
          return result;
        } catch (error) {
          const failure = normalizeFailure(error);
          const decision = providerFailureDecision({ status: failure.status, responseReceived: failure.responseReceived }, retryNumber);
          await repository.finishAttempt(begin.attempt, {
            status: decision.kind === "fail" && decision.ambiguous ? "ambiguous" : "failed",
            errorCode: failure.code, errorMessage: failure.message,
            ambiguous: decision.kind === "fail" && decision.ambiguous,
          });
          if (decision.kind === "retry") {
            await sleep(decision.delayMs);
            continue;
          }
          throw new GenerationWorkerError(failure.code, failure.message, { ambiguous: decision.ambiguous });
        } finally {
          clearInterval(callHeartbeat);
        }
      }
    }
  }

  return { processNextRun };
}

function heartbeat(repository, attempt, leaseSeconds) {
  const timer = setInterval(() => {
    repository.heartbeat(attempt).catch(() => {});
  }, Math.max(10_000, Math.floor(leaseSeconds * 1_000 / 3)));
  timer.unref?.();
  return timer;
}
function fingerprintModeration(input) {
  return { text: input.text ? digest(Buffer.from(input.text)) : null, image: input.image ? digest(input.image) : null };
}
function fingerprintImage(input) {
  return { prompt: digest(Buffer.from(input.prompt)), size: input.size,
    references: (input.references ?? []).map((value) => digest(value)) };
}
function providerRequestHash(operation, payload, version) {
  return digest(Buffer.from(JSON.stringify({ operation, payload, version })));
}
export function resolveImageArtifactKeys(stage, run) {
  if (stage === "base") return {
    key: `work-base-r${run.baseRevision}-t${run.targetedRetryCount}`,
    alias: "base",
  };
  const alias = `source-${stage}`;
  if (run.targetedRetryCount > 0) return run.lastStage === stage
    ? { key: `work-${alias}-t${run.targetedRetryCount}`, alias }
    : { key: alias, alias };
  return { key: `work-${alias}-t0`, alias };
}
function failedQaStage(issues) {
  const issue = issues.find((value) => value.severity === "error");
  if (issue?.row >= 0 && issue.row <= 8) {
    return ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"][issue.row];
  }
  if (issue?.row === 9) return "look-row-9";
  if (issue?.row === 10) return "look-row-10";
  return "cardinal";
}
function parseUsage(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function normalizeFailure(error) {
  const value = error && typeof error === "object" ? error : {};
  return {
    code: typeof value.code === "string" ? value.code : "generation_error",
    message: error instanceof Error ? error.message : "Generation failed.",
    status: typeof value.status === "number" ? value.status : null,
    responseReceived: typeof value.responseReceived === "boolean" ? value.responseReceived : true,
    ambiguous: Boolean(value.ambiguous),
    busy: Boolean(value.busy),
    cancelled: Boolean(value.cancelled),
  };
}
async function requireRunUpdate(repository, runId, input) {
  if (!await repository.updateRun(runId, input)) {
    throw new GenerationWorkerError("run_cancelled", "Generation run changed or was cancelled.", { cancelled: true });
  }
}
function defaultSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function logEvent(value) { console.log(JSON.stringify(value)); }

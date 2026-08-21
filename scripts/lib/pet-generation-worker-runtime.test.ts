import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("./pet-generation-pipeline.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pet-generation-pipeline.mjs")>();
  return { ...actual, hatchV2Pet: vi.fn(actual.hatchV2Pet) };
});

import { hatchV2Pet, V2_ATLAS } from "./pet-generation-pipeline.mjs";
import { OpenAIProviderError } from "./pet-generation-provider.mjs";
import { createGenerationWorkerRuntime, resolveImageArtifactKeys } from "./pet-generation-worker-runtime.mjs";

async function basePng(): Promise<Buffer> {
  return sharp({
    create: { width: 1024, height: 1024, channels: 4, background: "magenta" },
  }).png().toBuffer();
}

function memoryRepository(input: { base?: Buffer; imageBudget?: boolean; cancelImage?: boolean; status?: "validating" } = {}) {
  const artifacts = new Map<string, { buffer: Buffer }>();
  if (input.base) {
    artifacts.set("base", { buffer: input.base });
    artifacts.set("work-base-r0-t0", { buffer: input.base });
  }
  const attempts = new Map<string, { status: string; usageJson: string }>();
  const updates: Array<Record<string, unknown>> = [];
  let claimed = false;
  let attemptNumber = 0;
  return {
    updates,
    artifacts,
    attempts,
    findRunnableRun: vi.fn(async () => ({
      id: "run_test", requestId: "req_test", status: input.status ?? "queued_base",
      baseRevision: 0, targetedRetryCount: 0, imageCallCount: 0,
    })),
    claimRun: vi.fn(async (run) => {
      if (claimed) return null;
      claimed = true;
      return { run: { ...run, status: input.status ?? "generating_base" }, lease: {
        runId: run.id, stage: input.status ? "assembly" : "base", attempt: 1, leaseToken: "lock",
      } };
    }),
    loadRequest: vi.fn(async () => ({ prompt: "test pet", referenceImage: null, referenceContentType: "" })),
    readArtifact: vi.fn(async (_runId, key) => artifacts.get(key) ?? null),
    putArtifact: vi.fn(async ({ key, buffer }) => { artifacts.set(key, { buffer }); }),
    beginProviderAttempt: vi.fn(async ({ requestHash, reserveImage }) => {
      if (reserveImage && input.cancelImage) return { kind: "cancelled" };
      if (reserveImage && input.imageBudget) return { kind: "budget" };
      const existing = attempts.get(requestHash);
      if (existing?.status === "succeeded") {
        return { kind: "cached", attempt: { usageJson: existing.usageJson } };
      }
      attemptNumber += 1;
      return { kind: "acquired", attempt: {
        runId: "run_test", stage: "base", attempt: attemptNumber,
        leaseToken: `attempt-${attemptNumber}`, requestHash,
      } };
    }),
    finishAttempt: vi.fn(async (attempt, result) => {
      if (attempt.requestHash) attempts.set(attempt.requestHash, {
        status: result.status,
        usageJson: JSON.stringify(result.usage ?? {}),
      });
    }),
    heartbeat: vi.fn(async () => {}),
    updateRun: vi.fn(async (_runId, update) => { updates.push(update); return true; }),
  };
}

function config() {
  return { model: "image-model", reviewModel: "review-model", artifactRetentionDays: 14, leaseSeconds: 120 };
}

describe("generation worker runtime", () => {
  it("uses revision keys for base rerolls and replaces only the targeted source on retry", () => {
    expect(resolveImageArtifactKeys("base", { baseRevision: 1, targetedRetryCount: 0, lastStage: "base" }))
      .toEqual({ key: "work-base-r1-t0", alias: "base" });
    expect(resolveImageArtifactKeys("running-left", {
      baseRevision: 1, targetedRetryCount: 1, lastStage: "running-left",
    })).toEqual({ key: "work-source-running-left-t1", alias: "source-running-left" });
    expect(resolveImageArtifactKeys("idle", {
      baseRevision: 1, targetedRetryCount: 1, lastStage: "running-left",
    })).toEqual({ key: "source-idle", alias: "source-idle" });
    for (const stage of ["cardinal", "look-row-9", "look-row-10"]) {
      expect(resolveImageArtifactKeys(stage, {
        baseRevision: 1, targetedRetryCount: 1, lastStage: "cardinal",
      }).key).toBe(`work-source-${stage}-t1`);
    }
  });

  it("lets only one competing worker dispatch the base image", async () => {
    const repository = memoryRepository();
    const image = await basePng();
    const provider = {
      moderate: vi.fn(async () => ({ flagged: false, requestId: "mod" })),
      generateImage: vi.fn(async () => ({ image, requestId: "img", usage: {} })),
    };
    const first = createGenerationWorkerRuntime({ repository, provider, config: config(), workerId: "one", log: () => {} });
    const second = createGenerationWorkerRuntime({ repository, provider, config: config(), workerId: "two", log: () => {} });

    await Promise.all([first.processNextRun(), second.processNextRun()]);

    expect(provider.generateImage).toHaveBeenCalledTimes(1);
    expect(repository.updates).toContainEqual(expect.objectContaining({ status: "awaiting_base_review" }));
  });

  it("resumes from a stored base without a duplicate image dispatch and rechecks moderation", async () => {
    const repository = memoryRepository({ base: await basePng() });
    const provider = {
      moderate: vi.fn(async () => ({ flagged: false, requestId: "mod" })),
      generateImage: vi.fn(),
    };
    const runtime = createGenerationWorkerRuntime({ repository, provider, config: config(), workerId: "one", log: () => {} });

    await runtime.processNextRun();

    expect(provider.generateImage).not.toHaveBeenCalled();
    expect(provider.moderate).toHaveBeenCalledTimes(2);
    expect(repository.updates.at(-1)).toMatchObject({ status: "awaiting_base_review" });
  });

  it("continues a validating run to final review", async () => {
    vi.mocked(hatchV2Pet).mockResolvedValueOnce({
      artifacts: [], qa: { pass: true, issues: [], atlas: V2_ATLAS, despillPasses: 1, lookDirections: [] },
      review: { pass: true, issues: [] }, chroma: "#00ff00",
    });
    const repository = memoryRepository({ base: await basePng(), status: "validating" });
    await createGenerationWorkerRuntime({ repository, provider: {}, config: config(), workerId: "one", log: () => {} })
      .processNextRun();

    expect(repository.updates[0]).toMatchObject({ status: "validating", expectedStatuses: ["generating", "validating"] });
    expect(repository.updates[1]).toMatchObject({ status: "awaiting_final_review", expectedStatuses: ["validating"] });
  });

  it("retries explicit 5xx responses at most twice and records every dispatch", async () => {
    const repository = memoryRepository();
    const image = await basePng();
    const provider = {
      moderate: vi.fn(async () => ({ flagged: false, requestId: "mod" })),
      generateImage: vi.fn()
        .mockRejectedValueOnce(new OpenAIProviderError("rejected", { status: 500, responseReceived: true, code: "server_error" }))
        .mockRejectedValueOnce(new OpenAIProviderError("rejected", { status: 503, responseReceived: true, code: "server_error" }))
        .mockResolvedValueOnce({ image, requestId: "img", usage: {} }),
    };
    const runtime = createGenerationWorkerRuntime({
      repository, provider, config: config(), workerId: "one", sleep: async () => {}, log: () => {},
    });

    await runtime.processNextRun();

    expect(provider.generateImage).toHaveBeenCalledTimes(3);
    expect(repository.beginProviderAttempt.mock.calls.filter(([value]) => value.reserveImage)).toHaveLength(3);
    expect(repository.updates.at(-1)).toMatchObject({ status: "awaiting_base_review" });
  });

  it("marks a lost provider response ambiguous and requires manual retry", async () => {
    const repository = memoryRepository();
    const provider = {
      moderate: vi.fn(async () => ({ flagged: false, requestId: "mod" })),
      generateImage: vi.fn(async () => { throw new OpenAIProviderError("lost", {
        responseReceived: false, code: "ambiguous_network_error",
      }); }),
    };
    const runtime = createGenerationWorkerRuntime({ repository, provider, config: config(), workerId: "one", log: () => {} });

    await runtime.processNextRun();

    expect(provider.generateImage).toHaveBeenCalledTimes(1);
    expect(repository.updates.at(-1)).toMatchObject({
      status: "failed", failureCode: "ambiguous_network_error",
    });
    expect(repository.finishAttempt.mock.calls.some(([, value]) => value.status === "ambiguous")).toBe(true);
  });

  it("keeps a moderation-rejected image quarantined from the admin alias", async () => {
    const repository = memoryRepository();
    const image = await basePng();
    const provider = {
      moderate: vi.fn()
        .mockResolvedValueOnce({ flagged: false, requestId: "input-mod" })
        .mockResolvedValueOnce({ flagged: true, requestId: "output-mod" }),
      generateImage: vi.fn(async () => ({ image, requestId: "img", usage: {} })),
    };
    const runtime = createGenerationWorkerRuntime({ repository, provider, config: config(), workerId: "one", log: () => {} });

    await runtime.processNextRun();

    expect(repository.artifacts.has("work-base-r0-t0")).toBe(true);
    expect(repository.artifacts.has("base")).toBe(false);
    expect(repository.updates.at(-1)).toMatchObject({ status: "failed", failureCode: "output_moderation_rejected" });
  });

  it("fails before dispatch when the image-call budget is exhausted", async () => {
    const repository = memoryRepository({ imageBudget: true });
    const provider = {
      moderate: vi.fn(async () => ({ flagged: false, requestId: "mod" })),
      generateImage: vi.fn(),
    };
    const runtime = createGenerationWorkerRuntime({ repository, provider, config: config(), workerId: "one", log: () => {} });

    await runtime.processNextRun();

    expect(provider.generateImage).not.toHaveBeenCalled();
    expect(repository.updates.at(-1)).toMatchObject({ status: "failed", failureCode: "image_call_budget_exhausted" });
  });

  it("does not resurrect a run cancelled before provider dispatch", async () => {
    const repository = memoryRepository({ cancelImage: true });
    const provider = {
      moderate: vi.fn(async () => ({ flagged: false, requestId: "mod" })),
      generateImage: vi.fn(),
    };
    const runtime = createGenerationWorkerRuntime({ repository, provider, config: config(), workerId: "one", log: () => {} });

    await runtime.processNextRun();

    expect(provider.generateImage).not.toHaveBeenCalled();
    expect(repository.updates.some((update) => update.status === "failed")).toBe(false);
  });
});

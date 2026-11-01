import {randomUUID} from "node:crypto";
import {expect, it} from "vitest";
import {publicJob} from "./public-job";
import {jobSchema} from "./model";
import {parseHistoryGeneration} from "./history";
import {animationRepairProgressText} from "./animation-repair-progress";

it("projects only safe repair progress without changing status or logical step bounds", () => {
  const id = "a".repeat(64), token = randomUUID();
  const job = jobSchema.parse({id, prompt: "private prompt", displayName: "Synthetic", status: "generating", createdAt: 1000, expiresAt: 100000,
    worker: "owner", promptRevision: "test", pipelineVersion: 2, stages: [], animationRepair: {policy: 1, maxAttempts: 4,
      phase: "repairing", pending: ["failed"], issues: [{state: "failed", kind: "invalid", frame: 1}], attempts: [
        {state: "failed", ordinal: 1, token, reason: "initial", status: "saved", reservedAt: 1000, notBefore: 1000,
          startedAt: 1000, finishedAt: 1001, resultSha256: "b".repeat(64), generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04}},
        {state: "failed", ordinal: 2, token: randomUUID(), reason: "quality", status: "reserved", reservedAt: 2000, notBefore: 7000, sourceSha256: "b".repeat(64)},
      ]}});
  const value = publicJob(job, 3000);
  expect(value.status).toBe("generating");
  expect(value.animationRepair).toMatchObject({maxAttempts: 4, phase: "repairing", rows: expect.arrayContaining([{state: "failed", attempts: 2, retrying: true}]), retryAt: new Date(7000).toISOString()});
  expect(JSON.stringify(value)).not.toMatch(new RegExp(token + "|private prompt|sourceSha256|resultSha256|reservedAt"));
  expect(parseHistoryGeneration(value, id)?.animationRepair).toEqual(value.animationRepair);
  expect(animationRepairProgressText(value.animationRepair)).toContain("Waiting before the next attempt");
  const stopped = publicJob({...job, status: "failed", error: "invalid_sprite_extraction"}, 3000);
  expect(stopped.animationRepair?.rows.every(row => !row.retrying)).toBe(true);
});

it.each(["queue_timeout", "provider_rejected"])("does not promise saved animations for %s before the first saved row", error => {
  const job = jobSchema.parse({id: "a".repeat(64), prompt: "", displayName: "Synthetic", status: "failed", error,
    createdAt: 1000, expiresAt: 100000, worker: "owner", promptRevision: "test", pipelineVersion: 2, stages: [],
    animationRepair: {policy: 1, maxAttempts: 4, phase: "initial", pending: [], issues: [], attempts: []}});
  const value = publicJob(job, 3000);
  expect(value.animationRepair?.phase).toBe("stopped");
  const text = animationRepairProgressText(value.animationRepair);
  expect(text).toContain("stopped");
  expect(text).not.toMatch(/saved animations|manual recovery/i);
});

import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService, petGeneration} from "./service";
import {MemoryStore} from "./test-store";
import {POST} from "@/app/api/pet-generations/[id]/confirm/route";

const origin = "https://pets.example";
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});
async function pendingReview() {
  const store = new MemoryStore(), clock = {now: Date.parse("2026-10-18T06:00:00Z")};
  const service = createGenerationService(store, {now: () => clock.now, enabled: () => true, secret: () => "synthetic-confirm-secret-at-least-32-characters"});
  await service.generate({prompt: "Synthetic fox", requestId: randomUUID()}, "203.0.113.5", {reviewBase: true});
  const job = (await service.claim("synthetic-owner"))!;
  await service.beginStage(job, "base");
  await service.saveStage(job, "base", Buffer.from("synthetic-base"), {generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .1}});
  await service.awaitConfirmation(job);
  vi.spyOn(petGeneration, "confirm").mockImplementation(service.confirm);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  const confirm = () => POST(new Request(`${origin}/api/pet-generations/${job.id}/confirm`, {method: "POST", headers: {origin}}), {params: Promise.resolve({id: job.id})});
  return {store, clock, service, job, confirm};
}

it.each(["job", "artifact", "scheduler", "budget"])("rolls back expired confirmation when the %s read crosses TTL", async read => {
  const {store, clock, job, confirm} = await pendingReview();
  const before = {jobs: structuredClone(store.jobs), ledger: structuredClone(store.ledger), artifacts: new Map([...store.artifacts].map(([key, value]) => [key, {...value, bytes: Buffer.from(value.bytes)}]))};
  clock.now = job.expiresAt - 1;
  const transaction = store.transaction.bind(store);
  vi.spyOn(store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const value = await tx.getJob(id); if (read === "job") clock.now = job.expiresAt + 1; return value;},
    getArtifact: async (...args) => {const value = await tx.getArtifact(...args); if (read === "artifact") clock.now = job.expiresAt + 1; return value;},
    getLedger: async (...args) => {const value = await tx.getLedger(...args); if (args[0] === read) clock.now = job.expiresAt + 1; return value;},
  })));
  const response = await confirm();
  expect(response.status).toBe(410);
  expect((await response.json()).code).toBe("generation_expired");
  expect(store.jobs).toEqual(before.jobs);
  expect(store.ledger).toEqual(before.ledger); // Queue, tracking, spent costs and daily quota all unchanged.
  expect(store.artifacts).toEqual(before.artifacts);
});

it("uses the decision clock for continuation timestamps after nonexpired reads", async () => {
  const {store, clock, job, confirm} = await pendingReview();
  const admittedAt = clock.now;
  const transaction = store.transaction.bind(store);
  vi.spyOn(store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getLedger: async (...args) => {const value = await tx.getLedger(...args); if (args[0] === "budget") clock.now += 50; return value;},
  })));
  expect((await confirm()).status).toBe(202);
  const saved = (await store.readJob(job.id))!;
  expect(saved.baseConfirmedAt).toBe(admittedAt + 50);
  expect(saved.queuedAt).toBe(admittedAt + 50);
  expect(saved.expiresAt).toBe(job.expiresAt);
});

it("does not acknowledge an already-confirmed job that expires during its read", async () => {
  const {store, clock, job, confirm} = await pendingReview();
  expect((await confirm()).status).toBe(202);
  const before = structuredClone(store.ledger);
  clock.now = job.expiresAt - 1;
  const transaction = store.transaction.bind(store);
  vi.spyOn(store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const value = await tx.getJob(id); clock.now = job.expiresAt + 1; return value;},
  })));
  expect((await confirm()).status).toBe(410);
  expect(store.ledger).toEqual(before);
});

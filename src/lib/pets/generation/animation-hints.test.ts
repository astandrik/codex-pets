import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {createGenerationService, petGeneration} from "./service";
import {MemoryStore} from "./test-store";
import {createSpriteGenerationWorker, type SpriteRenderer} from "./sprite-worker";
import {DAY, STAGE_NAMES, jobSchema} from "./model";
import {buildCardMetadataRequest} from "./card-provider";
import {POST} from "@/app/api/pet-generations/[id]/confirm/route";

const hint = "Вправо — поворачивает голову вправо. Влево — влево. При прыжке поджимает лапы.";
const origin = "https://pets.example";
beforeEach(() => {vi.stubEnv("PET_GENERATION_ANIMATION_HINTS_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});
async function fixture() {
  const store = new MemoryStore(), clock = {now: Date.parse("2026-10-20T10:00:00Z")};
  const service = createGenerationService(store, {now: () => clock.now, enabled: () => true, secret: () => "synthetic-animation-secret-at-least-32-characters"});
  const view = await service.generate({requestId: randomUUID(), prompt: "Blue fox"}, "203.0.113.7", {reviewBase: true});
  const job = (await service.claim("base-worker"))!;
  await service.beginStage(job, "base"); await service.saveStage(job, "base", Buffer.from("synthetic-base"), {generationMs: 1}); await service.awaitConfirmation(job);
  vi.spyOn(petGeneration, "confirm").mockImplementation(service.confirm);
  const confirm = (body?: string, headers: Record<string, string> = {}) => POST(new Request(origin + "/confirm", {
    method: "POST", headers: {origin, ...(body === undefined ? {} : {"content-type": "application/json"}), ...headers}, body,
  }), {params: Promise.resolve({id: view.generationId})});
  return {store, service, clock, id: view.generationId, confirm};
}
it("atomically saves normalized animation text, exposes the accepted value and preserves quota/expiry", async () => {
  const f = await fixture(); const quota = [...f.store.ledger].filter(([k]) => /^(ip|day):/.test(k));
  const response = await f.confirm(JSON.stringify({animationPrompt: "  Вправо\r\nВлево  "}));
  expect(response.status).toBe(202);
  expect((await response.json()).generation.animationPrompt).toBe("Вправо\nВлево");
  expect(jobSchema.parse(await f.store.readJob(f.id)).animationPrompt).toBe("Вправо\nВлево");
  expect((await f.service.get(f.id)).animationPrompt).toBe("Вправо\nВлево");
  expect((await f.store.readJob(f.id))!.expiresAt).toBe(f.clock.now + DAY);
  expect([...f.store.ledger].filter(([k]) => /^(ip|day):/.test(k))).toEqual(quota);
});
it.each([undefined, "", "{}", JSON.stringify({animationPrompt: " \r\n "})])("preserves the legacy empty confirmation (%s)", async body => {
  const f = await fixture(); vi.stubEnv("PET_GENERATION_ANIMATION_HINTS_ENABLED", "false");
  expect((await f.confirm(body)).status).toBe(202);
  expect(await f.service.get(f.id)).not.toHaveProperty("animationPrompt");
});
it.each(["{", "null", "[]", JSON.stringify({animationPrompt: 1}), JSON.stringify({animationPrompt: null}), JSON.stringify({animationPrompt: "a".repeat(2001)}), JSON.stringify({unexpected: true})])("rejects invalid hints without confirming (%s)", async body => {
  const f = await fixture(); const jobs = structuredClone(f.store.jobs), ledger = structuredClone(f.store.ledger);
  expect((await f.confirm(body)).status).toBe(400); expect(f.store.jobs).toEqual(jobs); expect(f.store.ledger).toEqual(ledger);
});
it("bounds the actual body and checks Origin before reading it", async () => {
  const f = await fixture();
  expect((await f.confirm(JSON.stringify({animationPrompt: "a".repeat(17000)}))).status).toBe(413);
  expect((await f.confirm(JSON.stringify({animationPrompt: hint}), {origin: "https://other.example"})).status).toBe(403);
  expect((await f.confirm(JSON.stringify({animationPrompt: hint}), {"content-type": "text/plain"})).status).toBe(400);
  expect((await f.service.get(f.id)).status).toBe("awaiting_confirmation");
});
it("defaults admission off but permits a saved confirmation replay after disabling hints", async () => {
  const f = await fixture(); vi.stubEnv("PET_GENERATION_ANIMATION_HINTS_ENABLED", "");
  const denied = await f.confirm(JSON.stringify({animationPrompt: hint}));
  expect(denied.status).toBe(503); expect((await denied.json()).code).toBe("animation_hints_disabled");
  expect((await f.service.get(f.id)).status).toBe("awaiting_confirmation");
  vi.stubEnv("PET_GENERATION_ANIMATION_HINTS_ENABLED", "true"); await f.confirm(JSON.stringify({animationPrompt: hint}));
  vi.stubEnv("PET_GENERATION_ANIMATION_HINTS_ENABLED", "false");
  const replay = await f.confirm(JSON.stringify({animationPrompt: "different"}));
  expect(replay.status).toBe(200); expect((await replay.json()).generation.animationPrompt).toBe(hint);
});
it("keeps the first accepted text under concurrent confirmations with different input", async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([f.confirm(JSON.stringify({animationPrompt: hint})), f.confirm(JSON.stringify({animationPrompt: "other"}))]);
  expect([a.status, b.status]).toEqual([202, 200]);
  expect((await b.json()).generation.animationPrompt).toBe(hint);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).queue).toEqual([f.id]);
});
it.each(["queue", "budget", "expiry", "write"])("does not save hints on %s failure", async failure => {
  const f = await fixture();
  if (failure === "queue") {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "5");
    const state = JSON.parse(f.store.ledger.get("scheduler")!.value); state.queue = Array.from({length: 5}, (_, i) => String(i));
    // Keep queued entries live so expireQueue cannot remove them.
    const base = (await f.store.readJob(f.id))!;
    for (const id of state.queue) f.store.jobs.set(id, {...base, id, status: "queued", queuedAt: f.clock.now});
    f.store.ledger.get("scheduler")!.value = JSON.stringify(state);
  }
  if (failure === "budget") {
    const budget = JSON.parse(f.store.ledger.get("budget")!.value); budget.spent["2026-10-20"] = 50_000_000;
    f.store.ledger.get("budget")!.value = JSON.stringify(budget);
  }
  const transaction = f.store.transaction.bind(f.store);
  if (failure === "write" || failure === "expiry") vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    putJob: async job => {if (failure === "write") throw Error("synthetic write failure"); await tx.putJob(job);},
    getLedger: async (...args) => {const value = await tx.getLedger(...args); if (failure === "expiry" && args[0] === "budget") f.clock.now += DAY; return value;},
  })));
  const jobs = structuredClone(f.store.jobs), ledger = structuredClone(f.store.ledger);
  expect((await f.confirm(JSON.stringify({animationPrompt: hint}))).status).toBe(failure === "write" ? 503 : failure === "expiry" ? 410 : 429);
  expect(f.store.jobs).toEqual(jobs); expect(f.store.ledger).toEqual(ledger);
});
it("recovers a lost commit acknowledgement with the accepted text", async () => {
  const f = await fixture(); const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(async operation => {await transaction(operation); throw Error("lost commit acknowledgement");});
  const response = await f.confirm(JSON.stringify({animationPrompt: hint}));
  expect(response.status).toBe(200); expect((await response.json()).generation.animationPrompt).toBe(hint);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).queue).toEqual([f.id]);
});
it("resumes the approved reference after worker restart and flag-off without repeating base or the daily attempt", async () => {
  const f = await fixture(); const quota = [...f.store.ledger].filter(([k]) => /^(ip|day):/.test(k));
  await f.confirm(JSON.stringify({animationPrompt: hint})); vi.stubEnv("PET_GENERATION_ANIMATION_HINTS_ENABLED", "false");
  const generate = vi.fn(async () => ({bytes: Buffer.from("row"), generationMs: 1}));
  const open = vi.fn<SpriteRenderer["open"]>(async () => ({prepare: async () => undefined, generate, compose: async () => Buffer.from("atlas"), cleanup: async () => undefined}));
  const restarted = createGenerationService(f.store, {now: () => f.clock.now, enabled: () => true, secret: () => "synthetic-animation-secret-at-least-32-characters"});
  const worker = createSpriteGenerationWorker({service: restarted, store: f.store, now: () => f.clock.now, renderer: {open}, build: async () => ({"pet.zip": Buffer.from("synthetic")})});
  expect(await worker("after-restart")).toBe("completed"); expect(generate).toHaveBeenCalledTimes(STAGE_NAMES.length - 1);
  const job = open.mock.calls[0][0]; expect(job.animationPrompt).toBe(hint); expect(open.mock.calls[0][1].get("base")).toEqual(Buffer.from("synthetic-base"));
  expect(JSON.stringify(buildCardMetadataRequest(job, Array(4).fill("data:image/png;base64,AA==")))).not.toContain(hint);
  expect([...f.store.ledger].filter(([k]) => /^(ip|day):/.test(k))).toEqual(quota);
});

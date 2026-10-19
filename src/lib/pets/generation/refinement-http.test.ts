import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {createGenerationService, petGeneration} from "./service";
import {MemoryStore} from "./test-store";
import {POST} from "@/app/api/pet-generations/[id]/refine/route";
import GeneratedPetPage from "@/app/generated/[id]/page";

let store: MemoryStore; let service: ReturnType<typeof createGenerationService>;
const origin = "https://pets.example";
const context = (id: string) => ({params: Promise.resolve({id})});
const request = (input: unknown, headers: Record<string, string> = {}) => new Request(origin + "/refine", {method: "POST", headers: {origin, "content-type": "application/json", "x-pets-client-ip": "203.0.113.8", ...headers}, body: JSON.stringify(input)});
async function parent() {
  const result = await service.generate({prompt: "Synthetic fox", requestId: randomUUID()}, "203.0.113.8", {reviewBase: true});
  const active = (await service.claim("parent"))!; await service.beginStage(active, "base");
  const bytes = await sharp({create: {width: 8, height: 8, channels: 4, background: "red"}}).png().toBuffer();
  await service.saveStage(active, "base", bytes, {generationMs: 1}); await service.awaitConfirmation(active); return result.generationId;
}
beforeEach(() => {
  store = new MemoryStore(); service = createGenerationService(store, {enabled: () => true, secret: () => "synthetic-http-refinement-secret-long-enough"});
  vi.spyOn(petGeneration, "generate").mockImplementation(service.generate);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});

it("admits from the private saved base with fixed review policy and no source disclosure", async () => {
  const id = await parent(); const input = {requestId: randomUUID(), prompt: "Red scarf\r\nKeep the face"};
  const response = await POST(request(input), context(id)); const body = await response.json();
  expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(body.generation).toMatchObject({reviewBase: true, baseConfirmed: false, status: "queued"});
  expect(body.generation.generationId).not.toBe(id); expect(JSON.stringify(body)).not.toMatch(new RegExp(id + "|sourceSha256|reference.png|sourceBaseId"));
  expect((await store.readJob(body.generation.generationId))?.prompt).toBe("Red scarf\nKeep the face");
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
  const retry = await POST(request(input), context(id)); expect(retry.status).toBe(202); expect((await retry.json()).generation.generationId).toBe(body.generation.generationId);
  expect((await POST(request({...input, requestId: randomUUID()}), context(id))).status).toBe(503);
  expect(store.jobs.size).toBe(2);
});

it("rejects origin, malformed IDs, oversized input and client policy overrides before admission", async () => {
  const id = await parent(); const input = {requestId: randomUUID(), prompt: "Red scarf"};
  expect((await POST(request(input, {origin: "https://evil.example"}), context(id))).status).toBe(403);
  expect((await POST(request(input), context("../reference.png"))).status).toBe(400);
  for (const bad of [null, [], {...input, prompt: " "}, {...input, reviewBase: false}, {...input, sourceBaseId: "a".repeat(64)}, {...input, displayName: "Override"}]) expect((await POST(request(bad), context(id))).status).toBe(400);
  expect((await POST(request({...input, prompt: "x".repeat(17000)}), context(id))).status).toBe(413);
  expect(store.jobs.size).toBe(1); expect(store.ledger.get("day:" + new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10))?.value).toBe("1");
});

it("replays a committed new version after losing its commit acknowledgement", async () => {
  const id = await parent(); const input = {requestId: randomUUID(), prompt: "Blue scarf"};
  const transaction = store.transaction.bind(store);
  vi.spyOn(store, "transaction").mockImplementationOnce(async operation => {await transaction(operation); throw Error("synthetic lost commit ack");});
  expect((await POST(request(input), context(id))).status).toBe(503);
  const accepted = await POST(request(input), context(id)); expect(accepted.status).toBe(202); expect(store.jobs.size).toBe(2);
  const child = (await accepted.json()).generation.generationId;
  expect(JSON.parse(store.ledger.get("scheduler")!.value).queue).toEqual([child]);
});

it("accepts only a distinct capability ID as the previous-version navigation hint", async () => {
  const id = "a".repeat(64), previous = "b".repeat(64);
  expect((await GeneratedPetPage({params: Promise.resolve({id}), searchParams: Promise.resolve({from: previous})})).props.previousGenerationId).toBe(previous);
  for (const from of [id, "https://evil.example/private", [previous]]) expect((await GeneratedPetPage({params: Promise.resolve({id}), searchParams: Promise.resolve({from})})).props.previousGenerationId).toBeUndefined();
});

it.each(["generation_paused", "generation_disabled", "generation_review_disabled", "saved_stage_unavailable", "client_ip_unavailable"])("returns a definite503 %s with no new job or quota", async code => {
  const id = await parent();
  if (code === "generation_paused") {
    const row = store.ledger.get("scheduler")!; row.value = JSON.stringify({...JSON.parse(row.value), pauseReason: "outcome_unknown"});
  }
  if (code === "generation_disabled") {
    const disabled = createGenerationService(store, {enabled: () => false, secret: () => "synthetic-http-refinement-secret-long-enough"});
    vi.mocked(petGeneration.generate).mockImplementation(disabled.generate);
  }
  if (code === "generation_review_disabled") vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
  if (code === "saved_stage_unavailable") store.artifacts.get(id + ":stage-base.png")!.bytes = Buffer.from("synthetic corrupt saved base");
  const before = {jobs: structuredClone([...store.jobs]), ledger: structuredClone([...store.ledger]), artifacts: [...store.artifacts]};
  const response = await POST(request({requestId: randomUUID(), prompt: "Scarf red"}, code === "client_ip_unavailable" ? {"x-pets-client-ip": ""} : {}), context(id));
  expect(response.status).toBe(503); expect((await response.json()).code).toBe(code);
  expect([...store.jobs]).toEqual(before.jobs); expect([...store.ledger]).toEqual(before.ledger); expect([...store.artifacts]).toEqual(before.artifacts);
});


it("a post-dedup refusal cannot settle an older request still waiting to start its transaction", async () => {
  const id = await parent(), input = {requestId: randomUUID(), prompt: "Scarf red"};
  const transaction = store.transaction.bind(store);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  vi.spyOn(store, "transaction").mockImplementationOnce(async operation => {await gate; return transaction(operation);});
  const earlier = service.generate(input, "203.0.113.8", {reviewBase: true, sourceBaseId: id, allowNew: true});
  try {
    await expect(service.generate(input, "203.0.113.8", {reviewBase: true, sourceBaseId: id, allowNew: false})).rejects.toMatchObject({code: "generation_review_disabled"});
    expect(store.jobs.size).toBe(1);
  } finally {release();}
  const accepted = await earlier;
  expect(accepted.status).toBe("queued"); expect(store.jobs.size).toBe(2);
  expect((await service.generate(input, "203.0.113.8", {reviewBase: true, sourceBaseId: id, allowNew: false})).generationId).toBe(accepted.generationId);
});

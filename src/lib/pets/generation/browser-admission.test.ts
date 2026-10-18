import {createHash, createHmac, randomUUID} from "node:crypto";
import sharp from "sharp";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {POST} from "@/app/api/pet-generations/route";
import {createGenerationService, petGeneration} from "./service";
import {MemoryStore} from "./test-store";
import {createSpriteGenerationWorker} from "./sprite-worker";
import type {GenerationInput, GenerationJob} from "./model";

const origin = "https://pets.example", secret = "browser-admission-test-secret-at-least-32-characters";
const now = Date.parse("2026-10-18T09:00:00Z");
let store: MemoryStore, service: ReturnType<typeof createGenerationService>;
beforeEach(() => {
  store = new MemoryStore();
  service = createGenerationService(store, {now: () => now, enabled: () => true, secret: () => secret});
  vi.spyOn(petGeneration, "generate").mockImplementation(service.generate);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});
function request(input: GenerationInput, multipart = true, image?: Buffer) {
  const headers = new Headers({origin, "x-pets-client-ip": "203.0.113.5"});
  if (!multipart) {
    headers.set("content-type", "application/json");
    return new Request(origin + "/api/pet-generations", {method: "POST", headers, body: JSON.stringify(input)});
  }
  const form = new FormData();
  form.set("prompt", input.prompt); form.set("requestId", input.requestId);
  if (input.displayName !== undefined) form.set("displayName", input.displayName);
  if (image) form.set("referenceImage", new Blob([new Uint8Array(image)], {type: "image/png"}), "synthetic.png");
  return new Request(origin + "/api/pet-generations", {method: "POST", headers, body: form});
}
const input = (prompt = "Synthetic fox"): GenerationInput => ({prompt, requestId: randomUUID()});
const image = (color: string) => sharp({create: {width: 8, height: 8, channels: 4, background: color}}).png().toBuffer();

// Formula and record shape from0fe95bf, independent of the current service's admission path.
function oldDigest(domain: string, value: string) {return createHmac("sha256", secret).update(domain + "\0" + value).digest("hex");}
function seedOldRequest(body: GenerationInput, reference?: Buffer, reviewBase = true) {
  const id = "a".repeat(64), expiresAt = now + 86_400_000;
  const hash = oldDigest("body", JSON.stringify({prompt: body.prompt.trim(), displayName: body.displayName?.trim() ?? "Generated pet", ...(reference ? {referenceSha256: createHash("sha256").update(reference).digest("hex")} : {})}));
  const job: GenerationJob = {id, prompt: "", displayName: "Edited after completion", status: "completed", createdAt: now, expiresAt, worker: "", promptRevision: "pet-v2-review-20261017-1", pipelineVersion: 2, stages: [], ...(reviewBase ? {reviewBase: true, baseConfirmedAt: now} : {})};
  store.jobs.set(id, job);
  store.ledger.set("request:" + oldDigest("request", body.requestId), {value: JSON.stringify({hash, id, expiresAt: now + 7 * 86_400_000, nameProvided: body.displayName !== undefined}), expiresAt: now + 7 * 86_400_000});
  return job;
}

it.each(["false", "true"])("completes legacy JSON automatically with review flag=%s", async flag => {
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", flag);
  const response = await POST(request(input(), false)); expect(response.status).toBe(202);
  const id = (await response.json()).generation.generationId;
  const generate = vi.fn(async () => ({bytes: Buffer.from("synthetic-stage"), generationMs: 1, usage: {costUsd: .001, textInputTokens: 1, imageInputTokens: 0, outputTokens: 1}}));
  const worker = createSpriteGenerationWorker({service, store, now: () => now,
    renderer: {open: async () => ({prepare: async () => undefined, generate, compose: async () => Buffer.from("synthetic-atlas"), cleanup: async () => undefined})},
    build: async () => ({"pet.zip": Buffer.from("synthetic-zip")}),
  });
  expect(await worker("synthetic")).toBe("completed"); expect(generate).toHaveBeenCalledTimes(12);
  expect((await store.readJob(id))?.reviewBase).toBeUndefined();
});

it("preserves saved review policy when an existing job is replayed over JSON", async () => {
  const body = input(), saved = seedOldRequest(body);
  const ledger = structuredClone(store.ledger);
  const response = await POST(request(body, false)); expect(response.status).toBe(202);
  expect((await response.json()).generation).toMatchObject({generationId: saved.id, reviewBase: true});
  expect(store.jobs.get(saved.id)).toEqual(saved); expect(store.ledger).toEqual(ledger);
});

it.each(["\n", "\r\n", "\r"])("normalizes multipart line ending%j before length validation", async newline => {
  const body = {...input(" " + "a".repeat(999) + newline + "b".repeat(1000) + " "), displayName: " Fox" + newline + "Companion "};
  const wire = request(body);
  expect((await wire.clone().formData()).get("prompt")).toBe(" " + "a".repeat(999) + "\r\n" + "b".repeat(1000) + " ");
  const response = await POST(wire); expect(response.status).toBe(202);
  const job = store.jobs.get((await response.json()).generation.generationId)!;
  expect(job.prompt).toBe("a".repeat(999) + "\n" + "b".repeat(1000));
  expect(job.displayName).toBe("Fox\nCompanion");
});

it.each(["a".repeat(1000) + "\n" + "b".repeat(1000), "", " \r\n "])("rejects invalid canonical multipart text without admission", async prompt => {
  expect((await POST(request(input(prompt)))).status).toBe(400);
  expect(store.jobs.size).toBe(0); expect(store.ledger.size).toBe(0);
});

it.each([false, true])("replays a pre-upgrade JSON LF request as multipart, flag=%s", async flag => {
  const body = input("Synthetic fox\nRed scarf"), job = seedOldRequest(body, undefined, false);
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", String(flag));
  const ledger = structuredClone(store.ledger);
  const response = await POST(request(body)); expect(response.status).toBe(202);
  expect((await response.json()).generation.generationId).toBe(job.id);
  expect(store.jobs.size).toBe(1); expect(store.jobs.get(job.id)).toEqual(job); expect(store.ledger).toEqual(ledger);
});

it.each([false, true])("replays a completed pre-upgrade multipart request with image=%s despite cleared prompt and flag-off", async withImage => {
  const reference = withImage ? await image("blue") : undefined;
  const body = {...input("Synthetic fox\nRed scarf"), displayName: "Fox\nCompanion"};
  const legacy = {...body, prompt: body.prompt.replace(/\n/g, "\r\n"), displayName: body.displayName.replace(/\n/g, "\r\n")};
  const job = seedOldRequest(legacy, reference);
  const ledger = structuredClone(store.ledger);
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
  const response = await POST(request(body, true, reference)); expect(response.status).toBe(202);
  expect((await response.json()).generation.generationId).toBe(job.id);
  expect(store.jobs.size).toBe(1); expect(store.jobs.get(job.id)).toEqual(job); expect(store.ledger).toEqual(ledger);
});

it("replays new multiline image requests once, rejects changed inputs and charges only explicit new UUIDs", async () => {
  const reference = await image("blue"), body = input("Synthetic fox\nKeep scarf\nRed hat");
  const first = await POST(request(body, true, reference)); expect(first.status).toBe(202);
  const id = (await first.json()).generation.generationId;
  const before = structuredClone({jobs: store.jobs, ledger: store.ledger});
  for (const changed of [body, {...body, prompt: body.prompt.replace(/\n/g, "\r\n")}]) {
    const retry = await POST(request(changed, true, reference)); expect(retry.status).toBe(202);
    expect((await retry.json()).generation.generationId).toBe(id);
  }
  for (const changed of [{...body, prompt: body.prompt + " changed"}, {...body, displayName: "Other"}, {...body, displayName: "Generated pet"}]) {
    expect((await POST(request(changed, true, reference))).status).toBe(409);
  }
  expect((await POST(request(body, true, await image("red")))).status).toBe(409);
  expect(store.jobs).toEqual(before.jobs); expect(store.ledger).toEqual(before.ledger);
  const next = await POST(request({...body, requestId: randomUUID()}, true, reference)); expect(next.status).toBe(202);
  expect((await next.json()).generation.generationId).not.toBe(id); expect(store.jobs.size).toBe(2);
});

it("rejects changed text, name presence or image when replaying an old multipart fingerprint", async () => {
  const body = input("Synthetic fox\nRed scarf"), reference = await image("blue");
  seedOldRequest({...body, prompt: body.prompt.replaceAll("\n", "\r\n")}, reference);
  const before = structuredClone(store.ledger);
  for (const changed of [{...body, prompt: "Other\nRed scarf"}, {...body, displayName: "Generated pet"}]) {
    expect((await POST(request(changed, true, reference))).status).toBe(409);
  }
  expect((await POST(request(body, true, await image("red")))).status).toBe(409);
  expect(store.jobs.size).toBe(1); expect(store.ledger).toEqual(before);
});

it.each(["json", "service"])("preserves exact CRLF text and old fingerprints over%s", async transport => {
  const body = {...input("Fox\r\nScarf"), displayName: "Fox"};
  if (transport === "json") expect((await POST(request(body, false))).status).toBe(202);
  else await service.generate(body, "203.0.113.5");
  const record = JSON.parse(store.ledger.get("request:" + oldDigest("request", body.requestId))!.value);
  expect(record.hash).toBe(oldDigest("body", JSON.stringify({prompt: body.prompt, displayName: "Fox"})));
  expect([...store.jobs.values()][0].prompt).toBe(body.prompt);
  if (transport === "json") expect((await POST(request(body, false))).status).toBe(202);
  else await service.generate(body, "203.0.113.5");
  expect(store.jobs.size).toBe(1);
});

it("rejects unrelated internal legacy aliases and client-supplied aliases", async () => {
  const body = input("Fox\nScarf"), old = {...body, prompt: "Other\r\nScarf"};
  await expect(service.generate(body, "203.0.113.5", {reviewBase: true, legacyMultipartInput: old})).rejects.toMatchObject({code: "invalid_argument"});
  const form = new FormData(); form.set("prompt", body.prompt); form.set("requestId", body.requestId); form.set("legacyMultipartInput", JSON.stringify(old));
  expect((await POST(new Request(origin + "/api/pet-generations", {method: "POST", headers: {origin}, body: form}))).status).toBe(400);
  expect(store.jobs.size).toBe(0); expect(store.ledger.size).toBe(0);
});

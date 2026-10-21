import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {petGeneration, createGenerationService} from "./service";
import {generationStore} from "./store";
import {MemoryStore} from "./test-store";
import {createSpriteGenerationWorker, type SpriteRenderer} from "./sprite-worker";
import {POST as admit} from "@/app/api/pet-generations/route";
import {POST as confirm} from "@/app/api/pet-generations/[id]/confirm/route";
import {GET as base} from "@/app/api/pet-generations/[id]/base/route";
import {GET as file} from "@/app/api/pet-generations/[id]/files/[file]/route";
import {GET as status} from "@/app/api/pet-generations/[id]/route";

let store: MemoryStore;
let service: ReturnType<typeof createGenerationService>;
const origin = "https://pets.example";
const context = (id: string) => ({params: Promise.resolve({id})});
function post(path: string, body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request(origin + path, {method: "POST", headers: {origin, "x-pets-client-ip": "203.0.113.5", ...headers}, body});
}
beforeEach(() => {
  store = new MemoryStore();
  service = createGenerationService(store, {enabled: () => true, secret: () => "http-test-secret-at-least-32-characters"});
  vi.spyOn(petGeneration, "generate").mockImplementation(service.generate);
  vi.spyOn(petGeneration, "confirm").mockImplementation(service.confirm);
  vi.spyOn(petGeneration, "getBase").mockImplementation(service.getBase);
  vi.spyOn(petGeneration, "get").mockImplementation(service.get);
  vi.spyOn(generationStore, "readArtifact").mockImplementation(store.readArtifact.bind(store));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});

it("runs image-only HTTP admission through review, confirm and final private download", async () => {
  vi.stubEnv("PET_GENERATION_ANIMATION_HINTS_ENABLED", "true");
  const image = await sharp({create: {width: 32, height: 32, channels: 4, background: "red"}}).png().toBuffer();
  const idempotency = randomUUID();
  function upload(bytes = image) {const f = new FormData(); f.set("requestId", idempotency); f.set("referenceImage", new Blob([new Uint8Array(bytes)], {type: "image/png"}), "reference.png"); return f;}
  const accepted = await admit(post("/api/pet-generations", upload()));
  expect(accepted.status).toBe(202); const id = (await accepted.json()).generation.generationId;
  expect((await admit(post("/api/pet-generations", upload()))).status).toBe(202); expect(store.jobs.size).toBe(1);
  const different = await sharp(image).negate().png().toBuffer();
  expect((await admit(post("/api/pet-generations", upload(different)))).status).toBe(409);
  const generate = vi.fn(async () => ({bytes: image, generationMs: 1, usage: {costUsd: .1, textInputTokens: 1, imageInputTokens: 1, outputTokens: 1}}));
  const open = vi.fn<SpriteRenderer["open"]>(async () => ({prepare: async () => undefined, generate, compose: async () => image, cleanup: async () => undefined}));
  const worker = createSpriteGenerationWorker({service, store, renderer: {open}, build: async () => ({"pet.zip": Buffer.from("synthetic-zip")})});
  expect(await worker("one")).toBe("awaiting_confirmation"); expect(generate).toHaveBeenCalledOnce();
  expect(open.mock.calls[0]?.[2]).toEqual(store.artifacts.get(id + ":reference.png")?.bytes);
  const read = await status(new Request(origin), context(id)); const view = await read.json();
  expect(view.generation.status).toBe("awaiting_confirmation"); expect(view.generation.pollAfterSeconds).toBeUndefined();
  expect(JSON.stringify(view)).not.toMatch(/sourceSha256|reference.png/);
  const preview = await base(new Request(origin), context(id)); expect(preview.status).toBe(200);
  expect(Buffer.from(await preview.arrayBuffer())).toEqual(image); expect(preview.headers.get("cache-control")).toContain("no-store");
  for (const name of ["reference.png", "stage-base.png", "pet.zip"]) expect((await file(new Request(origin), {params: Promise.resolve({id, file: name})})).status).toBe(404);
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
  expect((await admit(post("/api/pet-generations", upload()))).status).toBe(202);
  const newUpload = upload(); newUpload.set("requestId", randomUUID());
  expect((await admit(post("/api/pet-generations", newUpload))).status).toBe(503);
  const motion = "Вправо — голова вправо; при прыжке поджимает лапы.";
  expect((await confirm(post("/confirm", JSON.stringify({animationPrompt: motion}), {"content-type": "application/json"}), context(id))).status).toBe(202);
  vi.stubEnv("PET_GENERATION_ANIMATION_HINTS_ENABLED", "false");
  expect((await confirm(post("/confirm"), context(id))).status).toBe(200);
  store.artifacts.delete(id + ":reference.png");
  expect(await worker("two")).toBe("completed"); expect(generate).toHaveBeenCalledTimes(12);
  expect(open.mock.calls[1][0].animationPrompt).toBe(motion);
  expect((await service.get(id)).animationPrompt).toBe(motion);
  const download = await file(new Request(origin), {params: Promise.resolve({id, file: "pet.zip"})});
  expect(download.status).toBe(200); expect(await download.text()).toBe("synthetic-zip");
});

it("keeps flag-off requests automatic and rejects browser-controlled approval policy", async () => {
  const input = {requestId: randomUUID(), prompt: "Fox"};
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "false");
  const response = await admit(post("/api/pet-generations", JSON.stringify(input), {"content-type": "application/json"}));
  expect(response.status).toBe(202); expect([...store.jobs.values()][0].reviewBase).toBeUndefined();
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
  for (const bad of [{requestId: randomUUID(), prompt: ""}, {...input, reviewBase: false}]) {
    expect((await admit(post("/api/pet-generations", JSON.stringify(bad), {"content-type": "application/json"}))).status).toBe(400);
  }
});

it("checks confirmation origin, readiness, private ID and base integrity", async () => {
  const accepted = await service.generate({prompt: "fox", requestId: randomUUID()}, "203.0.113.5", {reviewBase: true});
  const id = accepted.generationId;
  expect((await confirm(post("/confirm", undefined, {origin: "https://evil.example"}), context(id))).status).toBe(403);
  expect((await confirm(post("/confirm"), context(id))).status).toBe(409);
  expect((await base(new Request(origin), context("../reference.png"))).status).toBe(404);
  const worker = createSpriteGenerationWorker({service, store, renderer: {open: async () => ({prepare: async () => undefined, generate: async () => ({bytes: Buffer.from("base"), generationMs: 1}), compose: async () => Buffer.alloc(0), cleanup: async () => undefined})}});
  await worker("one"); store.artifacts.get(id + ":stage-base.png")!.bytes = Buffer.from("corrupt");
  expect((await confirm(post("/confirm"), context(id))).status).toBe(503);
  expect((await service.get(id)).status).toBe("awaiting_confirmation");
});

it("rolls back reference bytes, quota and queue if admission cannot commit its job", async () => {
  const image = await sharp({create: {width: 8, height: 8, channels: 4, background: "blue"}}).png().toBuffer();
  const form = new FormData(); form.set("requestId", randomUUID()); form.set("referenceImage", new Blob([new Uint8Array(image)], {type: "image/png"}), "test.png");
  const transaction = store.transaction.bind(store);
  vi.spyOn(store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx, putJob: async () => {throw Error("synthetic failed job write");}})));
  expect((await admit(post("/api/pet-generations", form))).status).toBe(503);
  expect(store.jobs.size).toBe(0); expect(store.artifacts.size).toBe(0); expect(store.ledger.size).toBe(0);
});

it.each(["missing", "corrupt"])("fails a %s reference before any provider call", async mode => {
  const image = await sharp({create: {width: 8, height: 8, channels: 4, background: "blue"}}).png().toBuffer();
  const form = new FormData(); form.set("requestId", randomUUID()); form.set("referenceImage", new Blob([new Uint8Array(image)], {type: "image/png"}), "test.png");
  const response = await admit(post("/api/pet-generations", form)); const id = (await response.json()).generation.generationId;
  if (mode === "missing") store.artifacts.delete(id + ":reference.png"); else store.artifacts.get(id + ":reference.png")!.bytes = Buffer.from("corrupt");
  const open = vi.fn<SpriteRenderer["open"]>();
  const worker = createSpriteGenerationWorker({service, store, renderer: {open}});
  expect(await worker("one")).toBe("failed"); expect(open).not.toHaveBeenCalled();
  expect((await service.get(id)).error?.code).toBe("saved_stage_unavailable");
});

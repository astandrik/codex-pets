import {createHash, randomUUID} from "node:crypto";
import sharp from "sharp";
import {describe, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker, type SpriteRenderer} from "./sprite-worker";
import {normalizeGenerationReference} from "./reference-image";
import {MemoryStore} from "./test-store";
import {DAY, STAGE_NAMES, type StageName} from "./model";

async function fixture() {
  const store = new MemoryStore();
  const config = {now: Date.parse("2026-10-18T10:00:00Z"), enabled: true};
  const service = createGenerationService(store, {now: () => config.now, enabled: () => config.enabled, secret: () => "synthetic-refinement-secret-long-enough"});
  const base = await sharp({create: {width: 8, height: 8, channels: 4, background: "#ffbf00"}}).png().toBuffer();
  const uploaded = await sharp({create: {width: 8, height: 8, channels: 4, background: "blue"}}).png().toBuffer();
  const parent = await service.generate({prompt: "Original blue character", displayName: "Pip", requestId: randomUUID()}, "203.0.113.9", {reviewBase: true, reference: await normalizeGenerationReference(uploaded, "image/png")});
  const job = (await service.claim("parent-owner"))!;
  await service.beginStage(job, "base");
  await service.saveStage(job, "base", base, {generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 1, outputTokens: 1, costUsd: .1}});
  const budget = JSON.parse(store.ledger.get("budget")!.value);
  budget.reservations[parent.generationId].unknown = true;
  store.ledger.get("budget")!.value = JSON.stringify(budget);
  await service.awaitConfirmation(job);
  const refine = (requestId = randomUUID(), sourceBaseId = parent.generationId, allowNew = true, prompt = "Make the scarf red") =>
    service.generate({requestId, prompt}, "203.0.113.9", {reviewBase: true, sourceBaseId, allowNew});
  return {store, service, config, parent, base, refine};
}

const quota = (store: MemoryStore) => [...store.ledger].filter(([key]) => key.startsWith("day:") || key.startsWith("ip:"));

describe("text refinement from a saved base", () => {
  it("creates one ordinary attempt from the saved base, preserves the original and animates only the chosen version", async () => {
    const f = await fixture();
    const parentBefore = structuredClone(await f.store.readJob(f.parent.generationId));
    f.config.now += 3_600_000;
    const child = await f.refine();
    const record = (await f.store.readJob(child.generationId))!;
    expect(record.reference?.sourceSha256).toBe(createHash("sha256").update(f.base).digest("hex"));
    const reference = await f.store.readArtifact(child.generationId, "reference.png", f.config.now);
    expect(reference).toBeDefined();
    const pixel = await sharp(reference!).raw().toBuffer();
    expect([...pixel.subarray(0, 4)]).toEqual([255, 191, 0, 255]);
    expect(record).toMatchObject({prompt: "Make the scarf red", displayName: "Pip", nameSource: "user", reviewBase: true, status: "queued", stages: []});
    expect(child.generationId).not.toBe(f.parent.generationId);
    expect(child.expiresAt).toBe("2026-10-19T11:00:00.000Z");
    expect(await f.store.readJob(f.parent.generationId)).toEqual(parentBefore);
    expect(await f.service.getBase(f.parent.generationId)).toEqual(f.base);
    expect(quota(f.store).map(([, row]) => row.value)).toEqual(["2", "2"]);
    expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.parent.generationId].unknown).toBe(true);

    const calls: StageName[] = [];
    const open = vi.fn<SpriteRenderer["open"]>(async () => ({prepare: async () => undefined, generate: async name => {
      calls.push(name); return {bytes: f.base, generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 1, outputTokens: 1, costUsd: .1}};
    }, compose: async () => Buffer.from("atlas"), cleanup: async () => undefined}));
    const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.config.now, renderer: {open}, build: async () => ({"pet.zip": Buffer.from("zip")})});
    expect(await worker("child-base")).toBe("awaiting_confirmation");
    expect(calls).toEqual(["base"]);
    expect(open.mock.calls[0][2]).toEqual(reference);
    const counted = quota(f.store);
    await f.service.confirm(child.generationId);
    expect(await worker("child-animations")).toBe("completed");
    expect(calls).toEqual([...STAGE_NAMES]);
    expect(quota(f.store)).toEqual(counted);
    expect((await f.service.get(f.parent.generationId)).status).toBe("awaiting_confirmation");
    expect(await f.service.getBase(f.parent.generationId)).toEqual(f.base);
  });

  it("deduplicates concurrent retries by source and text, even after the original expires and new admission is off", async () => {
    const f = await fixture(); f.config.now += 3_600_000;
    const request = randomUUID();
    const attempts = await Promise.all(Array.from({length: 8}, () => f.refine(request)));
    expect(new Set(attempts.map(item => item.generationId)).size).toBe(1);
    await expect(f.refine(request, "f".repeat(64))).rejects.toMatchObject({code: "request_id_conflict"});
    await expect(f.refine(request, f.parent.generationId, true, "Make the scarf green")).rejects.toMatchObject({code: "request_id_conflict"});
    f.config.now = Date.parse(f.parent.expiresAt) + 1; await f.store.cleanup(f.config.now);
    expect((await f.refine(request, f.parent.generationId, false)).generationId).toBe(attempts[0].generationId);
    expect(quota(f.store).map(([, row]) => row.value)).toEqual(["2", "2"]);
  });

  it.each(["missing", "expired", "corrupt", "confirmed"])("rejects a %s source without creating or charging a new attempt", async condition => {
    const f = await fixture();
    if (condition === "missing") f.store.jobs.delete(f.parent.generationId);
    if (condition === "expired") f.config.now += DAY;
    if (condition === "corrupt") f.store.artifacts.get(f.parent.generationId + ":stage-base.png")!.bytes = Buffer.from("corrupt");
    if (condition === "confirmed") await f.service.confirm(f.parent.generationId);
    const beforeJobs = structuredClone([...f.store.jobs]); const beforeLedger = structuredClone([...f.store.ledger]); const beforeArtifacts = [...f.store.artifacts];
    await expect(f.refine()).rejects.toMatchObject({code: ({missing: "not_found", expired: "generation_expired", corrupt: "saved_stage_unavailable", confirmed: "base_not_ready"})[condition]});
    expect([...f.store.jobs]).toEqual(beforeJobs); expect([...f.store.ledger]).toEqual(beforeLedger); expect([...f.store.artifacts]).toEqual(beforeArtifacts);
  });

  it("keeps source and quota intact when storing the new attempt cannot commit", async () => {
    const f = await fixture(); const before = {jobs: structuredClone([...f.store.jobs]), ledger: structuredClone([...f.store.ledger]), artifacts: [...f.store.artifacts]};
    const transaction = f.store.transaction.bind(f.store);
    vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx, putJob: async () => {throw Error("synthetic commit failure");}})));
    await expect(f.refine()).rejects.toThrow("synthetic commit failure");
    expect([...f.store.jobs]).toEqual(before.jobs); expect([...f.store.ledger]).toEqual(before.ledger); expect([...f.store.artifacts]).toEqual(before.artifacts);
  });
});

it("normalizes saved renderer bases up to 8 MiB without relaxing the 5 MiB upload limit", async () => {
  const f = await fixture();
  const bytes = await sharp({create: {width: 1600, height: 1200, channels: 3, background: "red"}}).png({compressionLevel: 0}).toBuffer();
  expect(bytes.length).toBeGreaterThan(5 * 1024 * 1024); expect(bytes.length).toBeLessThan(8 * 1024 * 1024);
  await expect(normalizeGenerationReference(bytes, "image/png")).rejects.toMatchObject({code: "reference_image_too_large"});
  f.store.jobs.get(f.parent.generationId)!.stages[0].sha256 = createHash("sha256").update(bytes).digest("hex");
  f.store.artifacts.get(f.parent.generationId + ":stage-base.png")!.bytes = bytes;
  const child = await f.refine();
  expect((await f.store.readJob(child.generationId))?.reference).toMatchObject({width: 1024, height: 768, sourceSha256: createHash("sha256").update(bytes).digest("hex")});
});

it("rechecks source expiry after decoding before charging or queueing a new version", async () => {
  const f = await fixture(); f.config.now = Date.parse(f.parent.expiresAt) - 1;
  const before = structuredClone([...f.store.ledger]); const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx, getArtifact: async (...args) => {
    const bytes = await tx.getArtifact(...args); f.config.now += 2; return bytes;
  }})));
  await expect(f.refine()).rejects.toMatchObject({code: "generation_expired"});
  expect(f.store.jobs.size).toBe(1); expect([...f.store.ledger]).toEqual(before);
});

it("counts deliberate identical edits with new UUIDs as distinct ordinary attempts", async () => {
  const f = await fixture(); const first = await f.refine(); const second = await f.refine();
  expect(second.generationId).not.toBe(first.generationId);
  expect(quota(f.store).map(([, row]) => row.value)).toEqual(["3", "3"]);
  expect((await f.service.get(f.parent.generationId)).status).toBe("awaiting_confirmation");
});


it.each(["read", "write"])("rejects an edit if the source expires during an admission ledger %s", async phase => {
  const f = await fixture();
  f.config.now = Date.parse(f.parent.expiresAt) - 1;
  const before = {jobs: structuredClone([...f.store.jobs]), ledger: structuredClone([...f.store.ledger]), artifacts: [...f.store.artifacts]};
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx, getLedger: async (key, now) => {
    const value = await tx.getLedger(key, now);
    if (phase === "read" && key === "scheduler") f.config.now += 2;
    return value;
  }, putLedger: async (key, value, expiresAt) => {
    await tx.putLedger(key, value, expiresAt);
    if (phase === "write" && key === "scheduler") f.config.now += 2;
  }})));
  await expect(f.refine()).rejects.toMatchObject({code: "generation_expired"});
  expect([...f.store.jobs]).toEqual(before.jobs);
  expect([...f.store.ledger]).toEqual(before.ledger);
  expect([...f.store.artifacts]).toEqual(before.artifacts);
});

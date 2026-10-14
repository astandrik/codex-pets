import JSZip from "jszip";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createGenerationService } from "./service";
import { DAY, jobSchema } from "./model";
import { MemoryStore } from "./test-store";

const now = Date.UTC(2026, 9, 11, 9);
const id = "a".repeat(64);
const receipt = { petId: "pet_review", slug: "demo-review", submittedAt: new Date(now).toISOString() };
const completed = { id, prompt: "", displayName: "Demo", status: "completed" as const, createdAt: now - 1000, expiresAt: now + DAY, worker: "", promptRevision: "test", pipelineVersion: 2, stages: [] };
let files: Record<string, Buffer>;
beforeAll(async () => {
  const json = Buffer.from(JSON.stringify({ id: "demo", displayName: "Demo", description: "A synthetic pet", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" }));
  const cells = Array.from({ length: 88 }, (_, cell) => `<rect x="${cell % 8 * 192 + 70}" y="${Math.floor(cell / 8) * 208 + 70}" width="50" height="50" fill="blue"/>`).join("");
  const sprite = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="2288">${cells}</svg>`)).webp({ lossless: true }).toBuffer();
  const zip = new JSZip().file("pet.json", json).file("spritesheet.webp", sprite);
  files = { "pet.json": json, "spritesheet.webp": sprite, "pet.zip": await zip.generateAsync({ type: "nodebuffer" }) };
});
function fixture() {
  const store = new MemoryStore();
  store.jobs.set(id, { ...completed });
  for (const [name, bytes] of Object.entries(files)) store.artifacts.set(id + ":" + name, { bytes, expiresAt: completed.expiresAt });
  store.ledger.set("day:2026-10-11", { value: "3", expiresAt: now + DAY });
  const service = createGenerationService(store, { enabled: () => false, secret: () => "test-secret".repeat(4), now: () => now });
  return { store, service };
}

describe("generated pet submission", () => {
  it("shows a saved submission receipt without exposing ownership or contacts", async () => {
    const { store, service } = fixture();
    store.jobs.set(id, { ...completed, submission: receipt });
    const result = await service.get(id);
    expect(result).toHaveProperty("submission", receipt);
    expect(JSON.stringify(result)).not.toContain("ownerEmail");
  });
  it("copies the ready package once and keeps the same receipt across concurrent readers", async () => {
    const { store, service } = fixture();
    const ledgerBefore = structuredClone(store.ledger);
    const [first, second] = await Promise.all([service.submit(id, { userId: "user-1", email: "private@example.com", name: "Author" }), service.submit(id, null)]);
    expect(second).toEqual(first);
    expect(store.submissions.size).toBe(1);
    const saved = [...store.submissions.values()][0];
    expect(saved.pet).toMatchObject({ ownerId: "user-1", ownerEmail: "private@example.com", publicEmailRequested: false, kind: "creature", tags: [] });
    expect(saved.assets.petJsonBuffer).toEqual(files["pet.json"]);
    expect(saved.assets.spritesheetBuffer).toEqual(files["spritesheet.webp"]);
    expect(saved.assets.zipBuffer).toEqual(files["pet.zip"]);
    expect(JSON.stringify(first)).not.toContain("private@example.com");
    expect(JSON.stringify(first)).not.toContain(id);
    expect(store.ledger).toEqual(ledgerBefore);
    expect((await service.get(id)).submission).toEqual(first);
    await store.cleanup(completed.expiresAt + 1);
    expect(store.artifacts.size).toBe(0);
    expect(store.submissions.size).toBe(1);
  });
  it("returns the committed receipt after a lost commit acknowledgment without a second submission", async () => {
    const { store, service } = fixture();
    const transaction = store.transaction.bind(store);
    store.transaction = async (operation) => { await transaction(operation); throw new Error("lost commit acknowledgment"); };
    const result = await service.submit(id, null);
    expect(store.submissions.size).toBe(1);
    expect(result).toEqual((await service.get(id)).submission);
  });
  it("does not leave assets or a pet behind when the transaction is rolled back", async () => {
    const { store, service } = fixture();
    const transaction = store.transaction.bind(store);
    store.transaction = (operation) => transaction(tx => operation({ ...tx, putJob: async () => { throw new Error("write failed"); } }));
    await expect(service.submit(id, null)).rejects.toThrow("write failed");
    expect(store.submissions.size).toBe(0);
    expect((await service.get(id)).submission).toBeUndefined();
  });
  it("never creates a submission for invalid, absent, unfinished or expired results", async () => {
    const { store, service } = fixture();
    await expect(service.submit("bad", null)).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(service.submit("b".repeat(64), null)).rejects.toMatchObject({ code: "not_found" });
    for (const status of ["queued", "generating", "processing", "failed"] as const) {
      store.jobs.set(id, { ...completed, status });
      await expect(service.submit(id, null)).rejects.toMatchObject({ code: "generation_not_completed" });
    }
    store.jobs.set(id, { ...completed, expiresAt: now });
    await expect(service.submit(id, null)).rejects.toMatchObject({ code: "generation_expired" });
    expect(store.submissions.size).toBe(0);
  });
  it("checks a chosen slug without reserving it or changing quotas", async () => {
    const { store, service } = fixture();
    for (const [slug, status] of [["lumi", "deleted"], ["lumi-2", "pending"], ["lumi-3", "rejected"], ["lumi-4", "approved"]] as const) store.reservedSlugs.set(slug, status);
    const before = structuredClone(store.ledger);
    expect(await service.checkSubmissionSlug(id, "lumi")).toEqual({ available: false, suggestedSlug: "lumi-5" });
    expect(store.submissions.size).toBe(0); expect(store.ledger).toEqual(before);
    const submitted = await service.submit(id, null, "lumi");
    expect(submitted.slug).toBe("lumi-5");
    expect([...store.submissions.values()][0].assets.zipBuffer).toEqual(files["pet.zip"]);
  });
  it("keeps the original receipt for later changed or invalid chosen slugs", async () => {
    const { service, store } = fixture();
    const first = await service.submit(id, null, "lumi");
    expect(await service.submit(id, null, "different")).toEqual(first);
    expect(await service.submit(id, null, "../admin")).toEqual(first);
    expect(await service.checkSubmissionSlug(id, null)).toEqual({ available: true, suggestedSlug: "lumi", submission: first });
    expect(store.submissions.size).toBe(1);
  });
  it("serializes two chosen names for one generation and collision allocation across generations", async () => {
    const { service, store } = fixture();
    const secondId = "b".repeat(64);
    store.jobs.set(secondId, { ...completed, id: secondId });
    for (const [name, bytes] of Object.entries(files)) store.artifacts.set(secondId + ":" + name, { bytes, expiresAt: completed.expiresAt });
    const [first, replay, other] = await Promise.all([service.submit(id, null, "lumi"), service.submit(id, null, "changed"), service.submit(secondId, null, "lumi")]);
    expect(replay).toEqual(first); expect(first.slug).toBe("lumi"); expect(other.slug).toBe("lumi-2");
    expect(store.submissions.size).toBe(2);
  });
  it("rejects unsafe, empty and overlong explicit slugs before package copying", async () => {
    const { store, service } = fixture();
    for (const slug of [null, "", "a".repeat(65), "-lumi", "lumi-", "https://pets.example/lumi", "lumi%2Fsecret"]) {
      await expect(service.checkSubmissionSlug(id, slug)).rejects.toMatchObject({ code: "invalid_public_slug" });
      await expect(service.submit(id, null, slug)).rejects.toMatchObject({ code: "invalid_public_slug" });
    }
    expect(store.submissions.size).toBe(0);
  });
  it("rechecks availability at commit and does not reserve the check result", async () => {
    const { store, service } = fixture();
    expect(await service.checkSubmissionSlug(id, "lumi")).toEqual({ available: true, suggestedSlug: "lumi" });
    store.reservedSlugs.set("lumi", "approved");
    expect((await service.submit(id, null, "lumi")).slug).toBe("lumi-2");
  });
  it("reconciles a chosen slug receipt after a lost acknowledgement", async () => {
    const { store, service } = fixture();
    const transaction = store.transaction.bind(store);
    store.transaction = async operation => { await transaction(operation); throw new Error("lost acknowledgment"); };
    expect((await service.submit(id, null, "lumi")).slug).toBe("lumi");
    expect(store.submissions.size).toBe(1);
  });

  it("rejects missing and corrupt packages before committing a submission", async () => {
    const { store, service } = fixture();
    store.artifacts.delete(id + ":pet.zip");
    await expect(service.submit(id, null)).rejects.toMatchObject({ code: "invalid_generated_package" });
    store.artifacts.set(id + ":pet.zip", { bytes: Buffer.from("corrupt"), expiresAt: now + DAY });
    await expect(service.submit(id, null)).rejects.toMatchObject({ code: "invalid_generated_package" });
    expect(store.submissions.size).toBe(0);
  });
  it("keeps legacy job payloads readable and retains new receipts through the schema", () => {
    expect(jobSchema.parse(completed)).not.toHaveProperty("submission");
    expect(jobSchema.parse({ ...completed, submission: receipt })).toHaveProperty("submission", receipt);
  });
  it("rejects a ZIP whose embedded metadata differs from the ready artifacts", async () => {
    const { store, service } = fixture();
    const zip = new JSZip().file("pet.json", "{}").file("spritesheet.webp", files["spritesheet.webp"]);
    store.artifacts.set(id + ":pet.zip", { bytes: await zip.generateAsync({ type: "nodebuffer" }), expiresAt: now + DAY });
    await expect(service.submit(id, null)).rejects.toMatchObject({ code: "invalid_generated_package" });
    expect(store.submissions.size).toBe(0);
  });
  it("rejects undecodable pixel data even when dimensions and ZIP contents are valid", async () => {
    const { store, service } = fixture();
    const sprite = Buffer.from(files["spritesheet.webp"]);
    sprite.fill(255, 30, 50);
    expect(await sharp(sprite).metadata()).toMatchObject({ width: 1536, height: 2288 });
    const zip = new JSZip().file("pet.json", files["pet.json"]).file("spritesheet.webp", sprite);
    store.artifacts.set(id + ":spritesheet.webp", { bytes: sprite, expiresAt: now + DAY });
    store.artifacts.set(id + ":pet.zip", { bytes: await zip.generateAsync({ type: "nodebuffer" }), expiresAt: now + DAY });
    await expect(service.submit(id, null)).rejects.toMatchObject({ code: "invalid_generated_package" });
    expect(store.submissions.size).toBe(0);
    expect((await service.get(id)).submission).toBeUndefined();
  });
});

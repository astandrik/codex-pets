import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredRelatedPetAnnotation } from "@/lib/pets/related/related-pets-annotations-repository";
import type { StoredPetSearchCaption } from "@/lib/pets/search/search-captions-repository";
import { PET_VISION_FRAME_POLICY } from "@/lib/pets/search/search-vision-frames";
import { prepareOpenAIApprovalMetadata } from "@/lib/pets/metadata-worker/approval";

const mocks = vi.hoisted(() => ({ request: vi.fn(), annotation: null as StoredRelatedPetAnnotation | null,
  caption: null as StoredPetSearchCaption | null, extract: vi.fn(), putAnnotation: vi.fn(), putCaption: vi.fn() }));
vi.mock("@/lib/openai-ams", () => ({ createAMSOpenAIJSONTransport: () => mocks.request }));
vi.mock("@/lib/pets/assets-repository", () => ({ readPetSpritesheetAsset: async () => ({ buffer: Buffer.from("fixture") }) }));
vi.mock("@/lib/pets/search/search-vision-frames", async (original) => ({
  ...await original<typeof import("@/lib/pets/search/search-vision-frames")>(), extractPetVisionFrames: mocks.extract,
}));
vi.mock("@/lib/pets/related/related-pets-annotations-repository", () => ({
  getRelatedPetAnnotation: async () => mocks.annotation, upsertRelatedPetAnnotation: mocks.putAnnotation,
}));
vi.mock("@/lib/pets/search/search-captions-repository", () => ({
  getPetSearchCaption: async () => mocks.caption, upsertPetSearchCaption: mocks.putCaption,
}));
const pet = { id: "pet_synthetic_bus", slug: "synthetic-bus", displayName: "Synthetic bus", description: "A cartoon bus",
  kind: "creature" as const, tags: [], status: "approved", spritesheetUrl: "/api/assets/asset_test/spritesheet.webp" };
const proposal = { entity: { key: null, aliases: [], confidence: "none", evidence: [] },
  franchises: [], franchise_families: [], collections: [], specific_archetypes: [], themes: [], media_origins: [] };
const text = { en: "cartoon bus", ru: "мультяшный автобус" };
const caption = { subject: text, appearance: text, clothing: { en: "", ru: "" }, style: text, mood: text,
  colors: { en: ["blue"], ru: ["синий"] }, search_terms_en: ["bus", "blue", "cartoon"], search_terms_ru: ["автобус", "синий", "мультяшный"] };
function response(value: unknown) { return { id: "resp_fixture", model: "gpt-6.1-sol", status: "completed", service_tier: "default",
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } }; }
let directory: string;
beforeEach(() => {
  vi.clearAllMocks(); mocks.annotation = null; mocks.caption = null;
  directory = mkdtempSync(join(tmpdir(), "approval-metadata-test-"));
  const key = join(directory, "key"); writeFileSync(key, "synthetic-key");
  vi.stubEnv("PET_APPROVAL_METADATA_DIR", directory); vi.stubEnv("OPENAI_API_KEY_FILE", key);
  const png = Buffer.from("synthetic-frame");
  mocks.extract.mockResolvedValue({ spriteVersion: 2, spritesheetSha256: "a".repeat(64),
    frames: PET_VISION_FRAME_POLICY.frames.map((f) => ({ ...f, png, dataUrl: `data:image/png;base64,${png.toString("base64")}` })) });
  mocks.request.mockImplementation(async (_operation, body) => response(body.text.format.name === "pet_visual_caption_v1" ? caption : proposal));
  mocks.putAnnotation.mockImplementation(async (row) => { mocks.annotation = row; });
  mocks.putCaption.mockImplementation(async (row) => { mocks.caption = row; });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true }); });

describe("general OpenAI approval metadata", () => {
  it("prepares both sources for a non-Lumi pet and reuses fresh persisted records on restart", async () => {
    const check = vi.fn(async () => undefined);
    await prepareOpenAIApprovalMetadata(pet, check);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.annotation?.slug).toBe(pet.slug); expect(mocks.caption?.slug).toBe(pet.slug);
    expect(mocks.annotation?.annotationRevision).toContain("openai");
    expect(mocks.caption?.captionRevision).toContain("openai");
    await prepareOpenAIApprovalMetadata(pet, check);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.putAnnotation).toHaveBeenCalledTimes(1); expect(mocks.putCaption).toHaveBeenCalledTimes(1);
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(6);
  });
  it("persists the first stage and never repeats either stage after an unknown second outcome", async () => {
    mocks.request.mockResolvedValueOnce(response(proposal)).mockRejectedValueOnce(new Error("provider private detail"));
    await expect(prepareOpenAIApprovalMetadata(pet, async () => undefined)).rejects.toMatchObject({ reason: "metadata_preparation_failed" });
    expect(mocks.annotation).not.toBeNull(); expect(mocks.caption).toBeNull();
    await expect(prepareOpenAIApprovalMetadata(pet, async () => undefined)).rejects.toMatchObject({ reason: "metadata_outcome_unknown" });
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("recovers a saved response after its database write failed without a new provider call", async () => {
    mocks.putCaption.mockRejectedValueOnce(new Error("lost before DB commit"));
    await expect(prepareOpenAIApprovalMetadata(pet, async () => undefined)).rejects.toMatchObject({ reason: "metadata_ydb_ack_unknown" });
    await prepareOpenAIApprovalMetadata(pet, async () => undefined);
    expect(mocks.request).toHaveBeenCalledTimes(2); expect(mocks.caption).not.toBeNull();
  });
  it("blocks changed inputs and revoked ownership without new paid requests", async () => {
    await prepareOpenAIApprovalMetadata(pet, async () => undefined);
    await expect(prepareOpenAIApprovalMetadata({ ...pet, description: "changed" }, async () => undefined))
      .rejects.toMatchObject({ reason: "metadata_ledger_invalid_or_stale" });
    await expect(prepareOpenAIApprovalMetadata(pet, async () => { throw new Error("metadata_lease_or_input_changed"); }))
      .rejects.toMatchObject({ reason: "metadata_lease_or_input_changed" });
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it } from "vitest";
import { prepareMetadataInputs, LUMI_METADATA_PET_ID, LUMI_METADATA_SLUG, LUMI_SPRITESHEET_SHA256,
  parseOpenAIAnnotation, parseOpenAICaption, annotationRecord, captionRecord } from "@/lib/pets/metadata-worker/producer";
import { PET_VISION_FRAME_POLICY } from "@/lib/pets/search-vision-frames";
import { OPENAI_ANNOTATION_REVISION, OPENAI_CAPTION_REVISION } from "@/lib/pets/metadata-sources";

const pet = { id: LUMI_METADATA_PET_ID, slug: LUMI_METADATA_SLUG, status: "pending", displayName: "Lumi",
  description: "A synthetic pale creature", kind: "creature" as const, tags: ["soft"] };
const png = Buffer.from("synthetic frame");
const frames = { spriteVersion: 2 as const, spritesheetSha256: LUMI_SPRITESHEET_SHA256,
  frames: PET_VISION_FRAME_POLICY.frames.map((frame) => ({ ...frame, png, dataUrl: `data:image/png;base64,${png.toString("base64")}` })) };
const rawProposal = { entity: { key: null, aliases: [], confidence: "none", evidence: [] },
  franchises: [], franchise_families: [], collections: [], specific_archetypes: [], themes: [], media_origins: [] };
const bilingual = { en: "pale creature", ru: "светлый зверёк" };
const rawCaption = { subject: bilingual, appearance: bilingual, clothing: { en: "", ru: "" },
  style: bilingual, mood: bilingual, colors: { en: ["white"], ru: ["белый"] },
  search_terms_en: ["creature", "pale", "soft"], search_terms_ru: ["зверёк", "светлый", "мягкий"] };

describe("Lumi metadata input contracts", () => {
  it("pins two requests and keeps text identity out of the image-only caption request", () => {
    const plan = prepareMetadataInputs(pet, "synthetic-asset", frames);
    expect(plan.totalReserveUSD).toBeLessThanOrEqual(0.5);
    for (const request of [plan.annotation, plan.caption]) {
      expect(request.body).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "low" },
        service_tier: "default", store: false, max_output_tokens: 4096 });
    }
    expect(JSON.stringify(plan.annotation.body)).toContain("Lumi");
    expect(JSON.stringify(plan.annotation.body)).not.toContain("input_image");
    expect(JSON.stringify(plan.caption.body)).not.toContain("Lumi");
    expect(JSON.stringify(plan.caption.body).match(/input_image/g)).toHaveLength(4);
  });
  it("rejects another pet, changed atlas or frame order", () => {
    expect(() => prepareMetadataInputs({ ...pet, id: "another" }, "asset", frames)).toThrow("target_mismatch");
    expect(() => prepareMetadataInputs(pet, "asset", { ...frames, spritesheetSha256: "changed" })).toThrow("target_mismatch");
    expect(() => prepareMetadataInputs(pet, "asset", { ...frames, frames: [...frames.frames].reverse() })).toThrow("frame_invalid");
  });
  it("builds truthful additive revisions and rejects unknown structured fields", () => {
    const proposal = parseOpenAIAnnotation(rawProposal);
    expect(annotationRecord(pet, proposal).annotationRevision).toBe(OPENAI_ANNOTATION_REVISION);
    const caption = parseOpenAICaption(rawCaption);
    expect(captionRecord(pet, "asset", LUMI_SPRITESHEET_SHA256, caption).captionRevision).toBe(OPENAI_CAPTION_REVISION);
    expect(() => parseOpenAIAnnotation({ ...rawProposal, surprise: true })).toThrow();
    expect(() => parseOpenAICaption({ ...rawCaption, identity: "Lumi" })).toThrow();
  });
});

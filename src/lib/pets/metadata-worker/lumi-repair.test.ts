import { describe, expect, it } from "vitest";
import { LUMI_METADATA_PET_ID, LUMI_METADATA_SLUG, LUMI_SPRITESHEET_SHA256, prepareLumiMetadataRepairInputs } from "./lumi-repair";
import { prepareApprovalMetadataInputs } from "./producer";
import { PET_VISION_FRAME_POLICY } from "@/lib/pets/search/search-vision-frames";
const pet = { id: LUMI_METADATA_PET_ID, slug: LUMI_METADATA_SLUG, status: "pending", displayName: "Lumi", description: "A synthetic pale creature", kind: "creature" as const, tags: ["soft"] };
const png = Buffer.from("synthetic frame");
const frames = { spriteVersion: 2 as const, spritesheetSha256: LUMI_SPRITESHEET_SHA256, frames: PET_VISION_FRAME_POLICY.frames.map(frame => ({ ...frame, png, dataUrl: "data:image/png;base64," + png.toString("base64") })) };
describe("Lumi-only repair boundary", () => {
  it("preserves request bytes and the existing ledger context", () => {
    const plan = prepareLumiMetadataRepairInputs(pet, "synthetic-asset", frames);
    expect(plan).toEqual(prepareApprovalMetadataInputs(pet, "synthetic-asset", frames));
    expect(plan.contextHash).toBe("a5550113c34f73fad60671829a5104949ec26ed018c5b402feaeefce258645e0");
  });
  it("retains the exact pet, atlas, version and status restrictions", () => {
    for (const other of [{ ...pet, id: "pet_another" }, { ...pet, slug: "another" }, { ...pet, status: "deleted" }]) {
      expect(() => prepareLumiMetadataRepairInputs(other, "synthetic-asset", frames)).toThrow("metadata_target_mismatch");
    }
    expect(() => prepareLumiMetadataRepairInputs(pet, "synthetic-asset", { ...frames, spritesheetSha256: "0".repeat(64) })).toThrow("metadata_target_mismatch");
    expect(() => prepareLumiMetadataRepairInputs(pet, "synthetic-asset", { ...frames, spriteVersion: 1 })).toThrow("metadata_target_mismatch");
  });
});

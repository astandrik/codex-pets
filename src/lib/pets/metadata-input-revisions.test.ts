import { describe, expect, it, vi } from "vitest";
import { getAdditionalMetadataInputRevisions } from "@/lib/pets/metadata-input-revisions";
import { OPENAI_ANNOTATION_REVISION, OPENAI_CAPTION_REVISION } from "@/lib/pets/metadata-sources";
const values = { utf8: (value: string) => value };
const result = (hash: string) => ({ resultSets: [{ rows: [{ items: [{ textValue: "lumi" }, { textValue: hash }, { textValue: "now" }] }] }] });

describe("mixed-source transaction fingerprints", () => {
  it("leaves the old input fingerprint contract untouched when extra sources are absent", async () => {
    const execute = vi.fn();
    expect(await getAdditionalMetadataInputRevisions(execute, values, {})).toEqual({});
    expect(execute).not.toHaveBeenCalled();
  });
  it("includes both actual revision and row hashes, with stable order and deduplication", async () => {
    const execute = vi.fn(async () => result("before"));
    const scope = { additionalAnnotationRevisions: [OPENAI_ANNOTATION_REVISION, OPENAI_ANNOTATION_REVISION], additionalCaptionRevisions: [OPENAI_CAPTION_REVISION] };
    const before = await getAdditionalMetadataInputRevisions(execute, values, scope);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(before.additionalAnnotations).toEqual([JSON.stringify([OPENAI_ANNOTATION_REVISION, [["lumi", "before", "now"]]])]);
    expect(before.additionalCaptions).toEqual([JSON.stringify([OPENAI_CAPTION_REVISION, [["lumi", "before", "now"]]])]);
    expect(await getAdditionalMetadataInputRevisions(async () => result("changed"), values, scope)).not.toEqual(before);
  });
});

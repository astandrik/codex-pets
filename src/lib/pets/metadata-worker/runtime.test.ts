import { describe, expect, it, vi } from "vitest";
import { persistMetadataRecord, reconcileExistingMetadataBeforeGeneration } from "@/lib/pets/metadata-worker/runtime";

describe("metadata-only YDB reconciliation", () => {
  const desired = { sourceHash: "synthetic", updatedAt: "now", captionRevision: "new-revision", captionText: "synthetic caption" };
  it("reads back a lost write ACK and a restarted application without repeating the write", async () => {
    let row: { sourceHash: string; updatedAt: string; captionText: string } | null = null;
    const get = vi.fn(async () => row);
    const put = vi.fn(async () => { row = { sourceHash: desired.sourceHash, updatedAt: desired.updatedAt, captionText: desired.captionText }; throw new Error("ack_lost"); });
    expect(await persistMetadataRecord(desired, get, put)).toBe("saved");
    expect(await persistMetadataRecord(desired, get, put)).toBe("already-saved");
    expect(put).toHaveBeenCalledTimes(1);
  });
  it("blocks conflicting records and unknown writes without destructive retries", async () => {
    const put = vi.fn(async () => { throw new Error("unknown"); });
    await expect(persistMetadataRecord(desired, async () => ({ sourceHash: "other", updatedAt: "before" }), put)).rejects.toThrow("record_conflict");
    expect(put).not.toHaveBeenCalled();
    await expect(persistMetadataRecord(desired, async () => null, put)).rejects.toThrow("ack_unknown");
    expect(put).toHaveBeenCalledTimes(1);
  });
  it("blocks existing YDB metadata with an empty or unrelated ledger before paid work", () => {
    const provider = vi.fn();
    for (const readReceipt of [() => { throw new Error("metadata_receipt_missing_or_stale"); },
      () => ({ ...desired, sourceHash: "another_source" })]) {
      expect(() => { reconcileExistingMetadataBeforeGeneration(desired, readReceipt); provider(); })
        .toThrow("existing_records_need_reconciliation");
    }
    expect(provider).not.toHaveBeenCalled();
    expect(() => reconcileExistingMetadataBeforeGeneration(desired, () => ({ ...desired, updatedAt: "old" }))).not.toThrow();
  });
});

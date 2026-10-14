import { metadataHash } from "@/lib/pets/metadata-worker/ledger";

function metadataRecordHash(value: object) {
  return metadataHash(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["updatedAt", "annotationRevision", "captionRevision"].includes(key)).sort(([a], [b]) => a.localeCompare(b))));
}

export function reconcileExistingMetadataBeforeGeneration(existing: object | null, readExpectedReceipt: () => object): void {
  if (!existing) return;
  try {
    if (metadataRecordHash(existing) === metadataRecordHash(readExpectedReceipt())) return;
  } catch { /* Missing, old or invalid receipts never authorize another paid call. */ }
  throw new Error("metadata_existing_records_need_reconciliation");
}

export async function persistMetadataRecord<T extends { sourceHash: string; updatedAt: string }>(
  desired: T, get: () => Promise<{ sourceHash: string; updatedAt: string } | null>, put: (value: T) => Promise<void>,
): Promise<"already-saved" | "saved"> {
  const expected = metadataRecordHash(desired);
  const matches = (value: { sourceHash: string; updatedAt: string } | null) => value && metadataRecordHash(value) === expected;
  const before = await get();
  if (before) {
    if (!matches(before)) throw new Error("metadata_existing_record_conflict");
    return "already-saved";
  }
  try { await put(desired); } catch {
    if (!matches(await get())) throw new Error("metadata_ydb_ack_unknown");
    return "saved";
  }
  if (!matches(await get())) throw new Error("metadata_ydb_readback_mismatch");
  return "saved";
}

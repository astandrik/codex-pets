import { readFileSync } from "node:fs";
import { z } from "zod";
import { createAMSOpenAIJSONTransport } from "@/lib/openai-ams";
import { isYdbConfigured } from "@/lib/ydb/client";
import { getPetForApprovalPreparationById } from "@/lib/pets/repository";
import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import { extractPetVisionFrames } from "@/lib/pets/search-vision-frames";
import { getRelatedPetAnnotation, upsertRelatedPetAnnotation } from "@/lib/pets/related-pets-annotations-repository";
import { getPetSearchCaption, upsertPetSearchCaption } from "@/lib/pets/search-captions-repository";
import { OPENAI_METADATA_MODEL } from "@/lib/pets/metadata-sources";
import { MetadataLedger, metadataHash } from "@/lib/pets/metadata-worker/ledger";
import { LUMI_METADATA_PET_ID, prepareMetadataInputs, parseOpenAIAnnotation, parseOpenAICaption,
  annotationRecord, captionRecord } from "@/lib/pets/metadata-worker/producer";

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

export async function runMetadataRepair(mode: "dry-run" | "generate-only" | "apply-records", petId: string, directory: string) {
  if (petId !== LUMI_METADATA_PET_ID || !isYdbConfigured() || process.env.PETS_DATA_SOURCE === "mock") {
    throw new Error("metadata_target_not_configured");
  }
  const load = async () => {
    const pet = await getPetForApprovalPreparationById(petId);
    if (!pet) throw new Error("metadata_pet_missing");
    const assetId = getPetAssetIdFromSpritesheetUrl(pet.spritesheetUrl);
    if (!assetId) throw new Error("metadata_asset_missing");
    const asset = await readPetSpritesheetAsset({ assetId });
    const extracted = await extractPetVisionFrames(asset.buffer);
    return { pet, assetId, extracted, plan: prepareMetadataInputs(pet, assetId, extracted) };
  };
  const { pet, assetId, extracted, plan } = await load();
  let transport: ReturnType<typeof createAMSOpenAIJSONTransport> | undefined;
  const request = async (body: unknown) => {
    if (!transport) throw new Error("metadata_provider_disabled");
    return transport("responses", body);
  };
  const ledger = new MetadataLedger(directory, plan.contextHash, request);
  const report = () => ({ mode, petId, model: OPENAI_METADATA_MODEL, contextHash: plan.contextHash,
    reserveUSD: plan.totalReserveUSD, stages: [plan.annotation, plan.caption].map(({ stage, inputTokenBound, reservedUSD }) =>
      ({ stage, inputTokenBound, reservedUSD })), ledger: ledger.summary });
  if (mode === "dry-run") return report();
  if (mode === "generate-only") {
    if (ledger.summary.unresolved) throw new Error("metadata_outcome_unknown");
    const { OPENAI_ANNOTATION_REVISION, OPENAI_CAPTION_REVISION } = await import("@/lib/pets/metadata-sources");
    const [existingAnnotation, existingCaption] = await Promise.all([
      getRelatedPetAnnotation(OPENAI_ANNOTATION_REVISION, pet.slug), getPetSearchCaption(OPENAI_CAPTION_REVISION, pet.slug),
    ]);
    reconcileExistingMetadataBeforeGeneration(existingAnnotation,
      () => annotationRecord(pet, ledger.readCompleted(plan.annotation, parseOpenAIAnnotation)));
    reconcileExistingMetadataBeforeGeneration(existingCaption,
      () => captionRecord(pet, assetId, extracted.spritesheetSha256, ledger.readCompleted(plan.caption, parseOpenAICaption)));
    if (pet.status !== "pending") throw new Error("metadata_pet_not_pending");
    const keyFile = process.env.OPENAI_API_KEY_FILE;
    if (!keyFile) throw new Error("metadata_key_file_missing");
    transport = createAMSOpenAIJSONTransport(readFileSync(keyFile, "utf8").trim(), process.env.HTTPS_PROXY ?? "");
    const model = z.object({ id: z.literal(OPENAI_METADATA_MODEL), object: z.literal("model") }).passthrough()
      .safeParse(await transport("metadata-model"));
    if (!model.success) throw new Error("metadata_model_unavailable");
    await ledger.generate(plan.annotation, parseOpenAIAnnotation);
    await ledger.generate(plan.caption, parseOpenAICaption);
    return report();
  }
  const annotation = annotationRecord(pet, ledger.readCompleted(plan.annotation, parseOpenAIAnnotation));
  const caption = captionRecord(pet, assetId, extracted.spritesheetSha256, ledger.readCompleted(plan.caption, parseOpenAICaption));
  if ((await load()).plan.contextHash !== plan.contextHash) throw new Error("metadata_input_changed");
  const annotationResult = await persistMetadataRecord(annotation,
    () => getRelatedPetAnnotation(annotation.annotationRevision, pet.slug), upsertRelatedPetAnnotation);
  if ((await load()).plan.contextHash !== plan.contextHash) throw new Error("metadata_input_changed");
  const captionResult = await persistMetadataRecord(caption,
    () => getPetSearchCaption(caption.captionRevision, pet.slug), upsertPetSearchCaption);
  return { ...report(), records: { annotation: annotationResult, caption: captionResult } };
}

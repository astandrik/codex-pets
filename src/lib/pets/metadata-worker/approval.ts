import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createAMSOpenAIJSONTransport } from "@/lib/openai-ams";
import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import { extractPetVisionFrames } from "@/lib/pets/search-vision-frames";
import { getRelatedPetAnnotation, upsertRelatedPetAnnotation } from "@/lib/pets/related-pets-annotations-repository";
import { getPetSearchCaption, upsertPetSearchCaption } from "@/lib/pets/search-captions-repository";
import { OPENAI_ANNOTATION_REVISION, OPENAI_CAPTION_REVISION, OPENAI_METADATA_MODEL_URI,
  OPENAI_ANNOTATION_PROPOSAL_REVISION, selectFreshAnnotationMetadata, selectFreshCaptionMetadata } from "@/lib/pets/metadata-sources";
import { MetadataLedger } from "@/lib/pets/metadata-worker/ledger";
import { persistMetadataRecord, reconcileExistingMetadataBeforeGeneration } from "@/lib/pets/metadata-worker/runtime";
import { prepareApprovalMetadataInputs, parseOpenAIAnnotation, parseOpenAICaption,
  annotationRecord, captionRecord, type MetadataPet } from "@/lib/pets/metadata-worker/producer";

/** Only the private approval worker has the key and durable, exclusively locked ledger mount. */
export async function prepareOpenAIApprovalMetadata(pet: MetadataPet & { spritesheetUrl: string }, checkCurrent: () => Promise<void>) {
  try {
    await checkCurrent();
    const directory = process.env.PET_APPROVAL_METADATA_DIR;
    const keyFile = process.env.OPENAI_API_KEY_FILE;
    if (!directory || !isAbsolute(directory) || !keyFile) throw new Error("metadata_worker_not_configured");
    const assetId = getPetAssetIdFromSpritesheetUrl(pet.spritesheetUrl);
    if (!assetId) throw new Error("metadata_asset_missing");
    const asset = await readPetSpritesheetAsset({ assetId });
    const extracted = await extractPetVisionFrames(asset.buffer);
    const plan = prepareApprovalMetadataInputs(pet, assetId, extracted);
    const [existingAnnotation, existingCaption] = await Promise.all([
      getRelatedPetAnnotation(OPENAI_ANNOTATION_REVISION, pet.slug),
      getPetSearchCaption(OPENAI_CAPTION_REVISION, pet.slug),
    ]);
    const freshAnnotation = selectFreshAnnotationMetadata(pet, existingAnnotation ? [existingAnnotation] : [], {
      annotationRevision: OPENAI_ANNOTATION_REVISION, proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION,
      modelUri: OPENAI_METADATA_MODEL_URI,
    });
    const freshCaption = selectFreshCaptionMetadata(existingCaption ? [existingCaption] : [], {
      slug: pet.slug, assetId, spritesheetSha256: extracted.spritesheetSha256,
      legacy: { captionRevision: OPENAI_CAPTION_REVISION, modelUri: OPENAI_METADATA_MODEL_URI },
    });
    if (freshAnnotation && freshCaption) return;
    // One directory per pet, not per attempt/context: changed inputs cannot silently authorize new paid calls.
    const transport = createAMSOpenAIJSONTransport(readFileSync(keyFile, "utf8").trim(), process.env.HTTPS_PROXY ?? "");
    const ledger = new MetadataLedger(join(directory, pet.id), plan.contextHash, async (body) => {
      await checkCurrent();
      return transport("responses", body);
    });
    const parseAnnotation = (value: unknown) => parseOpenAIAnnotation(value, pet.slug);
    reconcileExistingMetadataBeforeGeneration(existingAnnotation,
      () => annotationRecord(pet, ledger.readCompleted(plan.annotation, parseAnnotation)));
    reconcileExistingMetadataBeforeGeneration(existingCaption,
      () => captionRecord(pet, assetId, extracted.spritesheetSha256, ledger.readCompleted(plan.caption, parseOpenAICaption)));

    await checkCurrent();
    const annotation = annotationRecord(pet, await ledger.generate(plan.annotation, parseAnnotation));
    await checkCurrent();
    await persistMetadataRecord(annotation,
      () => getRelatedPetAnnotation(OPENAI_ANNOTATION_REVISION, pet.slug), upsertRelatedPetAnnotation);
    const caption = captionRecord(pet, assetId, extracted.spritesheetSha256,
      await ledger.generate(plan.caption, parseOpenAICaption));
    await checkCurrent();
    await persistMetadataRecord(caption,
      () => getPetSearchCaption(OPENAI_CAPTION_REVISION, pet.slug), upsertPetSearchCaption);
  } catch (error) {
    // No provider body or arbitrary exception text reaches public approval status. Unknown paid
    // outcomes remain in the durable ledger and go to manual review, never automatic regeneration.
    const code = error instanceof Error && /^metadata_[a-z_]+$/.test(error.message)
      ? error.message : "metadata_preparation_failed";
    throw Object.assign(new Error(code), { reason: code });
  }
}

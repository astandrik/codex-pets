import { listPetAnnotationsWithSources, listPetCaptionsWithSources } from "@/lib/pets/metadata-records";
import { selectFreshAnnotationMetadata, selectFreshCaptionMetadata, groupMetadataBySlug } from "@/lib/pets/metadata-sources";
import { decodeRelatedPetV24Vector } from "@/lib/pets/related/related-pets-ranking";
import { createHash } from "node:crypto";
import {
  buildPetSearchDocument,
  createPetSearchSourceHash,
} from "@/lib/pets/search/search-embeddings";
import {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
  createRelatedPetDocumentSourceHash,
  createRelatedPetQuerySourceHash,
} from "@/lib/pets/related/related-pets-embeddings";
import { OPENAI_PETS_REVISIONS, OPENAI_EMBEDDING_DIMENSIONS } from "@/lib/pets/openai-embedding-profile";
import { LEGACY_RELATED_PETS_V24_PROFILE } from "@/lib/pets/related/related-pets-profile";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import { createRelatedPetAnnotationEmbeddingSourceHash, RELATED_PETS_ANNOTATION_MODEL_NAME } from "@/lib/pets/related/related-pets-annotation-contract.mjs";
import { createPetVisualEmbeddingSourceHash, PET_VISION_CAPTION_REVISION } from "@/lib/pets/search/search-vision-contract";
import { getPetAssetIdFromSpritesheetUrl } from "@/lib/pets/asset-urls";
import { readPetSpritesheetAsset } from "@/lib/pets/assets-repository";
import { listRawPetSearchEmbeddings, upsertPetSearchEmbedding } from "@/lib/pets/search/search-embeddings-repository";

export type OpenAIIndexInput = { slug: string; modelRevision: string; sourceHash: string; text: string };
export async function collectOpenAIIndexInputs(): Promise<OpenAIIndexInput[]> {
  const folder = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  if (!folder) throw new Error("metadata_model_uri_missing");
  const modelUri = `gpt://${folder}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`;
  const pets = (await listApprovedPetsForSearch()).toSorted((a, b) => a.slug.localeCompare(b.slug));
  const annotations = groupMetadataBySlug(await listPetAnnotationsWithSources(LEGACY_RELATED_PETS_V24_PROFILE.annotationRevision));
  const captions = groupMetadataBySlug(await listPetCaptionsWithSources(PET_VISION_CAPTION_REVISION));
  const inputs: OpenAIIndexInput[] = [];
  for (const pet of pets) {
    const selectedAnnotation = selectFreshAnnotationMetadata(pet, annotations.get(pet.slug) ?? [], { modelUri,
      annotationRevision: LEGACY_RELATED_PETS_V24_PROFILE.annotationRevision,
      proposalRevision: LEGACY_RELATED_PETS_V24_PROFILE.annotationProposalRevision,
      acceptedProposalRevisions: LEGACY_RELATED_PETS_V24_PROFILE.acceptedAnnotationProposalRevisions });
    if (!selectedAnnotation) throw new Error("annotation_missing_or_stale");
    const { source: annotationSource, annotation } = selectedAnnotation;
    const assetId = getPetAssetIdFromSpritesheetUrl(pet.spritesheetUrl);
    if (!assetId) throw new Error("caption_asset_mismatch");
    const asset = await readPetSpritesheetAsset({ assetId });
    const selectedCaption = selectFreshCaptionMetadata(captions.get(pet.slug) ?? [], { slug: pet.slug, assetId,
      spritesheetSha256: hash(asset.buffer), legacy: { captionRevision: PET_VISION_CAPTION_REVISION, modelUri } });
    if (!selectedCaption) throw new Error("caption_missing_or_stale");
    const { source: captionSource, captionText, sourceHash: captionHash } = selectedCaption;
    inputs.push(
      { slug: pet.slug, modelRevision: OPENAI_PETS_REVISIONS.search,
        sourceHash: createPetSearchSourceHash(pet, OPENAI_PETS_REVISIONS.search), text: buildPetSearchDocument(pet) },
      { slug: pet.slug, modelRevision: OPENAI_PETS_REVISIONS.descriptionDocument,
        sourceHash: createRelatedPetDocumentSourceHash(pet, OPENAI_PETS_REVISIONS.descriptionDocument),
        text: buildRelatedPetDocument(pet, OPENAI_PETS_REVISIONS.descriptionDocument) },
      { slug: pet.slug, modelRevision: OPENAI_PETS_REVISIONS.descriptionQuery,
        sourceHash: createRelatedPetQuerySourceHash(pet, OPENAI_PETS_REVISIONS.descriptionQuery),
        text: buildRelatedPetQuery(pet, OPENAI_PETS_REVISIONS.descriptionQuery) },
    );
    for (const role of ["query", "document"] as const) {
      const modelRevision = role === "query" ? OPENAI_PETS_REVISIONS.annotationQuery : OPENAI_PETS_REVISIONS.annotationDocument;
      inputs.push({ slug: pet.slug, modelRevision, text: annotation.annotationText,
        sourceHash: createRelatedPetAnnotationEmbeddingSourceHash({ modelRevision, role,
          annotationRevision: annotationSource.annotationRevision,
          annotationSourceHash: annotation.sourceHash, annotationText: annotation.annotationText }) });
    }
    inputs.push({ slug: pet.slug, modelRevision: OPENAI_PETS_REVISIONS.visual, text: captionText,
      sourceHash: createPetVisualEmbeddingSourceHash({ visualRevision: OPENAI_PETS_REVISIONS.visual,
        captionRevision: captionSource.captionRevision, captionSourceHash: captionHash, captionText }) });
  }
  return inputs.map((row) => ({ ...row, text: row.text.normalize("NFKC").trim() }));
}
export function describeOpenAIIndexInputs(inputs: readonly OpenAIIndexInput[]) {
  const texts = [...new Set(inputs.map((row) => row.text))];
  const bytes = texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  return { pets: new Set(inputs.map((row) => row.slug)).size, vectors: inputs.length, uniqueInputs: texts.length,
    uniqueUtf8Bytes: bytes, conservativeUSD: bytes * 0.13 / 1_000_000,
    fingerprint: hash(JSON.stringify(inputs.map(({ text, ...row }) => ({ ...row, textHash: hash(text) })))) };
}
export async function applyOpenAIIndex(inputs: readonly OpenAIIndexInput[],
  embed: (input: string[]) => Promise<number[][]>, onBatch: (stats: { written: number; reused: number }) => void) {
  const existing = new Map<string, Awaited<ReturnType<typeof listRawPetSearchEmbeddings>>[number]>();
  for (const revision of Object.values(OPENAI_PETS_REVISIONS)) {
    for (const row of await listRawPetSearchEmbeddings(revision)) existing.set(`${revision}/${row.slug}`, row);
  }
  const pending = inputs.filter((row) => {
    const stored = existing.get(`${row.modelRevision}/${row.slug}`);
    return !stored || !decodeRelatedPetV24Vector(stored, { modelRevision: row.modelRevision,
      sourceHash: row.sourceHash, dimensions: OPENAI_EMBEDDING_DIMENSIONS });
  });
  const grouped = new Map<string, OpenAIIndexInput[]>();
  for (const row of pending) grouped.set(row.text, [...(grouped.get(row.text) ?? []), row]);
  const texts = [...grouped.keys()]; let written = 0;
  for (let offset = 0; offset < texts.length; offset += 32) {
    const batch = texts.slice(offset, offset + 32);
    const vectors = await embed(batch); // Worker durably saves response before returning.
    if (vectors.length !== batch.length) throw new Error("embedding_batch_invalid");
    for (let index = 0; index < batch.length; index++) {
      const embedding = vectors[index];
      if (embedding.length !== OPENAI_EMBEDDING_DIMENSIONS || embedding.some((v) => !Number.isFinite(v)) ||
          !embedding.some((v) => Math.abs(v) > 1e-10)) throw new Error("embedding_vector_invalid");
      for (const row of grouped.get(batch[index]) ?? []) {
        // UPSERT is idempotent; after a lost ACK the next run reads YDB and worker receipts first.
        await upsertPetSearchEmbedding({ modelRevision: row.modelRevision, slug: row.slug, sourceHash: row.sourceHash,
          dimensions: OPENAI_EMBEDDING_DIMENSIONS, embedding, updatedAt: new Date().toISOString() });
        written++;
      }
    }
    onBatch({ written, reused: inputs.length - pending.length });
  }
  return { written, reused: inputs.length - pending.length };
}
function hash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }

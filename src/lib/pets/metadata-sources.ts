import {
  OPENAI_ANNOTATION_REVISION,
  OPENAI_ANNOTATION_PROPOSAL_REVISION,
  OPENAI_CAPTION_REVISION,
  OPENAI_METADATA_MODEL_URI,
} from "@/lib/pets/metadata-source-identities.mjs";

export {
  OPENAI_METADATA_MODEL,
  OPENAI_METADATA_MODEL_URI,
  OPENAI_ANNOTATION_REVISION,
  OPENAI_ANNOTATION_PROPOSAL_REVISION,
  OPENAI_CAPTION_REVISION,
} from "@/lib/pets/metadata-source-identities.mjs";

export type AnnotationMetadataSource = {
  annotationRevision: string;
  modelUri: string;
  proposalRevision: string;
  acceptedProposalRevisions?: readonly string[];
};

export function resolveAnnotationMetadataSource(
  revision: string | undefined,
  legacy: AnnotationMetadataSource,
): AnnotationMetadataSource {
  if (!revision || revision === legacy.annotationRevision) return legacy;
  if (revision === OPENAI_ANNOTATION_REVISION) return {
    annotationRevision: OPENAI_ANNOTATION_REVISION,
    modelUri: OPENAI_METADATA_MODEL_URI,
    proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION,
    acceptedProposalRevisions: [OPENAI_ANNOTATION_PROPOSAL_REVISION],
  };
  throw new Error("annotation_source_revision_unsupported");
}

export function resolveCaptionMetadataSource(
  revision: string | undefined,
  legacy: { captionRevision: string; modelUri: string },
): { captionRevision: string; modelUri: string } {
  if (!revision || revision === legacy.captionRevision) return legacy;
  if (revision === OPENAI_CAPTION_REVISION) return {
    captionRevision: OPENAI_CAPTION_REVISION,
    modelUri: OPENAI_METADATA_MODEL_URI,
  };
  throw new Error("caption_source_revision_unsupported");
}

import type { StoredRelatedPetAnnotation } from "@/lib/pets/related/related-pets-annotations-repository";
import type { StoredPetSearchCaption } from "@/lib/pets/search/search-captions-repository";
import type { RelatedPetAnnotationInput } from "@/lib/pets/related/related-pets-annotation-contract.mjs";
import { validateCurrentRelatedPetAnnotation } from "@/lib/pets/related/related-pets-annotation-refresh.mjs";
import { parsePetVisionCaptionEnvelope, buildPetVisionCaptionText, createPetVisionCaptionSourceHash } from "@/lib/pets/search/search-vision-contract";

export function selectFreshAnnotationMetadata(
  pet: RelatedPetAnnotationInput,
  rows: readonly StoredRelatedPetAnnotation[],
  legacy: AnnotationMetadataSource,
) {
  const ordered = [...rows].toSorted((a, b) => Number(a.annotationRevision === OPENAI_ANNOTATION_REVISION) - Number(b.annotationRevision === OPENAI_ANNOTATION_REVISION));
  for (const row of ordered) {
    if (row.slug !== pet.slug) continue;
    try {
      const source = resolveAnnotationMetadataSource(row.annotationRevision, legacy);
      const annotation = validateCurrentRelatedPetAnnotation({ pet, stored: row, ...source });
      return { row, source, annotation };
    } catch {
      // A stale or malformed source must not hide another valid source.
    }
  }
  return null;
}

export function selectFreshCaptionMetadata(
  rows: readonly StoredPetSearchCaption[],
  input: { slug: string; assetId: string; spritesheetSha256?: string; throwOnMalformed?: boolean; legacy: { captionRevision: string; modelUri: string } },
) {
  const ordered = [...rows].toSorted((a, b) => Number(a.captionRevision === OPENAI_CAPTION_REVISION) - Number(b.captionRevision === OPENAI_CAPTION_REVISION));
  let malformed = false;
  for (const row of ordered) {
    if (row.slug !== input.slug) continue;
    try {
      const source = resolveCaptionMetadataSource(row.captionRevision, input.legacy);
      const envelope = parsePetVisionCaptionEnvelope(row.captionJson);
      if (envelope.source.assetId !== input.assetId ||
          (input.spritesheetSha256 && input.spritesheetSha256 !== envelope.source.spritesheetSha256)) continue;
      const captionText = buildPetVisionCaptionText(envelope.caption);
      const sourceHash = createPetVisionCaptionSourceHash({ ...source, assetId: input.assetId, spritesheetSha256: envelope.source.spritesheetSha256 });
      if (row.captionText !== captionText) throw new Error("caption_text_not_canonical");
      if (row.sourceHash !== sourceHash) continue;
      return { row, source, captionText, sourceHash };
    } catch {
      malformed = true;
      // Malformed derived metadata does not invalidate another fresh source.
    }
  }
  if (input.throwOnMalformed && malformed) throw new Error("caption_metadata_invalid");
  return null;
}

export function groupMetadataBySlug<T extends { slug: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.slug);
    if (existing) existing.push(row);
    else grouped.set(row.slug, [row]);
  }
  return grouped;
}

import {
  OPENAI_ANNOTATION_REVISION,
  OPENAI_CAPTION_REVISION,
} from "@/lib/pets/metadata-sources";
import { RELATED_PETS_ANNOTATION_REVISION } from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  getRelatedPetAnnotation, listRelatedPetAnnotations,
  type StoredRelatedPetAnnotation,
} from "@/lib/pets/related-pets-annotations-repository";
import {
  getPetSearchCaption, listPetSearchCaptions,
  type StoredPetSearchCaption,
} from "@/lib/pets/search-captions-repository";
import { PET_VISION_CAPTION_REVISION } from "@/lib/pets/search-vision-contract";

// Return candidates; callers validate freshness before selecting a source.
export async function getPetAnnotationCandidates(revision: string, slug: string): Promise<StoredRelatedPetAnnotation[]> {
  const rows: StoredRelatedPetAnnotation[] = [];
  for (const current of revision === RELATED_PETS_ANNOTATION_REVISION ? [revision, OPENAI_ANNOTATION_REVISION] : [revision]) {
    const row = await getRelatedPetAnnotation(current, slug);
    if (row) rows.push({ ...row, annotationRevision: current });
  }
  return rows;
}
export async function listPetAnnotationsWithSources(revision: string): Promise<StoredRelatedPetAnnotation[]> {
  const rows: StoredRelatedPetAnnotation[] = [];
  for (const current of revision === RELATED_PETS_ANNOTATION_REVISION ? [revision, OPENAI_ANNOTATION_REVISION] : [revision]) {
    rows.push(...(await listRelatedPetAnnotations(current)).map(row => ({ ...row, annotationRevision: current })));
  }
  return rows;
}
export async function getPetCaptionCandidates(revision: string, slug: string): Promise<StoredPetSearchCaption[]> {
  const rows: StoredPetSearchCaption[] = [];
  for (const current of revision === PET_VISION_CAPTION_REVISION ? [revision, OPENAI_CAPTION_REVISION] : [revision]) {
    const row = await getPetSearchCaption(current, slug);
    if (row) rows.push({ ...row, captionRevision: current });
  }
  return rows;
}
export async function listPetCaptionsWithSources(revision: string): Promise<StoredPetSearchCaption[]> {
  const rows: StoredPetSearchCaption[] = [];
  for (const current of revision === PET_VISION_CAPTION_REVISION ? [revision, OPENAI_CAPTION_REVISION] : [revision]) {
    rows.push(...(await listPetSearchCaptions(current)).map(row => ({ ...row, captionRevision: current })));
  }
  return rows;
}

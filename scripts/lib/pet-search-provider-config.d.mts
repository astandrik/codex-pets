export type BackfillEmbeddingDefinition = {
  dimensions: number;
  documentModelPath: string;
  requestDimensions: number | null;
};

export type VisionBackfillCaptionDefinition = {
  modelName: string;
};

export const PET_SEARCH_BACKFILL_REVISIONS: Record<
  string,
  BackfillEmbeddingDefinition
>;
export const PET_VISION_BACKFILL_CAPTION_REVISIONS: Record<
  string,
  VisionBackfillCaptionDefinition
>;
export const PET_VISUAL_BACKFILL_REVISIONS: Record<
  string,
  BackfillEmbeddingDefinition & { captionRevision: string }
>;

export function requirePetSearchBackfillRevision(
  revision: string | undefined,
): BackfillEmbeddingDefinition;
export function requirePetVisualBackfillRevision(input: {
  captionRevision: string;
  visualRevision: string;
}): {
  captionDefinition: VisionBackfillCaptionDefinition;
  visualDefinition: BackfillEmbeddingDefinition & {
    captionRevision: string;
  };
};
export function createEmbeddingRequest(input: {
  folderId: string;
  definition: BackfillEmbeddingDefinition;
  text: string;
}): {
  modelUri: string;
  text: string;
  dim?: string;
};

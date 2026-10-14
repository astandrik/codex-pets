export const OPENAI_METADATA_MODEL = "gpt-6.1-sol";
export const OPENAI_METADATA_MODEL_URI = "openai://gpt-6.1-sol";
export const OPENAI_ANNOTATION_REVISION = "openai-gpt-6.1-sol-related-annotation-20261011-v1";
export const OPENAI_ANNOTATION_PROPOSAL_REVISION = "openai-gpt-6.1-sol-related-proposal-20261011-v1";
export const OPENAI_CAPTION_REVISION = "openai-gpt-6.1-sol-pet-caption-20261011-v1";

export function assertAnnotationSourceIdentity({ annotationRevision, proposalRevision, modelUri }) {
  const openai = annotationRevision === OPENAI_ANNOTATION_REVISION ||
    proposalRevision === OPENAI_ANNOTATION_PROPOSAL_REVISION || modelUri.startsWith("openai://");
  if (openai && (annotationRevision !== OPENAI_ANNOTATION_REVISION ||
      proposalRevision !== OPENAI_ANNOTATION_PROPOSAL_REVISION || modelUri !== OPENAI_METADATA_MODEL_URI)) {
    throw new Error("annotation_provider_revision_mismatch");
  }
}

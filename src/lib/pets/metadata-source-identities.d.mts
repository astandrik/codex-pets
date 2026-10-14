export const OPENAI_METADATA_MODEL: "gpt-6.1-sol";
export const OPENAI_METADATA_MODEL_URI: "openai://gpt-6.1-sol";
export const OPENAI_ANNOTATION_REVISION: "openai-gpt-6.1-sol-related-annotation-20261011-v1";
export const OPENAI_ANNOTATION_PROPOSAL_REVISION: "openai-gpt-6.1-sol-related-proposal-20261011-v1";
export const OPENAI_CAPTION_REVISION: "openai-gpt-6.1-sol-pet-caption-20261011-v1";
export function assertAnnotationSourceIdentity(input: {
  annotationRevision: string; proposalRevision: string; modelUri: string;
}): void;

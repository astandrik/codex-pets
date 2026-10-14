import { describe, expect, it, vi } from "vitest";
import {
  OPENAI_ANNOTATION_REVISION, OPENAI_ANNOTATION_PROPOSAL_REVISION,
  OPENAI_CAPTION_REVISION, OPENAI_METADATA_MODEL_URI,
  resolveAnnotationMetadataSource, resolveCaptionMetadataSource,
} from "@/lib/pets/metadata-sources";
import {
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
  getRelatedPetAnnotationProposalContract, parseRelatedPetAnnotationProposal,
  parseStoredRelatedPetAnnotationProposal,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import { createYandexRelatedPetAnnotationClient } from "@/lib/pets/related-pets-annotation-client.mjs";
import { assertAnnotationSourceIdentity } from "@/lib/pets/metadata-source-identities.mjs";
import { OPENAI_RELATED_PETS_PROFILE, OPENAI_RELATED_PETS_PRE_METADATA_REVISION, RELATED_PETS_V24_RANKING_REVISION, isSupportedRelatedPetsRankingRevision } from "@/lib/pets/related-pets-profile";

const empty = { entity: { key: null, aliases: [], confidence: "none", evidence: [] }, franchises: [], franchise_families: [], collections: [], specific_archetypes: [], themes: [], media_origins: [] };
describe("truthful mixed metadata sources", () => {
  it("uses exactly R3 prompt/schema while naming the actual OpenAI model policy", () => {
    const legacy = getRelatedPetAnnotationProposalContract(RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3);
    const source = getRelatedPetAnnotationProposalContract(OPENAI_ANNOTATION_PROPOSAL_REVISION);
    expect(source.schema).toEqual(legacy.schema);
    expect(source.systemPrompt).toBe(legacy.systemPrompt);
    expect(source.userPrompt).toBe(legacy.userPrompt);
    expect(source).toMatchObject({ provider: "openai", revision: OPENAI_ANNOTATION_PROPOSAL_REVISION,
      tokenPolicy: { api: "responses", reasoning: "low", initialMaxOutputTokens: 4096, retryMaxOutputTokens: 4096 } });
    expect(parseStoredRelatedPetAnnotationProposal(parseRelatedPetAnnotationProposal(empty, source.revision), source.revision)).toEqual(parseRelatedPetAnnotationProposal(empty, source.revision));
    expect(() => parseRelatedPetAnnotationProposal({ ...empty, entity: { ...empty.entity, key: "Wrong Key" } }, source.revision)).toThrow();
  });
  it("forbids a Yandex writer from claiming an OpenAI proposal revision", () => {
    const fetchImpl = vi.fn();
    expect(() => createYandexRelatedPetAnnotationClient({ folderId: "f", apiKey: "fixture", modelUri: "gpt://f/qwen", timeoutMs: 100,
      proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION, fetchImpl })).toThrow("annotation_provider_revision_mismatch");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => assertAnnotationSourceIdentity({ annotationRevision: OPENAI_ANNOTATION_REVISION, proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3, modelUri: "gpt://f/qwen" })).toThrow();
  });
  it("preserves the exact legacy source and resolves only registered alternative revisions", () => {
    const legacy = { annotationRevision: "legacy", proposalRevision: "r3", modelUri: "gpt://f/qwen" };
    expect(resolveAnnotationMetadataSource(undefined, legacy)).toBe(legacy);
    expect(resolveAnnotationMetadataSource("legacy", legacy)).toBe(legacy);
    expect(resolveAnnotationMetadataSource(OPENAI_ANNOTATION_REVISION, legacy)).toMatchObject({ modelUri: OPENAI_METADATA_MODEL_URI, proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION });
    expect(() => resolveAnnotationMetadataSource("unknown", legacy)).toThrow();
    expect(resolveCaptionMetadataSource(OPENAI_CAPTION_REVISION, { captionRevision: "legacy", modelUri: "gpt://f/qwen" })).toEqual({ captionRevision: OPENAI_CAPTION_REVISION, modelUri: OPENAI_METADATA_MODEL_URI });
    expect(() => resolveCaptionMetadataSource("unknown", { captionRevision: "legacy", modelUri: "gpt://f/qwen" })).toThrow();
  });
  it("keeps old snapshots readable after adding source compatibility", () => {
    expect(OPENAI_RELATED_PETS_PROFILE.rankingRevision).not.toBe(OPENAI_RELATED_PETS_PRE_METADATA_REVISION);
    for (const revision of [OPENAI_RELATED_PETS_PROFILE.rankingRevision, OPENAI_RELATED_PETS_PRE_METADATA_REVISION, RELATED_PETS_V24_RANKING_REVISION]) expect(isSupportedRelatedPetsRankingRevision(revision)).toBe(true);
  });
});

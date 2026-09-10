import { describe, expect, it, vi } from "vitest";

import {
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
  RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationProposalHash,
  createRelatedPetAnnotationProposalInputHash,
  createRelatedPetAnnotationSourceHash,
  resolveRelatedPetAnnotation,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  refreshRelatedPetAnnotationRecord,
  validateCurrentRelatedPetAnnotation,
} from "@/lib/pets/related-pets-annotation-refresh.mjs";

const modelUri = "gpt://folder/qwen";
const annotationRevision = "annotation-r11";
const pet = {
  slug: "vi",
  displayName: "Vi",
  description: "Arcane fighter",
  kind: "character" as const,
  tags: ["arcane"],
};
const proposal = {
  entity: {
    key: "vi",
    aliases: [],
    confidence: "high" as const,
    evidence: ["name" as const],
  },
  franchises: [{
    key: "arcane",
    confidence: "high" as const,
    evidence: ["description" as const],
  }],
  franchiseFamilies: [],
  collections: [],
  specificArchetypes: [],
  themes: [],
  mediaOrigins: [],
};

describe("related pet annotation provenance refresh", () => {
  it("keeps a valid R2 row unchanged while the selected writer is R3", async () => {
    const stored = storedRecord(pet, annotationRevision);
    const createProposal = vi.fn();
    const upsertAnnotation = vi.fn();

    await expect(refreshRelatedPetAnnotationRecord({
      mode: "apply",
      pet,
      annotationRevision,
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
      acceptedProposalRevisions: RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
      modelUri,
      getAnnotation: async () => stored,
      createProposal,
      upsertAnnotation,
    })).resolves.toMatchObject({
      outcome: "unchanged",
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      sourceHash: stored.sourceHash,
    });
    expect(createProposal).not.toHaveBeenCalled();
    expect(upsertAnnotation).not.toHaveBeenCalled();
  });

  it("validates R3 provenance under its stored revision and rejects unsupported revisions", () => {
    const currentR3 = storedRecord(
      pet,
      annotationRevision,
      RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
    );
    expect(validateCurrentRelatedPetAnnotation({
      pet,
      annotationRevision,
      acceptedProposalRevisions: RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
      modelUri,
      stored: currentR3,
    })).toMatchObject({
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
      sourceHash: currentR3.sourceHash,
    });
    expect(() => validateCurrentRelatedPetAnnotation({
      pet,
      annotationRevision,
      acceptedProposalRevisions: RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
      modelUri,
      stored: { ...currentR3, proposalRevision: "proposal-r4" },
    })).toThrow("annotation_stale");
  });
  it("reuses a validated proposal when only the annotation revision changes", async () => {
    const reusable = storedRecord(pet, "annotation-r4");
    const createProposal = vi.fn();
    const upsertAnnotation = vi.fn(async () => undefined);

    const result = await refreshRelatedPetAnnotationRecord({
      mode: "apply",
      pet,
      annotationRevision,
      modelUri,
      getAnnotation: async () => null,
      findReusableProposal: async () => reusable,
      createProposal,
      upsertAnnotation,
      now: () => new Date("2026-08-26T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ outcome: "updated", proposalAction: "reused" });
    expect(createProposal).not.toHaveBeenCalled();
    expect(upsertAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      annotationRevision,
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      proposalInputHash: reusable.proposalInputHash,
      proposalHash: reusable.proposalHash,
      proposalJson: JSON.stringify(proposal),
    }));
  });

  it("does not reuse a proposal when the card input changed", async () => {
    const reusable = storedRecord(
      { ...pet, description: "Old description" },
      "annotation-r4",
    );
    const createProposal = vi.fn(async () => proposal);

    const result = await refreshRelatedPetAnnotationRecord({
      mode: "apply",
      pet,
      annotationRevision,
      modelUri,
      getAnnotation: async () => null,
      findReusableProposal: async () => reusable,
      createProposal,
      upsertAnnotation: async () => undefined,
    });

    expect(result).toMatchObject({ outcome: "updated", proposalAction: "generated" });
    expect(createProposal).toHaveBeenCalledOnce();
  });

  it("does not reuse a proposal whose normalized hash is invalid", async () => {
    const createProposal = vi.fn(async () => proposal);
    const result = await refreshRelatedPetAnnotationRecord({
      mode: "apply",
      pet,
      annotationRevision,
      modelUri,
      getAnnotation: async () => null,
      findReusableProposal: async () => ({
        ...storedRecord(pet, "annotation-r4"),
        proposalHash: "0".repeat(64),
      }),
      createProposal,
      upsertAnnotation: async () => undefined,
    });

    expect(result).toMatchObject({ outcome: "updated", proposalAction: "generated" });
    expect(createProposal).toHaveBeenCalledOnce();
  });

  it("rejects missing proposal provenance as stale", () => {
    const current = storedRecord(pet, annotationRevision);
    expect(() => validateCurrentRelatedPetAnnotation({
      pet,
      annotationRevision,
      modelUri,
      stored: { ...current, proposalInputHash: "" },
    })).toThrow("annotation_provenance_missing");
  });

  it("force refresh bypasses reusable proposals", async () => {
    const findReusableProposal = vi.fn(async () => storedRecord(pet, "annotation-r4"));
    const createProposal = vi.fn(async () => proposal);

    const result = await refreshRelatedPetAnnotationRecord({
      mode: "apply",
      force: true,
      pet,
      annotationRevision,
      modelUri,
      getAnnotation: async () => storedRecord(pet, annotationRevision),
      findReusableProposal,
      createProposal,
      upsertAnnotation: async () => undefined,
    });

    expect(result).toMatchObject({ outcome: "updated", proposalAction: "generated" });
    expect(findReusableProposal).not.toHaveBeenCalled();
    expect(createProposal).toHaveBeenCalledOnce();
  });
});

function storedRecord(
  inputPet: typeof pet,
  revision: string,
  proposalRevision = RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
) {
  const annotation = resolveRelatedPetAnnotation({
    slug: inputPet.slug,
    proposal,
  });
  const proposalInputHash = createRelatedPetAnnotationProposalInputHash({
    pet: inputPet,
    modelUri,
    proposalRevision,
  });
  const proposalHash = createRelatedPetAnnotationProposalHash(proposal);
  return {
    slug: inputPet.slug,
    sourceHash: createRelatedPetAnnotationSourceHash({
      slug: inputPet.slug,
      annotationRevision: revision,
      proposalRevision,
      proposalInputHash,
      proposalHash,
    }),
    proposalRevision,
    proposalInputHash,
    proposalHash,
    proposalJson: JSON.stringify(proposal),
    annotationJson: JSON.stringify(annotation),
    annotationText: buildRelatedPetAnnotationText(annotation),
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

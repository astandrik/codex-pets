import { describe, expect, it, vi } from "vitest";

import {
  createRelatedPetAnnotationEmbeddingClient,
  createRelatedPetAnnotationRuntime,
} from "@/lib/pets/related-pets-annotation-runtime";
import {
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
  RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationEmbeddingSourceHash,
  createRelatedPetAnnotationProposalHash,
  createRelatedPetAnnotationProposalInputHash,
  createRelatedPetAnnotationSourceHash,
  resolveRelatedPetAnnotation,
} from "@/lib/pets/related-pets-annotation-contract.mjs";

const pet = {
  slug: "vi",
  displayName: "Vi",
  description: "Arcane fighter",
  kind: "character" as const,
  tags: ["arcane"],
};
const proposal = {
  entity: { key: "vi", aliases: [], confidence: "high" as const, evidence: ["name" as const] },
  franchises: [{ key: "arcane", confidence: "high" as const, evidence: ["description" as const] }],
  franchiseFamilies: [],
  collections: [],
  specificArchetypes: [],
  themes: [],
  mediaOrigins: [],
};

describe("current annotation runtime", () => {
  it("uses a dedicated 768-dimensional v2 embedding client", () => {
    const client = createRelatedPetAnnotationEmbeddingClient({
      folderId: "folder-1",
      apiKey: "key",
      revision: "yandex-text-search-2026-07",
      embeddingModelId: "yandex-text-search-v1-256",
      dimensions: 256,
      minSemanticScore: 0.31,
      timeoutMs: 800,
    });

    expect(client.dimensions).toBe(768);
  });

  it("writes the annotation before its query and document vectors", async () => {
    const writes: string[] = [];
    const runtime = createRelatedPetAnnotationRuntime({
      annotationRevision: "annotation-current",
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      queryRevision: "query-current",
      documentRevision: "document-current",
      dimensions: 2,
      modelUri: "gpt://folder/qwen",
      createProposal: async () => proposal,
      embeddingClient: {
        embedPreparedQuery: async () => [1, 0],
        embedDocument: async () => [1, 0],
      },
      getAnnotation: async () => null,
      upsertAnnotation: async () => { writes.push("annotation"); },
      getEmbeddingMetadata: async () => null,
      upsertEmbedding: async ({ modelRevision }) => { writes.push(modelRevision); },
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });

    await expect(runtime.refresh(pet)).resolves.toBe("annotation-and-vectors");
    expect(writes).toEqual(["annotation", "query-current", "document-current"]);
  });

  it("reuses an R2 annotation and matching vectors while the writer is R3", async () => {
    const createProposal = vi.fn();
    const embedPreparedQuery = vi.fn();
    const embedDocument = vi.fn();
    const upsertAnnotation = vi.fn();
    const upsertEmbedding = vi.fn();
    const annotationRevision = "annotation-current";
    const modelUri = "gpt://folder/qwen";
    const annotation = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
    const provenance = annotationProvenance({ pet, annotationRevision });
    const annotationText = buildRelatedPetAnnotationText(annotation);
    const runtime = createRelatedPetAnnotationRuntime({
      annotationRevision,
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
      acceptedProposalRevisions: RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
      queryRevision: "query-current",
      documentRevision: "document-current",
      dimensions: 2,
      modelUri,
      createProposal,
      embeddingClient: {
        embedPreparedQuery,
        embedDocument,
      },
      getAnnotation: async () => ({
        slug: pet.slug,
        ...provenance,
        proposalJson: JSON.stringify(proposal),
        annotationJson: JSON.stringify(annotation),
        annotationText,
        updatedAt: "2026-08-11T00:00:00.000Z",
      }),
      upsertAnnotation,
      getEmbeddingMetadata: async (revision) => ({
        sourceHash: createRelatedPetAnnotationEmbeddingSourceHash({
          modelRevision: revision,
          role: revision === "query-current" ? "query" : "document",
          annotationRevision,
          annotationSourceHash: provenance.sourceHash,
          annotationText,
        }),
        dimensions: 2,
      }),
      upsertEmbedding,
    });
    await expect(runtime.refresh(pet)).resolves.toBe("unchanged");
    expect(createProposal).not.toHaveBeenCalled();
    expect(embedPreparedQuery).not.toHaveBeenCalled();
    expect(embedDocument).not.toHaveBeenCalled();
    expect(upsertAnnotation).not.toHaveBeenCalled();
    expect(upsertEmbedding).not.toHaveBeenCalled();
  });
});

function annotationProvenance(input: {
  pet: typeof pet;
  annotationRevision: string;
}) {
  const proposalInputHash = createRelatedPetAnnotationProposalInputHash({
    pet: input.pet,
    modelUri: "gpt://folder/qwen",
  });
  const proposalHash = createRelatedPetAnnotationProposalHash(proposal);
  return {
    sourceHash: createRelatedPetAnnotationSourceHash({
      slug: input.pet.slug,
      annotationRevision: input.annotationRevision,
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      proposalInputHash,
      proposalHash,
    }),
    proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
    proposalInputHash,
    proposalHash,
  };
}

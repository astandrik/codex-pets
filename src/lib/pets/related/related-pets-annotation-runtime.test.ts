import { OPENAI_ANNOTATION_REVISION, OPENAI_ANNOTATION_PROPOSAL_REVISION, OPENAI_METADATA_MODEL_URI } from "@/lib/pets/metadata-sources";
import { describe, expect, it, vi } from "vitest";

import {
  createRelatedPetAnnotationEmbeddingClient,
  createRelatedPetAnnotationRuntime,
} from "@/lib/pets/related/related-pets-annotation-runtime";
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
} from "@/lib/pets/related/related-pets-annotation-contract.mjs";

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

  it.each([false, true])("reuses fresh OpenAI over stale Yandex without new metadata calls (reversed=%s)", async (reverse) => {
    const modelUri = OPENAI_METADATA_MODEL_URI;
    const proposalInputHash = createRelatedPetAnnotationProposalInputHash({ pet, modelUri, proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION });
    const proposalHash = createRelatedPetAnnotationProposalHash(proposal);
    const sourceHash = createRelatedPetAnnotationSourceHash({ slug: pet.slug, annotationRevision: OPENAI_ANNOTATION_REVISION, proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION, proposalInputHash, proposalHash });
    const annotation = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
    const createProposal = vi.fn(); const upsertAnnotation = vi.fn(); const upsertEmbedding = vi.fn();
    const stored = { slug: pet.slug, annotationRevision: OPENAI_ANNOTATION_REVISION, proposalRevision: OPENAI_ANNOTATION_PROPOSAL_REVISION,
      proposalInputHash, proposalHash, sourceHash, proposalJson: JSON.stringify(proposal), annotationJson: JSON.stringify(annotation), annotationText: buildRelatedPetAnnotationText(annotation), updatedAt: "time" };
    const runtime = createRelatedPetAnnotationRuntime({ annotationRevision: "legacy", proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      queryRevision: "query", documentRevision: "document", dimensions: 2, modelUri: "gpt://folder/qwen", createProposal,
      embeddingClient: { embedPreparedQuery: async () => [1, 0], embedDocument: async () => [1, 0] },
      getAnnotation: async () => stored, getAnnotationCandidates: async () => { const rows = [{ ...stored, annotationRevision: "legacy", sourceHash: "stale-yandex" }, stored]; return reverse ? rows.reverse() : rows; }, upsertAnnotation, getEmbeddingMetadata: async () => null, upsertEmbedding });
    await expect(runtime.refresh(pet)).resolves.toBe("vectors-only");
    expect(createProposal).not.toHaveBeenCalled(); expect(upsertAnnotation).not.toHaveBeenCalled();
    expect(upsertEmbedding).toHaveBeenCalledTimes(2);
    stored.proposalInputHash = "stale";
    await expect(runtime.refresh(pet)).rejects.toThrow("annotation_stale");
    expect(createProposal).not.toHaveBeenCalled();
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

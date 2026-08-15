import { describe, expect, it, vi } from "vitest";

import { createRelatedPetAnnotationRuntime } from "@/lib/pets/related-pets-annotation-runtime";
import {
  buildRelatedPetAnnotationText,
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
  it("writes the annotation before its query and document vectors", async () => {
    const writes: string[] = [];
    const runtime = createRelatedPetAnnotationRuntime({
      annotationRevision: "annotation-current",
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

  it("does not call the provider when the stored source is current", async () => {
    const createProposal = vi.fn();
    const annotationRevision = "annotation-current";
    const modelUri = "gpt://folder/qwen";
    const annotation = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
    const runtime = createRelatedPetAnnotationRuntime({
      annotationRevision,
      queryRevision: "query-current",
      documentRevision: "document-current",
      dimensions: 2,
      modelUri,
      createProposal,
      embeddingClient: {
        embedPreparedQuery: async () => [1, 0],
        embedDocument: async () => [1, 0],
      },
      getAnnotation: async () => ({
        slug: pet.slug,
        sourceHash: createRelatedPetAnnotationSourceHash({
          pet,
          modelUri,
          annotationRevision,
        }),
        proposalJson: JSON.stringify(proposal),
        annotationJson: JSON.stringify(annotation),
        annotationText: buildRelatedPetAnnotationText(annotation),
        updatedAt: "2026-08-11T00:00:00.000Z",
      }),
      upsertAnnotation: async () => undefined,
      getEmbeddingMetadata: async () => null,
      upsertEmbedding: async () => undefined,
    });
    await expect(runtime.refresh(pet)).resolves.toBe("vectors-only");
    expect(createProposal).not.toHaveBeenCalled();
  });
});

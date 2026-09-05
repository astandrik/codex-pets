import { describe, expect, it, vi } from "vitest";

import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationProposalHash,
  createRelatedPetAnnotationProposalInputHash,
  createRelatedPetAnnotationSourceHash,
  resolveRelatedPetAnnotation,
} from "../../src/lib/pets/related-pets-annotation-contract.mjs";
import {
  adoptLegacyRelatedPetAnnotationProposal,
  createRelatedPetAnnotationCatalogFingerprint,
  parseRelatedPetAnnotationBackfillArgs,
  runRelatedPetAnnotationBackfill,
  runRelatedPetAnnotationEmbeddingBackfill,
} from "./related-pets-annotation-backfill.mjs";

const pet = {
  slug: "vi",
  displayName: "Vi",
  description: "An Arcane fighter.",
  kind: "character" as const,
  tags: ["arcane"],
  createdAt: "2026-08-15T00:00:00.000Z",
  approvedAt: "2026-08-16T00:00:00.000Z",
  status: "approved",
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
const annotationModelUri = "gpt://folder/qwen3.6-35b-a3b";

describe("related pet annotation backfill", () => {
  it("parses resumable modes and rejects ambiguous combinations", () => {
    expect(parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--continue-on-error",
    ])).toEqual({
      mode: "apply",
      slug: null,
      force: false,
      continueOnError: true,
      concurrency: 1,
      reuseProposalsFrom: null,
      expectedCatalogFingerprint: null,
    });
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--slug",
      "vi",
      "--continue-on-error",
    ])).toThrow(/cannot be combined/i);
  });

  it("binds explicit legacy proposal bootstrap to one catalog fingerprint", () => {
    const fingerprint = "a".repeat(64);
    expect(parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--reuse-proposals-from=old-r1",
      `--expected-catalog-fingerprint=${fingerprint}`,
    ])).toMatchObject({
      reuseProposalsFrom: "old-r1",
      expectedCatalogFingerprint: fingerprint,
    });
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--reuse-proposals-from=old-r1",
    ])).toThrow(/expected-catalog-fingerprint/i);
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      `--expected-catalog-fingerprint=${fingerprint}`,
    ])).toThrow(/reuse-proposals-from/i);
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--reuse-proposals-from=old-r1",
      "--expected-catalog-fingerprint=not-a-sha256",
    ])).toThrow(/64.*hex|sha-?256/i);
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--force",
      "--reuse-proposals-from=old-r1",
      `--expected-catalog-fingerprint=${fingerprint}`,
    ])).toThrow(/cannot be combined/i);
  });

  it("uses verifier-compatible stable catalog fingerprint serialization", () => {
    const secondPet = {
      ...pet,
      slug: "jinx",
      displayName: "Jinx",
      tags: ["zaun", "arcane"],
    };
    const expected = createRelatedPetAnnotationCatalogFingerprint([
      pet,
      secondPet,
    ]);
    expect(expected).toBe(
      "900382861712c1ff5c3b99bd1bada130531ee3602196d515bc1398bd10fb0cba",
    );
    expect(createRelatedPetAnnotationCatalogFingerprint([
      { ...secondPet, tags: [...secondPet.tags].reverse() },
      pet,
    ])).toBe(expected);
    expect(createRelatedPetAnnotationCatalogFingerprint([
      { ...pet, description: "Changed card" },
      secondPet,
    ])).not.toBe(expected);
  });

  it("rejects a legacy catalog mismatch before reuse, provider, or writes", async () => {
    const findReusableProposal = vi.fn();
    const createProposal = vi.fn();
    const upsertAnnotation = vi.fn();
    await expect(runRelatedPetAnnotationBackfill({
      options: {
        ...options("apply"),
        reuseProposalsFrom: "annotation-r9",
        expectedCatalogFingerprint: "0".repeat(64),
      },
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: annotationModelUri,
      pets: [pet],
      getAnnotation: vi.fn(),
      findReusableProposal,
      createProposal,
      upsertAnnotation,
      log: () => undefined,
    })).rejects.toThrow("annotation_catalog_fingerprint_mismatch");
    expect(findReusableProposal).not.toHaveBeenCalled();
    expect(createProposal).not.toHaveBeenCalled();
    expect(upsertAnnotation).not.toHaveBeenCalled();
  });

  it("adopts a legacy proposal with explicit current provenance", () => {
    const legacy = {
      slug: "vi",
      sourceHash: "legacy-source",
      proposalJson: JSON.stringify(proposal),
      annotationJson: "{}",
      annotationText: "entity: vi",
    };
    expect(adoptLegacyRelatedPetAnnotationProposal(
      legacy,
      "current-proposal-input",
    )).toMatchObject({
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      proposalInputHash: "current-proposal-input",
      proposalHash: createRelatedPetAnnotationProposalHash(proposal),
    });
  });

  it("preserves complete provenance and rejects partial legacy metadata", () => {
    const current = currentAnnotation(pet);
    expect(adoptLegacyRelatedPetAnnotationProposal(
      current,
      "different-input-hash",
    )).toBe(current);
    expect(() => adoptLegacyRelatedPetAnnotationProposal(
      { ...current, proposalHash: "" },
      "different-input-hash",
    )).toThrow("legacy_proposal_provenance_invalid");
  });

  it("reuses a provenance-matching proposal without a provider call", async () => {
    const reusable = currentAnnotation(pet, "annotation-r4");
    const createProposal = vi.fn();
    const upsertAnnotation = vi.fn(async () => undefined);
    const summary = await runRelatedPetAnnotationBackfill({
      options: options("apply"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: annotationModelUri,
      pets: [pet],
      getAnnotation: async () => null,
      findReusableProposal: async () => reusable,
      createProposal,
      upsertAnnotation,
      log: () => undefined,
    });

    expect(summary.updated).toBe(1);
    expect(createProposal).not.toHaveBeenCalled();
    expect(upsertAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      proposalInputHash: reusable.proposalInputHash,
      proposalHash: reusable.proposalHash,
    }));
  });

  it("reuses a full unchanged catalog and calls the model only for changed cards", async () => {
    const pets = Array.from({ length: 158 }, (_, index) => ({
      ...pet,
      slug: `pet-${String(index).padStart(3, "0")}`,
    }));
    const reusable = new Map(pets.map((candidate) => [
      candidate.slug,
      currentAnnotation(candidate, "annotation-r4"),
    ]));
    const createProposal = vi.fn(async () => proposal);
    const upsertAnnotation = vi.fn(async () => undefined);

    const unchangedSummary = await runRelatedPetAnnotationBackfill({
      options: { ...options("apply"), continueOnError: true, concurrency: 5 },
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: annotationModelUri,
      pets,
      getAnnotation: async () => null,
      findReusableProposal: async ({ slug }) => reusable.get(slug) ?? null,
      createProposal,
      upsertAnnotation,
      log: () => undefined,
    });

    expect(unchangedSummary).toMatchObject({
      scanned: 158,
      updated: 158,
      failed: 0,
      proposalReused: 158,
      proposalGenerated: 0,
    });
    expect(createProposal).not.toHaveBeenCalled();
    expect(upsertAnnotation).toHaveBeenCalledTimes(158);

    for (const candidate of pets.slice(-8)) {
      reusable.set(
        candidate.slug,
        currentAnnotation(
          { ...candidate, description: "Stale description" },
          "annotation-r4",
        ),
      );
    }
    upsertAnnotation.mockClear();
    const changedSummary = await runRelatedPetAnnotationBackfill({
      options: { ...options("apply"), continueOnError: true, concurrency: 5 },
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: annotationModelUri,
      pets,
      getAnnotation: async () => null,
      findReusableProposal: async ({ slug }) => reusable.get(slug) ?? null,
      createProposal,
      upsertAnnotation,
      log: () => undefined,
    });

    expect(changedSummary).toMatchObject({
      scanned: 158,
      updated: 158,
      failed: 0,
      proposalReused: 150,
      proposalGenerated: 8,
    });
    expect(createProposal).toHaveBeenCalledTimes(8);
    expect(upsertAnnotation).toHaveBeenCalledTimes(158);
  });

  it("dry-runs without provider calls or writes", async () => {
    const createProposal = vi.fn();
    const upsertAnnotation = vi.fn();
    const summary = await runRelatedPetAnnotationBackfill({
      options: options("dry-run"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
      pets: [pet],
      getAnnotation: async () => null,
      createProposal,
      upsertAnnotation,
      log: () => undefined,
    });
    expect(summary).toMatchObject({ planned: 1, updated: 0, failed: 0 });
    expect(createProposal).not.toHaveBeenCalled();
    expect(upsertAnnotation).not.toHaveBeenCalled();
  });

  it("stores proposal, resolved annotation, and controlled text", async () => {
    const upsertAnnotation = vi.fn(async () => undefined);
    const summary = await runRelatedPetAnnotationBackfill({
      options: options("apply"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
      pets: [pet],
      getAnnotation: async () => null,
      createProposal: async () => proposal,
      upsertAnnotation,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      log: () => undefined,
    });
    const resolved = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
    expect(summary.updated).toBe(1);
    expect(upsertAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      slug: "vi",
      annotationJson: JSON.stringify(resolved),
      annotationText: buildRelatedPetAnnotationText(resolved),
      updatedAt: "2026-08-11T00:00:00.000Z",
    }));
  });

  it("continues after sanitized failures", async () => {
    const logs: unknown[] = [];
    const summary = await runRelatedPetAnnotationBackfill({
      options: { ...options("apply"), continueOnError: true },
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
      pets: [pet, { ...pet, slug: "jinx" }],
      getAnnotation: async () => null,
      createProposal: async (candidate) => {
        if (candidate.slug === "vi") {
          throw Object.assign(new Error("SECRET_BODY"), { reason: "refused" });
        }
        return proposal;
      },
      upsertAnnotation: async () => undefined,
      log: (entry) => logs.push(entry),
    });
    expect(summary).toMatchObject({ updated: 1, failed: 1, failedSlugs: ["vi"] });
    expect(JSON.stringify(logs)).not.toContain("SECRET_BODY");
  });

  it("reports only safe field names for unresolved relations", async () => {
    const logs: unknown[] = [];
    const worldKnowledgeProposal = {
      ...proposal,
      franchises: [{
        key: "secret-franchise-response",
        confidence: "high" as const,
        evidence: ["world_knowledge" as const],
      }],
    };
    const summary = await runRelatedPetAnnotationBackfill({
      options: { ...options("apply"), continueOnError: true },
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
      pets: [pet],
      getAnnotation: async () => null,
      createProposal: async () => worldKnowledgeProposal,
      upsertAnnotation: async () => undefined,
      log: (entry) => logs.push(entry),
    });

    expect(summary.failedSlugs).toEqual(["vi"]);
    expect(logs).toContainEqual({
      action: "failed",
      slug: "vi",
      reason: "unresolved_strong_relation",
      unresolvedFields: ["franchises"],
    });
    expect(JSON.stringify(logs)).not.toContain("secret-franchise-response");
  });

  it.each([
    ["query", RELATED_PETS_ANNOTATION_QUERY_REVISION],
    ["document", RELATED_PETS_ANNOTATION_DOCUMENT_REVISION],
  ] as const)("backfills the %s vector from controlled text", async (role, revision) => {
    const storedAnnotation = currentAnnotation(pet);
    const upsert = vi.fn(async () => undefined);
    const summary = await runRelatedPetAnnotationEmbeddingBackfill({
      options: options("apply"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelRevision: revision,
      role,
      dimensions: 768,
      modelUri: annotationModelUri,
      pets: [pet],
      annotations: [storedAnnotation],
      getMetadata: async () => null,
      embed: async (text: string, actualRole: string) => {
        expect(text).toBe(storedAnnotation.annotationText);
        expect(actualRole).toBe(role);
        return Array(768).fill(0.25);
      },
      upsert,
      log: () => undefined,
    });
    expect(summary.updated).toBe(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      modelRevision: revision,
      slug: "vi",
      dimensions: 768,
    }));
  });

  it("rejects a stale annotation before embedding it", async () => {
    const resolved = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
    const annotationText = buildRelatedPetAnnotationText(resolved);
    const embed = vi.fn(async () => Array(768).fill(0.25));
    const getMetadata = vi.fn(async () => null);
    const upsert = vi.fn(async () => undefined);

    await expect(runRelatedPetAnnotationEmbeddingBackfill({
      options: options("apply"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelRevision: RELATED_PETS_ANNOTATION_QUERY_REVISION,
      role: "query",
      dimensions: 768,
      modelUri: annotationModelUri,
      pets: [pet],
      annotations: [{
        ...currentAnnotation({ ...pet, description: "Old description" }),
        annotationJson: JSON.stringify(resolved),
        annotationText,
      }],
      getMetadata,
      embed,
      upsert,
      log: () => undefined,
    })).rejects.toThrow("annotation_stale");

    expect(getMetadata).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a missing annotation model identity once before starting workers", async () => {
    const pets = [pet, { ...pet, slug: "jinx" }];
    const logs: unknown[] = [];
    const getMetadata = vi.fn(async () => null);

    await expect(runRelatedPetAnnotationEmbeddingBackfill({
      options: {
        ...options("dry-run"),
        continueOnError: true,
        concurrency: 2,
      },
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelRevision: RELATED_PETS_ANNOTATION_QUERY_REVISION,
      role: "query",
      dimensions: 768,
      modelUri: null,
      pets,
      annotations: pets.map((item) => currentAnnotation(item)),
      getMetadata,
      embed: async () => {
        throw new Error("unexpected_embed");
      },
      upsert: async () => {
        throw new Error("unexpected_upsert");
      },
      log: (entry) => logs.push(entry),
    })).rejects.toThrow("annotation_model_uri_missing");

    expect(logs).toEqual([]);
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it("reports a missing annotation without requiring model identity", async () => {
    await expect(runRelatedPetAnnotationEmbeddingBackfill({
      options: options("dry-run"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelRevision: RELATED_PETS_ANNOTATION_QUERY_REVISION,
      role: "query",
      dimensions: 768,
      modelUri: null,
      pets: [pet],
      annotations: [],
      getMetadata: async () => null,
      embed: async () => {
        throw new Error("unexpected_embed");
      },
      upsert: async () => {
        throw new Error("unexpected_upsert");
      },
      log: () => undefined,
    })).rejects.toThrow("annotation_missing");
  });

  it("requires a rebuild after a partial vector write", async () => {
    const logs: Array<Record<string, unknown>> = [];
    let embeddingCall = 0;
    const pets = [pet, { ...pet, slug: "jinx" }];

    await expect(runRelatedPetAnnotationEmbeddingBackfill({
      options: options("apply"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelRevision: RELATED_PETS_ANNOTATION_QUERY_REVISION,
      role: "query",
      dimensions: 768,
      modelUri: annotationModelUri,
      pets,
      annotations: pets.map((item) => currentAnnotation(item)),
      getMetadata: async () => null,
      embed: async () => {
        embeddingCall += 1;
        if (embeddingCall === 2) throw new Error("provider_failed");
        return Array(768).fill(0.25);
      },
      upsert: async () => undefined,
      log: (entry) => logs.push(entry as Record<string, unknown>),
    })).rejects.toThrow("provider_failed");

    expect(logs).toContainEqual(expect.objectContaining({
      action: "related-pets-rebuild-required",
    }));
  });
});

function options(mode: "dry-run" | "apply") {
  return {
    mode,
    slug: null,
    force: false,
    continueOnError: false,
    concurrency: 1,
  };
}

function currentAnnotation(
  inputPet: typeof pet,
  annotationRevision = RELATED_PETS_ANNOTATION_REVISION,
) {
  const annotation = resolveRelatedPetAnnotation({
    slug: inputPet.slug,
    proposal,
  });
  const proposalInputHash = createRelatedPetAnnotationProposalInputHash({
    pet: inputPet,
    modelUri: annotationModelUri,
  });
  const proposalHash = createRelatedPetAnnotationProposalHash(proposal);
  return {
    slug: inputPet.slug,
    sourceHash: createRelatedPetAnnotationSourceHash({
      slug: inputPet.slug,
      annotationRevision,
      proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      proposalInputHash,
      proposalHash,
    }),
    proposalRevision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
    proposalInputHash,
    proposalHash,
    proposalJson: JSON.stringify(proposal),
    annotationJson: JSON.stringify(annotation),
    annotationText: buildRelatedPetAnnotationText(annotation),
  };
}

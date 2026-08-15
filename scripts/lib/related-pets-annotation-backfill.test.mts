import { describe, expect, it, vi } from "vitest";

import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
  createRelatedPetAnnotationSourceHash,
  resolveRelatedPetAnnotation,
  buildRelatedPetAnnotationText,
} from "../../src/lib/pets/related-pets-annotation-contract.mjs";
import {
  createStoredRelatedPetAnnotationProposalLoader,
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
  status: "approved",
};
const proposal = {
  entity: {
    key: "vi",
    aliases: [],
    confidence: "high" as const,
    evidence: ["name" as const],
  },
  franchises: [
    {
      key: "arcane",
      confidence: "high" as const,
      evidence: ["description" as const],
    },
  ],
  franchiseFamilies: [],
  collections: [],
  specificArchetypes: [],
  themes: [],
  mediaOrigins: [],
};

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
    });
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--slug",
      "vi",
      "--continue-on-error",
    ])).toThrow(/cannot be combined/i);
  });

  it("parses a safe proposal source revision", () => {
    expect(parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--reuse-proposals-from",
      "yandex-qwen3.6-35b-a3b-related-annotation-2026-08-v11-r3",
    ])).toMatchObject({
      reuseProposalsFrom:
        "yandex-qwen3.6-35b-a3b-related-annotation-2026-08-v11-r3",
    });
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--reuse-proposals-from=../../unsafe",
    ])).toThrow(/valid revision/i);
  });

  it("loads and validates a stored provider proposal without calling AI", async () => {
    const getAnnotation = vi.fn(async () => ({
      proposalJson: JSON.stringify(proposal),
    }));
    const loadProposal = createStoredRelatedPetAnnotationProposalLoader({
      sourceRevision:
        "yandex-qwen3.6-35b-a3b-related-annotation-2026-08-v11-r3",
      getAnnotation,
    });

    await expect(loadProposal(pet)).resolves.toEqual(proposal);
    expect(getAnnotation).toHaveBeenCalledWith(
      "yandex-qwen3.6-35b-a3b-related-annotation-2026-08-v11-r3",
      "vi",
    );
  });

  it("fails safely when a stored provider proposal is missing or invalid", async () => {
    const missing = createStoredRelatedPetAnnotationProposalLoader({
      sourceRevision: "annotation-r3",
      getAnnotation: async () => null,
    });
    const invalid = createStoredRelatedPetAnnotationProposalLoader({
      sourceRevision: "annotation-r3",
      getAnnotation: async () => ({ proposalJson: "SECRET_INVALID_JSON" }),
    });

    await expect(missing(pet)).rejects.toMatchObject({
      reason: "source_annotation_missing",
    });
    await expect(invalid(pet)).rejects.toMatchObject({
      reason: "source_annotation_invalid",
    });
  });

  it("parses bounded concurrency and requires continue-on-error for parallel apply", () => {
    expect(parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--continue-on-error",
      "--concurrency=5",
    ])).toMatchObject({ concurrency: 5 });
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--concurrency",
      "5",
    ])).toThrow(/requires --continue-on-error/i);
    expect(() => parseRelatedPetAnnotationBackfillArgs([
      "--apply",
      "--continue-on-error",
      "--concurrency=11",
    ])).toThrow(/integer from 1 to 10/i);
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
      createSourceHash: createRelatedPetAnnotationSourceHash,
      log: () => undefined,
    });
    expect(summary).toMatchObject({ planned: 1, updated: 0, failed: 0 });
    expect(createProposal).not.toHaveBeenCalled();
    expect(upsertAnnotation).not.toHaveBeenCalled();
  });

  it("stores provider proposal, resolved annotation, and controlled text", async () => {
    const upsertAnnotation = vi.fn(async () => undefined);
    const summary = await runRelatedPetAnnotationBackfill({
      options: options("apply"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
      pets: [pet],
      getAnnotation: async () => null,
      createProposal: async () => proposal,
      upsertAnnotation,
      createSourceHash: createRelatedPetAnnotationSourceHash,
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

  it("continues after sanitized failures and returns failed slugs", async () => {
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
      createSourceHash: createRelatedPetAnnotationSourceHash,
      log: (entry) => logs.push(entry),
    });
    expect(summary).toMatchObject({ updated: 1, failed: 1, failedSlugs: ["vi"] });
    expect(JSON.stringify(logs)).not.toContain("SECRET_BODY");
  });

  it("limits parallel provider work and returns sorted failed slugs", async () => {
    let active = 0;
    let maxActive = 0;
    const summary = await runRelatedPetAnnotationBackfill({
      options: {
        ...options("apply"),
        continueOnError: true,
        concurrency: 2,
      },
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
      pets: ["zeta", "alpha", "beta", "gamma"].map((slug) => ({
        ...pet,
        slug,
      })),
      getAnnotation: async () => null,
      createProposal: async (candidate) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (candidate.slug === "zeta" || candidate.slug === "beta") {
          throw new Error("provider_failed");
        }
        return proposal;
      },
      upsertAnnotation: async () => undefined,
      createSourceHash: createRelatedPetAnnotationSourceHash,
      log: () => undefined,
    });

    expect(maxActive).toBe(2);
    expect(summary).toMatchObject({
      updated: 2,
      failed: 2,
      failedSlugs: ["beta", "zeta"],
    });
  });

  it("reports only safe field names for unresolved strong relations", async () => {
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
      createSourceHash: createRelatedPetAnnotationSourceHash,
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
  ] as const)("backfills the %s vector from stored controlled text", async (role, revision) => {
    const resolved = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
    const annotationText = buildRelatedPetAnnotationText(resolved);
    const upsert = vi.fn(async () => undefined);
    const summary = await runRelatedPetAnnotationEmbeddingBackfill({
      options: options("apply"),
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelRevision: revision,
      role,
      dimensions: 768,
      pets: [pet],
      annotations: [{
        slug: "vi",
        sourceHash: "annotation-hash",
        annotationJson: JSON.stringify(resolved),
        annotationText,
      }],
      getMetadata: async () => null,
      embed: async (text: string, actualRole: string) => {
        expect(text).toBe(annotationText);
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
});

function options(mode: "dry-run" | "apply") {
  return {
    mode,
    slug: null,
    force: false,
    continueOnError: false,
    concurrency: 1,
    reuseProposalsFrom: null,
  };
}

import { describe, expect, it } from "vitest";

import { createRelatedPetAnnotationsRepository } from "@/lib/pets/related-pets-annotations-repository";

const values = { utf8: (value: string) => ({ textValue: value }) };

describe("related pet annotations repository", () => {
  it("reads, lists, and writes one immutable revision", async () => {
    const executions: Array<{
      statement: string;
      params: Record<string, unknown> | undefined;
    }> = [];
    const repository = createRelatedPetAnnotationsRepository({
      isConfigured: () => true,
      values,
      execute: async (statement, params) => {
        executions.push({ statement, params });
        return {
          resultSets: [{
            rows: [{ items: [
              { textValue: "vi" },
              { textValue: "hash" },
              { textValue: "{\"entity\":{}}" },
              { textValue: "{\"schemaVersion\":1}" },
              { textValue: "entity: vi" },
              { textValue: "2026-08-11T00:00:00.000Z" },
            ] }],
          }],
        };
      },
    });

    await expect(repository.get("annotation-current", "vi")).resolves.toMatchObject({
      slug: "vi",
      sourceHash: "hash",
      annotationText: "entity: vi",
    });
    await expect(repository.listByRevision("annotation-current")).resolves.toHaveLength(1);
    await repository.upsert({
      annotationRevision: "annotation-current",
      slug: "vi",
      sourceHash: "hash",
      proposalJson: "{}",
      annotationJson: "{}",
      annotationText: "entity: vi",
      updatedAt: "2026-08-11T00:00:00.000Z",
    });
    await repository.deleteBySlug("vi");

    expect(executions[0]?.statement).toContain("pet_slug = $pet_slug");
    expect(executions[0]?.params).toMatchObject({
      $annotation_revision: { textValue: "annotation-current" },
      $pet_slug: { textValue: "vi" },
    });
    expect(executions[1]?.statement).not.toContain("pet_slug = $pet_slug");
    expect(executions[2]?.statement).toContain(
      "UPSERT INTO codex_pet_related_annotations",
    );
    expect(executions[3]?.statement).toContain(
      "DELETE FROM codex_pet_related_annotations",
    );
    expect(executions[3]?.params).toEqual({ $pet_slug: { textValue: "vi" } });
  });

  it("is inert without YDB configuration", async () => {
    const repository = createRelatedPetAnnotationsRepository({
      isConfigured: () => false,
      values,
      execute: async () => { throw new Error("must not execute"); },
    });
    await expect(repository.get("missing-revision", "vi")).resolves.toBeNull();
    await expect(repository.listByRevision("missing-revision")).resolves.toEqual([]);
  });
});

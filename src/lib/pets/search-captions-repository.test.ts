import { describe, expect, it } from "vitest";

import { createSearchCaptionsRepository } from "@/lib/pets/search-captions-repository";

const values = {
  utf8: (value: string) => ({ textValue: value }),
};

describe("search captions repository", () => {
  it("reads one caption and lists a configured revision", async () => {
    const statements: Array<{
      statement: string;
      params: Record<string, unknown>;
    }> = [];
    const repository = createSearchCaptionsRepository({
      isConfigured: () => true,
      values,
      execute: async (statement, params) => {
        statements.push({ statement, params });
        return {
          resultSets: [
            {
              rows: [
                {
                  items: [
                    { textValue: "velvet-byte" },
                    { textValue: "source-hash" },
                    { textValue: '{"schemaVersion":1}' },
                    { textValue: "subject_en: character" },
                    { textValue: "2026-07-22T12:00:00.000Z" },
                  ],
                },
              ],
            },
          ],
        };
      },
    });

    await expect(repository.get("caption-v1", "velvet-byte")).resolves.toEqual({
      slug: "velvet-byte",
      sourceHash: "source-hash",
      captionJson: '{"schemaVersion":1}',
      captionText: "subject_en: character",
      updatedAt: "2026-07-22T12:00:00.000Z",
    });
    await expect(repository.listByRevision("caption-v1")).resolves.toEqual([
      {
        slug: "velvet-byte",
        sourceHash: "source-hash",
        captionJson: '{"schemaVersion":1}',
        captionText: "subject_en: character",
        updatedAt: "2026-07-22T12:00:00.000Z",
      },
    ]);

    expect(statements[0]?.statement).toContain("pet_slug = $pet_slug");
    expect(statements[1]?.statement).toContain(
      "caption_revision = $caption_revision",
    );
    expect(statements[1]?.statement).not.toContain("pet_slug = $pet_slug");
  });

  it("upserts and deletes caption rows without exposing their contents", async () => {
    const statements: Array<{
      statement: string;
      params: Record<string, unknown>;
    }> = [];
    const repository = createSearchCaptionsRepository({
      isConfigured: () => true,
      values,
      execute: async (statement, params) => {
        statements.push({ statement, params });
        return { resultSets: [] };
      },
    });

    await repository.upsert({
      captionRevision: "caption-v1",
      slug: "velvet-byte",
      sourceHash: "source-hash",
      captionJson: '{"schemaVersion":1}',
      captionText: "subject_en: character",
      updatedAt: "2026-07-22T12:00:00.000Z",
    });
    await repository.deleteBySlug("velvet-byte");

    expect(statements[0]?.statement).toContain(
      "UPSERT INTO codex_pet_search_captions",
    );
    expect(statements[1]?.statement).toContain(
      "DELETE FROM codex_pet_search_captions",
    );
  });

  it("does not access YDB when it is not configured", async () => {
    const repository = createSearchCaptionsRepository({
      isConfigured: () => false,
      values,
      execute: async () => {
        throw new Error("must not execute");
      },
    });

    await expect(repository.get("caption-v1", "pet")).resolves.toBeNull();
    await expect(repository.listByRevision("caption-v1")).resolves.toEqual([]);
    await expect(
      repository.upsert({
        captionRevision: "caption-v1",
        slug: "pet",
        sourceHash: "hash",
        captionJson: "{}",
        captionText: "text",
        updatedAt: "2026-07-22T12:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(repository.deleteBySlug("pet")).resolves.toBeUndefined();
  });
});

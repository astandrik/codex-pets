import { describe, expect, it } from "vitest";

import { createSearchEmbeddingsRepository } from "@/lib/pets/search-embeddings-repository";

const values = {
  utf8: (value: string) => ({ textValue: value }),
  uint32: (value: number) => ({ uint32Value: value }),
  bytes: (value: Buffer) => ({ bytesValue: value }),
};

describe("search embeddings repository", () => {
  it("lists raw rows for one revision without filtering malformed vectors", async () => {
    const statements: Array<{
      statement: string;
      params: Record<string, unknown>;
    }> = [];
    const malformedEmbedding = Buffer.from([0xff, 0x00]);
    const repository = createSearchEmbeddingsRepository({
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
                    { textValue: "model-v1" },
                    { textValue: "velvet-byte" },
                    { textValue: "source-hash" },
                    { uint32Value: 0 },
                    { bytesValue: malformedEmbedding },
                    { textValue: "2026-08-03T10:00:00.000Z" },
                  ],
                },
              ],
            },
          ],
        };
      },
    });

    await expect(repository.listRawByRevision("model-v1")).resolves.toEqual([
      {
        modelRevision: "model-v1",
        slug: "velvet-byte",
        sourceHash: "source-hash",
        dimensions: 0,
        embedding: malformedEmbedding,
        updatedAt: "2026-08-03T10:00:00.000Z",
      },
    ]);
    expect(statements[0]?.statement).toContain(
      "WHERE model_revision = $model_revision",
    );
    expect(statements[0]?.statement).toContain("embedding");
    expect(statements[0]?.params).toEqual({
      $model_revision: { textValue: "model-v1" },
    });
  });

  it("runs exact cosine search and maps stored source hashes", async () => {
    const statements: Array<{ statement: string; params: Record<string, unknown> }> = [];
    const repository = createSearchEmbeddingsRepository({
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
                    { floatValue: 0.875 },
                  ],
                },
              ],
            },
          ],
        };
      },
    });

    const matches = await repository.findSimilar({
      modelRevision: "model-v1",
      dimensions: 2,
      embedding: [1, 0.5],
    });

    expect(matches).toEqual([
      { slug: "velvet-byte", sourceHash: "source-hash", score: 0.875 },
    ]);
    expect(statements[0]?.statement).toContain("Knn::CosineSimilarity");
    expect(statements[0]?.statement).toContain("ORDER BY score DESC");
    expect(statements[0]?.statement).not.toMatch(/\bLIMIT\b/i);
    expect(statements[0]?.params.$query_embedding).toMatchObject({
      bytesValue: expect.any(Buffer),
    });
    const queryVector = (
      statements[0]?.params.$query_embedding as { bytesValue: Buffer }
    ).bytesValue;
    expect(queryVector).toHaveLength(2 * Float32Array.BYTES_PER_ELEMENT + 1);
    expect(queryVector.at(-1)).toBe(0x01);
  });

  it("upserts, reads, and deletes versioned embeddings", async () => {
    const statements: Array<{ statement: string; params: Record<string, unknown> }> = [];
    const repository = createSearchEmbeddingsRepository({
      isConfigured: () => true,
      values,
      execute: async (statement, params) => {
        statements.push({ statement, params });
        if (statement.includes("SELECT source_hash")) {
          return {
            resultSets: [
              {
                rows: [
                  {
                    items: [
                      { textValue: "source-hash" },
                      { uint32Value: 2 },
                    ],
                  },
                ],
              },
            ],
          };
        }
        return { resultSets: [] };
      },
    });

    await repository.upsert({
      modelRevision: "model-v1",
      slug: "velvet-byte",
      sourceHash: "source-hash",
      dimensions: 2,
      embedding: [0.25, 0.75],
      updatedAt: "2026-07-22T12:00:00.000Z",
    });
    expect(
      await repository.getMetadata("model-v1", "velvet-byte"),
    ).toEqual({ sourceHash: "source-hash", dimensions: 2 });
    await repository.deleteBySlug("velvet-byte");

    expect(statements.some(({ statement }) => statement.includes("UPSERT INTO"))).toBe(true);
    expect(statements.some(({ statement }) => statement.includes("DELETE FROM"))).toBe(true);
  });

  it("returns no matches when YDB is not configured", async () => {
    const repository = createSearchEmbeddingsRepository({
      isConfigured: () => false,
      values,
      execute: async () => {
        throw new Error("must not execute");
      },
    });

    expect(
      await repository.findSimilar({
        modelRevision: "model-v1",
        dimensions: 2,
        embedding: [1, 0],
      }),
    ).toEqual([]);
    await expect(repository.listRawByRevision("model-v1")).resolves.toEqual(
      [],
    );
  });
});

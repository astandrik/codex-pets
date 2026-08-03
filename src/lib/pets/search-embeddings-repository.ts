import { embeddingToBuffer } from "@/lib/pets/search-embeddings";
import { isYdbConfigured, TypedValues, withSession } from "@/lib/ydb/client";
import {
  bytesAt,
  floatAt,
  rowsFromResult,
  textAt,
  uintAt,
} from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

export type StoredSemanticPetMatch = {
  slug: string;
  sourceHash: string;
  score: number;
};

export type StoredEmbeddingMetadata = {
  sourceHash: string;
  dimensions: number;
};

export type StoredRawPetSearchEmbedding = {
  modelRevision: string;
  slug: string;
  sourceHash: string;
  dimensions: number;
  embedding: Buffer;
  updatedAt: string;
};

type TypedValueFactory = {
  utf8: (value: string) => unknown;
  uint32: (value: number) => unknown;
  bytes: (value: Buffer) => unknown;
};

type SearchEmbeddingsRepositoryDependencies = {
  isConfigured: () => boolean;
  values: TypedValueFactory;
  execute: (
    statement: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
};

export function createSearchEmbeddingsRepository(
  dependencies: SearchEmbeddingsRepositoryDependencies,
) {
  return {
    findSimilar,
    getMetadata,
    listRawByRevision,
    upsert,
    deleteBySlug,
  };

  async function listRawByRevision(
    modelRevision: string,
  ): Promise<StoredRawPetSearchEmbedding[]> {
    if (!dependencies.isConfigured()) return [];

    const result = await dependencies.execute(
      `
DECLARE $model_revision AS Utf8;

SELECT model_revision, pet_slug, source_hash, dimensions, embedding, updated_at
FROM ${TABLES.searchEmbeddings}
WHERE model_revision = $model_revision;
      `,
      {
        $model_revision: dependencies.values.utf8(modelRevision),
      },
    );

    return rowsFromResult(result).map((row) => ({
      modelRevision: textAt(row, 0),
      slug: textAt(row, 1),
      sourceHash: textAt(row, 2),
      dimensions: uintAt(row, 3),
      embedding: bytesAt(row, 4),
      updatedAt: textAt(row, 5),
    }));
  }

  async function findSimilar(input: {
    modelRevision: string;
    dimensions: number;
    embedding: readonly number[];
  }): Promise<StoredSemanticPetMatch[]> {
    if (!dependencies.isConfigured()) return [];

    const result = await dependencies.execute(
      `
DECLARE $model_revision AS Utf8;
DECLARE $dimensions AS Uint32;
DECLARE $query_embedding AS String;

SELECT pet_slug,
       source_hash,
       Knn::CosineSimilarity(embedding, $query_embedding) AS score
FROM ${TABLES.searchEmbeddings}
WHERE model_revision = $model_revision
  AND dimensions = $dimensions
ORDER BY score DESC;
      `,
      {
        $model_revision: dependencies.values.utf8(input.modelRevision),
        $dimensions: dependencies.values.uint32(input.dimensions),
        $query_embedding: dependencies.values.bytes(
          embeddingToBuffer(input.embedding),
        ),
      },
    );

    return rowsFromResult(result).map((row) => ({
      slug: textAt(row, 0),
      sourceHash: textAt(row, 1),
      score: floatAt(row, 2),
    }));
  }

  async function getMetadata(
    modelRevision: string,
    slug: string,
  ): Promise<StoredEmbeddingMetadata | null> {
    if (!dependencies.isConfigured()) return null;

    const result = await dependencies.execute(
      `
DECLARE $model_revision AS Utf8;
DECLARE $pet_slug AS Utf8;

SELECT source_hash, dimensions
FROM ${TABLES.searchEmbeddings}
WHERE model_revision = $model_revision
  AND pet_slug = $pet_slug
LIMIT 1;
      `,
      {
        $model_revision: dependencies.values.utf8(modelRevision),
        $pet_slug: dependencies.values.utf8(slug),
      },
    );
    const row = rowsFromResult(result)[0];
    return row
      ? { sourceHash: textAt(row, 0), dimensions: uintAt(row, 1) }
      : null;
  }

  async function upsert(input: {
    modelRevision: string;
    slug: string;
    sourceHash: string;
    dimensions: number;
    embedding: readonly number[];
    updatedAt: string;
  }): Promise<void> {
    if (!dependencies.isConfigured()) return;

    await dependencies.execute(
      `
DECLARE $model_revision AS Utf8;
DECLARE $pet_slug AS Utf8;
DECLARE $source_hash AS Utf8;
DECLARE $dimensions AS Uint32;
DECLARE $embedding AS String;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.searchEmbeddings}
(model_revision, pet_slug, source_hash, dimensions, embedding, updated_at)
VALUES
($model_revision, $pet_slug, $source_hash, $dimensions, $embedding, $updated_at);
      `,
      {
        $model_revision: dependencies.values.utf8(input.modelRevision),
        $pet_slug: dependencies.values.utf8(input.slug),
        $source_hash: dependencies.values.utf8(input.sourceHash),
        $dimensions: dependencies.values.uint32(input.dimensions),
        $embedding: dependencies.values.bytes(
          embeddingToBuffer(input.embedding),
        ),
        $updated_at: dependencies.values.utf8(input.updatedAt),
      },
    );
  }

  async function deleteBySlug(slug: string): Promise<void> {
    if (!dependencies.isConfigured()) return;

    await dependencies.execute(
      `
DECLARE $pet_slug AS Utf8;

DELETE FROM ${TABLES.searchEmbeddings}
WHERE pet_slug = $pet_slug;
      `,
      { $pet_slug: dependencies.values.utf8(slug) },
    );
  }
}

const repository = createSearchEmbeddingsRepository({
  isConfigured: isYdbConfigured,
  values: TypedValues,
  execute: (statement, params) =>
    withSession((session) =>
      session.executeQuery(
        statement,
        params as NonNullable<Parameters<typeof session.executeQuery>[1]>,
      ),
    ),
});

export const findSimilarPetEmbeddings = repository.findSimilar;
export const getPetSearchEmbeddingMetadata = repository.getMetadata;
export const listRawPetSearchEmbeddings = repository.listRawByRevision;
export const upsertPetSearchEmbedding = repository.upsert;
export const deletePetSearchEmbeddings = repository.deleteBySlug;

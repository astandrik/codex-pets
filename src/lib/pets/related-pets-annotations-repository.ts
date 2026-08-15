import { isYdbConfigured, TypedValues, withSession } from "@/lib/ydb/client";
import { rowsFromResult, textAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

export type StoredRelatedPetAnnotation = {
  slug: string;
  sourceHash: string;
  proposalJson: string;
  annotationJson: string;
  annotationText: string;
  updatedAt: string;
};

type AnnotationRepositoryDependencies = {
  isConfigured: () => boolean;
  values: { utf8: (value: string) => unknown };
  execute: (
    statement: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
};

export function createRelatedPetAnnotationsRepository(
  dependencies: AnnotationRepositoryDependencies,
) {
  return { get, listByRevision, upsert, deleteBySlug };

  async function get(
    annotationRevision: string,
    slug: string,
  ): Promise<StoredRelatedPetAnnotation | null> {
    if (!dependencies.isConfigured()) return null;
    const result = await dependencies.execute(
      `
DECLARE $annotation_revision AS Utf8;
DECLARE $pet_slug AS Utf8;

SELECT pet_slug, source_hash, proposal_json, annotation_json,
       annotation_text, updated_at
FROM ${TABLES.relatedAnnotations}
WHERE annotation_revision = $annotation_revision
  AND pet_slug = $pet_slug
LIMIT 1;
      `,
      {
        $annotation_revision: dependencies.values.utf8(annotationRevision),
        $pet_slug: dependencies.values.utf8(slug),
      },
    );
    const row = rowsFromResult(result)[0];
    return row ? annotationFromRow(row) : null;
  }

  async function listByRevision(
    annotationRevision: string,
  ): Promise<StoredRelatedPetAnnotation[]> {
    if (!dependencies.isConfigured()) return [];
    const result = await dependencies.execute(
      `
DECLARE $annotation_revision AS Utf8;

SELECT pet_slug, source_hash, proposal_json, annotation_json,
       annotation_text, updated_at
FROM ${TABLES.relatedAnnotations}
WHERE annotation_revision = $annotation_revision;
      `,
      {
        $annotation_revision: dependencies.values.utf8(annotationRevision),
      },
    );
    return rowsFromResult(result).map(annotationFromRow);
  }

  async function upsert(input: {
    annotationRevision: string;
    slug: string;
    sourceHash: string;
    proposalJson: string;
    annotationJson: string;
    annotationText: string;
    updatedAt: string;
  }): Promise<void> {
    if (!dependencies.isConfigured()) return;
    await dependencies.execute(
      `
DECLARE $annotation_revision AS Utf8;
DECLARE $pet_slug AS Utf8;
DECLARE $source_hash AS Utf8;
DECLARE $proposal_json AS Utf8;
DECLARE $annotation_json AS Utf8;
DECLARE $annotation_text AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.relatedAnnotations}
(annotation_revision, pet_slug, source_hash, proposal_json, annotation_json,
 annotation_text, updated_at)
VALUES
($annotation_revision, $pet_slug, $source_hash, $proposal_json, $annotation_json,
 $annotation_text, $updated_at);
      `,
      {
        $annotation_revision: dependencies.values.utf8(input.annotationRevision),
        $pet_slug: dependencies.values.utf8(input.slug),
        $source_hash: dependencies.values.utf8(input.sourceHash),
        $proposal_json: dependencies.values.utf8(input.proposalJson),
        $annotation_json: dependencies.values.utf8(input.annotationJson),
        $annotation_text: dependencies.values.utf8(input.annotationText),
        $updated_at: dependencies.values.utf8(input.updatedAt),
      },
    );
  }

  async function deleteBySlug(slug: string): Promise<void> {
    if (!dependencies.isConfigured()) return;
    await dependencies.execute(
      `
DECLARE $pet_slug AS Utf8;

DELETE FROM ${TABLES.relatedAnnotations}
WHERE pet_slug = $pet_slug;
      `,
      { $pet_slug: dependencies.values.utf8(slug) },
    );
  }
}

function annotationFromRow(
  row: ReturnType<typeof rowsFromResult>[number],
): StoredRelatedPetAnnotation {
  return {
    slug: textAt(row, 0),
    sourceHash: textAt(row, 1),
    proposalJson: textAt(row, 2),
    annotationJson: textAt(row, 3),
    annotationText: textAt(row, 4),
    updatedAt: textAt(row, 5),
  };
}

const repository = createRelatedPetAnnotationsRepository({
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

export const getRelatedPetAnnotation = repository.get;
export const listRelatedPetAnnotations = repository.listByRevision;
export const upsertRelatedPetAnnotation = repository.upsert;
export const deleteRelatedPetAnnotations = repository.deleteBySlug;

import { rowsFromResult, textAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

type AdditionalMetadataScope = {
  additionalCaptionRevisions?: readonly string[];
  additionalAnnotationRevisions?: readonly string[];
};

export async function getAdditionalMetadataInputRevisions(
  execute: (statement: string, params: Record<string, unknown>) => Promise<unknown>,
  values: { utf8: (value: string) => unknown },
  scope: AdditionalMetadataScope,
): Promise<{ additionalCaptions?: string[]; additionalAnnotations?: string[] }> {
  const result: { additionalCaptions?: string[]; additionalAnnotations?: string[] } = {};
  for (const [revisions, table, column, key] of [
    [scope.additionalCaptionRevisions, TABLES.searchCaptions, "caption_revision", "additionalCaptions"],
    [scope.additionalAnnotationRevisions, TABLES.relatedAnnotations, "annotation_revision", "additionalAnnotations"],
  ] as const) {
    if (!revisions?.length) continue;
    const fingerprints: string[] = [];
    for (const revision of [...new Set(revisions)].toSorted()) {
      if (!revision.trim()) throw new Error("metadata_revision_missing");
      const rows = rowsFromResult(await execute(`
DECLARE $revision AS Utf8;
SELECT pet_slug, source_hash, updated_at FROM ${table}
WHERE ${column} = $revision ORDER BY pet_slug;`, { $revision: values.utf8(revision) }));
      fingerprints.push(JSON.stringify([revision, rows.map(row => {
        const fields = [textAt(row, 0), textAt(row, 1), textAt(row, 2)];
        if (fields.some(value => !value)) throw new Error("metadata_revision_row_invalid");
        return fields;
      })]));
    }
    result[key] = fingerprints;
  }
  return result;
}

export type CatalogInputRevision = Array<[slug: string, updatedAt: string]>;
export type EmbeddingInputRevision = Array<[
  revision: string,
  rows: Array<[slug: string, sourceHash: string, dimensions: number, updatedAt: string]>,
]>;
export type MetadataInputRevision = [
  revision: string,
  rows: Array<[slug: string, sourceHash: string, updatedAt: string]>,
];

export function normalizeEmbeddingModelRevisions(revisions: readonly string[]): string[] {
  return [...new Set(revisions.map((revision) => revision.trim()).filter(Boolean))].sort();
}

// Existing generations store nested JSON strings with this field order.
export function serializeRankingInputRevision(parts: {
  additionalCaptions?: string[];
  additionalAnnotations?: string[];
  catalog: CatalogInputRevision;
  embeddings: EmbeddingInputRevision;
  captions: MetadataInputRevision | null;
  annotations?: MetadataInputRevision;
}): string {
  return JSON.stringify({
    additionalCaptions: parts.additionalCaptions,
    additionalAnnotations: parts.additionalAnnotations,
    catalog: JSON.stringify(parts.catalog),
    embeddings: JSON.stringify(parts.embeddings),
    captions: parts.captions === null ? null : JSON.stringify(parts.captions),
    annotations: parts.annotations === undefined ? undefined : JSON.stringify(parts.annotations),
  });
}

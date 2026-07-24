import { isYdbConfigured, TypedValues, withSession } from "@/lib/ydb/client";
import { rowsFromResult, textAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

export type StoredPetSearchCaption = {
  slug: string;
  sourceHash: string;
  captionJson: string;
  captionText: string;
  updatedAt: string;
};

type TypedValueFactory = {
  utf8: (value: string) => unknown;
};

type SearchCaptionsRepositoryDependencies = {
  isConfigured: () => boolean;
  values: TypedValueFactory;
  execute: (
    statement: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
};

export function createSearchCaptionsRepository(
  dependencies: SearchCaptionsRepositoryDependencies,
) {
  return {
    get,
    listByRevision,
    upsert,
    deleteBySlug,
  };

  async function get(
    captionRevision: string,
    slug: string,
  ): Promise<StoredPetSearchCaption | null> {
    if (!dependencies.isConfigured()) return null;

    const result = await dependencies.execute(
      `
DECLARE $caption_revision AS Utf8;
DECLARE $pet_slug AS Utf8;

SELECT pet_slug, source_hash, caption_json, caption_text, updated_at
FROM ${TABLES.searchCaptions}
WHERE caption_revision = $caption_revision
  AND pet_slug = $pet_slug
LIMIT 1;
      `,
      {
        $caption_revision: dependencies.values.utf8(captionRevision),
        $pet_slug: dependencies.values.utf8(slug),
      },
    );

    const row = rowsFromResult(result)[0];
    return row ? captionFromRow(row) : null;
  }

  async function listByRevision(
    captionRevision: string,
  ): Promise<StoredPetSearchCaption[]> {
    if (!dependencies.isConfigured()) return [];

    const result = await dependencies.execute(
      `
DECLARE $caption_revision AS Utf8;

SELECT pet_slug, source_hash, caption_json, caption_text, updated_at
FROM ${TABLES.searchCaptions}
WHERE caption_revision = $caption_revision;
      `,
      {
        $caption_revision: dependencies.values.utf8(captionRevision),
      },
    );

    return rowsFromResult(result).map(captionFromRow);
  }

  async function upsert(input: {
    captionRevision: string;
    slug: string;
    sourceHash: string;
    captionJson: string;
    captionText: string;
    updatedAt: string;
  }): Promise<void> {
    if (!dependencies.isConfigured()) return;

    await dependencies.execute(
      `
DECLARE $caption_revision AS Utf8;
DECLARE $pet_slug AS Utf8;
DECLARE $source_hash AS Utf8;
DECLARE $caption_json AS Utf8;
DECLARE $caption_text AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.searchCaptions}
(caption_revision, pet_slug, source_hash, caption_json, caption_text, updated_at)
VALUES
($caption_revision, $pet_slug, $source_hash, $caption_json, $caption_text, $updated_at);
      `,
      {
        $caption_revision: dependencies.values.utf8(input.captionRevision),
        $pet_slug: dependencies.values.utf8(input.slug),
        $source_hash: dependencies.values.utf8(input.sourceHash),
        $caption_json: dependencies.values.utf8(input.captionJson),
        $caption_text: dependencies.values.utf8(input.captionText),
        $updated_at: dependencies.values.utf8(input.updatedAt),
      },
    );
  }

  async function deleteBySlug(slug: string): Promise<void> {
    if (!dependencies.isConfigured()) return;

    await dependencies.execute(
      `
DECLARE $pet_slug AS Utf8;

DELETE FROM ${TABLES.searchCaptions}
WHERE pet_slug = $pet_slug;
      `,
      { $pet_slug: dependencies.values.utf8(slug) },
    );
  }
}

function captionFromRow(
  row: ReturnType<typeof rowsFromResult>[number],
): StoredPetSearchCaption {
  return {
    slug: textAt(row, 0),
    sourceHash: textAt(row, 1),
    captionJson: textAt(row, 2),
    captionText: textAt(row, 3),
    updatedAt: textAt(row, 4),
  };
}

const repository = createSearchCaptionsRepository({
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

export const getPetSearchCaption = repository.get;
export const listPetSearchCaptions = repository.listByRevision;
export const upsertPetSearchCaption = repository.upsert;
export const deletePetSearchCaptions = repository.deleteBySlug;

export async function up({ sdk, execute, withSession }) {
  const { Column, TableDescription, Types, TypedValues } = sdk;

  const exists = await withSession(async (session) => {
    try {
      await session.describeTable("codex_user_profile_slugs");
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  });

  if (!exists) {
    await withSession((session) =>
      session.createTable(
        "codex_user_profile_slugs",
        new TableDescription()
          .withColumn(new Column("profile_slug", Types.UTF8))
          .withColumn(new Column("user_id", Types.UTF8))
          .withColumn(new Column("created_at", Types.UTF8))
          .withColumn(new Column("updated_at", Types.UTF8))
          .withPrimaryKey("profile_slug"),
      ),
    );
  }

  const result = await execute(`
SELECT user_id, profile_slug, created_at, updated_at
FROM codex_users
ORDER BY created_at ASC, user_id ASC
  `);

  const seen = new Set();
  const rows = result?.resultSets?.[0]?.rows ?? [];
  for (const row of rows) {
    const userId = textAt(row, 0);
    const profileSlug = textAt(row, 1);
    if (!userId || !profileSlug || seen.has(profileSlug)) continue;
    seen.add(profileSlug);

    await execute(
      `
DECLARE $profile_slug AS Utf8;
DECLARE $user_id AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO codex_user_profile_slugs
(profile_slug, user_id, created_at, updated_at)
VALUES ($profile_slug, $user_id, $created_at, $updated_at);
      `,
      {
        $profile_slug: TypedValues.utf8(profileSlug),
        $user_id: TypedValues.utf8(userId),
        $created_at: TypedValues.utf8(textAt(row, 2)),
        $updated_at: TypedValues.utf8(textAt(row, 3)),
      },
    );
  }
}

function textAt(row, index) {
  return row.items?.[index]?.textValue ?? "";
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

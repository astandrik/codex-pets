const RELATED_STATE_TABLE = "codex_pet_related_state";
const RELATED_SNAPSHOTS_TABLE = "codex_pet_related_snapshots";

export async function up({ sdk, withSession }) {
  await createTableIfMissing({
    withSession,
    tableName: RELATED_STATE_TABLE,
    createDescription: () =>
      new sdk.TableDescription()
        .withColumn(new sdk.Column("state_id", sdk.Types.UTF8))
        .withColumn(
          new sdk.Column(
            "requested_generation_id",
            sdk.Types.optional(sdk.Types.UTF8),
          ),
        )
        .withColumn(
          new sdk.Column(
            "active_generation_id",
            sdk.Types.optional(sdk.Types.UTF8),
          ),
        )
        .withColumn(
          new sdk.Column(
            "previous_generation_id",
            sdk.Types.optional(sdk.Types.UTF8),
          ),
        )
        .withColumn(new sdk.Column("status", sdk.Types.UTF8))
        .withColumn(new sdk.Column("ranking_revision", sdk.Types.UTF8))
        .withColumn(
          new sdk.Column("failure_reason", sdk.Types.optional(sdk.Types.UTF8)),
        )
        .withColumn(new sdk.Column("updated_at", sdk.Types.UTF8))
        .withPrimaryKey("state_id"),
  });

  await createTableIfMissing({
    withSession,
    tableName: RELATED_SNAPSHOTS_TABLE,
    createDescription: () =>
      new sdk.TableDescription()
        .withColumn(new sdk.Column("generation_id", sdk.Types.UTF8))
        .withColumn(new sdk.Column("source_slug", sdk.Types.UTF8))
        .withColumn(new sdk.Column("ranking_revision", sdk.Types.UTF8))
        .withColumn(new sdk.Column("related_slugs_json", sdk.Types.JSON))
        .withColumn(new sdk.Column("created_at", sdk.Types.UTF8))
        .withPrimaryKey("generation_id")
        .withPrimaryKey("source_slug"),
  });
}

async function createTableIfMissing({ withSession, tableName, createDescription }) {
  const exists = await withSession(async (session) => {
    try {
      await session.describeTable(tableName);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  });

  if (exists) return;

  await withSession((session) =>
    session.createTable(tableName, createDescription()),
  );
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

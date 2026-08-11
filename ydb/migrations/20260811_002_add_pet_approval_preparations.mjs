const TABLE_NAME = "codex_pet_approval_preparations";

export async function up({ sdk, withSession }) {
  const exists = await withSession(async (session) => {
    try {
      await session.describeTable(TABLE_NAME);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  });
  if (exists) return;

  await withSession((session) =>
    session.createTable(
      TABLE_NAME,
      new sdk.TableDescription()
        .withColumn(new sdk.Column("preparation_id", sdk.Types.UTF8))
        .withColumn(new sdk.Column("pet_id", sdk.Types.UTF8))
        .withColumn(new sdk.Column("pet_slug", sdk.Types.UTF8))
        .withColumn(new sdk.Column("pet_updated_at", sdk.Types.UTF8))
        .withColumn(new sdk.Column("reviewer_id", sdk.Types.UTF8))
        .withColumn(new sdk.Column("ranking_revision", sdk.Types.UTF8))
        .withColumn(new sdk.Column("expected_active_generation_id", sdk.Types.UTF8))
        .withColumn(new sdk.Column("prepared_generation_id", sdk.Types.UTF8))
        .withColumn(new sdk.Column("status", sdk.Types.UTF8))
        .withColumn(new sdk.Column("attempts", sdk.Types.UINT32))
        .withColumn(new sdk.Column("next_attempt_at", sdk.Types.UTF8))
        .withColumn(new sdk.Column("lease_owner", sdk.Types.UTF8))
        .withColumn(new sdk.Column("lease_until", sdk.Types.UTF8))
        .withColumn(new sdk.Column("failure_code", sdk.Types.UTF8))
        .withColumn(new sdk.Column("created_at", sdk.Types.UTF8))
        .withColumn(new sdk.Column("updated_at", sdk.Types.UTF8))
        .withPrimaryKey("preparation_id"),
    ),
  );
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

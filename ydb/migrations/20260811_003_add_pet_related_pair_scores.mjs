const TABLE_NAME = "codex_pet_related_pair_scores";

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

  await withSession((session) => session.createTable(
    TABLE_NAME,
    new sdk.TableDescription()
      .withColumn(new sdk.Column("scoring_revision", sdk.Types.UTF8))
      .withColumn(new sdk.Column("left_slug", sdk.Types.UTF8))
      .withColumn(new sdk.Column("right_slug", sdk.Types.UTF8))
      .withColumn(new sdk.Column("source_hash", sdk.Types.UTF8))
      .withColumn(new sdk.Column("relevance_grade", sdk.Types.UINT32))
      .withColumn(new sdk.Column("confidence", sdk.Types.UTF8))
      .withColumn(new sdk.Column("relation_types_json", sdk.Types.JSON))
      .withColumn(new sdk.Column("reason_codes_json", sdk.Types.JSON))
      .withColumn(new sdk.Column("updated_at", sdk.Types.UTF8))
      .withPrimaryKey("scoring_revision")
      .withPrimaryKey("left_slug")
      .withPrimaryKey("right_slug"),
  ));
}

function isNotFoundError(error) {
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    String(error?.message ?? error),
  );
}

const TABLE_NAME = "codex_pet_related_annotations";

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
        .withColumn(new sdk.Column("annotation_revision", sdk.Types.UTF8))
        .withColumn(new sdk.Column("pet_slug", sdk.Types.UTF8))
        .withColumn(new sdk.Column("source_hash", sdk.Types.UTF8))
        .withColumn(new sdk.Column("proposal_json", sdk.Types.UTF8))
        .withColumn(new sdk.Column("annotation_json", sdk.Types.UTF8))
        .withColumn(new sdk.Column("annotation_text", sdk.Types.UTF8))
        .withColumn(new sdk.Column("updated_at", sdk.Types.UTF8))
        .withPrimaryKey("annotation_revision")
        .withPrimaryKey("pet_slug"),
    ),
  );
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

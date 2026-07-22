const TABLE_NAME = "codex_pet_search_embeddings";

export async function up({ sdk, withSession }) {
  const { Column, TableDescription, Types } = sdk;

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
      new TableDescription()
        .withColumn(new Column("model_revision", Types.UTF8))
        .withColumn(new Column("pet_slug", Types.UTF8))
        .withColumn(new Column("source_hash", Types.UTF8))
        .withColumn(new Column("dimensions", Types.UINT32))
        .withColumn(new Column("embedding", Types.STRING))
        .withColumn(new Column("updated_at", Types.UTF8))
        .withPrimaryKey("model_revision")
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

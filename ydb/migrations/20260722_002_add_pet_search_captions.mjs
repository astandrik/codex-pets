const TABLE_NAME = "codex_pet_search_captions";

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
        .withColumn(new Column("caption_revision", Types.optional(Types.UTF8)))
        .withColumn(new Column("pet_slug", Types.optional(Types.UTF8)))
        .withColumn(new Column("source_hash", Types.optional(Types.UTF8)))
        .withColumn(new Column("caption_json", Types.optional(Types.UTF8)))
        .withColumn(new Column("caption_text", Types.optional(Types.UTF8)))
        .withColumn(new Column("updated_at", Types.optional(Types.UTF8)))
        .withPrimaryKey("caption_revision")
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

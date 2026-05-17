export async function up({ sdk, withSession }) {
  const { Column, TableDescription, Types } = sdk;

  const exists = await withSession(async (session) => {
    try {
      await session.describeTable("codex_pet_generation_request_images");
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  });

  if (exists) return;

  await withSession((session) =>
    session.createTable(
      "codex_pet_generation_request_images",
      new TableDescription()
        .withColumn(new Column("request_id", Types.UTF8))
        .withColumn(new Column("file_name", Types.UTF8))
        .withColumn(new Column("content_type", Types.UTF8))
        .withColumn(new Column("size_bytes", Types.UINT32))
        .withColumn(new Column("image_bytes", Types.BYTES))
        .withColumn(new Column("created_at", Types.UTF8))
        .withPrimaryKey("request_id"),
    ),
  );
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

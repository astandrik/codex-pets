export async function up({ sdk, withSession }) {
  const { Column, TableDescription, Types } = sdk;

  const exists = await withSession(async (session) => {
    try {
      await session.describeTable("codex_pet_generation_requests");
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  });

  if (exists) return;

  await withSession((session) =>
    session.createTable(
      "codex_pet_generation_requests",
      new TableDescription()
        .withColumn(new Column("id", Types.UTF8))
        .withColumn(new Column("status", Types.UTF8))
        .withColumn(new Column("kind", Types.UTF8))
        .withColumn(new Column("display_name_hint", Types.UTF8))
        .withColumn(new Column("prompt", Types.UTF8))
        .withColumn(new Column("contact_email", Types.UTF8))
        .withColumn(new Column("requester_name", Types.UTF8))
        .withColumn(new Column("requester_user_id", Types.UTF8))
        .withColumn(new Column("linked_pet_id", Types.UTF8))
        .withColumn(new Column("linked_pet_slug", Types.UTF8))
        .withColumn(new Column("admin_note", Types.UTF8))
        .withColumn(new Column("created_at", Types.UTF8))
        .withColumn(new Column("updated_at", Types.UTF8))
        .withColumn(new Column("fulfilled_at", Types.UTF8))
        .withColumn(new Column("rejected_at", Types.UTF8))
        .withPrimaryKey("id"),
    ),
  );
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

export async function up({ sdk, withSession }) {
  const { Column, TableDescription, Types } = sdk;

  const exists = await withSession(async (session) => {
    try {
      await session.describeTable("codex_idempotency_keys");
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  });

  if (exists) return;

  await withSession((session) =>
    session.createTable(
      "codex_idempotency_keys",
      new TableDescription()
        .withColumn(new Column("route", Types.UTF8))
        .withColumn(new Column("idempotency_key", Types.UTF8))
        .withColumn(new Column("request_hash", Types.UTF8))
        .withColumn(new Column("status", Types.UTF8))
        .withColumn(new Column("status_code", Types.UINT32))
        .withColumn(new Column("response_json", Types.UTF8))
        .withColumn(new Column("created_at", Types.UTF8))
        .withColumn(new Column("updated_at", Types.UTF8))
        .withPrimaryKey("route", "idempotency_key"),
    ),
  );
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

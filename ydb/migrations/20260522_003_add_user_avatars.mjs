export async function up({ sdk, execute, withSession }) {
  const {
    AlterTableDescription,
    Column,
    TableDescription,
    Types,
    TypedValues,
  } = sdk;

  const usersTable = await withSession((session) =>
    session.describeTable("codex_users"),
  );
  const userColumns = new Set(usersTable.columns.map((column) => column.name));

  if (!userColumns.has("avatar_id")) {
    await withSession((session) =>
      session.alterTable(
        "codex_users",
        new AlterTableDescription().withAddColumn(
          new Column("avatar_id", Types.optional(Types.UTF8)),
        ),
      ),
    );
  }

  const avatarsTableExists = await withSession(async (session) => {
    try {
      await session.describeTable("codex_user_avatars");
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  });

  if (!avatarsTableExists) {
    await withSession((session) =>
      session.createTable(
        "codex_user_avatars",
        new TableDescription()
          .withColumn(new Column("avatar_id", Types.UTF8))
          .withColumn(new Column("user_id", Types.UTF8))
          .withColumn(new Column("content_type", Types.UTF8))
          .withColumn(new Column("size_bytes", Types.UINT32))
          .withColumn(new Column("image_bytes", Types.BYTES))
          .withColumn(new Column("created_at", Types.UTF8))
          .withColumn(new Column("updated_at", Types.UTF8))
          .withPrimaryKey("avatar_id"),
      ),
    );
  }

  await execute(
    `
DECLARE $avatar_id AS Utf8;

UPDATE codex_users
SET avatar_id = $avatar_id
WHERE avatar_id IS NULL;
    `,
    {
      $avatar_id: TypedValues.utf8(""),
    },
  );
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

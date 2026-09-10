export async function up({ sdk, execute, withSession }) {
  const { AlterTableDescription, Column, Types, TypedValues } = sdk;
  const table = await withSession((session) => session.describeTable("codex_pets"));
  const columns = new Set(table.columns.map((column) => column.name));

  for (const [name, type] of [
    ["public_email_requested", Types.optional(Types.BOOL)],
    ["public_author_email", Types.optional(Types.UTF8)],
  ]) {
    if (columns.has(name)) continue;
    await withSession((session) =>
      session.alterTable(
        "codex_pets",
        new AlterTableDescription().withAddColumn(new Column(name, type)),
      ),
    );
  }

  await execute(
    `
DECLARE $public_email_requested AS Bool;
DECLARE $public_author_email AS Utf8;

UPDATE codex_pets
SET public_email_requested = COALESCE(public_email_requested, $public_email_requested),
    public_author_email = COALESCE(public_author_email, $public_author_email)
WHERE public_email_requested IS NULL OR public_author_email IS NULL;
    `,
    {
      $public_email_requested: TypedValues.bool(false),
      $public_author_email: TypedValues.utf8(""),
    },
  );
}

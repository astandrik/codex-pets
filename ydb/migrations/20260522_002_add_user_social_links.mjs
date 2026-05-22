export async function up({ sdk, execute, withSession }) {
  const { AlterTableDescription, Column, Types, TypedValues } = sdk;

  const table = await withSession((session) => session.describeTable("codex_users"));
  const columns = new Set(table.columns.map((column) => column.name));

  for (const column of [
    ["github_url", Types.optional(Types.UTF8)],
    ["linkedin_url", Types.optional(Types.UTF8)],
  ]) {
    if (columns.has(column[0])) continue;
    await withSession((session) =>
      session.alterTable(
        "codex_users",
        new AlterTableDescription().withAddColumn(
          new Column(column[0], column[1]),
        ),
      ),
    );
  }

  await execute(
    `
DECLARE $github_url AS Utf8;
DECLARE $linkedin_url AS Utf8;

UPDATE codex_users
SET github_url = $github_url,
    linkedin_url = $linkedin_url
WHERE github_url IS NULL OR linkedin_url IS NULL;
    `,
    {
      $github_url: TypedValues.utf8(""),
      $linkedin_url: TypedValues.utf8(""),
    },
  );
}

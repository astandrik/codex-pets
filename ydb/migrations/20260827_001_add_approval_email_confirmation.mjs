const TABLE_NAME = "codex_pet_approval_preparations";
const COLUMN_NAME = "publish_requested_email";

export async function up({ sdk, execute, withSession }) {
  const { AlterTableDescription, Column, Types, TypedValues } = sdk;
  const table = await withSession((session) => session.describeTable(TABLE_NAME));
  if (!table.columns.some((column) => column.name === COLUMN_NAME)) {
    await withSession((session) =>
      session.alterTable(
        TABLE_NAME,
        new AlterTableDescription().withAddColumn(
          new Column(COLUMN_NAME, Types.optional(Types.BOOL)),
        ),
      ),
    );
  }
  await execute(
    `
DECLARE $default_confirmation AS Bool;
UPDATE ${TABLE_NAME}
SET publish_requested_email = $default_confirmation
WHERE publish_requested_email IS NULL;
    `,
    { $default_confirmation: TypedValues.bool(false) },
  );
}

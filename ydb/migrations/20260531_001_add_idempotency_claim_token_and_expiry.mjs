export async function up({ sdk, execute, withSession }) {
  const { AlterTableDescription, Column, Types, TypedValues } = sdk;

  const table = await withSession((session) =>
    session.describeTable("codex_idempotency_keys"),
  );
  const columns = new Set(table.columns.map((column) => column.name));

  if (!columns.has("claim_token")) {
    await withSession((session) =>
      session.alterTable(
        "codex_idempotency_keys",
        new AlterTableDescription().withAddColumn(
          new Column("claim_token", Types.optional(Types.UTF8)),
        ),
      ),
    );
  }

  if (!columns.has("expires_at")) {
    await withSession((session) =>
      session.alterTable(
        "codex_idempotency_keys",
        new AlterTableDescription().withAddColumn(
          new Column("expires_at", Types.optional(Types.UTF8)),
        ),
      ),
    );
  }

  await execute(
    `
DECLARE $empty_claim_token AS Utf8;
DECLARE $fallback_expires_at AS Utf8;

UPDATE codex_idempotency_keys
SET claim_token = CASE
    WHEN claim_token IS NULL THEN $empty_claim_token
    ELSE claim_token
  END,
  expires_at = CASE
    WHEN expires_at IS NULL THEN $fallback_expires_at
    ELSE expires_at
  END
WHERE claim_token IS NULL OR expires_at IS NULL;
    `,
    {
      $empty_claim_token: TypedValues.utf8(""),
      $fallback_expires_at: TypedValues.utf8(
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ),
    },
  );
}

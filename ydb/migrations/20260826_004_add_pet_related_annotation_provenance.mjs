const TABLE_NAME = "codex_pet_related_annotations";
const COLUMN_NAMES = [
  "proposal_revision",
  "proposal_input_hash",
  "proposal_hash",
];

export async function up({ sdk, withSession }) {
  await withSession(async (session) => {
    const table = await session.describeTable(TABLE_NAME);
    const existing = new Set(
      (table.columns ?? []).map((column) => column.name),
    );
    const missing = COLUMN_NAMES.filter((name) => !existing.has(name));
    if (missing.length === 0) return;

    const alteration = new sdk.AlterTableDescription();
    for (const name of missing) {
      alteration.withAddColumn(
        new sdk.Column(name, sdk.Types.optional(sdk.Types.UTF8)),
      );
    }
    await session.alterTable(TABLE_NAME, alteration);
  });
}

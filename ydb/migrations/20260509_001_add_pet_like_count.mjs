export async function up({ sdk, execute, withSession }) {
  const { AlterTableDescription, Column, Types, TypedValues } = sdk;

  let likeCountIsOptional = false;
  const hasLikeCount = await withSession(async (session) => {
    const table = await session.describeTable("codex_pet_metrics");
    const column = table.columns.find((item) => item.name === "like_count");
    likeCountIsOptional = Boolean(column?.type?.optionalType);
    return Boolean(column);
  });

  if (!hasLikeCount) {
    await withSession((session) =>
      session.alterTable(
        "codex_pet_metrics",
        new AlterTableDescription().withAddColumn(
          new Column("like_count", Types.optional(Types.UINT32)),
        ),
      ),
    );
    likeCountIsOptional = true;
  }

  if (likeCountIsOptional) {
    await execute(
      `
DECLARE $like_count AS Uint32;

UPDATE codex_pet_metrics
SET like_count = $like_count
WHERE like_count IS NULL
    `,
      {
        $like_count: TypedValues.uint32(0),
      },
    );
  }
}

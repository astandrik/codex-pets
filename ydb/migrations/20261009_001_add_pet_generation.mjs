const TABLES = [
  { name: "codex_pet_generation_jobs", keys: ["id"], value: "payload", binary: false },
  { name: "codex_pet_generation_artifacts", keys: ["id", "kind"], value: "bytes", binary: true },
  { name: "codex_pet_generation_quotas", keys: ["record_key"], value: "payload", binary: false },
];

export async function up({ sdk, withSession }) {
  for (const spec of TABLES) {
    await withSession(async (session) => {
      try {
        const table = await session.describeTable(spec.name);
        const columns = new Set((table.columns ?? []).map((column) => column.name));
        if (![...spec.keys, spec.value, "expires_at"].every((name) => columns.has(name))) throw new Error("Generation table shape mismatch");
        return;
      } catch (error) {
        if (!/path not found|does not exist|schemeerror|scheme error/i.test(String(error?.message ?? error))) throw error;
      }
      const table = new sdk.TableDescription();
      for (const key of spec.keys) table.withColumn(new sdk.Column(key, sdk.Types.UTF8)).withPrimaryKey(key);
      table.withColumn(new sdk.Column(spec.value, spec.binary ? sdk.Types.BYTES : sdk.Types.UTF8));
      table.withColumn(new sdk.Column("expires_at", sdk.Types.TIMESTAMP));
      table.withTtl("expires_at", 0);
      await session.createTable(spec.name, table);
    });
  }
}

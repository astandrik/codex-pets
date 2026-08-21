const TABLES = [
  {
    name: "codex_pet_generation_runs",
    columns: [
      ["id", "UTF8"], ["request_id", "UTF8"], ["idempotency_key", "UTF8"], ["status", "UTF8"],
      ["base_revision", "UINT32"], ["targeted_retry_count", "UINT32"], ["image_call_count", "UINT32"],
      ["last_stage", "UTF8"], ["failure_code", "UTF8"], ["failure_message", "UTF8"], ["review_json", "UTF8"],
      ["final_id", "UTF8"], ["final_display_name", "UTF8"], ["final_description", "UTF8"],
      ["final_kind", "UTF8"], ["final_tags_json", "UTF8"], ["final_pet_id", "UTF8"],
      ["final_pet_slug", "UTF8"], ["approved_by", "UTF8"], ["created_at", "UTF8"],
      ["updated_at", "UTF8"], ["completed_at", "UTF8"], ["cancelled_at", "UTF8"],
    ],
    primaryKey: ["id"],
  },
  {
    name: "codex_pet_generation_stage_attempts",
    columns: [
      ["run_id", "UTF8"], ["stage", "UTF8"], ["attempt", "UINT32"], ["status", "UTF8"],
      ["lease_owner", "UTF8"], ["lease_token", "UTF8"], ["lease_expires_at", "UTF8"],
      ["heartbeat_at", "UTF8"], ["request_hash", "UTF8"], ["model", "UTF8"],
      ["usage_json", "UTF8"], ["provider_request_id", "UTF8"], ["error_code", "UTF8"],
      ["error_message", "UTF8"], ["ambiguous", "BOOL"], ["started_at", "UTF8"],
      ["updated_at", "UTF8"], ["completed_at", "UTF8"],
    ],
    primaryKey: ["run_id", "stage", "attempt"],
  },
  {
    name: "codex_pet_generation_artifacts",
    columns: [
      ["run_id", "UTF8"], ["artifact_key", "UTF8"], ["stage", "UTF8"], ["file_name", "UTF8"],
      ["content_type", "UTF8"], ["byte_size", "UINT64"], ["sha256", "UTF8"], ["created_at", "UTF8"],
      ["expires_at", "UTF8"], ["retained", "BOOL"],
    ],
    primaryKey: ["run_id", "artifact_key"],
  },
  {
    name: "codex_pet_generation_artifact_chunks",
    columns: [
      ["run_id", "UTF8"], ["artifact_key", "UTF8"], ["chunk_number", "UINT32"],
      ["size_bytes", "UINT32"], ["chunk_bytes", "STRING"],
    ],
    primaryKey: ["run_id", "artifact_key", "chunk_number"],
  },
];

export async function up({ sdk, withSession }) {
  const { Column, TableDescription, Types } = sdk;
  for (const table of TABLES) {
    if (await tableExists(withSession, table.name)) continue;
    let description = new TableDescription();
    for (const [name, type] of table.columns) {
      description = description.withColumn(new Column(name, Types[type]));
    }
    description = description.withPrimaryKey(...table.primaryKey);
    await withSession((session) => session.createTable(table.name, description));
  }
}
async function tableExists(withSession, name) {
  return withSession(async (session) => {
    try {
      await session.describeTable(name);
      return true;
    } catch (error) {
      if (/path not found|not found|does not exist|schemeerror|scheme error/i.test(String(error?.message ?? error))) return false;
      throw error;
    }
  });
}

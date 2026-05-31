const TABLE_NAME = "codex_idempotency_keys";
const EXPECTED_PRIMARY_KEY = ["route", "idempotency_key"];

export async function up({ sdk, execute, withSession }) {
  const { Column, TableDescription, Types, TypedValues } = sdk;

  const table = await describeTable(withSession);
  if (!table) {
    await createIdempotencyTable({
      Column,
      TableDescription,
      Types,
      withSession,
    });
    return;
  }

  if (hasExpectedPrimaryKey(table)) return;

  const records = await readExistingRecords(execute);
  await withSession((session) => session.dropTable(TABLE_NAME));
  await createIdempotencyTable({
    Column,
    TableDescription,
    Types,
    withSession,
  });

  for (const record of records) {
    await upsertRecord(execute, TypedValues, record);
  }
}

async function describeTable(withSession) {
  return withSession(async (session) => {
    try {
      return await session.describeTable(TABLE_NAME);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  });
}

async function createIdempotencyTable({
  Column,
  TableDescription,
  Types,
  withSession,
}) {
  await withSession((session) =>
    session.createTable(
      TABLE_NAME,
      new TableDescription()
        .withColumn(new Column("route", Types.UTF8))
        .withColumn(new Column("idempotency_key", Types.UTF8))
        .withColumn(new Column("request_hash", Types.UTF8))
        .withColumn(new Column("status", Types.UTF8))
        .withColumn(new Column("status_code", Types.UINT32))
        .withColumn(new Column("response_json", Types.UTF8))
        .withColumn(new Column("created_at", Types.UTF8))
        .withColumn(new Column("updated_at", Types.UTF8))
        .withColumn(new Column("claim_token", Types.UTF8))
        .withColumn(new Column("expires_at", Types.UTF8))
        .withPrimaryKey("route")
        .withPrimaryKey("idempotency_key"),
    ),
  );
}

async function readExistingRecords(execute) {
  const result = await execute(`
SELECT route, idempotency_key, request_hash, status, status_code, response_json,
       created_at, updated_at, claim_token, expires_at
FROM ${TABLE_NAME}
  `);
  const rows = result?.resultSets?.[0]?.rows ?? [];
  return rows.map((row) => ({
    route: textAt(row, 0),
    idempotencyKey: textAt(row, 1),
    requestHash: textAt(row, 2),
    status: textAt(row, 3),
    statusCode: uintAt(row, 4),
    responseJson: textAt(row, 5),
    createdAt: textAt(row, 6),
    updatedAt: textAt(row, 7),
    claimToken: textAt(row, 8),
    expiresAt: textAt(row, 9),
  }));
}

async function upsertRecord(execute, TypedValues, record) {
  await execute(
    `
DECLARE $route AS Utf8;
DECLARE $idempotency_key AS Utf8;
DECLARE $request_hash AS Utf8;
DECLARE $status AS Utf8;
DECLARE $status_code AS Uint32;
DECLARE $response_json AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $claim_token AS Utf8;
DECLARE $expires_at AS Utf8;

UPSERT INTO ${TABLE_NAME}
(route, idempotency_key, request_hash, status, status_code, response_json, created_at, updated_at, claim_token, expires_at)
VALUES ($route, $idempotency_key, $request_hash, $status, $status_code, $response_json, $created_at, $updated_at, $claim_token, $expires_at);
    `,
    {
      $route: TypedValues.utf8(record.route),
      $idempotency_key: TypedValues.utf8(record.idempotencyKey),
      $request_hash: TypedValues.utf8(record.requestHash),
      $status: TypedValues.utf8(record.status),
      $status_code: TypedValues.uint32(record.statusCode),
      $response_json: TypedValues.utf8(record.responseJson),
      $created_at: TypedValues.utf8(record.createdAt),
      $updated_at: TypedValues.utf8(record.updatedAt),
      $claim_token: TypedValues.utf8(record.claimToken),
      $expires_at: TypedValues.utf8(record.expiresAt),
    },
  );
}

function hasExpectedPrimaryKey(table) {
  const primaryKey = table.primaryKey ?? table.primaryKeys ?? [];
  return (
    primaryKey.length === EXPECTED_PRIMARY_KEY.length &&
    primaryKey.every((key, index) => key === EXPECTED_PRIMARY_KEY[index])
  );
}

function textAt(row, index) {
  return row.items?.[index]?.textValue ?? "";
}

function uintAt(row, index) {
  return Number(
    row.items?.[index]?.uint32Value ?? row.items?.[index]?.uint64Value ?? 0,
  );
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

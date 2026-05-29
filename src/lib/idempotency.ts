import { createHash } from "node:crypto";

import { jsonApiError } from "@/lib/api-error";
import { isMockPetsDataSource } from "@/lib/pets/mock-data";
import { TypedValues, isYdbConfigured, withSession } from "@/lib/ydb/client";
import { rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

export type IdempotencyKeyResult =
  | { ok: true; key: string | null }
  | { ok: false; response: Response };

export type IdempotencyReplayResult =
  | { kind: "fresh" }
  | { kind: "replay"; response: Response }
  | { kind: "conflict"; response: Response }
  | { kind: "unavailable"; response: Response };

type StoredIdempotencyRecord = {
  requestHash: string;
  statusCode: number;
  responseJson: string;
};

type StoreIdempotencyInput = {
  route: string;
  key: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
};

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const memoryRecords = new Map<string, StoredIdempotencyRecord>();

export function readIdempotencyKey(req: Request): IdempotencyKeyResult {
  const rawKey = req.headers.get("Idempotency-Key");
  if (!rawKey) return { ok: true, key: null };

  const key = rawKey.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return {
      ok: false,
      response: jsonApiError("invalid_idempotency_key", {
        status: 400,
        message:
          "Idempotency-Key must be 1-128 characters using letters, numbers, dot, underscore, tilde, or hyphen.",
        field: "Idempotency-Key",
      }),
    };
  }

  return { ok: true, key };
}

export function idempotencyStorageUnavailableResponse(): Response {
  return jsonApiError("idempotency_unavailable", {
    status: 503,
    message: "Idempotency storage is not available for this deployment.",
    hint: "Retry without Idempotency-Key or try again later.",
  });
}

export function isIdempotencyStorageAvailable(): boolean {
  return isMockPetsDataSource() || isYdbConfigured();
}

export async function resolveIdempotencyReplay(input: {
  route: string;
  key: string;
  requestHash: string;
}): Promise<IdempotencyReplayResult> {
  const record = await readStoredRecord(input.route, input.key);
  if (record === "unavailable") {
    return { kind: "unavailable", response: idempotencyStorageUnavailableResponse() };
  }

  if (!record) return { kind: "fresh" };

  if (record.requestHash !== input.requestHash) {
    return {
      kind: "conflict",
      response: jsonApiError("idempotency_key_conflict", {
        status: 409,
        message:
          "Idempotency-Key was already used for a different request body.",
        hint: "Use a new Idempotency-Key for a changed mutation request.",
        field: "Idempotency-Key",
      }),
    };
  }

  return {
    kind: "replay",
    response: new Response(record.responseJson, {
      status: record.statusCode,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Replayed": "true",
      },
    }),
  };
}

export async function storeIdempotencyResult(
  input: StoreIdempotencyInput,
): Promise<boolean> {
  const responseJson = JSON.stringify(input.responseBody);
  const record = {
    requestHash: input.requestHash,
    statusCode: input.statusCode,
    responseJson,
  };

  if (isMockPetsDataSource()) {
    memoryRecords.set(memoryKey(input.route, input.key), record);
    return true;
  }

  if (!isYdbConfigured()) return false;

  try {
    await withSession((session) =>
      session.executeQuery(
        `
DECLARE $route AS Utf8;
DECLARE $idempotency_key AS Utf8;
DECLARE $request_hash AS Utf8;
DECLARE $status_code AS Uint32;
DECLARE $response_json AS Utf8;
DECLARE $created_at AS Utf8;

UPSERT INTO ${TABLES.idempotencyKeys}
(route, idempotency_key, request_hash, status_code, response_json, created_at)
VALUES ($route, $idempotency_key, $request_hash, $status_code, $response_json, $created_at);
      `,
        {
          $route: TypedValues.utf8(input.route),
          $idempotency_key: TypedValues.utf8(input.key),
          $request_hash: TypedValues.utf8(input.requestHash),
          $status_code: TypedValues.uint32(input.statusCode),
          $response_json: TypedValues.utf8(responseJson),
          $created_at: TypedValues.utf8(new Date().toISOString()),
        },
      ),
    );
  } catch (error) {
    if (isIdempotencyStorageError(error)) return false;
    throw error;
  }
  return true;
}

export function hashIdempotencyPayload(value: unknown): string {
  return sha256(stableStringify(value));
}

export function hashBuffer(buffer: Buffer): string {
  return sha256(buffer);
}

async function readStoredRecord(
  route: string,
  key: string,
): Promise<StoredIdempotencyRecord | null | "unavailable"> {
  if (isMockPetsDataSource()) {
    return memoryRecords.get(memoryKey(route, key)) ?? null;
  }

  if (!isYdbConfigured()) return "unavailable";

  let result: unknown;
  try {
    result = await withSession((session) =>
      session.executeQuery(
        `
DECLARE $route AS Utf8;
DECLARE $idempotency_key AS Utf8;

SELECT request_hash, status_code, response_json
FROM ${TABLES.idempotencyKeys}
WHERE route = $route AND idempotency_key = $idempotency_key
LIMIT 1;
      `,
        {
          $route: TypedValues.utf8(route),
          $idempotency_key: TypedValues.utf8(key),
        },
      ),
    );
  } catch (error) {
    if (isIdempotencyStorageError(error)) return "unavailable";
    throw error;
  }

  const row = rowsFromResult(result)[0];
  if (!row) return null;
  return {
    requestHash: textAt(row, 0),
    statusCode: uintAt(row, 1),
    responseJson: textAt(row, 2),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
  return `{${entries.join(",")}}`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function memoryKey(route: string, key: string): string {
  return `${route}\0${key}`;
}

function isIdempotencyStorageError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
}

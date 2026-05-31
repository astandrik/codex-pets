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
  | { kind: "fresh"; claim: IdempotencyClaim }
  | { kind: "replay"; response: Response }
  | { kind: "conflict"; response: Response }
  | { kind: "in_progress"; response: Response }
  | { kind: "unavailable"; response: Response };

export type IdempotencyClaim = {
  updatedAt: string;
};

type StoredIdempotencyRecord = {
  status: "in_progress" | "completed";
  requestHash: string;
  statusCode: number;
  responseJson: string;
  updatedAt: string;
};

type StoreIdempotencyInput = {
  route: string;
  key: string;
  requestHash: string;
  claim: IdempotencyClaim;
  statusCode: number;
  responseBody: unknown;
};

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const IN_PROGRESS_TTL_MS = 10 * 60 * 1000;
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

export async function claimIdempotencyKey(input: {
  route: string;
  key: string;
  requestHash: string;
}): Promise<IdempotencyReplayResult> {
  const claim = await claimStoredRecord(input.route, input.key, input.requestHash);
  if (claim.kind === "claimed") {
    return { kind: "fresh", claim: { updatedAt: claim.updatedAt } };
  }

  const record = claim.record;
  if (record === "unavailable") {
    return { kind: "unavailable", response: idempotencyStorageUnavailableResponse() };
  }

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

  if (record.status === "in_progress") {
    return {
      kind: "in_progress",
      response: jsonApiError("idempotency_key_in_progress", {
        status: 409,
        message:
          "Idempotency-Key is already being processed for this request body.",
        hint: "Retry the same request after the first attempt completes.",
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
  const updatedAt = new Date().toISOString();
  const record = {
    status: "completed" as const,
    requestHash: input.requestHash,
    statusCode: input.statusCode,
    responseJson,
    updatedAt,
  };

  if (isMockPetsDataSource()) {
    const mapKey = memoryKey(input.route, input.key);
    const existing = memoryRecords.get(mapKey);
    if (
      existing?.status !== "in_progress" ||
      existing.requestHash !== input.requestHash ||
      existing.updatedAt !== input.claim.updatedAt
    ) {
      return false;
    }
    memoryRecords.set(mapKey, record);
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
DECLARE $claim_updated_at AS Utf8;
DECLARE $completed_status AS Utf8;
DECLARE $in_progress_status AS Utf8;
DECLARE $status_code AS Uint32;
DECLARE $response_json AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.idempotencyKeys}
SET status = $completed_status,
    status_code = $status_code,
    response_json = $response_json,
    updated_at = $updated_at
WHERE route = $route
  AND idempotency_key = $idempotency_key
  AND request_hash = $request_hash
  AND status = $in_progress_status
  AND updated_at = $claim_updated_at;
      `,
        {
          $route: TypedValues.utf8(input.route),
          $idempotency_key: TypedValues.utf8(input.key),
          $request_hash: TypedValues.utf8(input.requestHash),
          $claim_updated_at: TypedValues.utf8(input.claim.updatedAt),
          $completed_status: TypedValues.utf8("completed"),
          $in_progress_status: TypedValues.utf8("in_progress"),
          $status_code: TypedValues.uint32(input.statusCode),
          $response_json: TypedValues.utf8(responseJson),
          $updated_at: TypedValues.utf8(updatedAt),
        },
      ),
    );
  } catch {
    return false;
  }

  try {
    const stored = await readStoredRecord(input.route, input.key);
    return Boolean(
      stored &&
        stored !== "unavailable" &&
        stored.status === "completed" &&
        stored.requestHash === input.requestHash &&
        stored.responseJson === responseJson &&
        stored.updatedAt === updatedAt,
    );
  } catch {
    return false;
  }
}

export async function releaseIdempotencyClaim(input: {
  route: string;
  key: string;
  requestHash: string;
  claim: IdempotencyClaim;
}): Promise<boolean> {
  if (isMockPetsDataSource()) {
    const mapKey = memoryKey(input.route, input.key);
    const existing = memoryRecords.get(mapKey);
    if (
      existing?.status === "in_progress" &&
      existing.requestHash === input.requestHash &&
      existing.updatedAt === input.claim.updatedAt
    ) {
      memoryRecords.delete(mapKey);
    }
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
DECLARE $claim_updated_at AS Utf8;
DECLARE $status AS Utf8;

DELETE FROM ${TABLES.idempotencyKeys}
WHERE route = $route
  AND idempotency_key = $idempotency_key
  AND request_hash = $request_hash
  AND status = $status
  AND updated_at = $claim_updated_at;
      `,
        {
          $route: TypedValues.utf8(input.route),
          $idempotency_key: TypedValues.utf8(input.key),
          $request_hash: TypedValues.utf8(input.requestHash),
          $claim_updated_at: TypedValues.utf8(input.claim.updatedAt),
          $status: TypedValues.utf8("in_progress"),
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

SELECT status, request_hash, status_code, response_json, updated_at
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
    status: textAt(row, 0) === "completed" ? "completed" : "in_progress",
    requestHash: textAt(row, 1),
    statusCode: uintAt(row, 2),
    responseJson: textAt(row, 3),
    updatedAt: textAt(row, 4),
  };
}

async function claimStoredRecord(
  route: string,
  key: string,
  requestHash: string,
): Promise<
  | { kind: "claimed"; updatedAt: string }
  | { kind: "existing"; record: StoredIdempotencyRecord | "unavailable" }
> {
  if (isMockPetsDataSource()) {
    const mapKey = memoryKey(route, key);
    const existing = memoryRecords.get(mapKey);
    if (existing) {
      if (
        existing.status === "in_progress" &&
        existing.requestHash === requestHash &&
        isExpiredInProgressRecord(existing)
      ) {
        const record = inProgressRecord(requestHash);
        memoryRecords.set(mapKey, record);
        return { kind: "claimed", updatedAt: record.updatedAt };
      }
      return { kind: "existing", record: existing };
    }
    const record = inProgressRecord(requestHash);
    memoryRecords.set(mapKey, record);
    return { kind: "claimed", updatedAt: record.updatedAt };
  }

  if (!isYdbConfigured()) {
    return { kind: "existing", record: "unavailable" };
  }

  const now = new Date().toISOString();
  try {
    await withSession((session) =>
      session.executeQuery(
        `
DECLARE $route AS Utf8;
DECLARE $idempotency_key AS Utf8;
DECLARE $request_hash AS Utf8;
DECLARE $status AS Utf8;
DECLARE $status_code AS Uint32;
DECLARE $response_json AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;

INSERT INTO ${TABLES.idempotencyKeys}
(route, idempotency_key, request_hash, status, status_code, response_json, created_at, updated_at)
VALUES ($route, $idempotency_key, $request_hash, $status, $status_code, $response_json, $created_at, $updated_at);
        `,
        {
          $route: TypedValues.utf8(route),
          $idempotency_key: TypedValues.utf8(key),
          $request_hash: TypedValues.utf8(requestHash),
          $status: TypedValues.utf8("in_progress"),
          $status_code: TypedValues.uint32(0),
          $response_json: TypedValues.utf8(""),
          $created_at: TypedValues.utf8(now),
          $updated_at: TypedValues.utf8(now),
        },
      ),
    );
    return { kind: "claimed", updatedAt: now };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await readStoredRecord(route, key);
      if (
        existing &&
        existing !== "unavailable" &&
        existing.status === "in_progress" &&
        existing.requestHash === requestHash &&
        isExpiredInProgressRecord(existing)
      ) {
        return await reclaimExpiredRecord(route, key, requestHash, existing);
      }
      return { kind: "existing", record: existing ?? "unavailable" };
    }
    if (isIdempotencyStorageError(error)) {
      return { kind: "existing", record: "unavailable" };
    }
    throw error;
  }
}

async function reclaimExpiredRecord(
  route: string,
  key: string,
  requestHash: string,
  existing: StoredIdempotencyRecord,
): Promise<
  | { kind: "claimed"; updatedAt: string }
  | { kind: "existing"; record: StoredIdempotencyRecord | "unavailable" }
> {
  const now = new Date().toISOString();
  try {
    await withSession((session) =>
      session.executeQuery(
        `
DECLARE $route AS Utf8;
DECLARE $idempotency_key AS Utf8;
DECLARE $request_hash AS Utf8;
DECLARE $status AS Utf8;
DECLARE $status_code AS Uint32;
DECLARE $response_json AS Utf8;
DECLARE $previous_updated_at AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.idempotencyKeys}
SET status = $status,
    status_code = $status_code,
    response_json = $response_json,
    updated_at = $updated_at
WHERE route = $route
  AND idempotency_key = $idempotency_key
  AND request_hash = $request_hash
  AND status = $status
  AND updated_at = $previous_updated_at;
        `,
        {
          $route: TypedValues.utf8(route),
          $idempotency_key: TypedValues.utf8(key),
          $request_hash: TypedValues.utf8(requestHash),
          $status: TypedValues.utf8("in_progress"),
          $status_code: TypedValues.uint32(0),
          $response_json: TypedValues.utf8(""),
          $previous_updated_at: TypedValues.utf8(existing.updatedAt),
          $updated_at: TypedValues.utf8(now),
        },
      ),
    );
  } catch (error) {
    if (isIdempotencyStorageError(error)) {
      return { kind: "existing", record: "unavailable" };
    }
    throw error;
  }

  const current = await readStoredRecord(route, key);
  if (
    current &&
    current !== "unavailable" &&
    current.status === "in_progress" &&
    current.requestHash === requestHash &&
    current.updatedAt === now
  ) {
    return { kind: "claimed", updatedAt: now };
  }
  return { kind: "existing", record: current ?? "unavailable" };
}

function inProgressRecord(requestHash: string): StoredIdempotencyRecord {
  return {
    status: "in_progress",
    requestHash,
    statusCode: 0,
    responseJson: "",
    updatedAt: new Date().toISOString(),
  };
}

function isExpiredInProgressRecord(record: StoredIdempotencyRecord): boolean {
  if (record.status !== "in_progress") return false;
  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) return true;
  return Date.now() - updatedAt > IN_PROGRESS_TTL_MS;
}

function stableStringify(value: unknown): string {
  if (typeof value === "undefined") {
    return '{"$undefined":true}';
  }

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

function isDuplicateKeyError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /already exists|duplicate|constraint|precondition|primary key/i.test(
    message,
  );
}

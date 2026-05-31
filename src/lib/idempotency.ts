import { createHash, randomUUID } from "node:crypto";

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
  claimToken: string;
};

type StoredIdempotencyRecord = {
  status: "in_progress" | "completed" | "committed";
  requestHash: string;
  statusCode: number;
  responseJson: string;
  createdAt: string;
  updatedAt: string;
  claimToken: string;
  expiresAt: string;
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
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const memoryRecords = new Map<string, StoredIdempotencyRecord>();
let lastCleanupAttemptAt = 0;

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
    return { kind: "fresh", claim: { claimToken: claim.claimToken } };
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

  if (record.status !== "completed") {
    const isCommitted = record.status === "committed";
    return {
      kind: "in_progress",
      response: jsonApiError("idempotency_key_in_progress", {
        status: 409,
        message: isCommitted
          ? "Idempotency-Key was already accepted for this request body, but replay is not available."
          : "Idempotency-Key is already being processed for this request body.",
        hint: isCommitted
          ? "Use a new Idempotency-Key after the retention window if you need to submit again."
          : "Retry the same request after the first attempt completes.",
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
  const now = new Date();
  const updatedAt = now.toISOString();
  const expiresAt = createExpiresAt(now);

  if (isMockPetsDataSource()) {
    const mapKey = memoryKey(input.route, input.key);
    const existing = memoryRecords.get(mapKey);
    if (
      existing?.status !== "in_progress" ||
      existing.requestHash !== input.requestHash ||
      existing.claimToken !== input.claim.claimToken
    ) {
      return false;
    }
    memoryRecords.set(mapKey, {
      status: "completed",
      requestHash: input.requestHash,
      statusCode: input.statusCode,
      responseJson,
      createdAt: existing.createdAt,
      updatedAt,
      claimToken: "",
      expiresAt,
    });
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
DECLARE $claim_token AS Utf8;
DECLARE $completed_status AS Utf8;
DECLARE $in_progress_status AS Utf8;
DECLARE $status_code AS Uint32;
DECLARE $response_json AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $completed_claim_token AS Utf8;
DECLARE $expires_at AS Utf8;

UPDATE ${TABLES.idempotencyKeys}
SET status = $completed_status,
    status_code = $status_code,
    response_json = $response_json,
    updated_at = $updated_at,
    claim_token = $completed_claim_token,
    expires_at = $expires_at
WHERE route = $route
  AND idempotency_key = $idempotency_key
  AND request_hash = $request_hash
  AND status = $in_progress_status
  AND claim_token = $claim_token;
      `,
        {
          $route: TypedValues.utf8(input.route),
          $idempotency_key: TypedValues.utf8(input.key),
          $request_hash: TypedValues.utf8(input.requestHash),
          $claim_token: TypedValues.utf8(input.claim.claimToken),
          $completed_status: TypedValues.utf8("completed"),
          $in_progress_status: TypedValues.utf8("in_progress"),
          $status_code: TypedValues.uint32(input.statusCode),
          $response_json: TypedValues.utf8(responseJson),
          $updated_at: TypedValues.utf8(updatedAt),
          $completed_claim_token: TypedValues.utf8(""),
          $expires_at: TypedValues.utf8(expiresAt),
        },
      ),
    );
  } catch {
    await holdCommittedClaim(input, updatedAt, expiresAt);
    return false;
  }

  try {
    const stored = await readStoredRecord(input.route, input.key);
    if (
      stored &&
        stored !== "unavailable" &&
        stored.status === "completed" &&
        stored.requestHash === input.requestHash &&
        stored.responseJson === responseJson &&
        stored.updatedAt === updatedAt &&
        stored.expiresAt === expiresAt
    ) {
      return true;
    }
  } catch {
    await holdCommittedClaim(input, updatedAt, expiresAt);
    return false;
  }
  await holdCommittedClaim(input, updatedAt, expiresAt);
  return false;
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
      existing.claimToken === input.claim.claimToken
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
DECLARE $claim_token AS Utf8;
DECLARE $status AS Utf8;

DELETE FROM ${TABLES.idempotencyKeys}
WHERE route = $route
  AND idempotency_key = $idempotency_key
  AND request_hash = $request_hash
  AND status = $status
  AND claim_token = $claim_token;
      `,
        {
          $route: TypedValues.utf8(input.route),
          $idempotency_key: TypedValues.utf8(input.key),
          $request_hash: TypedValues.utf8(input.requestHash),
          $claim_token: TypedValues.utf8(input.claim.claimToken),
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

SELECT status, request_hash, status_code, response_json, created_at, updated_at, claim_token, expires_at
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
  const updatedAt = textAt(row, 5);
  return {
    status: normalizeStoredStatus(textAt(row, 0)),
    requestHash: textAt(row, 1),
    statusCode: uintAt(row, 2),
    responseJson: textAt(row, 3),
    createdAt: textAt(row, 4),
    updatedAt,
    claimToken: normalizeClaimToken(updatedAt, textAt(row, 6)),
    expiresAt: textAt(row, 7),
  };
}

async function claimStoredRecord(
  route: string,
  key: string,
  requestHash: string,
  allowExpiredDelete = true,
): Promise<
  | { kind: "claimed"; claimToken: string }
  | { kind: "existing"; record: StoredIdempotencyRecord | "unavailable" }
> {
  await cleanupExpiredRecords();

  if (isMockPetsDataSource()) {
    const mapKey = memoryKey(route, key);
    let existing = memoryRecords.get(mapKey);
    if (existing && isExpiredRetentionRecord(existing)) {
      memoryRecords.delete(mapKey);
      existing = undefined;
    }
    if (existing) {
      if (
        existing.status === "in_progress" &&
        existing.requestHash === requestHash &&
        isExpiredInProgressRecord(existing)
      ) {
        const record = inProgressRecord(requestHash);
        memoryRecords.set(mapKey, record);
        return { kind: "claimed", claimToken: record.claimToken };
      }
      return { kind: "existing", record: existing };
    }
    const record = inProgressRecord(requestHash);
    memoryRecords.set(mapKey, record);
    return { kind: "claimed", claimToken: record.claimToken };
  }

  if (!isYdbConfigured()) {
    return { kind: "existing", record: "unavailable" };
  }

  const now = new Date();
  const claimToken = createClaimToken();
  const createdAt = now.toISOString();
  const expiresAt = createExpiresAt(now);
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
DECLARE $claim_token AS Utf8;
DECLARE $expires_at AS Utf8;

INSERT INTO ${TABLES.idempotencyKeys}
(route, idempotency_key, request_hash, status, status_code, response_json, created_at, updated_at, claim_token, expires_at)
VALUES ($route, $idempotency_key, $request_hash, $status, $status_code, $response_json, $created_at, $updated_at, $claim_token, $expires_at);
        `,
        {
          $route: TypedValues.utf8(route),
          $idempotency_key: TypedValues.utf8(key),
          $request_hash: TypedValues.utf8(requestHash),
          $status: TypedValues.utf8("in_progress"),
          $status_code: TypedValues.uint32(0),
          $response_json: TypedValues.utf8(""),
          $created_at: TypedValues.utf8(createdAt),
          $updated_at: TypedValues.utf8(createdAt),
          $claim_token: TypedValues.utf8(claimToken),
          $expires_at: TypedValues.utf8(expiresAt),
        },
      ),
    );
    return { kind: "claimed", claimToken };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await readStoredRecord(route, key);
      if (
        existing &&
        existing !== "unavailable" &&
        isExpiredRetentionRecord(existing)
      ) {
        if (!allowExpiredDelete) {
          return { kind: "existing", record: "unavailable" };
        }
        const deleted = await deleteStoredRecord(route, key);
        if (!deleted) {
          return { kind: "existing", record: "unavailable" };
        }
        return await claimStoredRecord(route, key, requestHash, false);
      }
      if (
        existing &&
        existing !== "unavailable" &&
        existing.status === "in_progress" &&
        existing.requestHash === requestHash &&
        existing.claimToken === claimToken
      ) {
        return { kind: "claimed", claimToken };
      }
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

async function holdCommittedClaim(
  input: StoreIdempotencyInput,
  updatedAt: string,
  expiresAt: string,
): Promise<void> {
  if (!isYdbConfigured()) return;

  try {
    await withSession((session) =>
      session.executeQuery(
        `
DECLARE $route AS Utf8;
DECLARE $idempotency_key AS Utf8;
DECLARE $request_hash AS Utf8;
DECLARE $claim_token AS Utf8;
DECLARE $committed_status AS Utf8;
DECLARE $in_progress_status AS Utf8;
DECLARE $status_code AS Uint32;
DECLARE $response_json AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $completed_claim_token AS Utf8;
DECLARE $expires_at AS Utf8;

UPDATE ${TABLES.idempotencyKeys}
SET status = $committed_status,
    status_code = $status_code,
    response_json = $response_json,
    updated_at = $updated_at,
    claim_token = $completed_claim_token,
    expires_at = $expires_at
WHERE route = $route
  AND idempotency_key = $idempotency_key
  AND request_hash = $request_hash
  AND status = $in_progress_status
  AND claim_token = $claim_token;
        `,
        {
          $route: TypedValues.utf8(input.route),
          $idempotency_key: TypedValues.utf8(input.key),
          $request_hash: TypedValues.utf8(input.requestHash),
          $claim_token: TypedValues.utf8(input.claim.claimToken),
          $committed_status: TypedValues.utf8("committed"),
          $in_progress_status: TypedValues.utf8("in_progress"),
          $status_code: TypedValues.uint32(0),
          $response_json: TypedValues.utf8(""),
          $updated_at: TypedValues.utf8(updatedAt),
          $completed_claim_token: TypedValues.utf8(""),
          $expires_at: TypedValues.utf8(expiresAt),
        },
      ),
    );
  } catch {
    // If storage is fully unavailable, the route still returns the committed 201 response.
  }
}

async function reclaimExpiredRecord(
  route: string,
  key: string,
  requestHash: string,
  existing: StoredIdempotencyRecord,
): Promise<
  | { kind: "claimed"; claimToken: string }
  | { kind: "existing"; record: StoredIdempotencyRecord | "unavailable" }
> {
  const now = new Date();
  const updatedAt = now.toISOString();
  const claimToken = createClaimToken();
  const expiresAt = createExpiresAt(now);
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
DECLARE $previous_claim_token AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $claim_token AS Utf8;
DECLARE $expires_at AS Utf8;

UPDATE ${TABLES.idempotencyKeys}
SET status = $status,
    status_code = $status_code,
    response_json = $response_json,
    updated_at = $updated_at,
    claim_token = $claim_token,
    expires_at = $expires_at
WHERE route = $route
  AND idempotency_key = $idempotency_key
  AND request_hash = $request_hash
  AND status = $status
  AND updated_at = $previous_updated_at
  AND claim_token = $previous_claim_token;
        `,
        {
          $route: TypedValues.utf8(route),
          $idempotency_key: TypedValues.utf8(key),
          $request_hash: TypedValues.utf8(requestHash),
          $status: TypedValues.utf8("in_progress"),
          $status_code: TypedValues.uint32(0),
          $response_json: TypedValues.utf8(""),
          $previous_updated_at: TypedValues.utf8(existing.updatedAt),
          $previous_claim_token: TypedValues.utf8(existing.claimToken),
          $updated_at: TypedValues.utf8(updatedAt),
          $claim_token: TypedValues.utf8(claimToken),
          $expires_at: TypedValues.utf8(expiresAt),
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
    current.updatedAt === updatedAt &&
    current.claimToken === claimToken
  ) {
    return { kind: "claimed", claimToken };
  }
  return { kind: "existing", record: current ?? "unavailable" };
}

function inProgressRecord(requestHash: string): StoredIdempotencyRecord {
  const now = new Date();
  const nowIso = now.toISOString();
  return {
    status: "in_progress",
    requestHash,
    statusCode: 0,
    responseJson: "",
    createdAt: nowIso,
    updatedAt: nowIso,
    claimToken: createClaimToken(),
    expiresAt: createExpiresAt(now),
  };
}

function isExpiredInProgressRecord(record: StoredIdempotencyRecord): boolean {
  if (record.status !== "in_progress") return false;
  const updatedAt = Date.parse(record.updatedAt.split("#", 1)[0]);
  if (!Number.isFinite(updatedAt)) return true;
  return Date.now() - updatedAt > IN_PROGRESS_TTL_MS;
}

async function deleteStoredRecord(route: string, key: string): Promise<boolean> {
  if (isMockPetsDataSource()) {
    memoryRecords.delete(memoryKey(route, key));
    return true;
  }

  if (!isYdbConfigured()) return false;

  try {
    await withSession((session) =>
      session.executeQuery(
        `
DECLARE $route AS Utf8;
DECLARE $idempotency_key AS Utf8;

DELETE FROM ${TABLES.idempotencyKeys}
WHERE route = $route AND idempotency_key = $idempotency_key;
        `,
        {
          $route: TypedValues.utf8(route),
          $idempotency_key: TypedValues.utf8(key),
        },
      ),
    );
    return true;
  } catch (error) {
    if (isIdempotencyStorageError(error)) return false;
    throw error;
  }
}

function isExpiredRetentionRecord(record: StoredIdempotencyRecord): boolean {
  const expiresAt = Date.parse(record.expiresAt);
  return Number.isFinite(expiresAt) && Date.now() >= expiresAt;
}

async function cleanupExpiredRecords(): Promise<void> {
  const now = Date.now();
  if (
    now >= lastCleanupAttemptAt &&
    now - lastCleanupAttemptAt < CLEANUP_INTERVAL_MS
  ) {
    return;
  }
  lastCleanupAttemptAt = now;

  const cutoff = new Date(now).toISOString();
  if (isMockPetsDataSource()) {
    for (const [key, record] of memoryRecords) {
      if (record.expiresAt && record.expiresAt <= cutoff) {
        memoryRecords.delete(key);
      }
    }
    return;
  }

  if (!isYdbConfigured()) return;

  try {
    await withSession((session) =>
      session.executeQuery(
        `
DECLARE $expires_before AS Utf8;

DELETE FROM ${TABLES.idempotencyKeys}
WHERE expires_at < $expires_before;
        `,
        {
          $expires_before: TypedValues.utf8(cutoff),
        },
      ),
    );
  } catch {
    // Cleanup is best-effort; claim/store paths still report hard storage failures.
  }
}

function normalizeClaimToken(updatedAt: string, claimToken: string): string {
  return claimToken || (updatedAt.includes("#") ? updatedAt : "");
}

function normalizeStoredStatus(value: string): StoredIdempotencyRecord["status"] {
  if (value === "completed" || value === "committed") return value;
  return "in_progress";
}

function createClaimToken(): string {
  return randomUUID();
}

function createExpiresAt(now = new Date()): string {
  return new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS).toISOString();
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

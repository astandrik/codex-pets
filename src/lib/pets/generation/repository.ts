import type { Session } from "ydb-sdk";

import {
  fulfillGenerationRequest,
  getGenerationRequestById,
  markGenerationRequestInProgress,
  reopenGenerationRequest,
} from "@/lib/pets/generation-requests-repository";
import { chunkGenerationArtifact, reassembleGenerationArtifact, sha256 } from "@/lib/pets/generation/artifact-chunks";
import { PET_GENERATION_MAX_BASE_REROLLS, PET_GENERATION_MAX_TARGETED_RETRIES } from "@/lib/pets/generation/config";
import {
  assertGenerationRunTransition,
  retryStatusForStage,
  TERMINAL_GENERATION_RUN_STATUSES,
} from "@/lib/pets/generation/state-machine";
import {
  PET_GENERATION_RUN_STATUSES,
  PET_GENERATION_STAGES,
  type PetGenerationArtifact,
  type PetGenerationFinalMetadata,
  type PetGenerationReview,
  type PetGenerationRun,
  type PetGenerationRunStatus,
  type PetGenerationStage,
} from "@/lib/pets/generation/types";
import { isMockPetsDataSource } from "@/lib/pets/mock-data";
import { TypedValues, isYdbConfigured, withSession } from "@/lib/ydb/client";
import { bytesAt, rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

const ACTIVE = new Set(
  PET_GENERATION_RUN_STATUSES.filter((status) => !TERMINAL_GENERATION_RUN_STATUSES.has(status)),
);
const mockRuns = new Map<string, PetGenerationRun>();
const mockArtifacts = new Map<string, { metadata: PetGenerationArtifact; buffer: Buffer }>();

export type GenerationRunMutationResult =
  | { ok: true; run: PetGenerationRun }
  | { ok: false; error: "not_found" | "conflict"; message: string };

export async function createGenerationRun(input: {
  requestId: string;
  idempotencyKey: string;
}): Promise<GenerationRunMutationResult> {
  const request = await getGenerationRequestById(input.requestId);
  if (!request || ["deleted", "fulfilled", "rejected"].includes(request.status)) return notFound("Generation request was not found.");
  const found = await activeRun(input.requestId);
  if (found) return found.idempotencyKey === input.idempotencyKey || !input.idempotencyKey
    ? { ok: true, run: found }
    : conflict("This request already has an active generation run.");
  const now = new Date().toISOString();
  const run: PetGenerationRun = {
    id: `run_${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    status: "queued_base",
    baseRevision: 0,
    targetedRetryCount: 0,
    imageCallCount: 0,
    lastStage: null,
    failureCode: null,
    failureMessage: null,
    review: null,
    finalMetadata: null,
    finalPetId: null,
    finalPetSlug: null,
    approvedBy: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    cancelledAt: null,
  };
  if (isMockPetsDataSource()) {
    const competing = await activeRun(input.requestId);
    if (competing) return competing.idempotencyKey === input.idempotencyKey
      ? { ok: true, run: competing }
      : conflict("This request already has an active generation run.");
    mockRuns.set(run.id, run);
  } else {
    if (!isYdbConfigured()) return notFound("Persistence is not configured.");
    const created = await serializable(async (execute) => {
      const result = await execute(
        `DECLARE $request_id AS Utf8;
         SELECT ${RUN_COLUMNS} FROM ${TABLES.generationRuns}
         WHERE request_id=$request_id ORDER BY created_at DESC;`,
        { $request_id: TypedValues.utf8(input.requestId) },
      );
      const current = rowsFromResult(result).map(parseRun).find((item) => ACTIVE.has(item.status));
      if (current) return current;
      await execute(UPSERT_RUN, params(run));
      return run;
    });
    if (created.id !== run.id) return created.idempotencyKey === input.idempotencyKey
      ? { ok: true, run: created }
      : conflict("This request already has an active generation run.");
  }
  await markGenerationRequestInProgress({ requestId: input.requestId });
  return { ok: true, run };
}

export async function listLatestGenerationRunsByRequestIds(ids: readonly string[]) {
  const wanted = new Set(ids);
  if (!wanted.size) return new Map<string, PetGenerationRun>();
  let runs: PetGenerationRun[];
  if (isMockPetsDataSource()) runs = Array.from(mockRuns.values());
  else if (!isYdbConfigured()) runs = [];
  else runs = rowsFromResult(await withSession((session) =>
    session.executeQuery(`SELECT ${RUN_COLUMNS} FROM ${TABLES.generationRuns} ORDER BY created_at DESC LIMIT 500;`),
  )).map(parseRun);
  const result = new Map<string, PetGenerationRun>();
  for (const run of runs.filter((item) => wanted.has(item.requestId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!result.has(run.requestId)) result.set(run.requestId, run);
  }
  return result;
}

export async function getGenerationRunById(id: string): Promise<PetGenerationRun | null> {
  if (isMockPetsDataSource()) return mockRuns.get(id) ?? null;
  if (!isYdbConfigured()) return null;
  const result = await withSession((session) => session.executeQuery(
    `DECLARE $id AS Utf8; SELECT ${RUN_COLUMNS} FROM ${TABLES.generationRuns} WHERE id=$id LIMIT 1;`,
    { $id: TypedValues.utf8(id) },
  ));
  return rowsFromResult(result).map(parseRun)[0] ?? null;
}

export async function getGenerationRunByPetId(petId: string): Promise<PetGenerationRun | null> {
  if (isMockPetsDataSource()) return Array.from(mockRuns.values()).find((run) => run.finalPetId === petId) ?? null;
  if (!isYdbConfigured()) return null;
  const result = await withSession((session) => session.executeQuery(
    `DECLARE $pet_id AS Utf8; SELECT ${RUN_COLUMNS} FROM ${TABLES.generationRuns}
     WHERE final_pet_id=$pet_id ORDER BY created_at DESC LIMIT 1;`,
    { $pet_id: TypedValues.utf8(petId) },
  ));
  return rowsFromResult(result).map(parseRun)[0] ?? null;
}

export const approveGenerationBase = (id: string) =>
  transition(id, "queued_hatch", (run) => ({ ...run, failureCode: null, failureMessage: null }));

export async function regenerateGenerationBase(id: string) {
  const run = await getGenerationRunById(id);
  if (!run) return notFound();
  if (run.baseRevision >= PET_GENERATION_MAX_BASE_REROLLS) return conflict("The pilot allows one base regeneration per run.");
  return transition(id, "queued_base", (current) => ({
    ...current,
    baseRevision: current.baseRevision + 1,
    review: null,
    failureCode: null,
    failureMessage: null,
  }));
}

export async function retryGenerationRun(id: string) {
  const run = await getGenerationRunById(id);
  if (!run) return notFound();
  if (run.status !== "failed") return conflict("Only failed runs can be retried.");
  if (run.targetedRetryCount >= PET_GENERATION_MAX_TARGETED_RETRIES) return conflict("The pilot allows one targeted retry per run.");
  return transition(id, retryStatusForStage(run.lastStage), (current) => ({
    ...current,
    targetedRetryCount: current.targetedRetryCount + 1,
    failureCode: null,
    failureMessage: null,
  }));
}

export const cancelGenerationRun = (id: string) =>
  transition(id, "cancelled", (run) => ({ ...run, cancelledAt: new Date().toISOString() }));

export async function transitionGenerationRun(input: {
  runId: string;
  status: PetGenerationRunStatus;
  lastStage?: PetGenerationStage | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  review?: PetGenerationReview | null;
  finalMetadata?: PetGenerationFinalMetadata | null;
  finalPetId?: string | null;
  finalPetSlug?: string | null;
  approvedBy?: string | null;
  imageCallCount?: number;
}) {
  return transition(input.runId, input.status, (run) => ({
    ...run,
    lastStage: input.lastStage === undefined ? run.lastStage : input.lastStage,
    failureCode: input.failureCode === undefined ? run.failureCode : input.failureCode,
    failureMessage: input.failureMessage === undefined ? run.failureMessage : sanitizeGenerationError(input.failureMessage),
    review: input.review === undefined ? run.review : input.review,
    finalMetadata: input.finalMetadata === undefined ? run.finalMetadata : input.finalMetadata,
    finalPetId: input.finalPetId === undefined ? run.finalPetId : input.finalPetId,
    finalPetSlug: input.finalPetSlug === undefined ? run.finalPetSlug : input.finalPetSlug,
    approvedBy: input.approvedBy === undefined ? run.approvedBy : input.approvedBy,
    imageCallCount: input.imageCallCount === undefined ? run.imageCallCount : input.imageCallCount,
    completedAt: input.status === "completed" ? new Date().toISOString() : run.completedAt,
  }));
}

export async function completeGeneratedPetModeration(input: { petId: string; petSlug: string }) {
  const run = await getGenerationRunByPetId(input.petId);
  if (!run || run.status !== "awaiting_moderation") return;
  const fulfilled = await fulfillGenerationRequest({ requestId: run.requestId, petLookup: input.petId });
  if (fulfilled.ok) await transitionGenerationRun({
    runId: run.id,
    status: "completed",
    finalPetId: input.petId,
    finalPetSlug: input.petSlug,
  });
}

export async function reopenGeneratedPetRequest(petId: string) {
  const run = await getGenerationRunByPetId(petId);
  if (!run || !["awaiting_moderation", "completed"].includes(run.status)) return;
  const changed = await transitionGenerationRun({ runId: run.id, status: "submission_rejected" });
  if (changed.ok) await reopenGenerationRequest(run.requestId);
}

export async function storeGenerationArtifact(input: {
  runId: string;
  key: string;
  stage: PetGenerationStage;
  fileName: string;
  contentType: string;
  buffer: Buffer;
  expiresAt: string;
  retained?: boolean;
}): Promise<PetGenerationArtifact> {
  validateKey(input.key);
  const metadata: PetGenerationArtifact = {
    runId: input.runId, key: input.key, stage: input.stage, fileName: input.fileName,
    contentType: input.contentType, byteSize: input.buffer.length, sha256: sha256(input.buffer),
    createdAt: new Date().toISOString(), expiresAt: input.expiresAt, retained: input.retained ?? false,
  };
  if (isMockPetsDataSource()) {
    mockArtifacts.set(`${input.runId}:${input.key}`, { metadata, buffer: Buffer.from(input.buffer) });
    return metadata;
  }
  if (!isYdbConfigured()) throw new Error("Persistence is not configured.");
  const chunks = chunkGenerationArtifact(input.buffer);
  await serializable(async (execute) => {
    const ids = { $run_id: TypedValues.utf8(input.runId), $artifact_key: TypedValues.utf8(input.key) };
    await execute(
      `DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8;
       DELETE FROM ${TABLES.generationArtifactChunks} WHERE run_id=$run_id AND artifact_key=$artifact_key;`,
      ids,
    );
    await execute(UPSERT_ARTIFACT, { ...ids, ...artifactParams(metadata) });
    for (let index = 0; index < chunks.length; index += 1) {
      await execute(UPSERT_CHUNK, {
        ...ids,
        $chunk_number: TypedValues.uint32(index),
        $size_bytes: TypedValues.uint32(chunks[index].length),
        $chunk_bytes: TypedValues.bytes(chunks[index]),
      });
    }
  });
  return metadata;
}

export async function readGenerationArtifact(input: {
  runId: string;
  key: string;
}): Promise<{ metadata: PetGenerationArtifact; buffer: Buffer } | null> {
  validateKey(input.key);
  if (isMockPetsDataSource()) return mockArtifacts.get(`${input.runId}:${input.key}`) ?? null;
  if (!isYdbConfigured()) return null;
  const p = { $run_id: TypedValues.utf8(input.runId), $artifact_key: TypedValues.utf8(input.key) };
  const [meta, chunks] = await Promise.all([
    withSession((session) => session.executeQuery(
      `DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8;
       SELECT stage,file_name,content_type,byte_size,sha256,created_at,expires_at,retained
       FROM ${TABLES.generationArtifacts} WHERE run_id=$run_id AND artifact_key=$artifact_key LIMIT 1;`, p)),
    withSession((session) => session.executeQuery(
      `DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8;
       SELECT chunk_bytes FROM ${TABLES.generationArtifactChunks}
       WHERE run_id=$run_id AND artifact_key=$artifact_key ORDER BY chunk_number ASC;`, p)),
  ]);
  const row = rowsFromResult(meta)[0];
  if (!row) return null;
  const metadata: PetGenerationArtifact = {
    runId: input.runId, key: input.key, stage: parseStage(textAt(row, 0)), fileName: textAt(row, 1),
    contentType: textAt(row, 2), byteSize: uintAt(row, 3), sha256: textAt(row, 4),
    createdAt: textAt(row, 5), expiresAt: textAt(row, 6), retained: boolAt(row, 7),
  };
  return {
    metadata,
    buffer: reassembleGenerationArtifact({
      chunks: rowsFromResult(chunks).map((item) => bytesAt(item, 0)),
      expectedSize: metadata.byteSize,
      expectedSha256: metadata.sha256,
    }),
  };
}

async function transition(
  id: string,
  status: PetGenerationRunStatus,
  mutate: (run: PetGenerationRun) => PetGenerationRun,
): Promise<GenerationRunMutationResult> {
  const current = await getGenerationRunById(id);
  if (!current) return notFound();
  try { assertGenerationRunTransition(current.status, status); }
  catch (error) { return conflict(error instanceof Error ? error.message : "Invalid run transition."); }
  const next = { ...mutate(current), status, updatedAt: new Date().toISOString() };
  if (isMockPetsDataSource()) {
    const latest = mockRuns.get(id);
    if (!latest || latest.updatedAt !== current.updatedAt) return conflict("Run changed concurrently.");
    mockRuns.set(id, next);
    return { ok: true, run: next };
  }
  await withSession((session) => session.executeQuery(UPDATE_RUN, {
    ...params(next),
    $expected_status: TypedValues.utf8(current.status),
    $expected_updated_at: TypedValues.utf8(current.updatedAt),
  }));
  const confirmed = await getGenerationRunById(id);
  return confirmed?.updatedAt === next.updatedAt ? { ok: true, run: confirmed } : conflict("Run changed concurrently.");
}

async function activeRun(requestId: string) {
  if (isMockPetsDataSource()) return Array.from(mockRuns.values())
    .find((run) => run.requestId === requestId && ACTIVE.has(run.status)) ?? null;
  return Array.from((await listLatestGenerationRunsByRequestIds([requestId])).values())
    .find((run) => ACTIVE.has(run.status)) ?? null;
}

type Execute = (query: string, values?: Record<string, unknown>) => Promise<unknown>;
async function serializable<T>(operation: (execute: Execute) => Promise<T>): Promise<T> {
  return withSession(async (session: Session) => {
    const transaction = await session.beginTransaction({ serializableReadWrite: {} });
    if (!transaction.id) throw new Error("Unable to start generation transaction.");
    const tx = { txId: transaction.id };
    const execute: Execute = (query, values = {}) =>
      session.executeQuery(query, values as NonNullable<Parameters<typeof session.executeQuery>[1]>, tx);
    try {
      const value = await operation(execute);
      await session.commitTransaction(tx);
      return value;
    } catch (error) {
      try { await session.rollbackTransaction(tx); } catch {}
      throw error;
    }
  });
}

const RUN_COLUMNS = "id,request_id,idempotency_key,status,base_revision,targeted_retry_count,image_call_count,last_stage,failure_code,failure_message,review_json,final_id,final_display_name,final_description,final_kind,final_tags_json,final_pet_id,final_pet_slug,approved_by,created_at,updated_at,completed_at,cancelled_at";
const RUN_DECLARATIONS = `
  DECLARE $id AS Utf8; DECLARE $request_id AS Utf8; DECLARE $idempotency_key AS Utf8;
  DECLARE $status AS Utf8; DECLARE $base_revision AS Uint32; DECLARE $targeted_retry_count AS Uint32;
  DECLARE $image_call_count AS Uint32; DECLARE $last_stage AS Utf8; DECLARE $failure_code AS Utf8;
  DECLARE $failure_message AS Utf8; DECLARE $review_json AS Utf8; DECLARE $final_id AS Utf8;
  DECLARE $final_display_name AS Utf8; DECLARE $final_description AS Utf8; DECLARE $final_kind AS Utf8;
  DECLARE $final_tags_json AS Utf8; DECLARE $final_pet_id AS Utf8; DECLARE $final_pet_slug AS Utf8;
  DECLARE $approved_by AS Utf8; DECLARE $created_at AS Utf8; DECLARE $updated_at AS Utf8;
  DECLARE $completed_at AS Utf8; DECLARE $cancelled_at AS Utf8;`;
const UPSERT_RUN = `${RUN_DECLARATIONS}
  UPSERT INTO ${TABLES.generationRuns}
  (id,request_id,idempotency_key,status,base_revision,targeted_retry_count,image_call_count,last_stage,
  failure_code,failure_message,review_json,final_id,final_display_name,final_description,final_kind,
  final_tags_json,final_pet_id,final_pet_slug,approved_by,created_at,updated_at,completed_at,cancelled_at)
  VALUES ($id,$request_id,$idempotency_key,$status,$base_revision,$targeted_retry_count,$image_call_count,
  $last_stage,$failure_code,$failure_message,$review_json,$final_id,$final_display_name,$final_description,
  $final_kind,$final_tags_json,$final_pet_id,$final_pet_slug,$approved_by,$created_at,$updated_at,$completed_at,$cancelled_at);`;
const UPDATE_RUN = `${RUN_DECLARATIONS} DECLARE $expected_status AS Utf8; DECLARE $expected_updated_at AS Utf8;
  UPDATE ${TABLES.generationRuns} SET status=$status,updated_at=$updated_at,base_revision=$base_revision,
  targeted_retry_count=$targeted_retry_count,image_call_count=$image_call_count,last_stage=$last_stage,
  failure_code=$failure_code,failure_message=$failure_message,review_json=$review_json,final_id=$final_id,
  final_display_name=$final_display_name,final_description=$final_description,final_kind=$final_kind,
  final_tags_json=$final_tags_json,final_pet_id=$final_pet_id,final_pet_slug=$final_pet_slug,
  approved_by=$approved_by,completed_at=$completed_at,cancelled_at=$cancelled_at
  WHERE id=$id AND status=$expected_status AND updated_at=$expected_updated_at;`;
const UPSERT_ARTIFACT = `
  DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8; DECLARE $stage AS Utf8;
  DECLARE $file_name AS Utf8; DECLARE $content_type AS Utf8; DECLARE $byte_size AS Uint64;
  DECLARE $sha256 AS Utf8; DECLARE $created_at AS Utf8; DECLARE $expires_at AS Utf8; DECLARE $retained AS Bool;
  UPSERT INTO ${TABLES.generationArtifacts}
  (run_id,artifact_key,stage,file_name,content_type,byte_size,sha256,created_at,expires_at,retained)
  VALUES ($run_id,$artifact_key,$stage,$file_name,$content_type,$byte_size,$sha256,$created_at,$expires_at,$retained);`;
const UPSERT_CHUNK = `
  DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8; DECLARE $chunk_number AS Uint32;
  DECLARE $size_bytes AS Uint32; DECLARE $chunk_bytes AS String;
  UPSERT INTO ${TABLES.generationArtifactChunks}
  (run_id,artifact_key,chunk_number,size_bytes,chunk_bytes)
  VALUES ($run_id,$artifact_key,$chunk_number,$size_bytes,$chunk_bytes);`;

function params(run: PetGenerationRun) {
  return {
    $id: TypedValues.utf8(run.id), $request_id: TypedValues.utf8(run.requestId),
    $idempotency_key: TypedValues.utf8(run.idempotencyKey), $status: TypedValues.utf8(run.status),
    $base_revision: TypedValues.uint32(run.baseRevision), $targeted_retry_count: TypedValues.uint32(run.targetedRetryCount),
    $image_call_count: TypedValues.uint32(run.imageCallCount), $last_stage: TypedValues.utf8(run.lastStage ?? ""),
    $failure_code: TypedValues.utf8(run.failureCode ?? ""), $failure_message: TypedValues.utf8(run.failureMessage ?? ""),
    $review_json: TypedValues.utf8(run.review ? JSON.stringify(run.review) : ""),
    $final_id: TypedValues.utf8(run.finalMetadata?.id ?? ""),
    $final_display_name: TypedValues.utf8(run.finalMetadata?.displayName ?? ""),
    $final_description: TypedValues.utf8(run.finalMetadata?.description ?? ""),
    $final_kind: TypedValues.utf8(run.finalMetadata?.kind ?? ""),
    $final_tags_json: TypedValues.utf8(run.finalMetadata ? JSON.stringify(run.finalMetadata.tags) : ""),
    $final_pet_id: TypedValues.utf8(run.finalPetId ?? ""), $final_pet_slug: TypedValues.utf8(run.finalPetSlug ?? ""),
    $approved_by: TypedValues.utf8(run.approvedBy ?? ""), $created_at: TypedValues.utf8(run.createdAt),
    $updated_at: TypedValues.utf8(run.updatedAt), $completed_at: TypedValues.utf8(run.completedAt ?? ""),
    $cancelled_at: TypedValues.utf8(run.cancelledAt ?? ""),
  };
}

function parseRun(row: Parameters<typeof textAt>[0]): PetGenerationRun {
  const finalId = textAt(row, 11);
  return {
    id: textAt(row, 0), requestId: textAt(row, 1), idempotencyKey: textAt(row, 2),
    status: parseStatus(textAt(row, 3)), baseRevision: uintAt(row, 4),
    targetedRetryCount: uintAt(row, 5), imageCallCount: uintAt(row, 6),
    lastStage: textAt(row, 7) ? parseStage(textAt(row, 7)) : null,
    failureCode: textAt(row, 8) || null, failureMessage: textAt(row, 9) || null,
    review: parseJson<PetGenerationReview>(textAt(row, 10)),
    finalMetadata: finalId ? {
      id: finalId, displayName: textAt(row, 12), description: textAt(row, 13),
      kind: parseKind(textAt(row, 14)), tags: parseJson<string[]>(textAt(row, 15)) ?? [],
    } : null,
    finalPetId: textAt(row, 16) || null, finalPetSlug: textAt(row, 17) || null,
    approvedBy: textAt(row, 18) || null, createdAt: textAt(row, 19), updatedAt: textAt(row, 20),
    completedAt: textAt(row, 21) || null, cancelledAt: textAt(row, 22) || null,
  };
}

function artifactParams(value: PetGenerationArtifact) {
  return {
    $stage: TypedValues.utf8(value.stage), $file_name: TypedValues.utf8(value.fileName),
    $content_type: TypedValues.utf8(value.contentType), $byte_size: TypedValues.uint64(value.byteSize),
    $sha256: TypedValues.utf8(value.sha256), $created_at: TypedValues.utf8(value.createdAt),
    $expires_at: TypedValues.utf8(value.expiresAt), $retained: TypedValues.bool(value.retained),
  };
}
function parseStatus(value: string): PetGenerationRunStatus {
  return PET_GENERATION_RUN_STATUSES.includes(value as PetGenerationRunStatus) ? value as PetGenerationRunStatus : "failed";
}
function parseStage(value: string): PetGenerationStage {
  if (!PET_GENERATION_STAGES.includes(value as PetGenerationStage)) throw new Error("Unknown generation stage.");
  return value as PetGenerationStage;
}
function parseKind(value: string): PetGenerationFinalMetadata["kind"] {
  return value === "object" || value === "character" ? value : "creature";
}
function parseJson<T>(value: string): T | null {
  try { return value ? JSON.parse(value) as T : null; } catch { return null; }
}
function boolAt(row: Parameters<typeof textAt>[0], index: number): boolean {
  return Boolean((row.items?.[index] as { boolValue?: boolean } | undefined)?.boolValue);
}
function validateKey(value: string) {
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(value)) throw new Error("Invalid generation artifact key.");
}
export function sanitizeGenerationError(value: string | null): string | null {
  return value ? value.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/[\r\n\t]+/g, " ").slice(0, 500) : null;
}
function notFound(message = "Generation run was not found."): GenerationRunMutationResult {
  return { ok: false, error: "not_found", message };
}
function conflict(message: string): GenerationRunMutationResult {
  return { ok: false, error: "conflict", message };
}

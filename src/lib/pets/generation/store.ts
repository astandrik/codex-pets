import { withSerializableTransaction } from "@/lib/ydb/transaction";
import type { Session } from "ydb-sdk";
import { TypedValues, Types, withSession } from "@/lib/ydb/client";
import { bytesAt, rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import { storedGenerationJob, jobSchema, jobStatusSchema, GENERATION_ID, type GenerationJob } from "@/lib/pets/generation/model";
import { insertPendingPetInTransaction, listTakenPetSlugsInTransaction, type CreatePendingPetInput } from "@/lib/pets/repository";
import { insertPetAssetsInTransaction, type PetAssetInput } from "@/lib/pets/assets-repository";

export type PendingGenerationSubmission = {
  identity: { id: string; slug: string; createdAt: string };
  pet: CreatePendingPetInput;
  assets: PetAssetInput;
};

export const GENERATION_TABLES = {
  jobs: "codex_pet_generation_jobs",
  artifacts: "codex_pet_generation_artifacts",
  quotas: "codex_pet_generation_quotas",
} as const;

export type QueueJob = Pick<GenerationJob, "id" | "status" | "expiresAt">;

export interface GenerationTransaction {
  getQueueJobs(ids: readonly string[]): Promise<Map<string, QueueJob>>;
  getJob(id: string): Promise<GenerationJob | null>;
  getJobs(ids: readonly string[]): Promise<Map<string, GenerationJob>>;
  putJob(job: GenerationJob): Promise<void>;
  getLedger(key: string, now: number): Promise<string | null>;
  putLedger(key: string, value: string, expiresAt: number): Promise<void>;
  getArtifact(id: string, kind: string, now: number): Promise<Buffer | null>;
  putArtifact(id: string, kind: string, bytes: Buffer, expiresAt: number): Promise<void>;
  hasArtifact(id: string, kind: string, now: number): Promise<boolean>;
  setArtifactExpiry(id: string, kinds: string[], expiresAt: number): Promise<void>;
  deleteArtifacts(id: string): Promise<void>;
  saveSubmission(input: PendingGenerationSubmission): Promise<void>;
  listTakenSlugs(slugs: string[]): Promise<string[]>;
}
export interface GenerationStore {
  transaction<T>(operation: (tx: GenerationTransaction) => Promise<T>): Promise<T>;
  readJob(id: string): Promise<GenerationJob | null>;
  readArtifact(id: string, kind: string, now: number): Promise<Buffer | null>;
  cleanup(now: number): Promise<void>;
}

type Execute = (sql: string, params: NonNullable<Parameters<Session["executeQuery"]>[1]>) => ReturnType<Session["executeQuery"]>;
// Bound responses when queued jobs retain large correction histories.
const JOB_READ_BATCH_SIZE = 32;

function transactionApi(execute: Execute): GenerationTransaction {
  return {
    listTakenSlugs: slugs => listTakenPetSlugsInTransaction(slugs, execute),
    async saveSubmission(input) {
      await insertPetAssetsInTransaction(input.assets, execute);
      await insertPendingPetInTransaction(input.pet, input.identity, execute);
    },
    async getJob(id) {
      const result = await execute(`DECLARE $id AS Utf8;
SELECT payload FROM ${GENERATION_TABLES.jobs} WHERE id = $id;`, { $id: TypedValues.utf8(id) });
      const row = rowsFromResult(result)[0];
      return row ? jobSchema.parse(JSON.parse(textAt(row, 0))) : null;
    },
    async getJobs(ids) {
      const unique = [...new Set(ids)];
      const jobs = new Map<string, GenerationJob>();
      for (let offset = 0; offset < unique.length; offset += JOB_READ_BATCH_SIZE) {
        const batch = unique.slice(offset, offset + JOB_READ_BATCH_SIZE);
        // Cap the batch at 8 MiB (the SDK receives at most 16 MiB). Legacy records can still contain embedded image bytes.
        const result = await execute(`DECLARE $ids AS List<Utf8>;
SELECT id, IF(LENGTH(CAST(payload AS String)) <= 262144, payload, CAST("" AS Utf8)) AS payload,
LENGTH(CAST(payload AS String)) > 262144 AS oversized
FROM ${GENERATION_TABLES.jobs} WHERE id IN $ids;`, {
          $ids: TypedValues.list(Types.UTF8, batch),
        });
        if (result.resultSets?.length !== 1 || result.resultSets.some(set => set.truncated)) throw new Error("Incomplete generation job batch");
        for (const row of rowsFromResult(result)) {
          const id = textAt(row, 0), oversized = row.items?.[2]?.boolValue;
          if (!batch.includes(id) || jobs.has(id) || typeof oversized !== "boolean") throw new Error("Invalid generation job batch");
          let payload = textAt(row, 1);
          if (oversized) {
            if (payload !== "") throw new Error("Invalid oversized job marker");
            const single = await execute(`DECLARE $id AS Utf8;
SELECT payload FROM ${GENERATION_TABLES.jobs} WHERE id = $id;`, {$id: TypedValues.utf8(id)});
            if (single.resultSets?.length !== 1 || single.resultSets.some(set => set.truncated) || rowsFromResult(single).length !== 1) throw new Error("Incomplete oversized job read");
            payload = textAt(rowsFromResult(single)[0], 0);
          }
          const job = jobSchema.parse(JSON.parse(payload));
          if (job.id !== id) throw new Error("Mismatched generation job ID");
          jobs.set(id, job);
        }
      }
      return jobs;
    },
    async getQueueJobs(ids) {
      const unique = [...new Set(ids)];
      const jobs = new Map<string, QueueJob>();
      for (let offset = 0; offset < unique.length; offset += JOB_READ_BATCH_SIZE) {
        const batch = unique.slice(offset, offset + JOB_READ_BATCH_SIZE);
        const result = await execute(`DECLARE $ids AS List<Utf8>;
SELECT id, JSON_VALUE(CAST(payload AS Json), "strict $.status" ERROR ON EMPTY ERROR ON ERROR) AS status,
JSON_VALUE(CAST(payload AS Json), "strict $.expiresAt" RETURNING Uint64 ERROR ON EMPTY ERROR ON ERROR) AS expires
FROM ${GENERATION_TABLES.jobs} WHERE id IN $ids;`, {$ids: TypedValues.list(Types.UTF8, batch)});
        if (result.resultSets?.length !== 1 || result.resultSets.some(set => set.truncated)) throw new Error("Incomplete queue job batch");
        for (const row of rowsFromResult(result)) {
          const id = textAt(row, 0);
          const status = jobStatusSchema.parse(textAt(row, 1));
          if (row.items?.[2]?.uint64Value === undefined && row.items?.[2]?.uint32Value === undefined) throw new Error("Missing queue job expiry");
          const expiresAt = uintAt(row, 2);
          if (!GENERATION_ID.test(id) || !batch.includes(id) || jobs.has(id) || !Number.isSafeInteger(expiresAt) || expiresAt < 0) throw new Error("Invalid queue job summary");
          jobs.set(id, {id, status, expiresAt});
        }
      }
      return jobs;
    },
    async putJob(job) {
      await execute(`DECLARE $id AS Utf8; DECLARE $payload AS Utf8; DECLARE $expires AS Timestamp;
UPSERT INTO ${GENERATION_TABLES.jobs} (id, payload, expires_at) VALUES ($id, $payload, $expires);`, {
        $id: TypedValues.utf8(job.id), $payload: TypedValues.utf8(JSON.stringify(storedGenerationJob(job))),
        $expires: TypedValues.timestamp(new Date(job.expiresAt)),
      });
    },
    async getLedger(key, now) {
      const result = await execute(`DECLARE $key AS Utf8; DECLARE $now AS Timestamp;
SELECT payload FROM ${GENERATION_TABLES.quotas} WHERE record_key = $key AND expires_at > $now;`, {
        $key: TypedValues.utf8(key), $now: TypedValues.timestamp(new Date(now)),
      });
      const row = rowsFromResult(result)[0];
      return row ? textAt(row, 0) : null;
    },
    async putLedger(key, value, expiresAt) {
      await execute(`DECLARE $key AS Utf8; DECLARE $payload AS Utf8; DECLARE $expires AS Timestamp;
UPSERT INTO ${GENERATION_TABLES.quotas} (record_key, payload, expires_at) VALUES ($key, $payload, $expires);`, {
        $key: TypedValues.utf8(key), $payload: TypedValues.utf8(value),
        $expires: TypedValues.timestamp(new Date(expiresAt)),
      });
    },
    async getArtifact(id, kind, now) {
      const result = await execute(`DECLARE $id AS Utf8; DECLARE $kind AS Utf8; DECLARE $now AS Timestamp;
SELECT bytes FROM ${GENERATION_TABLES.artifacts} WHERE id = $id AND kind = $kind AND expires_at > $now;`, {
        $id: TypedValues.utf8(id), $kind: TypedValues.utf8(kind), $now: TypedValues.timestamp(new Date(now)),
      });
      const row = rowsFromResult(result)[0];
      return row ? bytesAt(row, 0) : null;
    },
    async hasArtifact(id,kind,now) {
      const result=await execute(`DECLARE $id AS Utf8; DECLARE $kind AS Utf8; DECLARE $now AS Timestamp;
SELECT kind FROM ${GENERATION_TABLES.artifacts} WHERE id=$id AND kind=$kind AND expires_at>$now;`,{$id:TypedValues.utf8(id),$kind:TypedValues.utf8(kind),$now:TypedValues.timestamp(new Date(now))});
      return rowsFromResult(result).length===1;
    },
    async setArtifactExpiry(id, kinds, expiresAt) {
      for (const kind of kinds) await execute(`DECLARE $id AS Utf8; DECLARE $kind AS Utf8; DECLARE $expires AS Timestamp;
UPDATE ${GENERATION_TABLES.artifacts} SET expires_at = $expires WHERE id = $id AND kind = $kind;`, {$id: TypedValues.utf8(id), $kind: TypedValues.utf8(kind), $expires: TypedValues.timestamp(new Date(expiresAt))});
    },
    async deleteArtifacts(id) {
      await execute(`DECLARE $id AS Utf8; DELETE FROM ${GENERATION_TABLES.artifacts} WHERE id = $id;`, {$id: TypedValues.utf8(id)});
    },
    async putArtifact(id, kind, bytes, expiresAt) {
      await execute(`DECLARE $id AS Utf8; DECLARE $kind AS Utf8; DECLARE $bytes AS String; DECLARE $expires AS Timestamp;
UPSERT INTO ${GENERATION_TABLES.artifacts} (id, kind, bytes, expires_at) VALUES ($id, $kind, $bytes, $expires);`, {
        $id: TypedValues.utf8(id), $kind: TypedValues.utf8(kind), $bytes: TypedValues.bytes(bytes),
        $expires: TypedValues.timestamp(new Date(expiresAt)),
      });
    },
  };
}

// Generation transactions share scheduler and accounting rows. Queue only the
// local database work; provider calls and direct artifact reads stay concurrent.
let pendingTransaction: Promise<void> = Promise.resolve();

export const generationStore: GenerationStore = {
  transaction(operation) {
    const result = pendingTransaction.then(() => withSerializableTransaction(execute => operation(transactionApi(execute))));
    pendingTransaction = result.then(() => undefined, () => undefined);
    return result;
  },
  readJob(id) {
    return withSession((session) => transactionApi((sql, params) => session.executeQuery(sql, params)).getJob(id));
  },
  readArtifact(id, kind, now) {
    return withSession((session) => transactionApi((sql, params) => session.executeQuery(sql, params)).getArtifact(id, kind, now));
  },
  async cleanup(now) {
    await withSession(async (session) => {
      for (const table of Object.values(GENERATION_TABLES)) {
        await session.executeQuery(`DECLARE $now AS Timestamp; DELETE FROM ${table} WHERE expires_at <= $now;`, {
          $now: TypedValues.timestamp(new Date(now)),
        });
      }
    });
  },
};

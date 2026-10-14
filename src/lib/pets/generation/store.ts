import { withSerializableTransaction } from "@/lib/ydb/transaction";
import type { Session } from "ydb-sdk";
import { TypedValues, withSession } from "@/lib/ydb/client";
import { bytesAt, rowsFromResult, textAt } from "@/lib/ydb/result";
import { jobSchema, type GenerationJob } from "@/lib/pets/generation/model";
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

export interface GenerationTransaction {
  getJob(id: string): Promise<GenerationJob | null>;
  putJob(job: GenerationJob): Promise<void>;
  getLedger(key: string, now: number): Promise<string | null>;
  putLedger(key: string, value: string, expiresAt: number): Promise<void>;
  getArtifact(id: string, kind: string, now: number): Promise<Buffer | null>;
  putArtifact(id: string, kind: string, bytes: Buffer, expiresAt: number): Promise<void>;
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
    async putJob(job) {
      await execute(`DECLARE $id AS Utf8; DECLARE $payload AS Utf8; DECLARE $expires AS Timestamp;
UPSERT INTO ${GENERATION_TABLES.jobs} (id, payload, expires_at) VALUES ($id, $payload, $expires);`, {
        $id: TypedValues.utf8(job.id), $payload: TypedValues.utf8(JSON.stringify(job)),
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
    async putArtifact(id, kind, bytes, expiresAt) {
      await execute(`DECLARE $id AS Utf8; DECLARE $kind AS Utf8; DECLARE $bytes AS String; DECLARE $expires AS Timestamp;
UPSERT INTO ${GENERATION_TABLES.artifacts} (id, kind, bytes, expires_at) VALUES ($id, $kind, $bytes, $expires);`, {
        $id: TypedValues.utf8(id), $kind: TypedValues.utf8(kind), $bytes: TypedValues.bytes(bytes),
        $expires: TypedValues.timestamp(new Date(expiresAt)),
      });
    },
  };
}

export const generationStore: GenerationStore = {
  transaction(operation) {
    return withSerializableTransaction(execute => operation(transactionApi(execute)));
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

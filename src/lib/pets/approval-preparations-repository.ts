import { createHash, randomUUID } from "node:crypto";
import type { Session } from "ydb-sdk";

import { isYdbConfigured, TypedValues, withSession } from "@/lib/ydb/client";
import { rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

export type ApprovalPreparationStatus =
  | "queued"
  | "preparing"
  | "retry"
  | "manual_review"
  | "succeeded";

export type ApprovalPreparation = {
  preparationId: string;
  petId: string;
  petSlug: string;
  petUpdatedAt: string;
  reviewerId: string;
  rankingRevision: string;
  expectedActiveGenerationId: string;
  preparedGenerationId: string;
  status: ApprovalPreparationStatus;
  attempts: number;
  nextAttemptAt: string;
  leaseOwner: string;
  leaseUntil: string;
  failureCode: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRankingInputScope = {
  embeddingModelRevisions: readonly string[];
  captionRevision: string | null;
  annotationRevision?: string | null;
};

type Execute = (
  statement: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

type Dependencies = {
  isConfigured: () => boolean;
  values: {
    utf8: (value: string) => unknown;
    uint32: (value: number) => unknown;
  };
  execute: Execute;
  transaction: <T>(operation: (execute: Execute) => Promise<T>) => Promise<T>;
};

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
const STATE_ID = "active";
const STATUSES = new Set<ApprovalPreparationStatus>([
  "queued",
  "preparing",
  "retry",
  "manual_review",
  "succeeded",
]);

export function createApprovalPreparationId(input: {
  petId: string;
  petUpdatedAt: string;
  rankingRevision: string;
  expectedActiveGenerationId: string;
}): string {
  const digest = createHash("sha256")
    .update(input.petId)
    .update("\0")
    .update(input.petUpdatedAt)
    .update("\0")
    .update(input.rankingRevision)
    .update("\0")
    .update(input.expectedActiveGenerationId)
    .digest("hex")
    .slice(0, 32);
  return `approval_${digest}`;
}

export function nextApprovalPreparationAttemptAt(
  attempts: number,
  now: Date,
): string | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined
    ? null
    : new Date(now.getTime() + delay).toISOString();
}

export function createApprovalPreparationsRepository(
  dependencies: Dependencies,
) {
  return { enqueue, get, claimNext, markFailure, finalize };

  async function enqueue(input: {
    petId: string;
    petSlug: string;
    petUpdatedAt: string;
    reviewerId: string;
    rankingRevision: string;
    expectedActiveGenerationId: string;
    now: string;
  }): Promise<ApprovalPreparation | null> {
    if (!dependencies.isConfigured()) return null;
    const preparationId = createApprovalPreparationId(input);
    return dependencies.transaction(async (execute) => {
      const existing = await getWithExecute(execute, preparationId);
      if (existing) {
        if (existing.status !== "manual_review") return existing;
        await execute(
          `
DECLARE $preparation_id AS Utf8;
DECLARE $reviewer_id AS Utf8;
DECLARE $manual_review AS Utf8;
DECLARE $queued AS Utf8;
DECLARE $zero AS Uint32;
DECLARE $empty AS Utf8;
DECLARE $now AS Utf8;

UPDATE ${TABLES.approvalPreparations}
SET reviewer_id = $reviewer_id, status = $queued, attempts = $zero,
    next_attempt_at = $now, prepared_generation_id = $empty,
    lease_owner = $empty, lease_until = $empty, failure_code = $empty,
    updated_at = $now
WHERE preparation_id = $preparation_id AND status = $manual_review;
          `,
          {
            $preparation_id: dependencies.values.utf8(preparationId),
            $reviewer_id: dependencies.values.utf8(input.reviewerId),
            $manual_review: dependencies.values.utf8("manual_review"),
            $queued: dependencies.values.utf8("queued"),
            $zero: dependencies.values.uint32(0),
            $empty: dependencies.values.utf8(""),
            $now: dependencies.values.utf8(input.now),
          },
        );
        return getWithExecute(execute, preparationId);
      }
      await execute(
        `
DECLARE $preparation_id AS Utf8;
DECLARE $pet_id AS Utf8;
DECLARE $pet_slug AS Utf8;
DECLARE $pet_updated_at AS Utf8;
DECLARE $reviewer_id AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $expected_active_generation_id AS Utf8;
DECLARE $empty AS Utf8;
DECLARE $status AS Utf8;
DECLARE $attempts AS Uint32;
DECLARE $now AS Utf8;

INSERT INTO ${TABLES.approvalPreparations}
(preparation_id, pet_id, pet_slug, pet_updated_at, reviewer_id,
 ranking_revision, expected_active_generation_id, prepared_generation_id,
 status, attempts, next_attempt_at, lease_owner, lease_until, failure_code,
 created_at, updated_at)
VALUES
($preparation_id, $pet_id, $pet_slug, $pet_updated_at, $reviewer_id,
 $ranking_revision, $expected_active_generation_id, $empty,
 $status, $attempts, $now, $empty, $empty, $empty, $now, $now);
        `,
        {
          $preparation_id: dependencies.values.utf8(preparationId),
          $pet_id: dependencies.values.utf8(input.petId),
          $pet_slug: dependencies.values.utf8(input.petSlug),
          $pet_updated_at: dependencies.values.utf8(input.petUpdatedAt),
          $reviewer_id: dependencies.values.utf8(input.reviewerId),
          $ranking_revision: dependencies.values.utf8(input.rankingRevision),
          $expected_active_generation_id: dependencies.values.utf8(
            input.expectedActiveGenerationId,
          ),
          $empty: dependencies.values.utf8(""),
          $status: dependencies.values.utf8("queued"),
          $attempts: dependencies.values.uint32(0),
          $now: dependencies.values.utf8(input.now),
        },
      );
      return getWithExecute(execute, preparationId);
    });
  }

  async function get(
    preparationId: string,
  ): Promise<ApprovalPreparation | null> {
    if (!dependencies.isConfigured()) return null;
    return getWithExecute(dependencies.execute, preparationId);
  }

  async function getWithExecute(
    execute: Execute,
    preparationId: string,
  ): Promise<ApprovalPreparation | null> {
    const result = await execute(
      `
DECLARE $preparation_id AS Utf8;

SELECT ${selectColumns()}
FROM ${TABLES.approvalPreparations}
WHERE preparation_id = $preparation_id
LIMIT 1;`,
      { $preparation_id: dependencies.values.utf8(preparationId) },
    );
    const row = rowsFromResult(result)[0];
    return row ? preparationFromRow(row) : null;
  }

  async function claimNext(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
  }): Promise<ApprovalPreparation | null> {
    if (!dependencies.isConfigured()) return null;
    return dependencies.transaction(async (execute) => {
      const result = await execute(
        `
DECLARE $queued AS Utf8;
DECLARE $retry AS Utf8;
DECLARE $preparing AS Utf8;
DECLARE $now AS Utf8;
DECLARE $empty AS Utf8;

SELECT ${selectColumns()}
FROM ${TABLES.approvalPreparations}
WHERE (status = $queued OR status = $retry OR status = $preparing)
  AND next_attempt_at <= $now
  AND (lease_until = $empty OR lease_until <= $now)
ORDER BY next_attempt_at, created_at, preparation_id
LIMIT 1;
        `,
        {
          $queued: dependencies.values.utf8("queued"),
          $retry: dependencies.values.utf8("retry"),
          $preparing: dependencies.values.utf8("preparing"),
          $now: dependencies.values.utf8(input.now),
          $empty: dependencies.values.utf8(""),
        },
      );
      const candidateRow = rowsFromResult(result)[0];
      if (!candidateRow) return null;
      const candidate = preparationFromRow(candidateRow);
      await execute(
        `
DECLARE $preparation_id AS Utf8;
DECLARE $expected_status AS Utf8;
DECLARE $preparing AS Utf8;
DECLARE $worker_id AS Utf8;
DECLARE $lease_until AS Utf8;
DECLARE $now AS Utf8;
DECLARE $one AS Uint32;

UPDATE ${TABLES.approvalPreparations}
SET status = $preparing,
    attempts = attempts + $one,
    lease_owner = $worker_id,
    lease_until = $lease_until,
    updated_at = $now
WHERE preparation_id = $preparation_id
  AND status = $expected_status;
        `,
        {
          $preparation_id: dependencies.values.utf8(candidate.preparationId),
          $expected_status: dependencies.values.utf8(candidate.status),
          $preparing: dependencies.values.utf8("preparing"),
          $worker_id: dependencies.values.utf8(input.workerId),
          $lease_until: dependencies.values.utf8(input.leaseUntil),
          $now: dependencies.values.utf8(input.now),
          $one: dependencies.values.uint32(1),
        },
      );
      const claimed = await getWithExecute(execute, candidate.preparationId);
      return claimed?.leaseOwner === input.workerId ? claimed : null;
    });
  }

  async function markFailure(input: {
    preparationId: string;
    workerId: string;
    failureCode: string;
    retryable: boolean;
    now: Date;
  }): Promise<ApprovalPreparation | null> {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(input.failureCode)) {
      throw new Error("Invalid approval preparation failure code.");
    }
    if (!dependencies.isConfigured()) return null;
    return dependencies.transaction(async (execute) => {
      const current = await getWithExecute(execute, input.preparationId);
      if (
        !current ||
        current.status !== "preparing" ||
        current.leaseOwner !== input.workerId
      ) {
        return current;
      }
      const nextAttemptAt = input.retryable
        ? nextApprovalPreparationAttemptAt(current.attempts, input.now)
        : null;
      await updateOutcome(execute, {
        preparationId: input.preparationId,
        status: nextAttemptAt ? "retry" : "manual_review",
        failureCode: input.failureCode,
        nextAttemptAt: nextAttemptAt ?? "",
        preparedGenerationId: current.preparedGenerationId,
        now: input.now.toISOString(),
      });
      return getWithExecute(execute, input.preparationId);
    });
  }

  async function finalize(input: {
    preparationId: string;
    workerId: string;
    preparedGenerationId: string;
    reviewId: string;
    now: string;
    inputScope: ApprovalRankingInputScope;
    expectedInputRevision: string;
    expectedSnapshotCount: number;
  }): Promise<boolean> {
    if (!dependencies.isConfigured()) return false;
    return dependencies.transaction(async (execute) => {
      const preparation = await getWithExecute(execute, input.preparationId);
      if (
        !preparation ||
        preparation.status !== "preparing" ||
        preparation.leaseOwner !== input.workerId
      ) {
        return false;
      }
      if (
        await getInputRevisionWithExecute(execute, input.inputScope) !==
        input.expectedInputRevision
      ) {
        return false;
      }
      const checks = await execute(
        `
DECLARE $pet_id AS Utf8;
DECLARE $pet_slug AS Utf8;
DECLARE $pending AS Utf8;
DECLARE $pet_updated_at AS Utf8;
DECLARE $state_id AS Utf8;
DECLARE $ready AS Utf8;
DECLARE $active_generation_id AS Utf8;
DECLARE $generation_id AS Utf8;
DECLARE $ranking_revision AS Utf8;

SELECT COUNT(*) AS pet_count
FROM ${TABLES.pets}
WHERE id = $pet_id AND slug = $pet_slug AND status = $pending
  AND updated_at = $pet_updated_at;

SELECT COUNT(*) AS state_count
FROM ${TABLES.relatedState}
WHERE state_id = $state_id AND status = $ready
  AND active_generation_id = $active_generation_id;

SELECT COUNT(*) AS snapshot_count
FROM ${TABLES.relatedSnapshots}
WHERE generation_id = $generation_id
  AND ranking_revision = $ranking_revision;
        `,
        {
          $pet_id: dependencies.values.utf8(preparation.petId),
          $pet_slug: dependencies.values.utf8(preparation.petSlug),
          $pending: dependencies.values.utf8("pending"),
          $pet_updated_at: dependencies.values.utf8(preparation.petUpdatedAt),
          $state_id: dependencies.values.utf8(STATE_ID),
          $ready: dependencies.values.utf8("ready"),
          $active_generation_id: dependencies.values.utf8(
            preparation.expectedActiveGenerationId,
          ),
          $generation_id: dependencies.values.utf8(input.preparedGenerationId),
          $ranking_revision: dependencies.values.utf8(
            preparation.rankingRevision,
          ),
        },
      );
      const resultSets = (checks as {
        resultSets?: Array<{ rows?: unknown[] }>;
      }).resultSets ?? [];
      const counts = resultSets.map((set) =>
        uintAt(
          { items: (set.rows?.[0] as { items?: [] } | undefined)?.items },
          0,
        )
      );
      if (
        counts[0] !== 1 ||
        counts[1] !== 1 ||
        counts[2] !== input.expectedSnapshotCount
      ) {
        return false;
      }

      await execute(finalizeStatement(), {
        $preparation_id: dependencies.values.utf8(preparation.preparationId),
        $pet_slug: dependencies.values.utf8(preparation.petSlug),
        $pet_updated_at: dependencies.values.utf8(preparation.petUpdatedAt),
        $pending: dependencies.values.utf8("pending"),
        $approved: dependencies.values.utf8("approved"),
        $now: dependencies.values.utf8(input.now),
        $empty: dependencies.values.utf8(""),
        $review_id: dependencies.values.utf8(input.reviewId),
        $pet_id: dependencies.values.utf8(preparation.petId),
        $reviewer_id: dependencies.values.utf8(preparation.reviewerId),
        $decision: dependencies.values.utf8("approved"),
        $state_id: dependencies.values.utf8(STATE_ID),
        $ready: dependencies.values.utf8("ready"),
        $active_generation_id: dependencies.values.utf8(
          preparation.expectedActiveGenerationId,
        ),
        $generation_id: dependencies.values.utf8(input.preparedGenerationId),
        $ranking_revision: dependencies.values.utf8(preparation.rankingRevision),
        $succeeded: dependencies.values.utf8("succeeded"),
      });
      return true;
    });
  }

  async function getInputRevisionWithExecute(
    execute: Execute,
    scope: ApprovalRankingInputScope,
  ): Promise<string> {
    const catalogResult = await execute(
      `
DECLARE $status AS Utf8;
SELECT slug, updated_at FROM ${TABLES.pets}
WHERE status = $status ORDER BY slug;
      `,
      { $status: dependencies.values.utf8("approved") },
    );
    const catalog = rowsFromResult(catalogResult).map((row) => [
      textAt(row, 0),
      textAt(row, 1),
    ]);
    const embeddings = [];
    const revisions = [...new Set(scope.embeddingModelRevisions)]
      .map((value) => value.trim())
      .filter(Boolean)
      .toSorted();
    for (const revision of revisions) {
      const result = await execute(
        `
DECLARE $model_revision AS Utf8;
SELECT pet_slug, source_hash, dimensions, updated_at
FROM ${TABLES.searchEmbeddings}
WHERE model_revision = $model_revision ORDER BY pet_slug;
        `,
        { $model_revision: dependencies.values.utf8(revision) },
      );
      embeddings.push([
        revision,
        rowsFromResult(result).map((row) => [
          textAt(row, 0),
          textAt(row, 1),
          uintAt(row, 2),
          textAt(row, 3),
        ]),
      ]);
    }
    let captions: unknown = null;
    if (scope.captionRevision) {
      const result = await execute(
        `
DECLARE $caption_revision AS Utf8;
SELECT pet_slug, source_hash, updated_at
FROM ${TABLES.searchCaptions}
WHERE caption_revision = $caption_revision ORDER BY pet_slug;
        `,
        { $caption_revision: dependencies.values.utf8(scope.captionRevision) },
      );
      captions = [
        scope.captionRevision,
        rowsFromResult(result).map((row) => [
          textAt(row, 0),
          textAt(row, 1),
          textAt(row, 2),
        ]),
      ];
    }
    let annotations: unknown = undefined;
    if (scope.annotationRevision) {
      const result = await execute(
        `
DECLARE $annotation_revision AS Utf8;
SELECT pet_slug, source_hash, updated_at
FROM ${TABLES.relatedAnnotations}
WHERE annotation_revision = $annotation_revision ORDER BY pet_slug;
        `,
        {
          $annotation_revision: dependencies.values.utf8(
            scope.annotationRevision,
          ),
        },
      );
      annotations = [
        scope.annotationRevision,
        rowsFromResult(result).map((row) => [
          textAt(row, 0),
          textAt(row, 1),
          textAt(row, 2),
        ]),
      ];
    }
    return JSON.stringify({
      catalog: JSON.stringify(catalog),
      embeddings: JSON.stringify(embeddings),
      captions: captions === null ? null : JSON.stringify(captions),
      ...(annotations === undefined
        ? {}
        : { annotations: JSON.stringify(annotations) }),
    });
  }

  async function updateOutcome(
    execute: Execute,
    input: {
      preparationId: string;
      status: ApprovalPreparationStatus;
      failureCode: string;
      nextAttemptAt: string;
      preparedGenerationId: string;
      now: string;
    },
  ): Promise<void> {
    await execute(
      `
DECLARE $preparation_id AS Utf8;
DECLARE $status AS Utf8;
DECLARE $failure_code AS Utf8;
DECLARE $next_attempt_at AS Utf8;
DECLARE $prepared_generation_id AS Utf8;
DECLARE $empty AS Utf8;
DECLARE $now AS Utf8;

UPDATE ${TABLES.approvalPreparations}
SET status = $status, failure_code = $failure_code,
    next_attempt_at = $next_attempt_at,
    prepared_generation_id = $prepared_generation_id,
    lease_owner = $empty, lease_until = $empty, updated_at = $now
WHERE preparation_id = $preparation_id;
      `,
      {
        $preparation_id: dependencies.values.utf8(input.preparationId),
        $status: dependencies.values.utf8(input.status),
        $failure_code: dependencies.values.utf8(input.failureCode),
        $next_attempt_at: dependencies.values.utf8(input.nextAttemptAt),
        $prepared_generation_id: dependencies.values.utf8(
          input.preparedGenerationId,
        ),
        $empty: dependencies.values.utf8(""),
        $now: dependencies.values.utf8(input.now),
      },
    );
  }
}

function selectColumns(): string {
  return `preparation_id, pet_id, pet_slug, pet_updated_at, reviewer_id,
ranking_revision, expected_active_generation_id, prepared_generation_id,
status, attempts, next_attempt_at, lease_owner, lease_until, failure_code,
created_at, updated_at`;
}

function preparationFromRow(
  row: ReturnType<typeof rowsFromResult>[number],
): ApprovalPreparation {
  const status = textAt(row, 8) as ApprovalPreparationStatus;
  if (!STATUSES.has(status)) {
    throw new Error("Invalid approval preparation status.");
  }
  return {
    preparationId: textAt(row, 0),
    petId: textAt(row, 1),
    petSlug: textAt(row, 2),
    petUpdatedAt: textAt(row, 3),
    reviewerId: textAt(row, 4),
    rankingRevision: textAt(row, 5),
    expectedActiveGenerationId: textAt(row, 6),
    preparedGenerationId: textAt(row, 7),
    status,
    attempts: uintAt(row, 9),
    nextAttemptAt: textAt(row, 10),
    leaseOwner: textAt(row, 11),
    leaseUntil: textAt(row, 12),
    failureCode: textAt(row, 13),
    createdAt: textAt(row, 14),
    updatedAt: textAt(row, 15),
  };
}

function finalizeStatement(): string {
  return `
DECLARE $preparation_id AS Utf8;
DECLARE $pet_slug AS Utf8;
DECLARE $pet_updated_at AS Utf8;
DECLARE $pending AS Utf8;
DECLARE $approved AS Utf8;
DECLARE $now AS Utf8;
DECLARE $empty AS Utf8;
DECLARE $review_id AS Utf8;
DECLARE $pet_id AS Utf8;
DECLARE $reviewer_id AS Utf8;
DECLARE $decision AS Utf8;
DECLARE $state_id AS Utf8;
DECLARE $ready AS Utf8;
DECLARE $active_generation_id AS Utf8;
DECLARE $generation_id AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $succeeded AS Utf8;

UPDATE ${TABLES.pets}
SET status = $approved, updated_at = $now, approved_at = $now,
    rejected_at = $empty, rejection_reason = $empty
WHERE slug = $pet_slug AND status = $pending AND updated_at = $pet_updated_at;

UPSERT INTO ${TABLES.reviews}
(id, pet_id, reviewer_id, decision, reason, created_at)
VALUES ($review_id, $pet_id, $reviewer_id, $decision, $empty, $now);

UPDATE ${TABLES.relatedState}
SET previous_generation_id = active_generation_id,
    active_generation_id = $generation_id,
    requested_generation_id = $generation_id,
    status = $ready, ranking_revision = $ranking_revision,
    failure_reason = NULL, updated_at = $now
WHERE state_id = $state_id AND status = $ready
  AND active_generation_id = $active_generation_id;

UPDATE ${TABLES.approvalPreparations}
SET status = $succeeded, prepared_generation_id = $generation_id,
    failure_code = $empty, next_attempt_at = $empty,
    lease_owner = $empty, lease_until = $empty, updated_at = $now
WHERE preparation_id = $preparation_id;
  `;
}

type TxControl = { txId: string };

async function withSerializableTransaction<T>(
  operation: (execute: Execute) => Promise<T>,
): Promise<T> {
  return withSession(async (session: Session) => {
    const transaction = await session.beginTransaction({
      serializableReadWrite: {},
    });
    if (!transaction.id) {
      throw new Error("Unable to start approval transaction.");
    }
    const txControl: TxControl = { txId: transaction.id };
    const execute: Execute = (statement, params) =>
      session.executeQuery(
        statement,
        params as NonNullable<Parameters<typeof session.executeQuery>[1]>,
        txControl,
      );
    try {
      const result = await operation(execute);
      await session.commitTransaction(txControl);
      return result;
    } catch (error) {
      try {
        await session.rollbackTransaction(txControl);
      } catch {
        // YDB can abort the transaction before the explicit rollback.
      }
      throw error;
    }
  });
}

const repository = createApprovalPreparationsRepository({
  isConfigured: isYdbConfigured,
  values: TypedValues,
  execute: (statement, params) =>
    withSession((session) =>
      session.executeQuery(
        statement,
        params as NonNullable<Parameters<typeof session.executeQuery>[1]>,
      ),
    ),
  transaction: withSerializableTransaction,
});

export const enqueueApprovalPreparation = repository.enqueue;
export const getApprovalPreparation = repository.get;
export const claimNextApprovalPreparation = repository.claimNext;
export const markApprovalPreparationFailure = repository.markFailure;
export const finalizeApprovalPreparation = repository.finalize;

export function createApprovalReviewId(): string {
  return `review_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
}

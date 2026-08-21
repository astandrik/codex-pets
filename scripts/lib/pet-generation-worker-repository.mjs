import { createHash, randomUUID } from "node:crypto";

const TABLES = Object.freeze({
  runs: "codex_pet_generation_runs",
  attempts: "codex_pet_generation_stage_attempts",
  artifacts: "codex_pet_generation_artifacts",
  chunks: "codex_pet_generation_artifact_chunks",
  requests: "codex_pet_generation_requests",
  requestImages: "codex_pet_generation_request_images",
});
const CHUNK_BYTES = 4 * 1024 * 1024;
const TERMINAL = new Set(["completed", "cancelled", "submission_rejected"]);

export function createGenerationWorkerRepository({ withSession, TypedValues, leaseSeconds, maxImageCalls }) {
  async function transaction(operation) {
    return withSession(async (session) => {
      const started = await session.beginTransaction({ serializableReadWrite: {} });
      if (!started.id) throw new Error("Unable to start generation worker transaction.");
      const tx = { txId: started.id };
      const execute = (query, params = {}) => session.executeQuery(query, params, tx);
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

  async function findRunnableRun() {
    const result = await withSession((session) => session.executeQuery(
      `DECLARE $queued_base AS Utf8; DECLARE $generating_base AS Utf8;
       DECLARE $queued_hatch AS Utf8; DECLARE $generating AS Utf8; DECLARE $validating AS Utf8;
       SELECT id,request_id,status,base_revision,targeted_retry_count,image_call_count,last_stage,updated_at
       FROM ${TABLES.runs}
       WHERE status=$queued_base OR status=$generating_base OR status=$queued_hatch OR status=$generating OR status=$validating
       ORDER BY updated_at ASC LIMIT 20;`,
      {
        $queued_base: TypedValues.utf8("queued_base"),
        $generating_base: TypedValues.utf8("generating_base"),
        $queued_hatch: TypedValues.utf8("queued_hatch"),
        $generating: TypedValues.utf8("generating"),
        $validating: TypedValues.utf8("validating"),
      },
    ));
    return rows(result).map(parseRun)[0] ?? null;
  }

  async function claimRun(run, owner) {
    return transaction(async (execute) => {
      const current = await readRun(execute, run.id);
      if (!current) return null;
      const base = ["queued_base", "generating_base"].includes(current.status);
      const hatch = ["queued_hatch", "generating", "validating"].includes(current.status);
      if (!base && !hatch) return null;
      const stage = base ? "base" : "assembly";
      const hash = `orchestration:${base ? "base" : "hatch"}:${current.baseRevision}:${current.targetedRetryCount}`;
      const acquired = await acquireAttempt(execute, {
        runId: current.id, stage, requestHash: hash, model: "deterministic-worker",
        owner, allowExpired: true, reserveImage: false,
      });
      if (acquired.kind !== "acquired") return null;
      const status = base ? "generating_base" : current.status === "validating" ? "validating" : "generating";
      const now = new Date().toISOString();
      await execute(
        `DECLARE $id AS Utf8; DECLARE $status AS Utf8; DECLARE $last_stage AS Utf8; DECLARE $updated_at AS Utf8;
         UPDATE ${TABLES.runs} SET status=$status,last_stage=$last_stage,updated_at=$updated_at WHERE id=$id;`,
        { $id: TypedValues.utf8(current.id), $status: TypedValues.utf8(status),
          $last_stage: TypedValues.utf8(current.lastStage || stage), $updated_at: TypedValues.utf8(now) },
      );
      return { run: { ...current, status, updatedAt: now }, lease: acquired.attempt };
    });
  }

  async function beginProviderAttempt(input) {
    return transaction((execute) => acquireAttempt(execute, {
      ...input,
      allowExpired: false,
      reserveImage: input.reserveImage,
    }));
  }

  async function acquireAttempt(execute, input) {
    if (!input.allowExpired) {
      const run = await readRun(execute, input.runId);
      if (!run) return { kind: "missing" };
      if (TERMINAL.has(run.status)) return { kind: "cancelled" };
    }
    const matching = await readLatestAttempt(execute, input.runId, input.stage, input.requestHash);
    const now = new Date();
    if (matching?.status === "succeeded") return { kind: "cached", attempt: matching };
    if (matching?.status === "leased") {
      if (matching.leaseExpiresAt > now.toISOString()) return { kind: "busy" };
      if (!input.allowExpired) {
        await finishAttemptTx(execute, matching, {
          status: "ambiguous", errorCode: "lease_expired_ambiguous",
          errorMessage: "The provider dispatch outcome is unknown after lease expiry.", ambiguous: true,
        });
        return { kind: "ambiguous" };
      }
      await finishAttemptTx(execute, matching, {
        status: "failed", errorCode: "worker_lease_expired",
        errorMessage: "The worker lease expired and was safely reclaimed.", ambiguous: false,
      });
    }
    let imageCallCount;
    if (input.reserveImage) {
      const run = await readRun(execute, input.runId);
      if (!run) return { kind: "missing" };
      if (run.imageCallCount >= maxImageCalls) return { kind: "budget" };
      imageCallCount = run.imageCallCount + 1;
      await execute(
        `DECLARE $id AS Utf8; DECLARE $count AS Uint32; DECLARE $updated_at AS Utf8;
         UPDATE ${TABLES.runs} SET image_call_count=$count,updated_at=$updated_at WHERE id=$id;`,
        { $id: TypedValues.utf8(input.runId), $count: TypedValues.uint32(imageCallCount),
          $updated_at: TypedValues.utf8(now.toISOString()) },
      );
    }
    const latest = await readLatestStageAttempt(execute, input.runId, input.stage);
    const attempt = {
      runId: input.runId,
      stage: input.stage,
      attempt: (latest?.attempt ?? 0) + 1,
      status: "leased",
      leaseOwner: input.owner,
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1_000).toISOString(),
      heartbeatAt: now.toISOString(),
      requestHash: input.requestHash,
      model: input.model,
      usageJson: "{}",
      providerRequestId: "",
      errorCode: "",
      errorMessage: "",
      ambiguous: false,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: "",
    };
    await execute(UPSERT_ATTEMPT, attemptParams(attempt, TypedValues));
    return { kind: "acquired", attempt, imageCallCount };
  }

  async function heartbeat(attempt) {
    const now = new Date();
    await withSession((session) => session.executeQuery(
      `DECLARE $run_id AS Utf8; DECLARE $stage AS Utf8; DECLARE $attempt AS Uint32;
       DECLARE $token AS Utf8; DECLARE $heartbeat AS Utf8; DECLARE $expires AS Utf8;
       UPDATE ${TABLES.attempts} SET heartbeat_at=$heartbeat,lease_expires_at=$expires,updated_at=$heartbeat
       WHERE run_id=$run_id AND stage=$stage AND attempt=$attempt AND lease_token=$token;`,
      { $run_id: TypedValues.utf8(attempt.runId), $stage: TypedValues.utf8(attempt.stage),
        $attempt: TypedValues.uint32(attempt.attempt), $token: TypedValues.utf8(attempt.leaseToken),
        $heartbeat: TypedValues.utf8(now.toISOString()),
        $expires: TypedValues.utf8(new Date(now.getTime() + leaseSeconds * 1_000).toISOString()) },
    ));
  }

  async function finishAttempt(attempt, result) {
    return transaction((execute) => finishAttemptTx(execute, attempt, result));
  }

  async function reconcileProviderSuccess(input) {
    return transaction(async (execute) => {
      const attempt = await readLatestAttempt(execute, input.runId, input.stage, input.requestHash);
      if (!attempt || attempt.status !== "leased") return false;
      await finishAttemptTx(execute, attempt, {
        status: "succeeded",
        usage: { recoveredFromArtifact: true },
      });
      return true;
    });
  }

  async function finishAttemptTx(execute, attempt, result) {
    const now = new Date().toISOString();
    await execute(
      `DECLARE $run_id AS Utf8; DECLARE $stage AS Utf8; DECLARE $attempt AS Uint32; DECLARE $token AS Utf8;
       DECLARE $status AS Utf8; DECLARE $usage AS Utf8; DECLARE $provider_id AS Utf8;
       DECLARE $error_code AS Utf8; DECLARE $error_message AS Utf8; DECLARE $ambiguous AS Bool;
       DECLARE $updated_at AS Utf8; DECLARE $completed_at AS Utf8; DECLARE $empty AS Utf8;
       UPDATE ${TABLES.attempts} SET status=$status,usage_json=$usage,provider_request_id=$provider_id,
       error_code=$error_code,error_message=$error_message,ambiguous=$ambiguous,lease_owner=$empty,lease_token=$empty,
       lease_expires_at=$empty,updated_at=$updated_at,completed_at=$completed_at
       WHERE run_id=$run_id AND stage=$stage AND attempt=$attempt AND lease_token=$token;`,
      {
        $run_id: TypedValues.utf8(attempt.runId), $stage: TypedValues.utf8(attempt.stage),
        $attempt: TypedValues.uint32(attempt.attempt), $token: TypedValues.utf8(attempt.leaseToken),
        $status: TypedValues.utf8(result.status), $usage: TypedValues.utf8(JSON.stringify(result.usage ?? {})),
        $provider_id: TypedValues.utf8(result.providerRequestId ?? ""),
        $error_code: TypedValues.utf8(sanitizeCode(result.errorCode)),
        $error_message: TypedValues.utf8(sanitizeMessage(result.errorMessage)),
        $ambiguous: TypedValues.bool(Boolean(result.ambiguous)), $updated_at: TypedValues.utf8(now),
        $completed_at: TypedValues.utf8(now), $empty: TypedValues.utf8(""),
      },
    );
  }

  async function loadRequest(requestId) {
    const result = await withSession((session) => session.executeQuery(
      `DECLARE $id AS Utf8;
       SELECT r.prompt,i.content_type,i.image_bytes FROM ${TABLES.requests} AS r
       LEFT JOIN ${TABLES.requestImages} AS i ON r.id=i.request_id WHERE r.id=$id LIMIT 1;`,
      { $id: TypedValues.utf8(requestId) },
    ));
    const row = rows(result)[0];
    if (!row) return null;
    const image = bytes(row, 2);
    return { prompt: text(row, 0), referenceContentType: text(row, 1), referenceImage: image.length ? image : null };
  }

  async function updateRun(runId, input) {
    return transaction(async (execute) => {
      const current = await readRun(execute, runId);
      if (!current || !input.expectedStatuses.includes(current.status)) return false;
      const now = new Date().toISOString();
      await execute(
        `DECLARE $id AS Utf8; DECLARE $status AS Utf8; DECLARE $last_stage AS Utf8;
         DECLARE $failure_code AS Utf8; DECLARE $failure_message AS Utf8; DECLARE $review_json AS Utf8;
         DECLARE $updated_at AS Utf8;
         UPDATE ${TABLES.runs} SET status=$status,last_stage=$last_stage,failure_code=$failure_code,
         failure_message=$failure_message,review_json=$review_json,updated_at=$updated_at WHERE id=$id;`,
        {
          $id: TypedValues.utf8(runId), $status: TypedValues.utf8(input.status),
          $last_stage: TypedValues.utf8(input.lastStage ?? ""),
          $failure_code: TypedValues.utf8(sanitizeCode(input.failureCode)),
          $failure_message: TypedValues.utf8(sanitizeMessage(input.failureMessage)),
          $review_json: TypedValues.utf8(input.review ? JSON.stringify(input.review) : ""),
          $updated_at: TypedValues.utf8(now),
        },
      );
      return true;
    });
  }

  async function putArtifact(input) {
    const digest = sha256(input.buffer);
    const now = new Date().toISOString();
    const chunks = [];
    for (let offset = 0; offset < input.buffer.length; offset += CHUNK_BYTES) {
      chunks.push(input.buffer.subarray(offset, Math.min(input.buffer.length, offset + CHUNK_BYTES)));
    }
    await transaction(async (execute) => {
      const ids = { $run_id: TypedValues.utf8(input.runId), $artifact_key: TypedValues.utf8(input.key) };
      await execute(
        `DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8;
         DELETE FROM ${TABLES.chunks} WHERE run_id=$run_id AND artifact_key=$artifact_key;`, ids,
      );
      await execute(
        `DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8; DECLARE $stage AS Utf8;
         DECLARE $file_name AS Utf8; DECLARE $content_type AS Utf8; DECLARE $byte_size AS Uint64;
         DECLARE $sha256 AS Utf8; DECLARE $created_at AS Utf8; DECLARE $expires_at AS Utf8; DECLARE $retained AS Bool;
         UPSERT INTO ${TABLES.artifacts} (run_id,artifact_key,stage,file_name,content_type,byte_size,sha256,created_at,expires_at,retained)
         VALUES ($run_id,$artifact_key,$stage,$file_name,$content_type,$byte_size,$sha256,$created_at,$expires_at,$retained);`,
        { ...ids, $stage: TypedValues.utf8(input.stage), $file_name: TypedValues.utf8(input.fileName),
          $content_type: TypedValues.utf8(input.contentType), $byte_size: TypedValues.uint64(input.buffer.length),
          $sha256: TypedValues.utf8(digest), $created_at: TypedValues.utf8(now),
          $expires_at: TypedValues.utf8(input.expiresAt), $retained: TypedValues.bool(Boolean(input.retained)) },
      );
      for (let index = 0; index < chunks.length; index += 1) {
        await execute(
          `DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8; DECLARE $chunk_number AS Uint32;
           DECLARE $size_bytes AS Uint32; DECLARE $chunk_bytes AS String;
           UPSERT INTO ${TABLES.chunks} (run_id,artifact_key,chunk_number,size_bytes,chunk_bytes)
           VALUES ($run_id,$artifact_key,$chunk_number,$size_bytes,$chunk_bytes);`,
          { ...ids, $chunk_number: TypedValues.uint32(index), $size_bytes: TypedValues.uint32(chunks[index].length),
            $chunk_bytes: TypedValues.bytes(chunks[index]) },
        );
      }
    });
    return { byteSize: input.buffer.length, sha256: digest };
  }

  async function readArtifact(runId, key) {
    const p = { $run_id: TypedValues.utf8(runId), $artifact_key: TypedValues.utf8(key) };
    const [metadataResult, chunksResult] = await Promise.all([
      withSession((session) => session.executeQuery(
        `DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8;
         SELECT stage,file_name,content_type,byte_size,sha256 FROM ${TABLES.artifacts}
         WHERE run_id=$run_id AND artifact_key=$artifact_key LIMIT 1;`, p)),
      withSession((session) => session.executeQuery(
        `DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8;
         SELECT chunk_bytes FROM ${TABLES.chunks} WHERE run_id=$run_id AND artifact_key=$artifact_key
         ORDER BY chunk_number ASC;`, p)),
    ]);
    const metadata = rows(metadataResult)[0];
    if (!metadata) return null;
    const buffer = Buffer.concat(rows(chunksResult).map((row) => bytes(row, 0)));
    const expectedSize = uint(metadata, 3);
    const expectedSha = text(metadata, 4);
    if (buffer.length !== expectedSize || sha256(buffer) !== expectedSha) throw new Error("Generation artifact integrity check failed.");
    return { stage: text(metadata, 0), fileName: text(metadata, 1), contentType: text(metadata, 2), buffer };
  }

  async function cleanupExpired(now = new Date()) {
    const result = await withSession((session) => session.executeQuery(
      `DECLARE $expires_at AS Utf8; DECLARE $retained AS Bool; DECLARE $completed AS Utf8;
       DECLARE $cancelled AS Utf8; DECLARE $submission_rejected AS Utf8;
       SELECT a.run_id,a.artifact_key FROM ${TABLES.artifacts} AS a
       INNER JOIN ${TABLES.runs} AS r ON a.run_id=r.id
       WHERE a.retained=$retained AND a.expires_at<$expires_at AND
       (r.status=$completed OR r.status=$cancelled OR r.status=$submission_rejected) LIMIT 100;`,
      {
        $expires_at: TypedValues.utf8(now.toISOString()),
        $retained: TypedValues.bool(false),
        $completed: TypedValues.utf8("completed"),
        $cancelled: TypedValues.utf8("cancelled"),
        $submission_rejected: TypedValues.utf8("submission_rejected"),
      },
    ));
    let deleted = 0;
    for (const row of rows(result)) {
      const runId = text(row, 0);
      const p = { $run_id: TypedValues.utf8(runId), $artifact_key: TypedValues.utf8(text(row, 1)) };
      await transaction(async (execute) => {
        await execute(`DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8;
          DELETE FROM ${TABLES.chunks} WHERE run_id=$run_id AND artifact_key=$artifact_key;`, p);
        await execute(`DECLARE $run_id AS Utf8; DECLARE $artifact_key AS Utf8;
          DELETE FROM ${TABLES.artifacts} WHERE run_id=$run_id AND artifact_key=$artifact_key;`, p);
      });
      deleted += 1;
    }
    return deleted;
  }

  async function readRun(execute, runId) {
    const result = await execute(
      `DECLARE $id AS Utf8;
       SELECT id,request_id,status,base_revision,targeted_retry_count,image_call_count,last_stage,updated_at
       FROM ${TABLES.runs} WHERE id=$id LIMIT 1;`,
      { $id: TypedValues.utf8(runId) },
    );
    return rows(result).map(parseRun)[0] ?? null;
  }

  async function readLatestAttempt(execute, runId, stage, requestHash) {
    const result = await execute(
      `DECLARE $run_id AS Utf8; DECLARE $stage AS Utf8; DECLARE $request_hash AS Utf8;
       SELECT ${ATTEMPT_COLUMNS} FROM ${TABLES.attempts}
       WHERE run_id=$run_id AND stage=$stage AND request_hash=$request_hash ORDER BY attempt DESC LIMIT 1;`,
      { $run_id: TypedValues.utf8(runId), $stage: TypedValues.utf8(stage), $request_hash: TypedValues.utf8(requestHash) },
    );
    return rows(result).map(parseAttempt)[0] ?? null;
  }

  async function readLatestStageAttempt(execute, runId, stage) {
    const result = await execute(
      `DECLARE $run_id AS Utf8; DECLARE $stage AS Utf8;
       SELECT ${ATTEMPT_COLUMNS} FROM ${TABLES.attempts}
       WHERE run_id=$run_id AND stage=$stage ORDER BY attempt DESC LIMIT 1;`,
      { $run_id: TypedValues.utf8(runId), $stage: TypedValues.utf8(stage) },
    );
    return rows(result).map(parseAttempt)[0] ?? null;
  }

  return {
    beginProviderAttempt, claimRun, cleanupExpired, findRunnableRun, finishAttempt, heartbeat,
    loadRequest, putArtifact, readArtifact, reconcileProviderSuccess, updateRun,
  };
}

const ATTEMPT_COLUMNS = "run_id,stage,attempt,status,lease_owner,lease_token,lease_expires_at,heartbeat_at,request_hash,model,usage_json,provider_request_id,error_code,error_message,ambiguous,started_at,updated_at,completed_at";
const UPSERT_ATTEMPT = `
  DECLARE $run_id AS Utf8; DECLARE $stage AS Utf8; DECLARE $attempt AS Uint32; DECLARE $status AS Utf8;
  DECLARE $lease_owner AS Utf8; DECLARE $lease_token AS Utf8; DECLARE $lease_expires_at AS Utf8;
  DECLARE $heartbeat_at AS Utf8; DECLARE $request_hash AS Utf8; DECLARE $model AS Utf8;
  DECLARE $usage_json AS Utf8; DECLARE $provider_request_id AS Utf8; DECLARE $error_code AS Utf8;
  DECLARE $error_message AS Utf8; DECLARE $ambiguous AS Bool; DECLARE $started_at AS Utf8;
  DECLARE $updated_at AS Utf8; DECLARE $completed_at AS Utf8;
  UPSERT INTO ${TABLES.attempts} (${ATTEMPT_COLUMNS}) VALUES
  ($run_id,$stage,$attempt,$status,$lease_owner,$lease_token,$lease_expires_at,$heartbeat_at,$request_hash,
   $model,$usage_json,$provider_request_id,$error_code,$error_message,$ambiguous,$started_at,$updated_at,$completed_at);`;

function attemptParams(value, TypedValues) {
  return {
    $run_id: TypedValues.utf8(value.runId), $stage: TypedValues.utf8(value.stage),
    $attempt: TypedValues.uint32(value.attempt), $status: TypedValues.utf8(value.status),
    $lease_owner: TypedValues.utf8(value.leaseOwner), $lease_token: TypedValues.utf8(value.leaseToken),
    $lease_expires_at: TypedValues.utf8(value.leaseExpiresAt), $heartbeat_at: TypedValues.utf8(value.heartbeatAt),
    $request_hash: TypedValues.utf8(value.requestHash), $model: TypedValues.utf8(value.model),
    $usage_json: TypedValues.utf8(value.usageJson), $provider_request_id: TypedValues.utf8(value.providerRequestId),
    $error_code: TypedValues.utf8(value.errorCode), $error_message: TypedValues.utf8(value.errorMessage),
    $ambiguous: TypedValues.bool(value.ambiguous), $started_at: TypedValues.utf8(value.startedAt),
    $updated_at: TypedValues.utf8(value.updatedAt), $completed_at: TypedValues.utf8(value.completedAt),
  };
}

function parseRun(row) {
  return { id: text(row, 0), requestId: text(row, 1), status: text(row, 2), baseRevision: uint(row, 3),
    targetedRetryCount: uint(row, 4), imageCallCount: uint(row, 5), lastStage: text(row, 6), updatedAt: text(row, 7) };
}
function parseAttempt(row) {
  return { runId: text(row, 0), stage: text(row, 1), attempt: uint(row, 2), status: text(row, 3),
    leaseOwner: text(row, 4), leaseToken: text(row, 5), leaseExpiresAt: text(row, 6), heartbeatAt: text(row, 7),
    requestHash: text(row, 8), model: text(row, 9), usageJson: text(row, 10), providerRequestId: text(row, 11),
    errorCode: text(row, 12), errorMessage: text(row, 13), ambiguous: bool(row, 14),
    startedAt: text(row, 15), updatedAt: text(row, 16), completedAt: text(row, 17) };
}
function rows(result) { return result?.resultSets?.[0]?.rows ?? []; }
function text(row, index) { return row.items?.[index]?.textValue ?? ""; }
function uint(row, index) { return Number(row.items?.[index]?.uint32Value ?? row.items?.[index]?.uint64Value ?? 0); }
function bool(row, index) { return Boolean(row.items?.[index]?.boolValue); }
function bytes(row, index) {
  const value = row.items?.[index]?.bytesValue;
  return value ? Buffer.from(value) : Buffer.alloc(0);
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sanitizeCode(value) {
  const text = String(value ?? "");
  return /^[a-zA-Z0-9_.-]{1,120}$/.test(text) ? text : text ? "generation_error" : "";
}
function sanitizeMessage(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/(?:sk|sess|key)-[a-zA-Z0-9_-]{12,}/g, "[redacted]").slice(0, 500);
}

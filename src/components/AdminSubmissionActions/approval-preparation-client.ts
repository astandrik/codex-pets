export type ApprovalStatus = "queued" | "preparing" | "retry" | "manual_review" | "succeeded";
export type ApprovalSnapshot = {
  preparationId: string | null;
  status: ApprovalStatus;
  failureCode: string | null;
  attempts: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  nextAttemptAt: string | null;
  leaseUntil: string | null;
};
export type ApprovalPreparationPollResult =
  | { status: "succeeded" | "failed" | "timeout" | "cancelled" }
  | { status: "manual_review"; failureCode: string | null };
export type ApprovalPollUpdate = { connection: "connected"; snapshot: ApprovalSnapshot; checkedAt: number }
  | { connection: "lost" };

type PollOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
  onUpdate?: (update: ApprovalPollUpdate) => void;
};
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const STATUSES = new Set<string>(["queued", "preparing", "retry", "manual_review", "succeeded"]);
function timestamp(value: unknown): string | null {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null;
}
export function parseApprovalSnapshot(value: unknown): ApprovalSnapshot | null {
  if (!value || typeof value !== "object" || !("status" in value) ||
      typeof value.status !== "string" || !STATUSES.has(value.status)) return null;
  const row = value as Record<string, unknown>;
  return {
    preparationId: typeof row.preparationId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(row.preparationId) ? row.preparationId : null,
    status: value.status as ApprovalStatus,
    failureCode: typeof row.failureCode === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(row.failureCode) ? row.failureCode : null,
    attempts: typeof row.attempts === "number" && Number.isSafeInteger(row.attempts) && row.attempts >= 0 ? row.attempts : null,
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    nextAttemptAt: timestamp(row.nextAttemptAt), leaseUntil: timestamp(row.leaseUntil),
  };
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", done, { once: true });
    if (signal?.aborted) done();
  });
}

export async function pollApprovalPreparation(url: string, options: PollOptions = {}): Promise<ApprovalPreparationPollResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? 150;
  const deadline = Date.now() + (options.maxDurationMs ?? 300_000);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.signal?.aborted) return { status: "cancelled" };
    if (Date.now() >= deadline) break;
    if (attempt > 0) await (options.sleep ? options.sleep(2_000) : pause(Math.min(2_000, deadline - Date.now()), options.signal));
    if (options.signal?.aborted) return { status: "cancelled" };
    if (Date.now() >= deadline) break;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, Math.min(options.requestTimeoutMs ?? 10_000, deadline - Date.now()));
    let response: Response;
    let snapshot: ApprovalSnapshot | null = null;
    try {
      response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
      if (response.ok) snapshot = parseApprovalSnapshot(await response.json());
    } catch (error) {
      if (error instanceof SyntaxError) return { status: "failed" };
      if (options.signal?.aborted) return { status: "cancelled" };
      options.onUpdate?.({ connection: "lost" }); continue;
    } finally {
      clearTimeout(timeout); options.signal?.removeEventListener("abort", abort);
    }
    if (options.signal?.aborted) return { status: "cancelled" };
    if (!response.ok) {
      if (RETRYABLE_STATUSES.has(response.status)) { options.onUpdate?.({ connection: "lost" }); continue; }
      return { status: "failed" };
    }
    if (options.signal?.aborted) return { status: "cancelled" };
    if (!snapshot) return { status: "failed" };
    options.onUpdate?.({ connection: "connected", snapshot, checkedAt: Date.now() });
    if (snapshot.status === "succeeded") return { status: "succeeded" };
    if (snapshot.status === "manual_review") return { status: "manual_review", failureCode: snapshot.failureCode };
  }
  return { status: "timeout" };
}

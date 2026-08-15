export type ApprovalPreparationPollResult =
  | "succeeded"
  | "manual_review"
  | "failed"
  | "timeout";

type PollOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
};

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export async function pollApprovalPreparation(
  url: string,
  options: PollOptions = {},
): Promise<ApprovalPreparationPollResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = options.maxAttempts ?? 150;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(2_000);
    let response: Response;
    try {
      response = await fetchImpl(url, { cache: "no-store" });
    } catch {
      continue;
    }
    if (!response.ok) {
      if (RETRYABLE_STATUSES.has(response.status)) continue;
      return "failed";
    }

    let payload: { status?: unknown };
    try {
      payload = await response.json() as { status?: unknown };
    } catch {
      return "failed";
    }
    if (payload.status === "succeeded") return "succeeded";
    if (payload.status === "manual_review") return "manual_review";
    if (
      payload.status !== "queued" &&
      payload.status !== "preparing" &&
      payload.status !== "retry"
    ) {
      return "failed";
    }
  }
  return "timeout";
}

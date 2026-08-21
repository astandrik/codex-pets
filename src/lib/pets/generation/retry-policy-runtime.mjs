export function providerFailureDecision(failure, retryNumber) {
  if (!failure.responseReceived) return { kind: "fail", ambiguous: true };
  const retryable = failure.status === 408 || failure.status === 429 ||
    (failure.status !== null && failure.status >= 500);
  if (!retryable || retryNumber >= 2) return { kind: "fail", ambiguous: false };
  return { kind: "retry", delayMs: 1_000 * 2 ** retryNumber };
}

export function assertImageCallBudget(current, maximum) {
  if (current >= maximum) throw new Error("Image-generation call budget exhausted.");
}

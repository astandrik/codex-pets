export type ProviderFailure = { status: number | null; responseReceived: boolean };
export type ProviderFailureDecision =
  | { kind: "retry"; delayMs: number }
  | { kind: "fail"; ambiguous: boolean };
export function providerFailureDecision(failure: ProviderFailure, retryNumber: number): ProviderFailureDecision;
export function assertImageCallBudget(current: number, maximum: number): void;

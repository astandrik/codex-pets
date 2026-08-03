export function claimHoldoutRun(
  markerPath: string,
  now?: () => Date,
): Promise<void>;
export function completeHoldoutRun(
  markerPath: string,
  status: "passed" | "failed",
): Promise<void>;

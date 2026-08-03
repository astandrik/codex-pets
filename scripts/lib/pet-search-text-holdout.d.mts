export function readTextHoldoutEnvironment(environment: Record<string, string | undefined>): {
  markerPath: string;
  rolloutId: string;
};
export function claimTextHoldoutRun(
  markerPath: string,
  rolloutId: string,
  now?: () => Date,
): Promise<void>;
export function completeTextHoldoutRun(
  markerPath: string,
  rolloutId: string,
  status: "passed" | "failed",
): Promise<void>;

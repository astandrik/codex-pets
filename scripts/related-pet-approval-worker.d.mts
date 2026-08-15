export type ApprovalWorkerIterationStatus =
  | "idle"
  | "succeeded"
  | "retry"
  | "manual_review";

export function runApprovalWorkerLoop(options: {
  once: boolean;
  workerId: string;
  runOnce: (workerId: string) => Promise<ApprovalWorkerIterationStatus>;
  sleep?: (milliseconds: number) => Promise<void>;
  write?: (line: string) => void;
  writeError?: (line: string) => void;
}): Promise<number>;

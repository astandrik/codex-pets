export type ApprovalWorkerIterationStatus =
  | "idle"
  | "in_progress"
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

export function createApprovalWorkerId(input: {
  hostname?: string;
  pid: number;
  randomId: string;
}): string;

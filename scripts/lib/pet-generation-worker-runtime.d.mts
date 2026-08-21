export class GenerationWorkerError extends Error {
  code: string;
  ambiguous: boolean;
  busy: boolean;
}
export function createGenerationWorkerRuntime(input: {
  repository: Record<string, unknown>;
  provider: Record<string, unknown>;
  config: { model: string; reviewModel: string; artifactRetentionDays: number; leaseSeconds: number };
  workerId: string;
  sleep?: (ms: number) => Promise<void>;
  log?: (value: Record<string, unknown>) => void;
}): { processNextRun(): Promise<boolean> };
export function resolveImageArtifactKeys(
  stage: string,
  run: { baseRevision: number; targetedRetryCount: number; lastStage?: string | null },
): { key: string; alias: string };

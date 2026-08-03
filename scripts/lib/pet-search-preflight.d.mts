export type ManagedSearchPreflightResult = {
  modelsApi: true;
  qwenAvailable: true;
  embeddingsV2: true;
  embeddingDimensions: 768;
  deepSeekEligible: boolean;
  deepSeekExclusionReason:
    | "model_unavailable"
    | "structured_output_invalid"
    | "structured_output_unsupported"
    | null;
};

export class ManagedSearchPreflightError extends Error {
  reason: string;
  httpStatus: number | null;
  role: "doc" | "query" | null;
}

export function runManagedSearchPreflight(input: {
  folderId: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ManagedSearchPreflightResult>;

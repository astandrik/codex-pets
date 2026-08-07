import type { PetVisionPipeline } from "./search-vision-pipelines.mjs";

export type VisionCaptionFailureReason =
  | "authentication_error"
  | "content_filtered"
  | "invalid_request"
  | "invalid_response"
  | "malformed_json"
  | "output_limit"
  | "provider_error"
  | "rate_limited"
  | "refused"
  | "schema_invalid"
  | "timeout";

export type VisionCaptionDiagnostic = {
  api: "responses";
  stage: string;
  attempt: number;
  httpStatus?: number;
  status?: string;
  reason?: VisionCaptionFailureReason;
  incompleteReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  clientRequestId: string;
  requestId?: string;
  serverTraceId?: string;
};

export class VisionCaptionRequestError extends Error {
  readonly reason: VisionCaptionFailureReason;
  readonly diagnostics: Partial<VisionCaptionDiagnostic>;
  constructor(
    reason: VisionCaptionFailureReason,
    diagnostics?: Partial<VisionCaptionDiagnostic>,
    options?: ErrorOptions,
  );
}

type VisionFrame = {
  state: string;
  row: number;
  frame: number;
  dataUrl: string;
};

export function createResponsesVisionRequest(input: {
  modelUri: string;
  pipeline: PetVisionPipeline;
  frames: readonly VisionFrame[];
  maxOutputTokens: number;
}): Record<string, unknown>;

export function classifyResponsesPayload<T>(
  payload: unknown,
  parseCaption: (value: unknown) => T,
):
  | { kind: "success"; caption: T; usage: Record<string, number | undefined> }
  | {
      kind: "failure";
      reason: VisionCaptionFailureReason;
      retryable: boolean;
      stage: string;
      incompleteReason?: string | null;
      usage?: Record<string, number | undefined>;
    };

export function createResponsesVisionCaptionRequester<T>(options: {
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  pipeline: PetVisionPipeline;
  parseCaption: (value: unknown) => T;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  reserveStart?: () => Promise<void>;
  onDiagnostic?: (diagnostic: VisionCaptionDiagnostic) => void;
}): (frames: readonly VisionFrame[]) => Promise<T>;

export const RESPONSES_VISION_ENDPOINT: string;

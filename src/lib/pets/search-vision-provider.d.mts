import type { PetVisionCaption } from "./search-vision-contract";
import type { PetVisionFrame } from "./search-vision-frames";

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
  reason?: VisionCaptionFailureReason;
  status?: string;
  httpStatus?: number;
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
  );
}

export const RESPONSES_VISION_ENDPOINT: string;

export function createResponsesVisionRequest(input: {
  modelUri: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchemaName: string;
  responseJsonSchema: object;
  frames: readonly PetVisionFrame[];
  maxOutputTokens: number;
}): object;

export function classifyResponsesPayload<T>(
  payload: unknown,
  parseCaption: (value: unknown) => T,
):
  | { kind: "success"; caption: T; usage: object }
  | {
      kind: "failure";
      reason: VisionCaptionFailureReason;
      retryable: boolean;
      stage: string;
      incompleteReason?: string;
      usage?: object;
    };

export function createResponsesVisionCaptionRequester<
  T = PetVisionCaption,
>(options: {
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  systemPrompt: string;
  userPrompt: string;
  responseSchemaName: string;
  responseJsonSchema: object;
  expectedFrames: readonly Omit<PetVisionFrame, "png" | "dataUrl">[];
  parseCaption: (value: unknown) => T;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  reserveStart?: () => Promise<void>;
  onDiagnostic?: (diagnostic: VisionCaptionDiagnostic) => void;
}): (frames: readonly PetVisionFrame[]) => Promise<T>;

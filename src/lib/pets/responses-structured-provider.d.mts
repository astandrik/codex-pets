export type StructuredResponseFailureReason =
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

export type StructuredResponseDiagnostic = {
  api: "responses";
  stage: string;
  attempt: number;
  reason?: StructuredResponseFailureReason;
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

export class StructuredResponseRequestError extends Error {
  readonly reason: StructuredResponseFailureReason;
  readonly diagnostics: Partial<StructuredResponseDiagnostic>;
  constructor(
    reason: StructuredResponseFailureReason,
    diagnostics?: Partial<StructuredResponseDiagnostic>,
  );
}

export const RESPONSES_ENDPOINT: string;

export function createResponsesStructuredRequest<T>(input: {
  modelUri: string;
  systemPrompt: string;
  content: readonly object[];
  responseSchemaName: string;
  responseJsonSchema: object;
  parseValue: (value: unknown) => T;
  maxOutputTokens: number;
  reasoning?: object;
}): object;

export function createResponsesStructuredRequester<Input, Output>(options: {
  endpoint?: string;
  folderId: string;
  apiKey: string;
  modelUri: string;
  timeoutMs: number;
  systemPrompt: string;
  responseSchemaName: string;
  responseJsonSchema: object;
  buildContent: (input: Input) => readonly object[];
  validateInput?: (input: Input) => void;
  parseValue: (value: unknown) => Output;
  reasoning?: object;
  initialMaxOutputTokens?: number;
  retryMaxOutputTokens?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  randomUUID?: () => string;
  reserveStart?: () => Promise<void>;
  onDiagnostic?: (diagnostic: StructuredResponseDiagnostic) => void;
}): (input: Input) => Promise<Output>;

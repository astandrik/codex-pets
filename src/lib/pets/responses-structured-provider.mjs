import { randomUUID } from "node:crypto";

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  OpenAIError,
} from "openai";
import { standardTextFormat } from "openai/helpers/standard-schema";

export const RESPONSES_ENDPOINT =
  "https://ai.api.cloud.yandex.net/v1/responses";

const INITIAL_MAX_OUTPUT_TOKENS = 8_000;
const RETRY_MAX_OUTPUT_TOKENS = 16_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 60_000;

export class StructuredResponseRequestError extends Error {
  constructor(reason, diagnostics = {}) {
    super("Structured response provider request failed.");
    this.name = "StructuredResponseRequestError";
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

export function createResponsesStructuredRequest(input) {
  const format = standardTextFormat(
    standardSchemaFor(input.parseValue),
    input.responseSchemaName,
    { schema: input.responseJsonSchema },
  );
  if (
    JSON.stringify(format.schema) !== JSON.stringify(input.responseJsonSchema)
  ) {
    throw new Error("The SDK changed the immutable structured-output schema.");
  }

  return {
    model: input.modelUri,
    instructions: input.systemPrompt,
    input: [
      {
        role: "user",
        content: input.content,
      },
    ],
    temperature: 0,
    max_output_tokens: input.maxOutputTokens,
    store: false,
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    text: { format },
  };
}

export function createResponsesStructuredRequester(options) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  const createRequestId = options.randomUUID ?? randomUUID;
  const reserveStart = options.reserveStart ?? (() => Promise.resolve());
  const onDiagnostic = options.onDiagnostic ?? (() => undefined);
  const initialMaxOutputTokens =
    options.initialMaxOutputTokens ?? INITIAL_MAX_OUTPUT_TOKENS;
  const retryMaxOutputTokens =
    options.retryMaxOutputTokens ?? RETRY_MAX_OUTPUT_TOKENS;

  if (
    initialMaxOutputTokens <= 0 ||
    retryMaxOutputTokens < initialMaxOutputTokens
  ) {
    throw new Error("Structured response token limits are invalid.");
  }

  return async function requestStructured(input) {
    options.validateInput?.(input);
    let maxOutputTokens = initialMaxOutputTokens;
    let structuredOutputRetryUsed = false;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await reserveStart();
      const clientRequestId = createRequestId();
      const outcome = await requestOnce({
        ...options,
        now,
        content: options.buildContent(input),
        attempt,
        clientRequestId,
        maxOutputTokens,
      });

      if (outcome.kind === "success") {
        onDiagnostic({
          ...outcome.diagnostics,
          stage: "complete",
          status: "completed",
          ...outcome.usage,
        });
        return outcome.value;
      }

      const diagnostics = {
        ...outcome.diagnostics,
        stage: outcome.stage,
        reason: outcome.reason,
        incompleteReason: outcome.incompleteReason ?? undefined,
        ...outcome.usage,
      };
      onDiagnostic(diagnostics);
      lastError = new StructuredResponseRequestError(
        outcome.reason,
        diagnostics,
      );
      if (!outcome.retryable || attempt >= MAX_ATTEMPTS) throw lastError;

      if (outcome.reason === "output_limit") {
        if (maxOutputTokens >= retryMaxOutputTokens) throw lastError;
        maxOutputTokens = retryMaxOutputTokens;
      } else if (
        outcome.reason === "malformed_json" ||
        outcome.reason === "schema_invalid"
      ) {
        if (structuredOutputRetryUsed) throw lastError;
        structuredOutputRetryUsed = true;
      }
      await sleep(outcome.retryDelayMs || backoffMs(attempt));
    }

    throw lastError ?? new StructuredResponseRequestError("provider_error");
  };
}

async function requestOnce(input) {
  const responseMetadata = {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const client = createClient(input, responseMetadata);
  try {
    const request = createResponsesStructuredRequest({
      ...input,
      maxOutputTokens: input.maxOutputTokens,
    });
    const { data, response, request_id: requestId } = await client.responses
      .parse(request, {
        headers: { "x-client-request-id": input.clientRequestId },
        maxRetries: 0,
        signal: controller.signal,
        timeout: input.timeoutMs,
      })
      .withResponse();

    Object.assign(responseMetadata, metadataFromResponse(response, requestId));
    return classifyParsedResponse(data, {
      ...baseDiagnostics(input),
      ...responseMetadata,
    });
  } catch (error) {
    return classifySdkError(
      error,
      { ...input, requestAborted: controller.signal.aborted },
      responseMetadata,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function createClient(input, responseMetadata) {
  const fetchImpl = input.fetchImpl ?? fetch;
  return new OpenAI({
    apiKey: input.apiKey,
    baseURL: responsesBaseUrl(input.endpoint ?? RESPONSES_ENDPOINT),
    defaultHeaders: { Authorization: `Api-Key ${input.apiKey}` },
    fetch: async (url, init) => {
      const response = await fetchImpl(url, init);
      Object.assign(responseMetadata, metadataFromResponse(response));
      if (!response.ok) {
        await cancelResponseBody(response);
        return new Response(null, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        });
      }
      return response;
    },
    logLevel: "off",
    maxRetries: 0,
    project: input.folderId,
    timeout: input.timeoutMs,
  });
}

function classifyParsedResponse(payload, diagnostics) {
  const usage = safeUsage(payload?.usage);
  if (!isObject(payload)) {
    return failure("invalid_response", true, "response_envelope", {
      diagnostics,
    });
  }

  if (isObject(payload.error)) {
    return failure(
      stringValue(payload.error.code) === "content_filter"
        ? "content_filtered"
        : "provider_error",
      false,
      "response_status",
      { diagnostics, usage },
    );
  }

  if (payload.status === "incomplete") {
    const incompleteReason = isObject(payload.incomplete_details)
      ? stringValue(payload.incomplete_details.reason)
      : null;
    if (incompleteReason === "max_output_tokens") {
      return failure("output_limit", true, "response_status", {
        diagnostics,
        incompleteReason,
        usage,
      });
    }
    if (incompleteReason === "content_filter") {
      return failure("content_filtered", false, "response_status", {
        diagnostics,
        incompleteReason,
        usage,
      });
    }
    return failure("invalid_response", false, "response_status", {
      diagnostics,
      incompleteReason,
      usage,
    });
  }

  if (payload.status !== "completed" || !Array.isArray(payload.output)) {
    return failure(
      payload.status === "failed" ? "provider_error" : "invalid_response",
      false,
      "response_status",
      { diagnostics, usage },
    );
  }

  if (containsRefusal(payload.output)) {
    return failure("refused", false, "response_content", {
      diagnostics,
      usage,
    });
  }
  if (payload.output_parsed === null || payload.output_parsed === undefined) {
    return failure("invalid_response", true, "response_content", {
      diagnostics,
      usage,
    });
  }
  return {
    kind: "success",
    value: payload.output_parsed,
    diagnostics,
    usage,
  };
}

function classifySdkError(error, input, responseMetadata) {
  const diagnostics = {
    ...baseDiagnostics(input),
    ...responseMetadata,
  };
  if (error instanceof APIConnectionTimeoutError || input.requestAborted) {
    return failure("timeout", true, "network", { diagnostics });
  }
  if (error instanceof APIConnectionError) {
    return failure("provider_error", true, "network", { diagnostics });
  }
  if (error instanceof APIError) {
    const status = error.status;
    const apiDiagnostics = {
      ...diagnostics,
      httpStatus: status ?? diagnostics.httpStatus,
      requestId: error.requestID ?? diagnostics.requestId,
    };
    const contentFiltered = error.code === "content_filter";
    return failure(
      contentFiltered ? "content_filtered" : httpFailureReason(status),
      !contentFiltered && (status === 429 || (status ?? 0) >= 500),
      "http",
      {
        diagnostics: apiDiagnostics,
        retryDelayMs: retryAfterMs(
          error.headers?.get("Retry-After") ?? null,
          input.now(),
        ),
      },
    );
  }
  if (error instanceof SyntaxError) {
    return failure("malformed_json", true, "structured_json", {
      diagnostics,
    });
  }
  if (
    error instanceof OpenAIError &&
    error.message.startsWith("Standard Schema validation failed:")
  ) {
    return failure("schema_invalid", true, "structured_schema", {
      diagnostics,
    });
  }
  return failure("invalid_response", true, "response_envelope", {
    diagnostics,
  });
}

function standardSchemaFor(parseValue) {
  return {
    "~standard": {
      version: 1,
      vendor: "codex-pets",
      validate(value) {
        try {
          return { value: parseValue(value) };
        } catch {
          return {
            issues: [
              { message: "Structured output did not match the expected schema." },
            ],
          };
        }
      },
    },
  };
}

function containsRefusal(output) {
  return output.some(
    (item) =>
      isObject(item) &&
      item.type === "message" &&
      Array.isArray(item.content) &&
      item.content.some(
        (content) =>
          isObject(content) &&
          (content.type === "refusal" || typeof content.refusal === "string"),
      ),
  );
}

function metadataFromResponse(response, requestId) {
  return {
    stage: "http",
    httpStatus: response.status,
    requestId:
      requestId ?? response.headers.get("x-request-id") ?? undefined,
    serverTraceId:
      response.headers.get("x-server-trace-id") ?? undefined,
  };
}

function responsesBaseUrl(endpoint) {
  if (!endpoint.endsWith("/responses")) {
    throw new Error("Responses endpoint must end with /responses.");
  }
  return endpoint.slice(0, -"/responses".length);
}

function baseDiagnostics(input) {
  return {
    api: "responses",
    stage: "network",
    attempt: input.attempt,
    clientRequestId: input.clientRequestId,
  };
}

function failure(reason, retryable, stage, extra = {}) {
  return { kind: "failure", reason, retryable, stage, ...extra };
}

function safeUsage(input) {
  if (!isObject(input)) return {};
  const outputDetails = isObject(input.output_tokens_details)
    ? input.output_tokens_details
    : {};
  return {
    inputTokens: finiteNumber(input.input_tokens),
    outputTokens: finiteNumber(input.output_tokens),
    reasoningTokens: finiteNumber(outputDetails.reasoning_tokens),
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value ? value : null;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function httpFailureReason(status) {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 429) return "rate_limited";
  if (status && status >= 400 && status < 500) return "invalid_request";
  return "provider_error";
}

function retryAfterMs(value, timestamp) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 0;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - timestamp));
}

function backoffMs(attempt) {
  return Math.min(10_000, 1_000 * 2 ** (attempt - 1));
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The SDK only needs status and headers to classify this failed request.
  }
}

function sleepFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

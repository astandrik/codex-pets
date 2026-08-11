import { randomUUID } from "node:crypto";

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
    text: {
      format: {
        type: "json_schema",
        name: input.responseSchemaName,
        strict: true,
        schema: input.responseJsonSchema,
      },
    },
  };
}

export function classifyResponsesPayload(payload, parseValue) {
  if (!isObject(payload)) {
    return failure("invalid_response", true, "response_envelope");
  }

  const usage = safeUsage(payload.usage);
  if (isObject(payload.error)) {
    return failure(
      stringValue(payload.error.code) === "content_filter"
        ? "content_filtered"
        : "provider_error",
      false,
      "response_status",
      { usage },
    );
  }

  if (payload.status === "incomplete") {
    const incompleteReason = isObject(payload.incomplete_details)
      ? stringValue(payload.incomplete_details.reason)
      : null;
    if (incompleteReason === "max_output_tokens") {
      return failure("output_limit", true, "response_status", {
        incompleteReason,
        usage,
      });
    }
    if (incompleteReason === "content_filter") {
      return failure("content_filtered", false, "response_status", {
        incompleteReason,
        usage,
      });
    }
    return failure("invalid_response", false, "response_status", {
      incompleteReason,
      usage,
    });
  }

  if (payload.status !== "completed" || !Array.isArray(payload.output)) {
    return failure(
      payload.status === "failed" ? "provider_error" : "invalid_response",
      false,
      "response_status",
      { usage },
    );
  }

  const texts = [];
  for (const outputItem of payload.output) {
    if (!isObject(outputItem) || outputItem.type !== "message") continue;
    if (!Array.isArray(outputItem.content)) continue;
    for (const contentItem of outputItem.content) {
      if (!isObject(contentItem)) continue;
      if (
        contentItem.type === "refusal" ||
        typeof contentItem.refusal === "string"
      ) {
        return failure("refused", false, "response_content", { usage });
      }
      if (
        contentItem.type === "output_text" &&
        typeof contentItem.text === "string" &&
        contentItem.text.trim()
      ) {
        texts.push(contentItem.text);
      }
    }
  }
  if (texts.length === 0) {
    return failure("invalid_response", true, "response_content", { usage });
  }

  let parsed;
  try {
    parsed = JSON.parse(texts.join("\n"));
  } catch {
    return failure("malformed_json", true, "structured_json", { usage });
  }

  try {
    return { kind: "success", value: parseValue(parsed), usage };
  } catch {
    return failure("schema_invalid", true, "structured_schema", { usage });
  }
}

export function createResponsesStructuredRequester(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  const createRequestId = options.randomUUID ?? randomUUID;
  const reserveStart = options.reserveStart ?? (() => Promise.resolve());
  const onDiagnostic = options.onDiagnostic ?? (() => undefined);

  return async function requestStructured(input) {
    options.validateInput?.(input);
    let maxOutputTokens = INITIAL_MAX_OUTPUT_TOKENS;
    let structuredOutputRetryUsed = false;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await reserveStart();
      const clientRequestId = createRequestId();
      const outcome = await requestOnce({
        ...options,
        fetchImpl,
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
        if (maxOutputTokens >= RETRY_MAX_OUTPUT_TOKENS) throw lastError;
        maxOutputTokens = RETRY_MAX_OUTPUT_TOKENS;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    let response;
    try {
      response = await input.fetchImpl(input.endpoint ?? RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${input.apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Project": input.folderId,
          "x-client-request-id": input.clientRequestId,
        },
        body: JSON.stringify(
          createResponsesStructuredRequest({
            ...input,
            maxOutputTokens: input.maxOutputTokens,
          }),
        ),
        signal: controller.signal,
      });
    } catch {
      return failure(
        controller.signal.aborted ? "timeout" : "provider_error",
        true,
        "network",
        { diagnostics: baseDiagnostics(input) },
      );
    }

    const diagnostics = {
      ...baseDiagnostics(input),
      stage: "http",
      httpStatus: response.status,
      requestId: response.headers.get("x-request-id") ?? undefined,
      serverTraceId:
        response.headers.get("x-server-trace-id") ?? undefined,
    };
    if (!response.ok) {
      await cancelResponseBody(response);
      return failure(
        httpFailureReason(response.status),
        response.status === 429 || response.status >= 500,
        "http",
        {
          diagnostics,
          retryDelayMs: retryAfterMs(
            response.headers.get("Retry-After"),
            input.now(),
          ),
        },
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return failure(
        controller.signal.aborted ? "timeout" : "malformed_json",
        true,
        controller.signal.aborted ? "network" : "response_envelope",
        { diagnostics },
      );
    }
    if (controller.signal.aborted) {
      return failure("timeout", true, "network", { diagnostics });
    }

    const outcome = classifyResponsesPayload(payload, input.parseValue);
    return {
      ...outcome,
      diagnostics: {
        ...diagnostics,
        status: stringValue(payload?.status) ?? undefined,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
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
  if (status >= 400 && status < 500) return "invalid_request";
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
    // Best-effort cleanup after the provider outcome is known.
  }
}

function sleepFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

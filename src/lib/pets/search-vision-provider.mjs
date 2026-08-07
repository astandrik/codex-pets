import { randomUUID } from "node:crypto";

export const RESPONSES_VISION_ENDPOINT =
  "https://ai.api.cloud.yandex.net/v1/responses";

const MAX_RETRY_AFTER_MS = 60_000;

export class VisionCaptionRequestError extends Error {
  constructor(reason, diagnostics = {}, options) {
    super("Vision caption provider request failed.", options);
    this.name = "VisionCaptionRequestError";
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

export function createResponsesVisionRequest(input) {
  return {
    model: input.modelUri,
    instructions: input.pipeline.systemPrompt,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: input.pipeline.userPrompt },
          ...input.frames.map((frame) => ({
            type: "input_image",
            image_url: frame.dataUrl,
          })),
        ],
      },
    ],
    temperature: 0,
    max_output_tokens: input.maxOutputTokens,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: input.pipeline.responseSchemaName,
        strict: true,
        schema: input.pipeline.responseJsonSchema,
      },
    },
  };
}

export function classifyResponsesPayload(payload, parseCaption) {
  if (!isObject(payload)) {
    return failure("invalid_response", true, "response_envelope");
  }

  const usage = safeUsage(payload.usage);
  if (isObject(payload.error)) {
    const code = stringValue(payload.error.code);
    if (code === "content_filter") {
      return failure("content_filtered", false, "response_status", { usage });
    }
    return failure("provider_error", false, "response_status", { usage });
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
    return failure("malformed_json", true, "caption_json", { usage });
  }

  try {
    return { kind: "success", caption: parseCaption(parsed), usage };
  } catch {
    return failure("schema_invalid", true, "caption_schema", { usage });
  }
}

export function createResponsesVisionCaptionRequester(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  const createRequestId = options.randomUUID ?? randomUUID;
  const reserveStart = options.reserveStart ?? (() => Promise.resolve());
  const onDiagnostic = options.onDiagnostic ?? (() => undefined);

  return async function requestCaption(frames) {
    validateFrames(frames, options.pipeline.framePolicy.frames);
    let maxOutputTokens = options.pipeline.tokenPolicy.initial;
    let structuredOutputRetryUsed = false;
    let lastError = null;

    for (
      let attempt = 1;
      attempt <= options.pipeline.tokenPolicy.maxAttempts;
      attempt += 1
    ) {
      await reserveStart();
      const clientRequestId = createRequestId();
      const request = createResponsesVisionRequest({
        modelUri: options.modelUri,
        pipeline: options.pipeline,
        frames,
        maxOutputTokens,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      let response;
      try {
        response = await fetchImpl(RESPONSES_VISION_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Api-Key ${options.apiKey}`,
            "Content-Type": "application/json",
            "OpenAI-Project": options.folderId,
            "x-client-request-id": clientRequestId,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (cause) {
        const reason = controller.signal.aborted ? "timeout" : "provider_error";
        const diagnostics = {
          api: "responses",
          stage: "network",
          attempt,
          reason,
          clientRequestId,
        };
        onDiagnostic(diagnostics);
        lastError = new VisionCaptionRequestError(reason, diagnostics, { cause });
        clearTimeout(timeout);
        if (attempt < options.pipeline.tokenPolicy.maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }
      clearTimeout(timeout);

      const baseDiagnostics = {
        api: "responses",
        stage: "http",
        attempt,
        httpStatus: response.status,
        clientRequestId,
        requestId: response.headers.get("x-request-id") ?? undefined,
        serverTraceId:
          response.headers.get("x-server-trace-id") ?? undefined,
      };

      if (!response.ok) {
        const reason = httpFailureReason(response.status);
        const diagnostics = { ...baseDiagnostics, reason };
        onDiagnostic(diagnostics);
        lastError = new VisionCaptionRequestError(reason, diagnostics);
        if (
          attempt < options.pipeline.tokenPolicy.maxAttempts &&
          (response.status === 429 || response.status >= 500)
        ) {
          await cancelResponseBody(response);
          const retryDelay = retryAfterMs(
            response.headers.get("Retry-After"),
            now(),
          );
          await sleep(retryDelay || backoffMs(attempt));
          continue;
        }
        await cancelResponseBody(response);
        throw lastError;
      }

      let payload;
      try {
        payload = await response.json();
      } catch (cause) {
        const diagnostics = {
          ...baseDiagnostics,
          stage: "response_envelope",
          reason: "invalid_response",
        };
        onDiagnostic(diagnostics);
        lastError = new VisionCaptionRequestError(
          "invalid_response",
          diagnostics,
          { cause },
        );
        if (attempt < options.pipeline.tokenPolicy.maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      const outcome = classifyResponsesPayload(payload, options.parseCaption);
      if (outcome.kind === "success") {
        onDiagnostic({
          ...baseDiagnostics,
          stage: "complete",
          status: "completed",
          ...outcome.usage,
        });
        return outcome.caption;
      }

      const diagnostics = {
        ...baseDiagnostics,
        stage: outcome.stage,
        status: stringValue(payload?.status) ?? undefined,
        reason: outcome.reason,
        incompleteReason: outcome.incompleteReason ?? undefined,
        ...outcome.usage,
      };
      onDiagnostic(diagnostics);
      lastError = new VisionCaptionRequestError(outcome.reason, diagnostics);
      if (!outcome.retryable || attempt >= options.pipeline.tokenPolicy.maxAttempts) {
        throw lastError;
      }
      if (outcome.reason === "output_limit") {
        const retryLimit = options.pipeline.tokenPolicy.retry;
        if (!retryLimit || maxOutputTokens >= retryLimit) throw lastError;
        maxOutputTokens = retryLimit;
      } else if (
        outcome.reason === "malformed_json" ||
        outcome.reason === "schema_invalid"
      ) {
        if (structuredOutputRetryUsed) throw lastError;
        structuredOutputRetryUsed = true;
      }
      await sleep(backoffMs(attempt));
    }

    throw lastError ?? new VisionCaptionRequestError("provider_error");
  };
}

function validateFrames(frames, expectedFrames) {
  if (!Array.isArray(frames) || frames.length !== expectedFrames.length) {
    throw new VisionCaptionRequestError("invalid_request");
  }
  const valid = expectedFrames.every((expected, index) => {
    const actual = frames[index];
    return (
      actual?.state === expected.state &&
      actual.row === expected.row &&
      actual.frame === expected.frame &&
      typeof actual.dataUrl === "string" &&
      actual.dataUrl.startsWith("data:image/png;base64,")
    );
  });
  if (!valid) throw new VisionCaptionRequestError("invalid_request");
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
    // Best-effort resource cleanup; the provider outcome is already known.
  }
}

function sleepFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

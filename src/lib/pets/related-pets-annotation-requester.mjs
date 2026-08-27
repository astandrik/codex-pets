import { randomUUID } from "node:crypto";

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  OpenAIError,
} from "openai";
import {
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from "openai/core/error";
import { standardResponseFormat } from "openai/helpers/standard-schema";

import {
  RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
  RELATED_PETS_ANNOTATION_SCHEMA_NAME,
  RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
  RELATED_PETS_ANNOTATION_TOKEN_POLICY,
  RELATED_PETS_ANNOTATION_USER_PROMPT,
  buildRelatedPetAnnotationInput,
  parseRelatedPetAnnotationProposal,
} from "./related-pets-annotation-contract.mjs";

const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 60_000;

export class AnnotationRequestError extends Error {
  constructor(reason, diagnostics) {
    super("Structured annotation request failed.");
    this.name = "AnnotationRequestError";
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

export function createAnnotationRequester(options) {
  const format = standardResponseFormat({
    "~standard": {
      version: 1,
      vendor: "codex-pets",
      validate(value) {
        try {
          return { value: parseRelatedPetAnnotationProposal(value) };
        } catch {
          return { issues: [{ message: "Invalid annotation proposal." }] };
        }
      },
    },
  }, RELATED_PETS_ANNOTATION_SCHEMA_NAME, {
    schema: RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
  });
  if (JSON.stringify(format.json_schema.schema) !==
    JSON.stringify(RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA)) {
    throw new Error("The SDK changed the immutable annotation schema.");
  }
  const policy = RELATED_PETS_ANNOTATION_TOKEN_POLICY;
  return async function requestAnnotation(pet) {
    const messages = [
      { role: "system", content: RELATED_PETS_ANNOTATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          RELATED_PETS_ANNOTATION_USER_PROMPT,
          buildRelatedPetAnnotationInput(pet),
        ].join("\n\n"),
      },
    ];
    let maxTokens = policy.initialMaxOutputTokens;
    let schemaRetryUsed = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await options.reserveStart();
      const diagnostics = {
        api: policy.api,
        attempt,
        clientRequestId: (options.randomUUID ?? randomUUID)(),
      };
      const outcome = await requestOnce(options, {
        model: options.modelUri,
        messages,
        response_format: format,
        reasoning_effort: policy.reasoning,
        temperature: 0,
        max_tokens: maxTokens,
        store: false,
        stream: false,
      }, diagnostics);
      options.onDiagnostic({ ...diagnostics, ...outcome.diagnostic });
      if (outcome.kind === "success") return outcome.value;

      const error = new AnnotationRequestError(outcome.reason, {
        ...diagnostics,
        ...outcome.diagnostic,
      });
      if (!outcome.retryable || attempt === MAX_ATTEMPTS) throw error;
      if (outcome.reason === "output_limit") {
        if (maxTokens === policy.retryMaxOutputTokens) throw error;
        maxTokens = policy.retryMaxOutputTokens;
      } else if (
        outcome.reason === "malformed_json" || outcome.reason === "schema_invalid"
      ) {
        if (schemaRetryUsed) throw error;
        schemaRetryUsed = true;
      }
      await options.sleep(outcome.retryDelayMs || 1_000 * 2 ** (attempt - 1));
    }
    throw new AnnotationRequestError("provider_error", {});
  };
}

async function requestOnce(options, body, diagnostics) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: "https://ai.api.cloud.yandex.net/v1",
    defaultHeaders: { Authorization: `Api-Key ${options.apiKey}` },
    project: options.folderId,
    maxRetries: 0,
    timeout: options.timeoutMs,
    logLevel: "off",
    fetch: async (url, init) => {
      const response = await fetchImpl(url, init);
      Object.assign(diagnostics, {
        httpStatus: response.status,
        requestId: response.headers.get("x-request-id") ?? undefined,
        serverTraceId: response.headers.get("x-server-trace-id") ?? undefined,
      });
      if (response.ok) return response;
      try {
        await response.body?.cancel();
      } catch {
        // Failed HTTP bodies are not needed for SDK classification.
      }
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });
  try {
    const { data } = await client.chat.completions.parse(body, {
      headers: { "x-client-request-id": diagnostics.clientRequestId },
      maxRetries: 0,
      timeout: options.timeoutMs,
      signal: controller.signal,
    }).withResponse();
    const choice = data.choices?.[0];
    const metadata = {
      finishReason: [
        "stop", "length", "content_filter", "tool_calls", "function_call",
      ].includes(choice?.finish_reason) ? choice.finish_reason : undefined,
      inputTokens: finiteNumber(data.usage?.prompt_tokens),
      outputTokens: finiteNumber(data.usage?.completion_tokens),
      reasoningTokens: finiteNumber(
        data.usage?.completion_tokens_details?.reasoning_tokens,
      ),
    };
    if (choice?.message?.refusal != null) {
      return failure("refused", false, "response_content", metadata);
    }
    if (choice?.finish_reason !== "stop") {
      return failure("invalid_response", false, "response_status", metadata);
    }
    if (data.choices.length !== 1 || choice.message.parsed == null ||
      choice.message.role !== "assistant" || choice.message.tool_calls?.length) {
      return failure("invalid_response", true, "response_content", metadata);
    }
    return {
      kind: "success",
      value: choice.message.parsed,
      diagnostic: { stage: "complete", ...metadata },
    };
  } catch (error) {
    if (controller.signal.aborted || error instanceof APIConnectionTimeoutError) {
      return failure("timeout", true, "network");
    }
    if (error instanceof APIConnectionError) {
      return failure("provider_error", true, "network");
    }
    if (error instanceof LengthFinishReasonError) {
      return failure("output_limit", true, "response_status", { finishReason: "length" });
    }
    if (error instanceof ContentFilterFinishReasonError) {
      return failure("content_filtered", false, "response_status", { finishReason: "content_filter" });
    }
    if (error instanceof APIError) {
      const status = error.status;
      let reason = "provider_error";
      if (status === 401 || status === 403) reason = "authentication_error";
      else if (status === 429) reason = "rate_limited";
      else if (status >= 400 && status < 500) reason = "invalid_request";
      return {
        ...failure(reason, status === 429 || status >= 500, "http"),
        retryDelayMs: retryAfterMs(error.headers?.get("Retry-After"), options.now()),
      };
    }
    if (error instanceof SyntaxError) {
      return failure("malformed_json", true, "structured_json");
    }
    if (error instanceof OpenAIError &&
      error.message.startsWith("Standard Schema validation failed:")) {
      return failure("schema_invalid", true, "structured_schema");
    }
    return failure("invalid_response", true, "response_envelope");
  } finally {
    clearTimeout(timeout);
  }
}

function failure(reason, retryable, stage, metadata = {}) {
  return {
    kind: "failure",
    reason,
    retryable,
    diagnostic: { stage, reason, ...metadata },
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function retryAfterMs(value, now) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1_000));
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - now))
    : 0;
}

import {
  PET_CAPTION_REWRITE_RESPONSE_JSON_SCHEMA,
  PET_CAPTION_REWRITE_SYSTEM_PROMPT,
  parsePetVisionCaption,
} from "./pet-vision-search-backfill.mjs";

const MODELS_ENDPOINT = "https://ai.api.cloud.yandex.net/v1/models";
const EMBEDDING_ENDPOINT =
  "https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding";
const COMPLETIONS_ENDPOINT =
  "https://ai.api.cloud.yandex.net/v1/chat/completions";

const PREFLIGHT_CAPTION = parsePetVisionCaption({
  subject: { en: "robot", ru: "робот" },
  appearance: {
    en: "small metal body",
    ru: "маленький металлический корпус",
  },
  clothing: { en: "", ru: "" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "friendly", ru: "дружелюбный" },
  colors: { en: ["blue"], ru: ["синий"] },
  search_terms_en: ["small robot", "pixel art", "friendly"],
  search_terms_ru: [
    "маленький робот",
    "пиксель-арт",
    "дружелюбный",
  ],
});

export class ManagedSearchPreflightError extends Error {
  constructor(reason, metadata = {}) {
    super("Managed search v2 preflight failed.");
    this.name = "ManagedSearchPreflightError";
    this.reason = reason;
    this.httpStatus = metadata.httpStatus ?? null;
    this.role = metadata.role ?? null;
  }
}

export async function runManagedSearchPreflight({
  folderId,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) {
  const qwenModelUri = `gpt://${folderId}/qwen3.6-35b-a3b`;
  const deepSeekModelUri = `gpt://${folderId}/deepseek-v4-flash`;
  const commonHeaders = {
    Authorization: `Api-Key ${apiKey}`,
    "Content-Type": "application/json",
  };

  const modelsResponse = await request(fetchImpl, MODELS_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "x-project": folderId,
    },
  }, timeoutMs);
  if (!modelsResponse.ok) {
    throw new ManagedSearchPreflightError("models_api_error");
  }
  const modelsPayload = await readJson(
    modelsResponse,
    "models_api_error",
  );
  const modelIds = Array.isArray(modelsPayload?.data)
    ? modelsPayload.data.flatMap((model) =>
        typeof model?.id === "string" ? [model.id] : []
      )
    : [];
  const qwenAvailable = hasModel(modelIds, qwenModelUri);
  if (!qwenAvailable) {
    throw new ManagedSearchPreflightError("qwen_model_unavailable");
  }
  const deepSeekAvailable = hasModel(modelIds, deepSeekModelUri);

  for (const role of ["doc", "query"]) {
    const embeddingResponse = await request(
      fetchImpl,
      EMBEDDING_ENDPOINT,
      {
        method: "POST",
        headers: {
          ...commonHeaders,
          "x-folder-id": folderId,
        },
        body: JSON.stringify({
          modelUri:
            `emb://${folderId}/text-embeddings-v2-${role}`,
          text: role === "doc" ? "visual caption" : "visual pet",
          dim: "768",
        }),
      },
      timeoutMs,
    );
    if (!embeddingResponse.ok) {
      throw new ManagedSearchPreflightError(
        "embedding_provider_error",
        { httpStatus: embeddingResponse.status, role },
      );
    }
    const embeddingPayload = await readJson(
      embeddingResponse,
      "invalid_embedding_response",
    );
    const embedding = embeddingPayload?.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.length !== 768 ||
      embedding.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new ManagedSearchPreflightError(
        "invalid_embedding_response",
      );
    }
  }

  if (!deepSeekAvailable) {
    return {
      modelsApi: true,
      qwenAvailable: true,
      embeddingsV2: true,
      embeddingDimensions: 768,
      deepSeekEligible: false,
      deepSeekExclusionReason: "model_unavailable",
    };
  }

  const deepSeekResponse = await request(
    fetchImpl,
    COMPLETIONS_ENDPOINT,
    {
      method: "POST",
      headers: {
        ...commonHeaders,
        "OpenAI-Project": folderId,
      },
      body: JSON.stringify({
        model: deepSeekModelUri,
        messages: [
          {
            role: "system",
            content: PET_CAPTION_REWRITE_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify(PREFLIGHT_CAPTION),
          },
        ],
        temperature: 0,
        stream: false,
        max_tokens: 900,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "pet_visual_caption_rewrite_v1",
            strict: true,
            schema: PET_CAPTION_REWRITE_RESPONSE_JSON_SCHEMA,
          },
        },
      }),
    },
    timeoutMs,
  );
  if (deepSeekResponse.status === 400 || deepSeekResponse.status === 422) {
    return {
      modelsApi: true,
      qwenAvailable: true,
      embeddingsV2: true,
      embeddingDimensions: 768,
      deepSeekEligible: false,
      deepSeekExclusionReason: "structured_output_unsupported",
    };
  }
  if (!deepSeekResponse.ok) {
    throw new ManagedSearchPreflightError("deepseek_provider_error");
  }
  const deepSeekPayload = await readJson(
    deepSeekResponse,
    "deepseek_invalid_response",
  );
  const message = deepSeekPayload?.choices?.[0]?.message;
  const content = message?.content;
  if (
    typeof message?.refusal === "string" ||
    typeof content !== "string"
  ) {
    return deepSeekExcluded("structured_output_invalid");
  }
  try {
    parsePetVisionCaption(JSON.parse(content));
  } catch {
    return deepSeekExcluded("structured_output_invalid");
  }

  return {
    modelsApi: true,
    qwenAvailable: true,
    embeddingsV2: true,
    embeddingDimensions: 768,
    deepSeekEligible: true,
    deepSeekExclusionReason: null,
  };
}

function deepSeekExcluded(reason) {
  return {
    modelsApi: true,
    qwenAvailable: true,
    embeddingsV2: true,
    embeddingDimensions: 768,
    deepSeekEligible: false,
    deepSeekExclusionReason: reason,
  };
}

function hasModel(modelIds, modelUri) {
  return modelIds.some(
    (candidate) =>
      candidate === modelUri || candidate.startsWith(`${modelUri}/`),
  );
}

async function request(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    throw new ManagedSearchPreflightError(
      controller.signal.aborted ? "timeout" : "provider_error",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response, reason) {
  try {
    return await response.json();
  } catch {
    throw new ManagedSearchPreflightError(reason);
  }
}

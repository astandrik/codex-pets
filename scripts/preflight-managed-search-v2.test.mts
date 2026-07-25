import { describe, expect, it, vi } from "vitest";

import {
  PET_CAPTION_REWRITE_RESPONSE_JSON_SCHEMA,
  PET_CAPTION_REWRITE_SYSTEM_PROMPT,
} from "./lib/pet-vision-search-backfill.mjs";
import {
  ManagedSearchPreflightError,
  runManagedSearchPreflight,
} from "./lib/pet-search-preflight.mjs";

const caption = {
  subject: { en: "robot", ru: "робот" },
  appearance: { en: "small metal body", ru: "маленький металлический корпус" },
  clothing: { en: "", ru: "" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "friendly", ru: "дружелюбный" },
  colors: { en: ["blue"], ru: ["синий"] },
  search_terms_en: ["small robot", "pixel art", "friendly"],
  search_terms_ru: ["маленький робот", "пиксель-арт", "дружелюбный"],
};

describe("managed search v2 preflight", () => {
  it("checks Models API, both 768 embedding roles, and DeepSeek strict output", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      Response.json({
        data: [
          { id: "gpt://folder-1/qwen3.6-35b-a3b" },
          { id: "gpt://folder-1/deepseek-v4-flash" },
        ],
      }),
      Response.json({ embedding: Array(768).fill(0.1) }),
      Response.json({ embedding: Array(768).fill(0.2) }),
      Response.json({
        choices: [{ message: { content: JSON.stringify(caption) } }],
      }),
    ];
    const result = await runManagedSearchPreflight({
      folderId: "folder-1",
      apiKey: "secret-key",
      fetchImpl: vi.fn(async (url, init) => {
        requests.push({ url: String(url), init });
        return responses.shift()!;
      }),
    });

    expect(result).toEqual({
      modelsApi: true,
      qwenAvailable: true,
      embeddingsV2: true,
      embeddingDimensions: 768,
      deepSeekEligible: true,
      deepSeekExclusionReason: null,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "https://ai.api.cloud.yandex.net/v1/models",
      "https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding",
      "https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding",
      "https://ai.api.cloud.yandex.net/v1/chat/completions",
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      modelUri: "emb://folder-1/text-embeddings-v2-doc",
      dim: "768",
    });
    expect(JSON.parse(String(requests[2]?.init?.body))).toMatchObject({
      modelUri: "emb://folder-1/text-embeddings-v2-query",
      dim: "768",
    });
    expect(JSON.parse(String(requests[3]?.init?.body))).toMatchObject({
      model: "gpt://folder-1/deepseek-v4-flash",
      messages: [
        { role: "system", content: PET_CAPTION_REWRITE_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(caption) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          strict: true,
          schema: PET_CAPTION_REWRITE_RESPONSE_JSON_SCHEMA,
        },
      },
    });
  });

  it("automatically excludes DeepSeek when strict output is unsupported", async () => {
    const responses = [
      Response.json({
        data: [
          { id: "gpt://folder-1/qwen3.6-35b-a3b" },
          { id: "gpt://folder-1/deepseek-v4-flash" },
        ],
      }),
      Response.json({ embedding: Array(768).fill(0.1) }),
      Response.json({ embedding: Array(768).fill(0.2) }),
      new Response(null, { status: 400 }),
    ];

    await expect(
      runManagedSearchPreflight({
        folderId: "folder-1",
        apiKey: "secret-key",
        fetchImpl: vi.fn(async () => responses.shift()!),
      }),
    ).resolves.toMatchObject({
      deepSeekEligible: false,
      deepSeekExclusionReason: "structured_output_unsupported",
    });
  });

  it("automatically excludes DeepSeek when a successful response violates the strict schema", async () => {
    const responses = [
      Response.json({
        data: [
          { id: "gpt://folder-1/qwen3.6-35b-a3b" },
          { id: "gpt://folder-1/deepseek-v4-flash" },
        ],
      }),
      Response.json({ embedding: Array(768).fill(0.1) }),
      Response.json({ embedding: Array(768).fill(0.2) }),
      Response.json({
        choices: [{ message: { content: "{\"subject\":{}}" } }],
      }),
    ];

    await expect(
      runManagedSearchPreflight({
        folderId: "folder-1",
        apiKey: "secret-key",
        fetchImpl: vi.fn(async () => responses.shift()!),
      }),
    ).resolves.toMatchObject({
      deepSeekEligible: false,
      deepSeekExclusionReason: "structured_output_invalid",
    });
  });

  it("rejects non-finite or non-768 embeddings", async () => {
    const responses = [
      Response.json({
        data: [
          { id: "gpt://folder-1/qwen3.6-35b-a3b" },
          { id: "gpt://folder-1/deepseek-v4-flash" },
        ],
      }),
      Response.json({ embedding: [Number.NaN] }),
    ];

    await expect(
      runManagedSearchPreflight({
        folderId: "folder-1",
        apiKey: "secret-key",
        fetchImpl: vi.fn(async () => responses.shift()!),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ManagedSearchPreflightError>>({
        reason: "invalid_embedding_response",
      }),
    );
  });

  it("reports only safe HTTP metadata for embedding preflight failures", async () => {
    const responses = [
      Response.json({
        data: [{ id: "gpt://folder-1/qwen3.6-35b-a3b" }],
      }),
      new Response(null, { status: 403 }),
    ];

    await expect(
      runManagedSearchPreflight({
        folderId: "folder-1",
        apiKey: "secret-key",
        fetchImpl: vi.fn(async () => responses.shift()!),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        reason: "embedding_provider_error",
        httpStatus: 403,
        role: "doc",
      }),
    );
  });
});

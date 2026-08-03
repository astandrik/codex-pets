import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  PET_CAPTION_REWRITE_RESPONSE_JSON_SCHEMA,
  PET_CAPTION_REWRITE_SYSTEM_PROMPT,
  parsePetVisionCaption,
  type PetVisionCaption,
} from "@/lib/pets/search-vision-contract";
import {
  CaptionRewriteProviderError,
  createYandexCaptionRewriteClient,
} from "@/lib/pets/search-caption-rewriter";

const upstreamCaption = parsePetVisionCaption({
  subject: { en: "woman", ru: "женщина" },
  appearance: { en: "silver hair", ru: "серебряные волосы" },
  clothing: { en: "black dress", ru: "чёрное платье" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "confident", ru: "уверенная" },
  colors: { en: ["black"], ru: ["чёрный"] },
  search_terms_en: ["anime woman", "gothic", "elegant"],
  search_terms_ru: ["аниме девушка", "готика", "элегантная"],
});

describe("Yandex managed caption rewriter", () => {
  it("sends only the validated Qwen caption with strict JSON schema", async () => {
    const requests: RequestInit[] = [];
    const rewritten: PetVisionCaption = {
      ...upstreamCaption,
      search_terms_en: ["silver-haired woman", "gothic", "pixel art"],
    };
    const client = createYandexCaptionRewriteClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/deepseek-v4-flash",
      timeoutMs: 30_000,
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});
        return providerResponse(rewritten);
      },
    });

    await expect(client.rewriteCaption(upstreamCaption)).resolves.toEqual(
      rewritten,
    );
    const body = JSON.parse(String(requests[0]?.body));
    expect(body).toMatchObject({
      model: "gpt://folder-1/deepseek-v4-flash",
      temperature: 0,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "pet_visual_caption_rewrite_v1",
          strict: true,
          schema: PET_CAPTION_REWRITE_RESPONSE_JSON_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: PET_CAPTION_REWRITE_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify(upstreamCaption),
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("image_url");
    expect(body.messages[1].content).toBe(JSON.stringify(upstreamCaption));
  });

  it("rejects strict-output violations and marks unsupported structured output", async () => {
    const malformedClient = createYandexCaptionRewriteClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/deepseek-v4-flash",
      timeoutMs: 30_000,
      fetchImpl: async () =>
        providerResponse({
          ...upstreamCaption,
          identity: "forbidden",
        } as unknown as PetVisionCaption),
    });
    await expect(
      malformedClient.rewriteCaption(upstreamCaption),
    ).rejects.toMatchObject({ reason: "invalid_response" });

    const unsupportedClient = createYandexCaptionRewriteClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/deepseek-v4-flash",
      timeoutMs: 30_000,
      fetchImpl: async () => new Response(null, { status: 400 }),
    });
    await expect(
      unsupportedClient.rewriteCaption(upstreamCaption),
    ).rejects.toMatchObject({
      reason: "structured_output_unsupported",
    });
  });

  it("classifies timeouts without retaining provider content", async () => {
    vi.useFakeTimers();
    try {
      const client = createYandexCaptionRewriteClient({
        folderId: "folder-1",
        apiKey: "secret-key",
        modelUri: "gpt://folder-1/deepseek-v4-flash",
        timeoutMs: 50,
        fetchImpl: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("SECRET_PROVIDER_BODY", "AbortError")),
            );
          }),
      });
      const result = client.rewriteCaption(upstreamCaption).catch(
        (error) => error,
      );
      await vi.advanceTimersByTimeAsync(50);
      const error = await result;

      expect(error).toEqual(
        expect.objectContaining<Partial<CaptionRewriteProviderError>>({
          reason: "timeout",
        }),
      );
      expect(inspect(error)).not.toContain("SECRET_PROVIDER_BODY");
    } finally {
      vi.useRealTimers();
    }
  });
});

function providerResponse(caption: PetVisionCaption): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify(caption),
        },
      },
    ],
  });
}

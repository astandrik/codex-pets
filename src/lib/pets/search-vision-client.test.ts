import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  PET_VISION_RESPONSE_JSON_SCHEMA,
  PET_VISION_SYSTEM_PROMPT,
  PET_VISION_USER_PROMPT,
  type PetVisionCaption,
} from "@/lib/pets/search-vision-contract";
import {
  VisionCaptionProviderError,
  createYandexVisionCaptionClient,
} from "@/lib/pets/search-vision-client";
import {
  PET_VISION_FRAME_POLICY,
  type PetVisionFrame,
} from "@/lib/pets/search-vision-frames";

const providerCaption: PetVisionCaption = {
  subject: { en: "woman", ru: "женщина" },
  appearance: { en: "silver hair", ru: "серебряные волосы" },
  clothing: { en: "black dress", ru: "чёрное платье" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "confident", ru: "уверенная" },
  colors: { en: ["black"], ru: ["чёрный"] },
  search_terms_en: ["anime woman", "gothic", "elegant"],
  search_terms_ru: ["аниме девушка", "готика", "элегантная"],
};

const frames: PetVisionFrame[] = PET_VISION_FRAME_POLICY.frames.map(
  ({ state, row, frame }, index) => ({
    state,
    row,
    frame,
    png: Buffer.from(`image-${index}`),
    dataUrl: `data:image/png;base64,IMAGE_${index}`,
  }),
);

describe("Yandex vision caption client", () => {
  it("sends exactly four ordered images and no catalog metadata", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return providerResponse(providerCaption);
      },
    });

    await expect(client.createCaption(frames)).resolves.toEqual(providerCaption);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://ai.api.cloud.yandex.net/v1/chat/completions",
    );
    expect(requests[0]?.init?.headers).toEqual({
      Authorization: "Api-Key secret-key",
      "Content-Type": "application/json",
      "OpenAI-Project": "folder-1",
    });
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      model: "gpt://folder-1/qwen3.6-35b-a3b",
      temperature: 0,
      stream: false,
      max_tokens: 900,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "pet_visual_caption_v1",
          strict: true,
          schema: PET_VISION_RESPONSE_JSON_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: PET_VISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: PET_VISION_USER_PROMPT },
            ...frames.map((frame) => ({
              type: "image_url",
              image_url: { url: frame.dataUrl },
            })),
          ],
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("SECRET_PET_NAME");
    expect(JSON.stringify(body).match(/data:image\/png;base64/g)).toHaveLength(4);
  });

  it("serializes calls and evenly spaces every provider start", async () => {
    let currentTime = 0;
    const starts: number[] = [];
    const waits: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const client = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        currentTime += milliseconds;
      },
      fetchImpl: async () => {
        starts.push(currentTime);
        calls += 1;
        if (calls === 1) await firstRequest;
        return providerResponse(providerCaption);
      },
    });

    const first = client.createCaption(frames);
    const second = client.createCaption(frames);
    await vi.waitFor(() => expect(starts).toEqual([0]));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(starts).toEqual([0, 6_000]);
    expect(waits).toEqual([6_000]);
  });

  it("retries one 429/5xx response and honors bounded Retry-After", async () => {
    let currentTime = 0;
    const waits: number[] = [];
    const cancelFirstBody = vi.fn();
    const responses = [
      new Response(
        new ReadableStream({
          cancel: cancelFirstBody,
        }),
        {
          status: 429,
          headers: { "Retry-After": "2" },
        },
      ),
      providerResponse(providerCaption),
    ];
    const client = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        currentTime += milliseconds;
      },
      fetchImpl: async () => responses.shift() ?? providerResponse(providerCaption),
    });

    await expect(client.createCaption(frames)).resolves.toEqual(providerCaption);
    expect(waits).toEqual([2_000, 4_000]);
    expect(cancelFirstBody).toHaveBeenCalledOnce();
  });

  it("classifies timeout, refusal, and malformed responses without leaking bodies", async () => {
    vi.useFakeTimers();
    const timeoutClient = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 50,
      fetchImpl: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    const timeout = timeoutClient.createCaption(frames);
    const timeoutExpectation = expect(timeout).rejects.toMatchObject({
      reason: "timeout",
    });
    await vi.advanceTimersByTimeAsync(50);
    await timeoutExpectation;
    vi.useRealTimers();

    for (const [response, reason, secret] of [
      [
        Response.json({
          choices: [{ message: { refusal: "SECRET_REFUSAL" } }],
        }),
        "refused",
        "SECRET_REFUSAL",
      ],
      [
        new Response("SECRET_RESPONSE_FRAGMENT", {
          headers: { "Content-Type": "application/json" },
        }),
        "invalid_response",
        "SECRET_RESPONSE_FRAGMENT",
      ],
      [
        Response.json({
          choices: [
            { message: { content: "SECRET_CAPTION_FRAGMENT not json" } },
          ],
        }),
        "invalid_response",
        "SECRET_CAPTION_FRAGMENT",
      ],
    ] as const) {
      const client = createYandexVisionCaptionClient({
        folderId: "folder-1",
        apiKey: "secret-key",
        modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
        timeoutMs: 30_000,
        fetchImpl: async () => response,
      });
      const error = await client.createCaption(frames).catch((value) => value);
      expect(error).toEqual(
        expect.objectContaining<Partial<VisionCaptionProviderError>>({ reason }),
      );
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(inspect(error)).not.toContain(secret);
    }
  });

  it("keeps the request timeout active while reading the response body", async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      let bodyController:
        | ReadableStreamDefaultController<Uint8Array>
        | undefined;
      const client = createYandexVisionCaptionClient({
        folderId: "folder-1",
        apiKey: "secret-key",
        modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
        timeoutMs: 50,
        fetchImpl: async (_url, init) => {
          requestSignal = init?.signal ?? undefined;
          const signal = requestSignal;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                bodyController = controller;
                signal?.addEventListener("abort", () => {
                  controller.error(new DOMException("Aborted", "AbortError"));
                });
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        },
      });

      const resultPromise = client.createCaption(frames).catch((error) => error);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
      const aborted = requestSignal?.aborted ?? false;
      if (!aborted) {
        bodyController?.error(new Error("test cleanup"));
      }
      const result = await resultPromise;

      expect(aborted).toBe(true);
      expect(result).toEqual(
        expect.objectContaining<Partial<VisionCaptionProviderError>>({
          reason: "timeout",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid frame order before making a provider request", async () => {
    const fetchImpl = vi.fn();
    const client = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      fetchImpl,
    });

    await expect(client.createCaption(frames.toReversed())).rejects.toMatchObject({
      reason: "invalid_request",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
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

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
    const diagnostics: unknown[] = [];
    const client = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
      onDiagnostic: (entry) => diagnostics.push(entry),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return providerResponse(providerCaption);
      },
    });

    await expect(client.createCaption(frames)).resolves.toEqual(providerCaption);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://ai.api.cloud.yandex.net/v1/responses",
    );
    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get("Authorization")).toBe("Api-Key secret-key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("OpenAI-Project")).toBe("folder-1");
    expect(headers.get("x-client-request-id")).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      model: "gpt://folder-1/qwen3.6-35b-a3b",
      instructions: PET_VISION_SYSTEM_PROMPT,
      temperature: 0,
      max_output_tokens: 8_000,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "pet_visual_caption_v1",
          strict: true,
          schema: PET_VISION_RESPONSE_JSON_SCHEMA,
        },
      },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: PET_VISION_USER_PROMPT },
            ...frames.map((frame) => ({
              type: "input_image",
              image_url: frame.dataUrl,
            })),
          ],
        },
      ],
    });
    expect(body).not.toHaveProperty("reasoning");
    expect(JSON.stringify(body)).not.toContain("SECRET_PET_NAME");
    expect(JSON.stringify(body).match(/data:image\/png;base64/g)).toHaveLength(4);
    expect(JSON.stringify(diagnostics)).not.toContain("secret-key");
    expect(JSON.stringify(diagnostics)).not.toContain("IMAGE_0");
    expect(JSON.stringify(diagnostics)).not.toContain("silver hair");
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

  it("retries 429 and 5xx responses and honors bounded Retry-After", async () => {
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
      new Response(null, { status: 503 }),
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
    expect(waits).toEqual([2_000, 4_000, 2_000, 4_000]);
    expect(cancelFirstBody).toHaveBeenCalledOnce();
  });

  it("keeps retries in the outer policy and treats 4xx as terminal", async () => {
    const serverFailure = vi.fn(
      async (...request: Parameters<typeof fetch>) => {
        void request;
        return new Response(null, { status: 503 });
      },
    );
    const retryingClient = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      sleep: async () => undefined,
      fetchImpl: serverFailure,
    });

    await expect(retryingClient.createCaption(frames)).rejects.toMatchObject({
      reason: "provider_error",
    });
    expect(serverFailure).toHaveBeenCalledTimes(3);
    for (const request of serverFailure.mock.calls) {
      expect(new Headers(request[1]?.headers).get("x-stainless-retry-count")).toBe(
        "0",
      );
    }

    for (const [status, reason] of [
      [400, "invalid_request"],
      [401, "authentication_error"],
      [403, "authentication_error"],
    ] as const) {
      const fetchImpl = vi.fn(async () => new Response(null, { status }));
      const client = createYandexVisionCaptionClient({
        folderId: "folder-1",
        apiKey: "secret-key",
        modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
        timeoutMs: 30_000,
        sleep: async () => undefined,
        fetchImpl,
      });

      await expect(client.createCaption(frames)).rejects.toMatchObject({ reason });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("retries network failures at most three times", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("SECRET_NETWORK_ERROR");
    });
    const diagnostics: unknown[] = [];
    const client = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      sleep: async () => undefined,
      fetchImpl,
      onDiagnostic: (entry) => diagnostics.push(entry),
    });

    const error = await client.createCaption(frames).catch((value) => value);
    expect(error).toEqual(
      expect.objectContaining<Partial<VisionCaptionProviderError>>({
        reason: "provider_error",
      }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(inspect(error)).not.toContain("SECRET_NETWORK_ERROR");
    expect(JSON.stringify(diagnostics)).not.toContain("SECRET_NETWORK_ERROR");
  });

  it("retries an output-limited response with 16000 tokens", async () => {
    let currentTime = 0;
    const waits: number[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    const responses = [
      Response.json({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: {
          input_tokens: 448,
          output_tokens: 8_000,
          output_tokens_details: { reasoning_tokens: 7_900 },
        },
      }),
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
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return responses.shift() ?? providerResponse(providerCaption);
      },
    });

    await expect(client.createCaption(frames)).resolves.toEqual(providerCaption);
    expect(bodies.map((body) => body.max_output_tokens)).toEqual([
      8_000,
      16_000,
    ]);
    expect(waits).toEqual([1_000, 5_000]);
  });

  it("retries a schema-invalid structured response only once", async () => {
    const fetchImpl = vi.fn(async () =>
      providerResponse({
        ...providerCaption,
        subject: { en: "", ru: "" },
      }),
    );
    const client = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      sleep: async () => undefined,
      fetchImpl,
    });

    await expect(client.createCaption(frames)).rejects.toMatchObject({
      reason: "schema_invalid",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("classifies timeout, refusal, and malformed responses without leaking bodies", async () => {
    vi.useFakeTimers();
    const timeoutClient = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 50,
      sleep: async () => undefined,
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
    await vi.advanceTimersByTimeAsync(150);
    await timeoutExpectation;
    vi.useRealTimers();

    for (const [response, reason, secret] of [
      [
        Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "SECRET_REFUSAL" }],
            },
          ],
        }),
        "refused",
        "SECRET_REFUSAL",
      ],
      [
        new Response("SECRET_RESPONSE_FRAGMENT", {
          headers: { "Content-Type": "application/json" },
        }),
        "malformed_json",
        "SECRET_RESPONSE_FRAGMENT",
      ],
      [
        Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "SECRET_CAPTION_FRAGMENT not json",
                },
              ],
            },
          ],
        }),
        "malformed_json",
        "SECRET_CAPTION_FRAGMENT",
      ],
      [
        Response.json({
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
          output: [],
        }),
        "content_filtered",
        "SECRET_FILTER_MARKER",
      ],
    ] as const) {
      const client = createYandexVisionCaptionClient({
        folderId: "folder-1",
        apiKey: "secret-key",
        modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
        timeoutMs: 30_000,
        sleep: async () => undefined,
        fetchImpl: async () => response.clone(),
      });
      const error = await client.createCaption(frames).catch((value) => value);
      expect(error).toEqual(
        expect.objectContaining<Partial<VisionCaptionProviderError>>({ reason }),
      );
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(inspect(error)).not.toContain(secret);
    }
  });

  it("retries malformed JSON only once", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("not json", {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createYandexVisionCaptionClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      timeoutMs: 30_000,
      sleep: async () => undefined,
      fetchImpl,
    });

    await expect(client.createCaption(frames)).rejects.toMatchObject({
      reason: "malformed_json",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
        sleep: async () => undefined,
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
      await vi.advanceTimersByTimeAsync(150);
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
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(caption),
          },
        ],
      },
    ],
  });
}

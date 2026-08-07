import { describe, expect, it, vi } from "vitest";

import {
  PET_VISION_CAPTION_REVISION_V2,
  parsePetVisionCaptionForRevision,
  type PetVisionCaptionV2,
} from "@/lib/pets/search-vision-contract";
import { requirePetVisionPipeline } from "@/lib/pets/search-vision-pipelines.mjs";
import {
  classifyResponsesPayload,
  createResponsesVisionCaptionRequester,
} from "@/lib/pets/search-vision-provider.mjs";

const pipeline = requirePetVisionPipeline(PET_VISION_CAPTION_REVISION_V2);
const caption: PetVisionCaptionV2 = {
  subject: { en: "bear", ru: "медведь" },
  appearance: { en: "round brown bear", ru: "круглый коричневый медведь" },
  clothing: { en: "", ru: "" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "friendly", ru: "дружелюбный" },
  colors: { en: ["brown", "black"], ru: ["коричневый", "чёрный"] },
  accessories: { en: "", ru: "" },
  distinctive_features: { en: "round ears", ru: "круглые уши" },
  pose_motion: { en: "waves and jumps", ru: "машет и прыгает" },
  search_terms_en: ["brown bear", "cartoon bear", "round animal"],
  search_terms_ru: ["коричневый медведь", "мультяшный медведь", "круглый зверь"],
};
const frames = pipeline.framePolicy.frames.map((frame, index) => ({
  ...frame,
  dataUrl: `data:image/png;base64,FRAME_${index}_SECRET`,
}));

describe("Responses vision provider", () => {
  it("sends nine images with strict structured output and keeps Qwen auto reasoning", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const diagnostics: unknown[] = [];
    const requester = createRequester({
      onDiagnostic: (entry) => diagnostics.push(entry),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return completedResponse(caption);
      },
    });

    await expect(requester(frames)).resolves.toEqual(caption);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://ai.api.cloud.yandex.net/v1/responses",
    );
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: "Api-Key SECRET_API_KEY",
      "OpenAI-Project": "folder-1",
      "x-client-request-id": "00000000-0000-4000-8000-000000000001",
    });
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      model: "gpt://folder-1/qwen3.6-35b-a3b",
      instructions: pipeline.systemPrompt,
      temperature: 0,
      max_output_tokens: 8_000,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "pet_visual_caption_v2",
          strict: true,
          schema: pipeline.responseJsonSchema,
        },
      },
    });
    expect(body).not.toHaveProperty("reasoning");
    expect(body.input[0].content).toHaveLength(10);
    expect(body.input[0].content.slice(1)).toEqual(
      frames.map((frame) => ({
        type: "input_image",
        image_url: frame.dataUrl,
      })),
    );
    expect(JSON.stringify(diagnostics)).not.toContain("SECRET_API_KEY");
    expect(JSON.stringify(diagnostics)).not.toContain("FRAME_0_SECRET");
    expect(JSON.stringify(diagnostics)).not.toContain("round brown bear");
  });

  it("retries an output-token incomplete response at 16000 tokens", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const responses = [
      Response.json({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: {
          input_tokens: 900,
          output_tokens: 8_000,
          output_tokens_details: { reasoning_tokens: 7_900 },
        },
      }),
      completedResponse(caption),
    ];
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(
      async () => undefined,
    );
    const requester = createRequester({
      sleep,
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return responses.shift() ?? completedResponse(caption);
      },
    });

    await expect(requester(frames)).resolves.toEqual(caption);
    expect(bodies.map((body) => body.max_output_tokens)).toEqual([
      8_000,
      16_000,
    ]);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("retries malformed structured output once and treats refusal and filtering as terminal", async () => {
    const malformed = completedResponse("not-json");
    const requester = createRequester({
      sleep: async () => undefined,
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce(malformed)
        .mockResolvedValueOnce(completedResponse(caption)),
    });
    await expect(requester(frames)).resolves.toEqual(caption);

    const refusal = classifyResponsesPayload(
      {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "SECRET" }] },
        ],
      },
      parseV2,
    );
    expect(refusal).toMatchObject({
      kind: "failure",
      reason: "refused",
      retryable: false,
    });
    const filtered = classifyResponsesPayload(
      {
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
        output: [],
      },
      parseV2,
    );
    expect(filtered).toMatchObject({
      kind: "failure",
      reason: "content_filtered",
      retryable: false,
    });
  });

  it("retries 429 and 5xx responses at most three times and honors Retry-After", async () => {
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(
      async () => undefined,
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(completedResponse(caption));
    const requester = createRequester({ fetchImpl, sleep });

    await expect(requester(frames)).resolves.toEqual(caption);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      2_000,
      2_000,
    ]);
  });

  it("classifies an aborted request as a timeout without response data", async () => {
    vi.useFakeTimers();
    const diagnostics: unknown[] = [];
    const requester = createRequester({
      timeoutMs: 50,
      onDiagnostic: (entry) => diagnostics.push(entry),
      sleep: async () => undefined,
      fetchImpl: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    const request = requester(frames);
    const expectation = expect(request).rejects.toMatchObject({
      reason: "timeout",
    });
    await vi.advanceTimersByTimeAsync(150);
    await expectation;
    expect(JSON.stringify(diagnostics)).not.toContain("Aborted");
    vi.useRealTimers();
  });
});

function createRequester(
  overrides: Partial<Parameters<typeof createResponsesVisionCaptionRequester<PetVisionCaptionV2>>[0]> = {},
) {
  return createResponsesVisionCaptionRequester<PetVisionCaptionV2>({
    folderId: "folder-1",
    apiKey: "SECRET_API_KEY",
    modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
    timeoutMs: 180_000,
    pipeline,
    parseCaption: parseV2,
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    sleep: async () => undefined,
    ...overrides,
  });
}

function parseV2(value: unknown): PetVisionCaptionV2 {
  return parsePetVisionCaptionForRevision(
    value,
    PET_VISION_CAPTION_REVISION_V2,
  ) as PetVisionCaptionV2;
}

function completedResponse(value: PetVisionCaptionV2 | string): Response {
  return Response.json(
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: typeof value === "string" ? value : JSON.stringify(value),
            },
          ],
        },
      ],
      usage: {
        input_tokens: 1_200,
        output_tokens: 500,
        output_tokens_details: { reasoning_tokens: 350 },
      },
    },
    {
      headers: {
        "x-request-id": "provider-request-1",
        "x-server-trace-id": "provider-trace-1",
      },
    },
  );
}

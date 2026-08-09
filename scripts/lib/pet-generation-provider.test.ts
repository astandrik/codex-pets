import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  createOpenAIPetGenerationProvider,
  OpenAIProviderError,
} from "./pet-generation-provider.mjs";

async function png(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 4, background: "red" },
  }).png().toBuffer();
}

describe("OpenAI pet generation provider", () => {
  it("uses generation JSON for the base and multipart edits for references", async () => {
    const image = await png();
    const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(JSON.stringify({
        data: [{ b64_json: image.toString("base64") }],
        usage: { total_tokens: 7 },
      }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_1" } });
    };
    const provider = createOpenAIPetGenerationProvider({
      apiKey: "test-key",
      imageModel: "gpt-image-2-2026-04-21",
      reviewModel: "gpt-5.6-sol",
      fetchImpl,
    });

    await provider.generateImage({ prompt: "base", size: "1024x1024" });
    await provider.generateImage({ prompt: "row", size: "1536x1024", references: [image] });

    expect(calls[0][0]).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(calls[0][1]?.body))).toMatchObject({
      model: "gpt-image-2-2026-04-21",
      quality: "high",
      output_format: "png",
    });
    expect(calls[1][0]).toBe("https://api.openai.com/v1/images/edits");
    const form = calls[1][1]?.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).getAll("image[]")).toHaveLength(1);
  });

  it("marks a lost response as ambiguous instead of retryable", async () => {
    const provider = createOpenAIPetGenerationProvider({
      apiKey: "test-key",
      imageModel: "image-model",
      reviewModel: "review-model",
      fetchImpl: vi.fn(async () => { throw new Error("socket closed"); }),
    });

    await expect(provider.generateImage({ prompt: "base", size: "1024x1024" })).rejects.toMatchObject({
      name: "OpenAIProviderError",
      code: "ambiguous_network_error",
      responseReceived: false,
    } satisfies Partial<OpenAIProviderError>);
  });

  it("moderates images as data URLs and validates structured review output", async () => {
    const image = await png();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200, headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify({ pass: true, issues: [] }) }] }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createOpenAIPetGenerationProvider({
      apiKey: "test-key", imageModel: "image-model", reviewModel: "review-model", fetchImpl,
    });

    await expect(provider.moderate({ image })).resolves.toMatchObject({ flagged: false });
    await expect(provider.review({ contactSheet: image, directionSheet: image })).resolves.toMatchObject({
      review: { pass: true, issues: [] },
    });
    const moderationBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(moderationBody.input[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    const reviewBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(reviewBody.text.format).toMatchObject({ type: "json_schema", strict: true });
  });
});

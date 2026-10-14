import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImage } from "@/lib/pets/generation/worker";
import type { GenerationJob } from "@/lib/pets/generation/model";

const job: GenerationJob = { id: "a".repeat(64), prompt: "A fox", displayName: "Fox", createdAt: 0, expiresAt: 1, status: "generating", worker: "test", promptRevision: "test", pipelineVersion: 1, stages: [] };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("image provider contract", () => {
  it("sends one fixed-format request to OpenAI and records measured usage", async () => {
    vi.stubEnv("OPENAI_API_KEY", "unit-test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://untrusted.invalid");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }], usage: { input_tokens: 100, input_tokens_details: { text_tokens: 100, image_tokens: 0 }, output_tokens: 1000 } }), { headers: { "Content-Type": "application/json", "x-request-id": "synthetic-provider-id" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateImage(job);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    const request = new Request(input, init);
    expect(request.url).toBe("https://api.openai.com/v1/images/generations");
    expect(await request.json()).toMatchObject({ model: "gpt-image-2.5-sunburst", quality: "high", n: 1, background: "transparent", size: "1536x2288", output_format: "png", moderation: "auto" });
    expect(result.bytes.toString()).toBe("image-bytes");
    expect(result.usage?.costUsd).toBe(0.0305);
  });
  it("does not automatically retry an ambiguous provider failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "unit-test-key");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateImage(job)).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

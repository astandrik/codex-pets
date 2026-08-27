import { inspect } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
  RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
  RELATED_PETS_ANNOTATION_USER_PROMPT,
  parseRelatedPetAnnotationProposal,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import { createYandexRelatedPetAnnotationClient } from "@/lib/pets/related-pets-annotation-client.mjs";

const pet = {
  slug: "vi",
  displayName: "Vi",
  description: "An Arcane fighter.",
  kind: "character" as const,
  tags: ["arcane"],
};
const proposal = {
  entity: {
    key: "vi",
    aliases: ["Violet"],
    confidence: "high",
    evidence: ["name"],
  },
  franchises: [
    { key: "arcane", confidence: "high", evidence: ["description"] },
  ],
  franchise_families: [],
  collections: [],
  specific_archetypes: [],
  themes: [],
  media_origins: [],
};
type ClientOptions = Parameters<typeof createYandexRelatedPetAnnotationClient>[0];

afterEach(() => vi.useRealTimers());

describe("related pet annotation client", () => {
  it("uses exact text-only Chat Completions schema and returns a parsed proposal", async () => {
    const fetchImpl = vi.fn(async (...request: Parameters<typeof fetch>) => {
      void request;
      return completedResponse(proposal, {
        prompt_tokens: 263,
        completion_tokens: 341,
        completion_tokens_details: { reasoning_tokens: 0 },
      });
    });
    const diagnostics: unknown[] = [];
    const result = await createClient({
      fetchImpl,
      onDiagnostic: (entry) => diagnostics.push(entry),
    }).createProposal(pet);

    expect(result).toEqual(parseRelatedPetAnnotationProposal(proposal));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://ai.api.cloud.yandex.net/v1/chat/completions");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Api-Key SECRET_KEY");
    expect(headers.get("openai-project")).toBe("folder-1");
    expect(headers.get("x-stainless-retry-count")).toBe("0");
    expect(headers.get("x-client-request-id")).toBe("request-1");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      model: "gpt://folder-1/qwen3.6-35b-a3b",
      messages: [
        { role: "system", content: RELATED_PETS_ANNOTATION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            RELATED_PETS_ANNOTATION_USER_PROMPT,
            "name: Vi\nkind: character\ndescription: An Arcane fighter.\ntags: arcane",
          ].join("\n\n"),
        },
      ],
      temperature: 0,
      max_tokens: 4_000,
      reasoning_effort: "none",
      store: false,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "related_pet_annotation_v11_r12",
          strict: true,
          schema: RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("input_image");
    expect(diagnostics).toEqual([expect.objectContaining({
      api: "chat_completions",
      attempt: 1,
      stage: "complete",
      finishReason: "stop",
      httpStatus: 200,
      inputTokens: 263,
      outputTokens: 341,
      reasoningTokens: 0,
    })]);
    assertSanitized(diagnostics);
  });

  it("escalates length only once from 4000 to 8000 and preserves the start limiter", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const waits: number[] = [];
    let now = 0;
    const responses = [completedResponse(proposal, undefined, "length"), completedResponse(proposal)];
    const client = createClient({
      now: () => now,
      sleep: async (ms) => { waits.push(ms); now += ms; },
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return responses.shift()!;
      },
    });
    await expect(client.createProposal(pet)).resolves.toEqual(parseRelatedPetAnnotationProposal(proposal));
    expect(bodies.map((body) => body.max_tokens)).toEqual([4_000, 8_000]);
    expect(waits).toEqual([1_000, 5_000]);

    const fetchImpl = vi.fn(async () => completedResponse(proposal, undefined, "length"));
    await expect(createClient({ fetchImpl }).createProposal(pet)).rejects.toMatchObject({ reason: "output_limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["malformed envelope", () => new Response("SECRET_RESPONSE", { headers: { "Content-Type": "application/json" } }), "malformed_json"],
    ["malformed content", () => chatResponse("SECRET_RESPONSE"), "malformed_json"],
    ["invalid schema", () => completedResponse({ ...proposal, extra: "SECRET_RESPONSE" }), "schema_invalid"],
  ] as const)("retries %s only once and does not leak the SDK error", async (_name, response, reason) => {
    const fetchImpl = vi.fn(async () => response());
    const diagnostics: unknown[] = [];
    const error = await createClient({ fetchImpl, onDiagnostic: (entry) => diagnostics.push(entry) })
      .createProposal(pet).catch((value) => value);
    expect(error).toMatchObject({ reason, message: "Related pet annotation provider request failed." });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    assertSanitized([error, diagnostics]);
  });

  it("bounds mixed transport, token and schema retries to three outer attempts", async () => {
    const responses = [
      new Response(null, { status: 503 }),
      completedResponse(proposal, undefined, "length"),
      completedResponse({ ...proposal, extra: true }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    await expect(createClient({ fetchImpl }).createProposal(pet)).rejects.toMatchObject({ reason: "schema_invalid" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["network", async () => { throw new TypeError("SECRET_NETWORK_ERROR"); }, "provider_error"],
    ["503", async () => new Response("SECRET_RESPONSE", { status: 503 }), "provider_error"],
  ] as const)("retries %s at most three times", async (_name, fetchImpl, reason) => {
    const fetchMock = vi.fn(fetchImpl);
    const diagnostics: unknown[] = [];
    const error = await createClient({ fetchImpl: fetchMock, onDiagnostic: (entry) => diagnostics.push(entry) })
      .createProposal(pet).catch((value) => value);
    expect(error).toMatchObject({ reason });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    assertSanitized([error, diagnostics]);
  });

  it.each([
    ["2", 2_000],
    ["999", 60_000],
    ["Thu, 01 Jan 1970 00:02:00 GMT", 60_000],
    ["invalid", 1_000],
  ])("honors bounded Retry-After %s and cancels failed bodies", async (header, expectedDelay) => {
    let now = 0;
    const waits: number[] = [];
    const cancel = vi.fn();
    const responses = [
      new Response(new ReadableStream({ cancel }), { status: 429, headers: { "Retry-After": header } }),
      completedResponse(proposal),
    ];
    const client = createClient({
      now: () => now,
      sleep: async (ms) => { waits.push(ms); now += ms; },
      fetchImpl: async () => responses.shift()!,
    });
    await expect(client.createProposal(pet)).resolves.toEqual(parseRelatedPetAnnotationProposal(proposal));
    expect(waits[0]).toBe(expectedDelay);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    [400, "invalid_request"],
    [401, "authentication_error"],
    [403, "authentication_error"],
    [422, "invalid_request"],
  ] as const)("treats HTTP %s as terminal", async (status, reason) => {
    const fetchImpl = vi.fn(async () => new Response("SECRET_RESPONSE", { status }));
    const error = await createClient({ fetchImpl }).createProposal(pet).catch((value) => value);
    expect(error).toMatchObject({ reason });
    expect(fetchImpl).toHaveBeenCalledOnce();
    assertSanitized(error);
  });

  it.each([
    ["refusal", () => chatResponse(null, "stop", "SECRET_REFUSAL"), "refused"],
    ["content filter", () => chatResponse(null, "content_filter"), "content_filtered"],
    ["unexpected tool call", () => chatResponse(JSON.stringify(proposal), "tool_calls"), "invalid_response"],
    ["unknown finish reason", () => chatResponse(JSON.stringify(proposal), "SECRET_RESPONSE"), "invalid_response"],
  ] as const)("treats %s as terminal", async (_name, response, reason) => {
    const fetchImpl = vi.fn(async () => response());
    const diagnostics: unknown[] = [];
    const error = await createClient({ fetchImpl, onDiagnostic: (entry) => diagnostics.push(entry) })
      .createProposal(pet).catch((value) => value);
    expect(error).toMatchObject({ reason });
    expect(fetchImpl).toHaveBeenCalledOnce();
    assertSanitized([error, diagnostics]);
  });

  it("rejects an empty completion instead of succeeding with null", async () => {
    const fetchImpl = vi.fn(async () => chatResponse(null));
    await expect(createClient({ fetchImpl }).createProposal(pet)).rejects.toMatchObject({ reason: "invalid_response" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each(["headers", "body"] as const)("keeps timeout active through %s and sanitizes abort errors", async (phase) => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (phase === "headers") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("SECRET_TIMEOUT")));
        });
      }
      return new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("SECRET_TIMEOUT")));
        },
      }), { headers: { "Content-Type": "application/json" } });
    });
    const result = createClient({ timeoutMs: 50, fetchImpl }).createProposal(pet).catch((value) => value);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await result;
    expect(error).toMatchObject({ reason: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    assertSanitized(error);
  });

  it("serializes starts but allows in-flight requests to overlap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: number[] = [];
    const waits: number[] = [];
    let resolveFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const client = createClient({
      now: Date.now,
      sleep: async (ms) => {
        waits.push(ms);
        await new Promise((resolve) => setTimeout(resolve, ms));
      },
      fetchImpl: async () => {
        starts.push(Date.now());
        return starts.length === 1 ? firstResponse : completedResponse(proposal);
      },
    });
    const first = client.createProposal(pet);
    const second = client.createProposal({ ...pet, slug: "jinx" });
    const results = Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(starts).toEqual([0, 6_000]);
    expect(waits).toEqual([6_000]);
    resolveFirst?.(completedResponse(proposal));
    await expect(results).resolves.toHaveLength(2);
  });
});

function createClient(options: Partial<ClientOptions> = {}) {
  let clock = 0;
  return createYandexRelatedPetAnnotationClient({
    folderId: "folder-1",
    apiKey: "SECRET_KEY",
    modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
    timeoutMs: 30_000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    randomUUID: () => "request-1",
    onDiagnostic: () => undefined,
    ...options,
  });
}

function completedResponse(value: unknown, usage?: object, finishReason = "stop") {
  return chatResponse(JSON.stringify(value), finishReason, null, usage);
}

function chatResponse(content: string | null, finishReason = "stop", refusal: string | null = null, usage?: object) {
  return Response.json({
    id: "completion-1",
    object: "chat.completion",
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content, refusal } }],
    usage,
  }, { headers: { "x-request-id": "server-request-1" } });
}

function assertSanitized(value: unknown) {
  const text = inspect(value, { depth: 10 });
  for (const secret of [
    "SECRET_KEY", "SECRET_RESPONSE", "SECRET_NETWORK_ERROR", "SECRET_TIMEOUT",
    "SECRET_REFUSAL", "An Arcane fighter", "Violet", RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
  ]) expect(text).not.toContain(secret);
}

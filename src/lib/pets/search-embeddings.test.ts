import { describe, expect, it, vi } from "vitest";

import {
  EmbeddingProviderError,
  buildRelatedPetQuery,
  buildPetSearchDocument,
  createRelatedPetQuerySourceHash,
  createPetSearchSourceHash,
  createYandexEmbeddingClient,
  embeddingToBuffer,
} from "@/lib/pets/search-embeddings";

const pet = {
  slug: "velvet-byte",
  displayName: "Velvet Byte",
  description: "A gothic coding character",
  kind: "character" as const,
  tags: ["night", "gothic"],
};

describe("pet search embeddings", () => {
  it("builds a stable document and source hash from public metadata", () => {
    expect(buildPetSearchDocument(pet)).toBe(
      "name: Velvet Byte\nkind: character\ndescription: A gothic coding character\ntags: gothic, night",
    );
    expect(createPetSearchSourceHash(pet, "model-v1")).toBe(
      createPetSearchSourceHash({ ...pet, tags: ["gothic", "night"] }, "model-v1"),
    );
    expect(createPetSearchSourceHash(pet, "model-v2")).not.toBe(
      createPetSearchSourceHash(pet, "model-v1"),
    );
  });

  it("builds a stable related query from tags with a description fallback", () => {
    expect(
      buildRelatedPetQuery({
        ...pet,
        tags: [" Night ", "gothic", "night", "ＰＩＸＥＬ"],
      }),
    ).toBe("night gothic pixel");
    expect(buildRelatedPetQuery({ ...pet, tags: [] })).toBe(
      pet.description,
    );
    expect(createRelatedPetQuerySourceHash(pet, "query-v1")).not.toBe(
      createRelatedPetQuerySourceHash(
        { ...pet, tags: ["gothic", "night"] },
        "query-v1",
      ),
    );
    expect(createRelatedPetQuerySourceHash(pet, "query-v2")).not.toBe(
      createRelatedPetQuerySourceHash(pet, "query-v1"),
    );
  });

  it("encodes float vectors as little-endian YDB bytes", () => {
    const buffer = embeddingToBuffer([1.5, -2.25]);

    expect(buffer).toHaveLength(9);
    expect(buffer.readFloatLE(0)).toBe(1.5);
    expect(buffer.readFloatLE(4)).toBe(-2.25);
    expect(buffer[8]).toBe(0x01);
  });

  it("uses query/document model URIs and Api-Key authentication", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "model-v1",
      dimensions: 3,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({ embedding: [0.1, 0.2, 0.3] });
      },
    });

    await client.embedQuery("  SEXY  ");
    await client.embedDocument("pet document");

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(
      "https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding",
    );
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: "Api-Key secret-key",
      "Content-Type": "application/json",
      "x-folder-id": "folder-1",
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      modelUri: "emb://folder-1/text-search-query/latest",
      text: "sexy",
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      modelUri: "emb://folder-1/text-search-doc/latest",
      text: "pet document",
    });
  });

  it("uses the managed v2 doc/query models with an explicit 768 dimension", async () => {
    const requests: RequestInit[] = [];
    const embedding = Array.from({ length: 768 }, (_, index) => index / 768);
    const client = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "yandex-text-embeddings-v2-768-2026-07",
      dimensions: 768,
      queryModelPath: "text-embeddings-v2-query",
      documentModelPath: "text-embeddings-v2-doc",
      requestDimensions: 768,
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});
        return Response.json({ embedding });
      },
    });

    await client.embedQuery("gothic pet");
    await client.embedDocument("visual caption");

    expect(JSON.parse(String(requests[0]?.body))).toEqual({
      modelUri: "emb://folder-1/text-embeddings-v2-query",
      text: "gothic pet",
      dim: "768",
    });
    expect(JSON.parse(String(requests[1]?.body))).toEqual({
      modelUri: "emb://folder-1/text-embeddings-v2-doc",
      text: "visual caption",
      dim: "768",
    });
  });

  it("caches normalized query embeddings without repeating provider calls", async () => {
    let calls = 0;
    const client = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "model-v1",
      dimensions: 2,
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ embedding: [0.4, 0.6] });
      },
    });

    expect(await client.embedQuery(" Sexy ")).toEqual([0.4, 0.6]);
    expect(await client.embedQuery("ＳＥＸＹ")).toEqual([0.4, 0.6]);
    expect(calls).toBe(1);
  });

  it("expires cached queries and evicts the least recently used entry", async () => {
    let now = 0;
    let calls = 0;
    const client = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "model-v1",
      dimensions: 1,
      queryCacheSize: 2,
      queryCacheTtlMs: 100,
      now: () => now,
      fetchImpl: async () => Response.json({ embedding: [++calls] }),
    });

    await client.embedQuery("first");
    await client.embedQuery("second");
    await client.embedQuery("first");
    await client.embedQuery("third");
    expect(await client.embedQuery("second")).toEqual([4]);

    now = 100;
    expect(await client.embedQuery("third")).toEqual([5]);
  });

  it("rejects invalid dimensions and rate-limits distinct provider calls", async () => {
    const invalidClient = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "model-v1",
      dimensions: 3,
      fetchImpl: async () => Response.json({ embedding: [0.1] }),
    });
    await expect(invalidClient.embedQuery("sexy")).rejects.toMatchObject({
      reason: "invalid_response",
    });

    const limitedClient = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "model-v1",
      dimensions: 1,
      requestsPerMinute: 1,
      fetchImpl: async () => Response.json({ embedding: [0.1] }),
    });
    await limitedClient.embedQuery("first");
    await expect(limitedClient.embedQuery("second")).rejects.toEqual(
      expect.objectContaining<Partial<EmbeddingProviderError>>({
        reason: "rate_limited",
      }),
    );
  });

  it.each([
    [429, "rate_limited"],
    [500, "provider_error"],
  ] as const)("classifies provider HTTP %s failures", async (status, reason) => {
    const client = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "model-v1",
      dimensions: 1,
      fetchImpl: async () => new Response(null, { status }),
    });

    await expect(client.embedQuery("space")).rejects.toMatchObject({ reason });
  });

  it("times out provider calls and caps concurrent requests", async () => {
    vi.useFakeTimers();
    const timeoutClient = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "model-v1",
      dimensions: 1,
      timeoutMs: 50,
      fetchImpl: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });
    const timeoutPromise = timeoutClient.embedQuery("space");
    const timeoutExpectation = expect(timeoutPromise).rejects.toMatchObject({
      reason: "timeout",
    });
    await vi.advanceTimersByTimeAsync(50);
    await timeoutExpectation;
    vi.useRealTimers();

    let resolveFirst: ((response: Response) => void) | undefined;
    const concurrentClient = createYandexEmbeddingClient({
      folderId: "folder-1",
      apiKey: "secret-key",
      revision: "model-v1",
      dimensions: 1,
      maxConcurrent: 1,
      fetchImpl: async () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const first = concurrentClient.embedQuery("first");
    await expect(concurrentClient.embedQuery("second")).rejects.toMatchObject({
      reason: "overloaded",
    });
    resolveFirst?.(Response.json({ embedding: [0.1] }));
    await expect(first).resolves.toEqual([0.1]);
  });
});

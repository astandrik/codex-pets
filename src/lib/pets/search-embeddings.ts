import { createHash } from "node:crypto";

import { normalizeSearchQuery } from "@/lib/pets/search-ranking";
import type { PetKind } from "@/lib/pets/types";

const EMBEDDING_ENDPOINT =
  "https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding";
const DEFAULT_DIMENSIONS = 256;
const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_REQUESTS_PER_MINUTE = 60;
const DEFAULT_QUERY_CACHE_SIZE = 500;
const DEFAULT_QUERY_CACHE_TTL_MS = 10 * 60 * 1_000;

export type PetSearchDocumentInput = {
  slug: string;
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
};

export type EmbeddingFallbackReason =
  | "invalid_request"
  | "invalid_response"
  | "overloaded"
  | "provider_error"
  | "rate_limited"
  | "timeout";

export class EmbeddingProviderError extends Error {
  constructor(
    public readonly reason: EmbeddingFallbackReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EmbeddingProviderError";
  }
}

export type YandexEmbeddingClient = {
  revision: string;
  dimensions: number;
  embedQuery: (text: string) => Promise<number[]>;
  embedDocument: (text: string) => Promise<number[]>;
};

type YandexEmbeddingClientOptions = {
  folderId: string;
  apiKey: string;
  revision: string;
  dimensions?: number;
  queryModelPath?: string;
  documentModelPath?: string;
  requestDimensions?: number | null;
  timeoutMs?: number;
  maxConcurrent?: number;
  requestsPerMinute?: number;
  queryCacheSize?: number;
  queryCacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export function buildPetSearchDocument(pet: PetSearchDocumentInput): string {
  const tags = Array.from(
    new Set(
      pet.tags
        .map((tag) => tag.normalize("NFKC").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();

  return [
    `name: ${pet.displayName.normalize("NFKC").trim()}`,
    `kind: ${pet.kind}`,
    `description: ${pet.description.normalize("NFKC").trim()}`,
    `tags: ${tags.join(", ")}`,
  ].join("\n");
}

export function createPetSearchSourceHash(
  pet: PetSearchDocumentInput,
  modelRevision: string,
): string {
  return createHash("sha256")
    .update(modelRevision)
    .update("\n")
    .update(buildPetSearchDocument(pet))
    .digest("hex");
}

export function embeddingToBuffer(embedding: readonly number[]): Buffer {
  const buffer = Buffer.allocUnsafe(
    embedding.length * Float32Array.BYTES_PER_ELEMENT + 1,
  );
  embedding.forEach((value, index) => {
    buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
  });
  // YDB's binary FloatVector format ends with the Float32 type marker.
  buffer[buffer.length - 1] = 0x01;
  return buffer;
}

export function createYandexEmbeddingClient(
  options: YandexEmbeddingClientOptions,
): YandexEmbeddingClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const requestsPerMinute =
    options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE;
  const queryCacheSize = options.queryCacheSize ?? DEFAULT_QUERY_CACHE_SIZE;
  const queryCacheTtlMs =
    options.queryCacheTtlMs ?? DEFAULT_QUERY_CACHE_TTL_MS;
  const queryCache = new Map<
    string,
    { embedding: number[]; expiresAt: number }
  >();
  let activeRequests = 0;
  let requestTimestamps: number[] = [];

  return {
    revision: options.revision,
    dimensions,
    embedQuery,
    embedDocument: (text) => requestEmbedding("doc", normalizeDocument(text)),
  };

  async function embedQuery(text: string): Promise<number[]> {
    const normalized = normalizeSearchQuery(text).text;
    if (!normalized) {
      throw new EmbeddingProviderError(
        "invalid_request",
        "Embedding query must not be empty.",
      );
    }

    const cacheKey = createHash("sha256").update(normalized).digest("hex");
    const cached = queryCache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      queryCache.delete(cacheKey);
      queryCache.set(cacheKey, cached);
      return [...cached.embedding];
    }
    queryCache.delete(cacheKey);

    const embedding = await requestEmbedding("query", normalized);
    queryCache.set(cacheKey, {
      embedding: [...embedding],
      expiresAt: now() + queryCacheTtlMs,
    });
    while (queryCache.size > queryCacheSize) {
      const oldestKey = queryCache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      queryCache.delete(oldestKey);
    }
    return embedding;
  }

  async function requestEmbedding(
    kind: "doc" | "query",
    text: string,
  ): Promise<number[]> {
    reserveProviderCall();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const modelPath =
        kind === "query"
          ? (options.queryModelPath ?? "text-search-query/latest")
          : (options.documentModelPath ?? "text-search-doc/latest");
      const requestBody = {
        modelUri: `emb://${options.folderId}/${modelPath}`,
        text,
        ...(options.requestDimensions
          ? { dim: String(options.requestDimensions) }
          : {}),
      };
      const response = await fetchImpl(EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${options.apiKey}`,
          "Content-Type": "application/json",
          "x-folder-id": options.folderId,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new EmbeddingProviderError(
          response.status === 429 ? "rate_limited" : "provider_error",
          `Embedding provider returned HTTP ${response.status}.`,
        );
      }

      const payload: unknown = await response.json();
      const embedding = readEmbedding(payload);
      if (
        embedding.length !== dimensions ||
        embedding.some((value) => !Number.isFinite(value))
      ) {
        throw new EmbeddingProviderError(
          "invalid_response",
          `Embedding provider returned ${embedding.length} values; expected ${dimensions}.`,
        );
      }
      return embedding;
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      if (controller.signal.aborted) {
        throw new EmbeddingProviderError(
          "timeout",
          "Embedding provider request timed out.",
          { cause: error },
        );
      }
      throw new EmbeddingProviderError(
        "provider_error",
        "Embedding provider request failed.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      activeRequests -= 1;
    }
  }

  function reserveProviderCall(): void {
    const timestamp = now();
    requestTimestamps = requestTimestamps.filter(
      (startedAt) => timestamp - startedAt < 60_000,
    );
    if (activeRequests >= maxConcurrent) {
      throw new EmbeddingProviderError(
        "overloaded",
        "Embedding provider concurrency limit reached.",
      );
    }
    if (requestTimestamps.length >= requestsPerMinute) {
      throw new EmbeddingProviderError(
        "rate_limited",
        "Embedding provider per-process rate limit reached.",
      );
    }
    requestTimestamps.push(timestamp);
    activeRequests += 1;
  }
}

function normalizeDocument(text: string): string {
  const normalized = text.normalize("NFKC").trim();
  if (!normalized) {
    throw new EmbeddingProviderError(
      "invalid_request",
      "Embedding document must not be empty.",
    );
  }
  return normalized;
}

function readEmbedding(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const embedding = (payload as { embedding?: unknown }).embedding;
  if (!Array.isArray(embedding)) return [];
  return embedding.filter((value): value is number => typeof value === "number");
}

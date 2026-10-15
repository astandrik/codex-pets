import { createEmbeddingClient, EmbeddingProviderError } from "@/lib/pets/search/search-embeddings";
import { OPENAI_EMBEDDING_DIMENSIONS, OPENAI_EMBEDDING_MODEL } from "@/lib/pets/openai-embedding-profile";

export type PrivateEmbeddingConfig = {
  endpoint: string;
  token: string;
};

export function validatePrivateEmbeddingEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  // Docker service name is fixed. Public URLs, redirects and direct fallback are forbidden.
  if (url.protocol !== "http:" || url.hostname !== "pets-embeddings" ||
      url.port !== "8090" || url.pathname !== "/embeddings" ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("invalid_private_embedding_endpoint");
  }
  return url.href;
}

export function createPrivateOpenAIEmbeddingClient(options: PrivateEmbeddingConfig & {
  revision: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}) {
  const endpoint = validatePrivateEmbeddingEndpoint(options.endpoint);
  if (!options.token.trim()) throw new Error("embedding_service_token_missing");
  return createEmbeddingClient({
    revision: options.revision,
    dimensions: OPENAI_EMBEDDING_DIMENSIONS,
    timeoutMs: options.timeoutMs,
    request: async (_kind, text, signal) => {
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: [text], mode: "online" }),
        signal,
      });
      if (!response.ok) throw new EmbeddingProviderError(
        response.status === 429 ? "rate_limited" : "provider_error", "Private embedding service failed.");
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !("model" in payload) ||
          payload.model !== OPENAI_EMBEDDING_MODEL || !("data" in payload) || !Array.isArray(payload.data)) {
        throw new EmbeddingProviderError("invalid_response", "Invalid embedding response.");
      }
      const embedding: unknown = payload.data[0]?.embedding;
      if (payload.data.length !== 1 || !Array.isArray(embedding) ||
          embedding.length !== OPENAI_EMBEDDING_DIMENSIONS ||
          !embedding.every((x): x is number => typeof x === "number" && Number.isFinite(x)) ||
          embedding.reduce((sum, x) => sum + x * x, 0) < 1e-12) {
        throw new EmbeddingProviderError("invalid_response", "Invalid embedding vector.");
      }
      return embedding;
    },
  });
}

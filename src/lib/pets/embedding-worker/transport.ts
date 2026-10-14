import { createAMSOpenAIJSONTransport } from "@/lib/openai-ams";
import { OPENAI_EMBEDDING_DIMENSIONS, OPENAI_EMBEDDING_MODEL } from "@/lib/pets/openai-embedding-profile";

export { validateAMSProxy } from "@/lib/openai-ams";

export function createAMSOpenAITransport(apiKey: string, proxyURL: string) {
  const request = createAMSOpenAIJSONTransport(apiKey, proxyURL);
  return (input: readonly string[]): Promise<unknown> => request("embeddings", {
    model: OPENAI_EMBEDDING_MODEL, dimensions: OPENAI_EMBEDDING_DIMENSIONS,
    encoding_format: "float", input,
  });
}
